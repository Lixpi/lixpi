import { randomBytes } from 'node:crypto'
import {
    createAccount,
    fromPublic,
    fromSeed,
} from '@nats-io/nkeys'
import { authPolicy } from './policy.ts'

type Permissions = {
    pub?: {
        allow?: readonly string[]
        deny?: readonly string[]
    }
    sub?: {
        allow?: readonly string[]
        deny?: readonly string[]
    }
    resp?: {
        max: number
        ttl: number
    }
}

type Environment = Record<string, string | undefined>

const permissionDirection = (direction: Permissions['pub']) => ({
    ...(direction?.allow?.length ? { allow: [...direction.allow] } : {}),
    ...(!direction?.allow?.length
        ? { deny: ['>'] }
        : direction.deny?.length
            ? { deny: [...direction.deny] }
            : {}),
})

const normalizePermissions = (permissions: Permissions) => ({
    pub: permissionDirection(permissions.pub),
    sub: permissionDirection(permissions.sub),
    ...(permissions.resp ? { resp: permissions.resp } : {}),
})

export const applicationManifest = (
    env: Environment,
    version: number,
) => {
    if (
        !Number.isSafeInteger(version)
        || version < 1
    )
        throw new Error('Registration version must be a positive safe integer')

    const services = authPolicy.services.flatMap(profile => {
        const publicKey = env[profile.publicKeyEnv]

        if (!publicKey) {
            if (profile.required)
                throw new Error(`Missing registration identity: ${profile.publicKeyEnv}`)

            return []
        }

        if (!fromPublic(publicKey).getPublicKey().startsWith('U'))
            throw new Error(`Service registration requires a public user key: ${profile.publicKeyEnv}`)

        return [{
            userId: profile.userId,
            publicKey,
            account: profile.account,
            permissions: normalizePermissions(profile.permissions),
        }]
    })
    const extra = JSON.parse(env.NATS_SERVICE_AUTH_REGISTRATIONS || '[]')

    if (!Array.isArray(extra))
        throw new Error('Additional registrations must be an array')

    for (const service of extra)
        services.push({
            ...service,
            permissions: normalizePermissions(service.permissions),
        })

    const mock = env.MOCK_AUTH0 === 'true'

    if (
        mock
        && env.ENVIRONMENT !== 'local'
    )
        throw new Error('Local identity provider requires ENVIRONMENT=local')

    if (
        mock
        && (!env.MOCK_AUTH0_DOMAIN || !env.MOCK_AUTH0_JWKS_URI)
    )
        throw new Error('Local identity provider requires domain and JWKS URL')

    const domain = mock ? `http://${env.MOCK_AUTH0_DOMAIN}` : env.AUTH0_DOMAIN

    if (
        !domain
        || !env.AUTH0_API_IDENTIFIER
    )
        throw new Error('Browser registration requires issuer and audience')

    const issuer = `${domain.replace(/\/+$/u, '')}/`
    const jwksUrl = mock ? env.MOCK_AUTH0_JWKS_URI! : `${issuer}.well-known/jwks.json`

    for (const address of [issuer, jwksUrl]) {
        const url = new URL(address)

        if (
            url.username
            || url.password
            || url.hash
            || (url.protocol !== 'https:' && !(mock && url.protocol === 'http:'))
        )
            throw new Error('Invalid browser verification URL')
    }

    const expand = (subject: string) => subject.replaceAll('{userIdToken}', '{subjectToken}').replaceAll('{userId}', '{subject}')
    const browserPermissions = normalizePermissions({
        pub: { allow: [...new Set([
            '_INBOX.{subjectToken}.>',
            ...authPolicy.browser.flatMap(p => p.pub?.allow ?? []).map(expand),
        ])] },
        sub: { allow: [...new Set([
            '_INBOX.{subjectToken}.>',
            ...authPolicy.browser.flatMap(p => p.sub?.allow ?? []).map(expand),
        ])] },
    })

    return {
        schema: 1,
        owner: 'lixpi',
        version,
        services,
        browsers: [{
            issuer,
            audience: env.AUTH0_API_IDENTIFIER,
            jwksUrl,
            account: 'AUTH',
            permissions: [browserPermissions],
        }],
    }
}

export const signApplicationRegistration = (
    env: Environment,
    seed: string,
    version: number,
) => {
    const key = fromSeed(
        new TextEncoder().encode(seed),
    )

    try {
        if (!key.getPublicKey().startsWith('A'))
            throw new Error('Registration signing requires an account key')

        const payload = Buffer.from(
            JSON.stringify(
                applicationManifest(env, version),
            ),
        )

        return {
            issuer: key.getPublicKey(),
            payload: payload.toString('base64'),
            signature: Buffer.from(
                key.sign(payload),
            ).toString('base64'),
        }
    } finally {
        key.clear()
    }
}

// Called by deployment tooling. Its returned signing seed must never enter serving containers.
export const registrationEnvironment = (env: Environment): Record<string, string> => {
    const key = env.NATS_REGISTRATION_AUTHORITY_SEED
        ? fromSeed(
            new TextEncoder().encode(env.NATS_REGISTRATION_AUTHORITY_SEED),
        )
        : createAccount()

    try {
        const seed = new TextDecoder().decode(
            key.getSeed(),
        )
        const previous = env.NATS_APPLICATION_REGISTRATION ? JSON.parse(env.NATS_APPLICATION_REGISTRATION) : undefined
        let version = 1

        if (previous) {
            const payload = Buffer.from(previous.payload, 'base64')

            if (
                previous.issuer !== key.getPublicKey()
                || !key.verify(
                    payload,
                    Buffer.from(previous.signature, 'base64'),
                )
            )
                throw new Error('Existing registration does not match its authority')

            const manifest = JSON.parse(
                payload.toString(),
            )
            version = manifest.version

            if (JSON.stringify(
                applicationManifest(env, version),
            ) !== payload.toString())
                version++
        }

        const signed = signApplicationRegistration(
            env,
            seed,
            version,
        )
        const accounts = [
            ...new Set(
                applicationManifest(env, version)
                    .services.map(service => service.account)
                    .concat('AUTH'),
            ),
        ]

        return {
            NATS_REGISTRATION_AUTHORITY_SEED: seed,
            NATS_REGISTRATION_AUTHORITIES: JSON.stringify([{
                publicKey: signed.issuer,
                owner: 'lixpi',
                accounts,
            }]),
            NATS_REGISTRATION_PASSWORD: env.NATS_REGISTRATION_PASSWORD || randomBytes(32).toString('hex'),
            NATS_APPLICATION_REGISTRATION: JSON.stringify(signed),
        }
    } finally {
        key.clear()
    }
}
