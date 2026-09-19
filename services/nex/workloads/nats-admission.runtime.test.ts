import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { connect } from '@nats-io/transport-node'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import { Objm } from '@nats-io/obj'
import { generateSelfIssuedJWT } from '@lixpi/nats-service'
import { getNatsUserInboxPrefix, NATS_SUBJECTS } from '@lixpi/constants'

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

describe.runIf(process.env.LIXPI_NATS_AUTH_RUNTIME_TEST === 'true')('embedded NATS admission', () => {
    const servers = 'nats://lixpi-nats-1:4222'
    const serviceConnection = async (name: string) => {
        const env = parseEnv(readFileSync('/run/nats-test.env', 'utf8'))

        return connect({
            servers,
            token: generateSelfIssuedJWT(env[`NATS_${name}_NKEY_SEED`], `svc:${name.toLowerCase().replaceAll('_', '-')}`),
            reconnect: false,
        })
    }
    it('admits a browser independently of API and denies the retired password', async () => {
        const env = parseEnv(readFileSync('/run/nats-test.env', 'utf8'))
        const response = await fetch('http://lixpi-localauth0:3000/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: 'client_id',
                client_secret: 'client_secret',
                audience: env.AUTH0_API_IDENTIFIER,
                grant_type: 'client_credentials',
            }),
        })
        expect(response.status).toBe(200)
        const { access_token: token } = await response.json()
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
        const browser = await connect({
            servers,
            token,
            inboxPrefix: getNatsUserInboxPrefix(claims.sub),
            reconnect: false,
        })

        try {
            await browser.flush()
            const denied = Promise.withResolvers<Error>()
            browser.subscribe('$SYS.REQ.USER.AUTH', { callback: error => { if (error)
                denied.resolve(error) } })
            await browser.flush()
            expect((await denied.promise).message).toMatch(/permission/i)
        } finally { await browser.close() }

        await expect(connect({
            servers,
            user: 'regular_user',
            pass: 'synthetic-retired-password',
            reconnect: false,
        })).rejects.toThrow()
        await expect(connect({
            servers,
            token: 'invalid',
            reconnect: false,
        })).rejects.toThrow()
    }, 15000)
    it('admits service identities and shares Object Store data in AUTH', async () => {
        const api = await serviceConnection('API')
        const worker = await serviceConnection('FILE_CONVERSION')
        const fidelity = await serviceConnection('CHARACTER_FIDELITY')
        const bucket = `auth_acceptance_${randomUUID().replaceAll('-', '')}`
        const manager = new Objm(jetstream(api))

        try {
            const store = await manager.create(bucket, { replicas: 3 })
            const workerStore = await new Objm(jetstream(worker)).open(bucket)
            await workerStore.putBlob({ name: 'acceptance' }, new TextEncoder().encode('auth-account-preserved'))
            const bytes = await store.getBlob('acceptance')
            expect(new TextDecoder().decode(bytes!)).toBe('auth-account-preserved')
            const fidelityStore = await new Objm(jetstream(fidelity)).open(bucket)
            expect(new TextDecoder().decode((await fidelityStore.getBlob('acceptance'))!)).toBe('auth-account-preserved')
            const denied = Promise.withResolvers<Error>()
            api.subscribe('$SYS.REQ.USER.AUTH', { callback: error => { if (error)
                denied.resolve(error) } })
            await api.flush()
            expect((await denied.promise).message).toMatch(/permission/i)
        } finally {
            await (await jetstreamManager(api)).streams.delete(`OBJ_${bucket}`)
            await Promise.all([api.close(), worker.close(), fidelity.close()])
        }
    }, 15000)
    it.runIf(process.env.LIXPI_NATS_WORKLOAD_RUNTIME_TEST === 'true')('routes API requests and replies through both live workload identities', async () => {
        const api = await serviceConnection('API')

        try {
            const conversion = await api.request(NATS_SUBJECTS.BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS, JSON.stringify({
                jobId: 'auth-acceptance',
                organizationId: 'auth-acceptance',
                requestedRenditions: ['preview'],
                bucketName: 'invalid',
            }), { timeout: 5000 })
            expect(conversion.json().renditions[0].status).toBe('failed')
            const fidelity = await api.request(NATS_SUBJECTS.CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL, JSON.stringify({ jobId: 'auth-acceptance' }), { timeout: 5000 })
            expect(fidelity.json().error.code).toBe('CHARACTER_FIDELITY_REQUEST_INVALID')
        } finally {
            await api.close()
        }
    })
})
