import { createUser, fromPublic } from '@nats-io/nkeys'
import { describe, expect, it } from 'vitest'
import { authPolicy } from './policy.ts'
import { applicationManifest, registrationEnvironment } from './registration.ts'

const fixture = () => ({
    ENVIRONMENT: 'local',
    MOCK_AUTH0: 'true',
    MOCK_AUTH0_DOMAIN: 'identity:3000',
    MOCK_AUTH0_JWKS_URI: 'http://identity:3000/.well-known/jwks.json',
    AUTH0_API_IDENTIFIER: 'test-audience',
    ...Object.fromEntries(authPolicy.services.map(service => [service.publicKeyEnv, createUser().getPublicKey()])),
})

describe('deployment registration signing', () => {
    it('signs application permissions and advances the version only when declarations change', () => {
        const env = fixture()
        const generated = registrationEnvironment(env)
        const envelope = JSON.parse(generated.NATS_APPLICATION_REGISTRATION)
        const payload = Buffer.from(envelope.payload, 'base64')
        expect(fromPublic(envelope.issuer).verify(payload, Buffer.from(envelope.signature, 'base64'))).toBe(true)
        expect(JSON.parse(payload.toString())).toEqual(applicationManifest(env, 1))
        expect(registrationEnvironment({
            ...env,
            ...generated,
        })).toEqual(generated)
        const changed = registrationEnvironment({
            ...env,
            ...generated,
            NATS_API_NKEY_PUBLIC: createUser().getPublicKey(),
        })
        expect(JSON.parse(Buffer.from(JSON.parse(changed.NATS_APPLICATION_REGISTRATION).payload, 'base64').toString()).version).toBe(2)
        expect(changed.NATS_REGISTRATION_AUTHORITY_SEED).toBe(generated.NATS_REGISTRATION_AUTHORITY_SEED)
    })

    it('rejects tampered previous declarations and missing required identities', () => {
        const env = fixture()
        const generated = registrationEnvironment(env)
        const envelope = JSON.parse(generated.NATS_APPLICATION_REGISTRATION)
        envelope.payload = Buffer.from('{}').toString('base64')
        expect(() => registrationEnvironment({
            ...env,
            ...generated,
            NATS_APPLICATION_REGISTRATION: JSON.stringify(envelope),
        })).toThrow('does not match')
        expect(() => applicationManifest({
            ...env,
            NATS_API_NKEY_PUBLIC: '',
        }, 1)).toThrow('NATS_API_NKEY_PUBLIC')
    })

    it('limits raw browser identity interpolation and keeps missing directions denied', () => {
        const env = fixture()
        const extra = [{
            userId: 'custom',
            publicKey: createUser().getPublicKey(),
            account: 'AUTH',
            permissions: { pub: { allow: ['custom.events'] } },
        }]
        const manifest = applicationManifest({
            ...env,
            NATS_SERVICE_AUTH_REGISTRATIONS: JSON.stringify(extra),
        }, 1)
        expect(manifest.services.at(-1)?.permissions.sub).toEqual({ deny: ['>'] })
        expect(JSON.stringify(manifest.browsers)).toContain('{subjectToken}')
        expect(JSON.stringify(manifest.browsers)).not.toContain('{userIdToken}')
        expect(() => applicationManifest({
            ...env,
            ENVIRONMENT: 'production',
        }, 1)).toThrow('Local identity')
    })
})
