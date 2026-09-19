import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromSeed } from '@nats-io/nkeys'
import { connect, nkeyAuthenticator, type NatsConnection } from '@nats-io/transport-node'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { NatsRegistrationClient } from '@lixpi/nats-service/registration'
import { authPolicy } from '@lixpi/nats-subject-registry/policy'
import { signApplicationRegistration } from '@lixpi/nats-subject-registry/registration'

const targets = process.env.NATS_REGISTRATION_TEST_TARGETS
describe.runIf(Boolean(targets))('application registrations on disposable Go brokers', () => {
    const connections: NatsConnection[] = []
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwks = createServer((_request, response) => response.end(JSON.stringify({ keys: [{
        ...keys.publicKey.export({ format: 'jwk' }),
        kid: 'proof',
        alg: 'RS256',
        use: 'sig',
    }] })))
    let servers: string[]
    let fixture: string
    let issuer: string
    let signed: ReturnType<typeof signApplicationRegistration>
    beforeAll(async () => {
        servers = targets!.split(',')

        if (servers.some(server => !new URL(server).hostname.startsWith('lixpi-nats-embedded-proof')))
            throw new Error('Registration tests require isolated proof brokers')

        fixture = process.env.NATS_TEST_CLIENT_FIXTURE!

        if (!fixture)
            throw new Error('Synthetic fixture directory required')

        await new Promise<void>(resolve => jwks.listen(0, '0.0.0.0', resolve))
        const ip = Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal)?.address
        const address = jwks.address()

        if (
            !ip
            || !address
            || typeof address === 'string'
        )
            throw new Error('Fixture JWKS address unavailable')

        issuer = `http://${ip}:${address.port}/`
        const env: Record<string, string> = {
            ENVIRONMENT: 'local',
            MOCK_AUTH0: 'true',
            MOCK_AUTH0_DOMAIN: `${ip}:${address.port}`,
            MOCK_AUTH0_JWKS_URI: issuer,
            AUTH0_API_IDENTIFIER: 'proof',
        }

        for (const profile of authPolicy.services) {
            if (
                !profile.required
                && profile.name !== 'NEX_NODE'
            )
                continue

            env[profile.publicKeyEnv] = fromSeed(readFileSync(`${fixture}/${profile.name}.seed`)).getPublicKey()
        }

        signed = signApplicationRegistration(env, readFileSync(`${fixture}/registration-authority.seed`, 'utf8'), Date.now())
        await NatsRegistrationClient.apply({
            servers,
            password: 'synthetic-registration',
            registration: JSON.stringify(signed),
        })
    })
    afterAll(async () => {
        for (const connection of connections)
            await connection.close()

        jwks.close()
    })
    it('accepts the TypeScript-signed application manifest on every broker and admits browser requests', async () => {
        const seed = readFileSync(`${fixture}/API.seed`)
        const subject = NATS_SUBJECTS.USER_SUBJECTS.GET_USER
        const api = await connect({
            servers,
            authenticator: nkeyAuthenticator(seed),
            reconnect: false,
        })
        connections.push(api)
        api.subscribe(subject, { callback: (_error, message) => message.respond('registered application') })
        await api.flush()
        const header = Buffer.from(JSON.stringify({
            alg: 'RS256',
            kid: 'proof',
        })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
            iss: issuer,
            aud: 'proof',
            sub: 'proof-user',
            exp: Math.floor(Date.now() / 1000) + 60,
        })).toString('base64url')
        const content = `${header}.${payload}`
        const token = `${content}.${sign('RSA-SHA256', Buffer.from(content), keys.privateKey).toString('base64url')}`

        for (const server of servers) {
            const browser = await connect({
                servers: [server],
                token,
                inboxPrefix: `_INBOX.${Buffer.from('proof-user').toString('hex')}`,
                reconnect: false,
            })
            connections.push(browser)
            expect((await browser.request(subject, '', { timeout: 2000 })).string()).toBe('registered application')
        }
    })
    it('rejects tampering with the approved bytes', async () => void (await expect(NatsRegistrationClient.apply({
        servers,
        password: 'synthetic-registration',
        registration: JSON.stringify({
            ...signed,
            payload: Buffer.from('{}').toString('base64'),
        }),
    })).rejects.toThrow('signature')))
})
