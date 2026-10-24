import { describe, expect, it, vi } from 'vitest'
import { ensureAssetMaintenanceQueue, enqueueRenditionRetry } from './asset-maintenance-queue.ts'
import NatsService from '@lixpi/nats-service'
import { AccountRequestContext } from './account-request-context.ts'

describe('asset maintenance durability', () => {
    it('persists the original verified work context and refuses unscoped retries', async () => {
        const publishJetStream = vi.fn().mockResolvedValue(undefined)
        const service = vi.spyOn(NatsService, 'getInstance').mockReturnValue({ publishJetStream } as never)
        const account = {
            identityKey: 'identity',
            issuer: 'issuer',
            subject: 'user',
            epoch: 3,
            personalOrganizationId: 'org',
            tokenExpiresAt: 1000,
        }
        const context = vi.spyOn(AccountRequestContext, 'workContext').mockReturnValue(account)
        const payload = {
            organizationId: 'org',
            assetId: 'asset',
            retryAttempt: 1,
        }

        try {
            await enqueueRenditionRetry(payload)
            expect(publishJetStream).toHaveBeenCalledWith(expect.any(String), {
                ...payload,
                accountContext: account,
            })
            context.mockImplementation(() => { throw new Error('ACCOUNT_ADMISSION_DENIED') })
            await expect(enqueueRenditionRetry(payload)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
            expect(publishJetStream).toHaveBeenCalledOnce()
        } finally { context.mockRestore(); service.mockRestore() }
    })
    it('requests three disk replicas before creating its durable consumer', async () => {
        const service = {
            ensureJetStreamStream: vi.fn().mockResolvedValue(undefined),
            ensureJetStreamConsumer: vi.fn().mockResolvedValue(undefined),
        }
        await ensureAssetMaintenanceQueue(service as any)
        expect(service.ensureJetStreamStream).toHaveBeenCalledWith(expect.objectContaining({
            name: 'ASSET_MAINTENANCE',
            storage: 'file',
            num_replicas: 3,
        }))
        expect(service.ensureJetStreamStream.mock.invocationCallOrder[0]).toBeLessThan(service.ensureJetStreamConsumer.mock.invocationCallOrder[0])
    })

    it('does not start consuming when replicated stream setup fails', async () => {
        const service = {
            ensureJetStreamStream: vi.fn().mockRejectedValue(new Error('No quorum')),
            ensureJetStreamConsumer: vi.fn(),
        }
        await expect(ensureAssetMaintenanceQueue(service as any)).rejects.toThrow('No quorum')
        expect(service.ensureJetStreamConsumer).not.toHaveBeenCalled()
    })
})
