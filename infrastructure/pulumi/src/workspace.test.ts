import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    awsConfig,
    getProgramName,
    getStackArgs,
    getWorkspaceOptions,
    requiresExistingStack,
} from './workspace.ts'

afterEach(() => void vi.unstubAllEnvs())

describe('Pulumi workspace selection', () => {
    it('preserves the existing application defaults', () => {
        vi.stubEnv('PULUMI_PROGRAM', process.env.PULUMI_PROGRAM ?? '')
        delete process.env.PULUMI_PROGRAM
        vi.stubEnv('PULUMI_PROJECT_NAME', process.env.PULUMI_PROJECT_NAME ?? '')
        delete process.env.PULUMI_PROJECT_NAME
        vi.stubEnv('STATE_STORAGE_URL', process.env.STATE_STORAGE_URL ?? '')
        delete process.env.STATE_STORAGE_URL
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', '')
        vi.stubEnv('AWS_EXPECTED_ACCOUNT_ID', process.env.AWS_EXPECTED_ACCOUNT_ID ?? '')
        delete process.env.AWS_EXPECTED_ACCOUNT_ID

        expect(getProgramName()).toBe('application')
        expect(requiresExistingStack()).toBe(false)
        expect(getStackArgs('production').projectName).toBe('lixpi.ai')
        expect(getWorkspaceOptions().projectSettings.backend?.url).toBeUndefined()
        expect(awsConfig('us-east-1')).toEqual({
            'aws:region': { value: 'us-east-1' },
        })
    })

    it('requires a named project, existing stack, backend and expected account for a website', () => {
        vi.stubEnv('PULUMI_PROGRAM', 'static-website')
        vi.stubEnv('STATE_STORAGE_URL', process.env.STATE_STORAGE_URL ?? '')
        delete process.env.STATE_STORAGE_URL
        vi.stubEnv('PULUMI_PROJECT_NAME', process.env.PULUMI_PROJECT_NAME ?? '')
        delete process.env.PULUMI_PROJECT_NAME
        vi.stubEnv('STATE_STORAGE_URL', process.env.STATE_STORAGE_URL ?? '')
        delete process.env.STATE_STORAGE_URL
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', '')
        vi.stubEnv('AWS_EXPECTED_ACCOUNT_ID', process.env.AWS_EXPECTED_ACCOUNT_ID ?? '')
        delete process.env.AWS_EXPECTED_ACCOUNT_ID

        expect(getProgramName()).toBe('static-website')
        expect(requiresExistingStack()).toBe(true)
        expect(() => getStackArgs('production')).toThrow('PULUMI_PROJECT_NAME is required')
        expect(() => getWorkspaceOptions()).toThrow('STATE_STORAGE_URL is required')
        vi.stubEnv('PULUMI_PROJECT_NAME', 'lixpi-website')
        vi.stubEnv('STATE_STORAGE_URL', 's3://example-state')
        expect(getStackArgs('production').projectName).toBe('lixpi-website')
        expect(getWorkspaceOptions().projectSettings.backend?.url).toBe('s3://example-state')
        expect(() => awsConfig('us-east-1')).toThrow('AWS_EXPECTED_ACCOUNT_ID is required')

        vi.stubEnv('AWS_EXPECTED_ACCOUNT_ID', '529088280712')
        expect(awsConfig('us-east-1')).toEqual({
            'aws:region': { value: 'us-east-1' },
            'aws:allowedAccountIds': { value: '["529088280712"]' },
        })
    })

    it('rejects invalid program, stack-selection and account values', () => {
        vi.stubEnv('PULUMI_PROGRAM', 'other')
        expect(() => getProgramName()).toThrow('Unsupported PULUMI_PROGRAM')

        vi.stubEnv('PULUMI_PROGRAM', process.env.PULUMI_PROGRAM ?? '')
        delete process.env.PULUMI_PROGRAM
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', 'yes')
        expect(() => requiresExistingStack()).toThrow('PULUMI_REQUIRE_EXISTING_STACK must be true or false')

        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', '')
        vi.stubEnv('AWS_EXPECTED_ACCOUNT_ID', 'not-an-account')
        expect(() => awsConfig('us-east-1')).toThrow('AWS_EXPECTED_ACCOUNT_ID must contain twelve digits')
    })
})
