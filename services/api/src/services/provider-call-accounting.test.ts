import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderUsageClient } from '@lixpi/usage-reporter'
import { ProviderCallAccounting } from './provider-call-accounting.ts'
import { AccountRequestContext } from './account-request-context.ts'

const identity = {
    organizationId: 'org-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
}

describe('auxiliary provider accounting', () => {
    const request = vi.fn()
    const enqueueUsage = vi.fn()
    const enqueueCompletion = vi.fn()

    beforeEach(() => {
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'false')
        request.mockReset().mockImplementation(async (subject, data) => {
            if (subject.endsWith('.authorize'))
                return {
                    authorized: true,
                    authorizationId: `authorization:${data.workflowId}`,
                }

            if (subject.endsWith('.complete'))
                return { completed: true }

            return { recorded: true }
        })
        enqueueUsage.mockReset().mockResolvedValue(undefined)
        enqueueCompletion.mockReset().mockResolvedValue(undefined)
        ProviderCallAccounting.configure(new ProviderUsageClient(
            { request },
            {
                enabled: true,
                requestTimeoutMs: 100,
                denyRequestWhenAuthorizationUnavailable: true,
            },
            {
                enqueueUsage,
                enqueueCompletion,
            },
        ))
    })

    afterEach(() => {
        ProviderCallAccounting.configure()
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it('does not call a provider without an authorized organization identity', async () => {
        const provider = vi.fn()
        await expect(ProviderCallAccounting.run('model', 100, provider)).rejects.toThrow('no usage identity')
        expect(provider).not.toHaveBeenCalled()
        expect(request).not.toHaveBeenCalled()
    })

    it('does not call a provider after denied authorization', async () => {
        request.mockResolvedValue({ authorized: false })
        const provider = vi.fn()
        await expect(ProviderCallAccounting.run('model', 100, provider, identity)).rejects.toThrow('not authorized')
        expect(provider).not.toHaveBeenCalled()
        expect(enqueueUsage).not.toHaveBeenCalled()
    })

    it('persists measured usage and completion when metrics goes offline after authorization', async () => {
        request.mockImplementation(async subject => {
            if (subject.endsWith('.authorize'))
                return {
                    authorized: true,
                    authorizationId: 'authorization-1',
                }

            throw new Error('metrics offline')
        })
        await ProviderCallAccounting.run('model', 100, async accounting => void accounting.observe({
            promptTokens: 12,
            completionTokens: 3,
        }, 'response-1'), identity)
        expect(enqueueUsage).toHaveBeenCalledWith(expect.objectContaining({
            orgId: 'org-1',
            userId: 'user-1',
            authorizationId: 'authorization-1',
            providerRequestId: 'response-1',
            usage: {
                promptTokens: 12,
                completionTokens: 3,
            },
        }))
        expect(enqueueCompletion).toHaveBeenCalledWith(expect.objectContaining({
            authorizationId: 'authorization-1',
            providerRequestIds: ['response-1'],
        }))
        expect(enqueueUsage.mock.invocationCallOrder[0]).toBeLessThan(enqueueCompletion.mock.invocationCallOrder[0])
    })

    it('records zero usage and completes a rejected request', async () => {
        await expect(ProviderCallAccounting.run('model', 100, async () => {
            const error = new Error('invalid request') as Error & { status: number }
            error.status = 400

            throw error
        }, identity)).rejects.toThrow('invalid request')
        expect(enqueueUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: {
            promptTokens: 0,
            completionTokens: 0,
        } }))
        expect(enqueueCompletion).toHaveBeenCalledOnce()
    })

    it('leaves a request unresolved when the connection fails without a final usage measurement', async () => {
        await expect(ProviderCallAccounting.run('model', 100, async () => {
            throw new Error('connection lost')
        }, identity)).rejects.toThrow('connection lost')
        expect(enqueueUsage).not.toHaveBeenCalled()
        expect(enqueueCompletion).not.toHaveBeenCalled()
    })

    it('records partial measurements without completing an unresolved request', async () => {
        await expect(ProviderCallAccounting.run('model', 100, async accounting => {
            accounting.observe({ promptTokens: 12 }, 'partial-response')

            throw new Error('connection lost')
        }, identity)).rejects.toThrow('connection lost')
        expect(enqueueUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: { promptTokens: 12 } }))
        expect(enqueueCompletion).not.toHaveBeenCalled()
    })

    it('keeps parallel caller identities separate through asynchronous work', async () => {
        const other = {
            organizationId: 'org-2',
            userId: 'user-2',
        }
        await Promise.all([identity, other].map(caller => ProviderCallAccounting.inScope(caller, async () => {
            await Promise.resolve()
            await ProviderCallAccounting.run('model', 100, async accounting => {
                await Promise.resolve()
                accounting.observe({ promptTokens: 1 }, caller.userId)
            })
        })))
        expect(enqueueUsage.mock.calls.map(([record]) => [record.userId, record.orgId]).sort()).toEqual([
            ['user-1', 'org-1'], ['user-2', 'org-2'],
        ])
    })

    it('releases an authorization if admission is revoked before transport starts', async () => {
        vi.spyOn(AccountRequestContext, 'assertActive')
            .mockImplementationOnce(() => undefined)
            .mockImplementation(() => { throw new Error('ACCOUNT_ADMISSION_DENIED') })
        const provider = vi.fn()
        await expect(ProviderCallAccounting.run('model', 100, provider, identity)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(provider).not.toHaveBeenCalled()
        expect(enqueueCompletion).toHaveBeenCalledOnce()
    })

    it('never completes an authorization when usage persistence fails', async () => {
        enqueueUsage.mockRejectedValue(new Error('outbox disk full'))
        await expect(ProviderCallAccounting.run('model', 100, async accounting => void accounting.observe({ promptTokens: 1 }), identity)).rejects.toThrow('outbox disk full')
        expect(enqueueCompletion).not.toHaveBeenCalled()
    })
})
