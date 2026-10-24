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
    it('binds admission to the signed browser profile only for the coordinated release', () => {
        const env = fixture()
        expect(applicationManifest(env, 1).browsers[0].admission).toBeUndefined()
        const enabled = applicationManifest({
            ...env,
            ACCOUNT_ADMISSION_ENABLED: 'true',
            ACCOUNT_ADMISSION_STREAM: 'ACCOUNTS',
        }, 1)
        expect(enabled.browsers[0].admission).toEqual({
            subject: 'accounts.admission.check.v1',
            claim: 'https://lixpi.ai/admission',
            stream: 'ACCOUNTS',
        })
        expect(enabled.browsers[0].permissions).toEqual(applicationManifest(env, 1).browsers[0].permissions)
        expect(enabled.services.find(service => service.userId === 'svc:api')?.permissions.sub.allow).toContain('accounts.admission.check.v1')
        expect(() => applicationManifest({
            ...env,
            ACCOUNT_ADMISSION_ENABLED: 'yes',
        }, 1)).toThrow('ACCOUNT_ADMISSION_ENABLED')
        expect(enabled.browsers[0].permissions[0].pub.allow?.some(subject => subject.includes('admission'))).toBe(false)
    })
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

    it('restricts worker admission decisions and invalidations to service identities', () => {
        const manifest = applicationManifest(fixture(), 1)

        for (const userId of ['svc:file-conversion', 'svc:character-fidelity']) {
            const permissions = manifest.services.find(service => service.userId === userId)!.permissions
            expect(permissions.pub.allow).toContain('accounts.admission.work.v1')
            expect(permissions.sub.allow).toContain('accounts.admission.changed.v1')
            expect(permissions.pub.allow).not.toContain('accounts.admission.changed.v1')
        }

        expect(manifest.services.find(service => service.userId === 'svc:api')!.permissions.sub.allow).toContain('accounts.admission.work.v1')

        for (const browser of manifest.browsers)
            expect(JSON.stringify(browser.permissions)).not.toContain('accounts.admission.')
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
