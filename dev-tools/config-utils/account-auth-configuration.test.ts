import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from 'node:util'
import { registrationEnvironment } from '@lixpi/nats-subject-registry/registration'
import { LocalAccountAuthConfiguration } from './account-auth-configuration.ts'

vi.mock('@lixpi/nats-subject-registry/registration', () => ({ registrationEnvironment: vi.fn(values => ({ NATS_APPLICATION_REGISTRATION: JSON.stringify({ payload: Buffer.from(JSON.stringify({ browsers: [{
    issuer: `${values.AUTH0_DOMAIN}/`,
    audience: values.AUTH0_API_IDENTIFIER,
    admission: { stream: values.ACCOUNT_ADMISSION_STREAM },
}] })).toString('base64') }) })) }))
const source = `# preserve developer settings\nENVIRONMENT=local\nAUTH0_TENANT_DOMAIN=example.us.auth0.com\nDOMAIN_NAME=dev.example.com\nVITE_AUTH0_CLIENT_ID=browser\nNATS_REGISTRATION_AUTHORITY_SEED=private-seed\nNATS_APPLICATION_REGISTRATION=previous\nACCOUNT_ADMISSION_STREAM=ADMISSION_local\nMOCK_AUTH0=true\nVITE_MOCK_AUTH=true\nACCOUNT_ADMISSION_ENABLED=false\nCUSTOM="private-value" # untouched\n`

describe('local account authentication cutover configuration', () => {
    afterEach(() => vi.clearAllMocks())
    it('enables real authentication and signed admission together while retaining unrelated settings', () => {
        const output = LocalAccountAuthConfiguration.render(source)
        expect(parseEnv(output)).toMatchObject({
            MOCK_AUTH0: 'false',
            VITE_MOCK_AUTH: 'false',
            ACCOUNT_ADMISSION_ENABLED: 'true',
            AUTH0_DOMAIN: 'https://example.us.auth0.com',
            VITE_AUTH0_DOMAIN: 'example.us.auth0.com',
        })
        expect(output).toContain('CUSTOM="private-value" # untouched')
        expect(registrationEnvironment).toHaveBeenCalledWith(expect.objectContaining({
            MOCK_AUTH0: 'false',
            ACCOUNT_ADMISSION_ENABLED: 'true',
            NATS_REGISTRATION_AUTHORITY_SEED: 'private-seed',
        }))
        expect(LocalAccountAuthConfiguration.render(output)).toBe(output)
    })
    it('keeps explicitly selected custom-domain login', () => void expect(parseEnv(LocalAccountAuthConfiguration.render(`${source}AUTH0_USE_DEVELOPER_KEYS=false\n`)).AUTH0_DOMAIN).toBe('https://auth.dev.example.com'))
    it('refuses a stale signer that omits account enforcement', () => {
        vi.mocked(registrationEnvironment).mockReturnValueOnce({ NATS_APPLICATION_REGISTRATION: JSON.stringify({ payload: Buffer.from(JSON.stringify({ browsers: [{ issuer: 'https://example.us.auth0.com/' }] })).toString('base64') }) })
        expect(() => LocalAccountAuthConfiguration.render(source)).toThrow('Rebuild lixpi-config-utils')
    })
    it('rejects deployed environments, unbound signing keys, missing streams and invalid mode before signing', () => {
        for (const invalid of [source.replace('ENVIRONMENT=local', 'ENVIRONMENT=production'), source.replace('NATS_REGISTRATION_AUTHORITY_SEED=private-seed', ''), source.replace('ACCOUNT_ADMISSION_STREAM=ADMISSION_local', ''), `${source}AUTH0_USE_DEVELOPER_KEYS=oops\n`])
            expect(() => LocalAccountAuthConfiguration.render(invalid)).toThrow()

        expect(registrationEnvironment).not.toHaveBeenCalled()
    })
})
