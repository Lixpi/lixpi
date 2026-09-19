import { describe, expect, it, vi } from 'vitest'
import { ensureAssetMaintenanceQueue } from './asset-maintenance-queue.ts'

describe('asset maintenance durability', () => {
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
