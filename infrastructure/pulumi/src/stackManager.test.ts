import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    LocalWorkspace,
    type Stack,
} from '@pulumi/pulumi/automation/index.js'
import { StackManager } from './stackManager.ts'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('StackManager workspace selection', () => {
    it('selects the existing website stack and applies the expected account guard', async () => {
        vi.stubEnv('PULUMI_PROGRAM', 'static-website')
        vi.stubEnv('PULUMI_PROJECT_NAME', 'lixpi-website')
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', 'true')
        vi.stubEnv('STATE_STORAGE_URL', 's3://lixpi.com-pulumi-production')
        vi.stubEnv('AWS_EXPECTED_ACCOUNT_ID', '529088280712')
        const stack = { setConfig: vi.fn().mockResolvedValue(undefined) } as unknown as Stack
        const selectStack = vi.spyOn(LocalWorkspace, 'selectStack').mockResolvedValue(stack)
        const createOrSelectStack = vi.spyOn(LocalWorkspace, 'createOrSelectStack')
        const manager = new StackManager('production', 'us-east-1')

        await manager.init()
        await manager.init()

        expect(selectStack).toHaveBeenCalledOnce()
        expect(selectStack).toHaveBeenCalledWith(
            expect.objectContaining({
                stackName: 'production',
                projectName: 'lixpi-website',
            }),
            expect.objectContaining({
                projectSettings: expect.objectContaining({
                    name: 'lixpi-website',
                    backend: { url: 's3://lixpi.com-pulumi-production' },
                }),
            }),
        )
        expect(createOrSelectStack).not.toHaveBeenCalled()
        expect(stack.setConfig).toHaveBeenCalledWith('aws:allowedAccountIds', {
            value: '["529088280712"]',
        })
        expect(stack.setConfig).toHaveBeenCalledWith('aws:region', { value: 'us-east-1' })
    })

    it('creates or selects stacks for the unchanged main application project', async () => {
        vi.stubEnv('PULUMI_PROGRAM', process.env.PULUMI_PROGRAM ?? '')
        delete process.env.PULUMI_PROGRAM
        vi.stubEnv('PULUMI_PROJECT_NAME', process.env.PULUMI_PROJECT_NAME ?? '')
        delete process.env.PULUMI_PROJECT_NAME
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', process.env.PULUMI_REQUIRE_EXISTING_STACK ?? '')
        delete process.env.PULUMI_REQUIRE_EXISTING_STACK
        vi.stubEnv('STATE_STORAGE_URL', process.env.STATE_STORAGE_URL ?? '')
        delete process.env.STATE_STORAGE_URL
        vi.stubEnv('AWS_EXPECTED_ACCOUNT_ID', process.env.AWS_EXPECTED_ACCOUNT_ID ?? '')
        delete process.env.AWS_EXPECTED_ACCOUNT_ID
        const stack = { setConfig: vi.fn().mockResolvedValue(undefined) } as unknown as Stack
        const selectStack = vi.spyOn(LocalWorkspace, 'selectStack')
        const createOrSelectStack = vi.spyOn(LocalWorkspace, 'createOrSelectStack').mockResolvedValue(stack)
        const manager = new StackManager('production', 'us-east-1')

        await manager.init()

        expect(createOrSelectStack).toHaveBeenCalledWith(
            expect.objectContaining({
                stackName: 'production',
                projectName: 'lixpi.ai',
            }),
            expect.objectContaining({
                projectSettings: expect.objectContaining({
                    name: 'lixpi.ai',
                    backend: { url: undefined },
                }),
            }),
        )
        expect(selectStack).not.toHaveBeenCalled()
        expect(stack.setConfig).toHaveBeenCalledOnce()
        expect(stack.setConfig).toHaveBeenCalledWith('aws:region', { value: 'us-east-1' })
    })
})
