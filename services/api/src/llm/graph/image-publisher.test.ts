'use strict'

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

const generatedAssetStorageMocks = vi.hoisted(() => ({
    attachGeneratedAssetNode: vi.fn(async () => ({ layoutRevision: 1, nodes: [] })),
    settleGeneratedAssetOriginal: vi.fn(async (input: any) => ({
        assetId: input.generationRun.lineageAssignment.assetId,
        organizationId: 'org-1',
        url: `/api/assets/${input.generationRun.lineageAssignment.assetId}/renditions/original`,
    })),
}))
const assetProvenanceMaterializerMocks = vi.hoisted(() => ({
    materializeAssetProvenance: vi.fn(async () => undefined),
}))
const assetMaintenanceQueueMocks = vi.hoisted(() => ({
    enqueueProvenanceRebuild: vi.fn(async () => undefined),
}))

vi.mock('../../services/generated-asset-storage.ts', () => generatedAssetStorageMocks)
vi.mock('../../services/asset-provenance-materializer.ts', () => assetProvenanceMaterializerMocks)
vi.mock('../../services/asset-maintenance-queue.ts', () => assetMaintenanceQueueMocks)

import { ImagePublisher, readImageIntrinsicSize } from './image-publisher.ts'

type Published = { subject: string, payload: any }

function makeNats(published: Published[]): any {
    return {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
        getObjectStore: vi.fn(async () => ({})),
        createObjectStore: vi.fn(async () => ({})),
        putObject: vi.fn(async () => undefined),
        deleteObject: vi.fn(async () => undefined),
    }
}

const baseGenerationRun = {
    generationRequestId: 'request-1',
    reasoningRunId: 'reasoning-1',
    mediaRunId: 'media-1',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    mediaModelId: 'Google:gemini-2.5-flash-image',
    mediaType: 'image',
    reasoningIndex: 0,
    mediaIndex: 0,
    variantIndex: 0,
    lineageAssignment: {
        assetId: 'asset-1',
        generationRequestId: 'request-1',
        reasoningRunId: 'reasoning-1',
        mediaRunId: 'media-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        mediaModelId: 'Google:gemini-2.5-flash-image',
        mediaType: 'image',
        branchId: 'branch-1',
        branchForkNodeId: 'fork-1',
        lineageParentNodeId: 'fork-1',
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        promptText: 'draw it',
        createdAt: 1,
    },
} as const

const makePublisher = (generationRun: any = baseGenerationRun, ...rest: any[]) => {
    const published: Published[] = []
    const nats = makeNats(published)
    const publisher = new ImagePublisher(nats, 'org-1', 'ws-1', 'thread-1', 'Google', generationRun, ...rest)
    return { publisher, published, nats }
}

const makePublisherWithoutGenerationRun = () => {
    const published: Published[] = []
    const nats = makeNats(published)
    const publisher = new ImagePublisher(nats, 'org-1', 'ws-1', 'thread-1', 'Google')
    return { publisher, published }
}

const makeCaptureOnlyPublisher = () => {
    const published: Published[] = []
    const nats = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
    } as any
    const publisher = new ImagePublisher(
        nats,
        'org-1',
        'ws-1',
        'run-1',
        'Google',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
    )
    return { publisher, published }
}

describe('ImagePublisher', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        generatedAssetStorageMocks.attachGeneratedAssetNode.mockResolvedValue({ layoutRevision: 1, nodes: [] })
        generatedAssetStorageMocks.settleGeneratedAssetOriginal.mockImplementation(async (input: any) => ({
            assetId: input.generationRun.lineageAssignment.assetId,
            organizationId: 'org-1',
            url: `/api/assets/${input.generationRun.lineageAssignment.assetId}/renditions/original`,
        }))
        assetProvenanceMaterializerMocks.materializeAssetProvenance.mockResolvedValue(undefined)
        assetMaintenanceQueueMocks.enqueueProvenanceRebuild.mockResolvedValue(undefined)
    })

    it('publishes a placeholder for partial stream images with an empty base64 payload', async () => {
        const { publisher, published } = makePublisher()

        await publisher.partial('', 2)

        expect(generatedAssetStorageMocks.attachGeneratedAssetNode).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            workspaceId: 'ws-1',
            kind: 'image',
        }))
        expect(published).toHaveLength(1)
        expect(published[0]?.subject).toBe('ai.interaction.chat.receiveMessage.org-1.thread-1')
        expect(published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: '',
            assetId: 'asset-1',
            partialIndex: 2,
            aiProvider: 'Google',
        }))
    })

    it('publishes partial image metadata for non-empty base64 payloads', async () => {
        const { publisher, published, nats } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.partial(pngBase64, 1)

        expect(published).toHaveLength(1)
        expect(published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: expect.stringMatching(/^\/api\/transient-media\/workspaces\/ws-1\/objects\/partial-[a-f0-9]{64}\.png\?revision=1$/),
            assetId: 'asset-1',
            partialIndex: 1,
            aiProvider: 'Google',
        })
        expect(nats.putObject).toHaveBeenCalledWith(
            'transient-media-org-1-files',
            expect.stringMatching(/^partial-[a-f0-9]{64}\.png$/),
            expect.any(Buffer),
            expect.objectContaining({ description: expect.stringContaining('Transient image partial') }),
        )
    })

    it('throws when partial is called without a generationRun', async () => {
        const { publisher } = makePublisherWithoutGenerationRun()

        await expect(publisher.partial('', 0)).rejects.toThrow('Image partial is missing generationRun')
    })

    it('throws when partial is called without a lineageAssignment assetId', async () => {
        const generationRun = { ...baseGenerationRun, lineageAssignment: undefined } as any
        const { publisher } = makePublisher(generationRun)

        await expect(publisher.partial('', 0)).rejects.toThrow('Image partial is missing Asset assignment')
    })

    it('silently skips partial publish failures', async () => {
        const { publisher, published } = makePublisher()
        const nats = makeNats([])
        nats.putObject.mockRejectedValueOnce(new Error('object storage temporarily unavailable'))
        const publisher2 = new ImagePublisher(nats, 'org-1', 'ws-1', 'thread-1', 'Google', baseGenerationRun)

        await expect(publisher2.partial('aW1hZ2UtdmFsaWQ=', 0)).resolves.toBeUndefined()
        expect(published).toHaveLength(0)
    })

    it('replaces an earlier partial object when the next partial arrives', async () => {
        const { publisher, published, nats } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64')

        await publisher.partial(pngBase64, 0)
        await publisher.partial(pngBase64, 1)

        const firstUrl = published[0]?.payload.content.imageUrl as string
        const firstObjectKey = firstUrl.match(/objects\/(partial-[a-f0-9]{64}\.png)/)?.[1]
        expect(firstObjectKey).toBeTruthy()
        expect(nats.deleteObject).toHaveBeenCalledWith('transient-media-org-1-files', firstObjectKey)
    })

    it('clears the active partial object after publishing the final image', async () => {
        const { publisher, published, nats } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64')

        await publisher.partial(pngBase64, 0)
        const partialUrl = published[0]?.payload.content.imageUrl as string
        const partialObjectKey = partialUrl.match(/objects\/(partial-[a-f0-9]{64}\.png)/)?.[1]
        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'finish it',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(nats.deleteObject).toHaveBeenLastCalledWith('transient-media-org-1-files', partialObjectKey)
    })

    it('rejects empty final image bytes', async () => {
        const { publisher, published } = makePublisher()

        await expect(publisher.complete({
            imageBase64: '',
            responseId: '',
            revisedPrompt: '',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('no final image bytes')

        expect(generatedAssetStorageMocks.settleGeneratedAssetOriginal).not.toHaveBeenCalled()
        expect(published).toHaveLength(0)
    })

    it('rejects non-image final bytes', async () => {
        const { publisher, published } = makePublisher()

        await expect(publisher.complete({
            imageBase64: Buffer.from('not an image').toString('base64'),
            responseId: '',
            revisedPrompt: '',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('not a PNG or JPEG image')

        expect(generatedAssetStorageMocks.settleGeneratedAssetOriginal).not.toHaveBeenCalled()
        expect(published).toHaveLength(0)
    })

    it('rejects truncated PNG headers that are not full valid images', async () => {
        const { publisher, published } = makePublisher()
        const shortPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString('base64')

        await expect(publisher.complete({
            imageBase64: shortPng,
            responseId: 'resp-2',
            revisedPrompt: 'tiny',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('Image completion failed: provider returned bytes that are not a PNG or JPEG image')

        expect(generatedAssetStorageMocks.settleGeneratedAssetOriginal).not.toHaveBeenCalled()
        expect(published).toHaveLength(0)
    })

    it('throws when complete is called without a generationRun', async () => {
        const { publisher } = makePublisherWithoutGenerationRun()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await expect(publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'cat',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('Image completion is missing generationRun')
    })

    it('captures valid provider bytes without publishing or persisting candidate media', async () => {
        const { publisher, published } = makeCaptureOnlyPublisher()
        const pngBase64 = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
        ]).toString('base64')

        await publisher.partial('', 0)
        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'candidate-1',
            revisedPrompt: 'candidate',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(generatedAssetStorageMocks.attachGeneratedAssetNode).not.toHaveBeenCalled()
        expect(generatedAssetStorageMocks.settleGeneratedAssetOriginal).not.toHaveBeenCalled()
        expect(published).toEqual([])
    })

    it('stores JPEG final bytes with the JPEG MIME type', async () => {
        const { publisher, published } = makePublisher()
        const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')

        await publisher.complete({
            imageBase64: jpegBase64,
            responseId: 'resp-1',
            revisedPrompt: 'prompt',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(generatedAssetStorageMocks.settleGeneratedAssetOriginal).toHaveBeenCalledWith(expect.objectContaining({
            originalName: 'generated-image.jpg',
            mimeType: 'image/jpeg',
        }))
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.IMAGE_COMPLETE)
    })

    it('propagates storage errors from IMAGE_COMPLETE', async () => {
        generatedAssetStorageMocks.settleGeneratedAssetOriginal.mockRejectedValueOnce(new Error('temporary object store write failure'))
        const { publisher, published } = makePublisher()
        const jpegBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64')

        await expect(
            publisher.complete({
                imageBase64: jpegBase64,
                responseId: 'resp-1',
                revisedPrompt: 'cat',
                imageModelId: 'gemini-2.5-flash-image',
            }),
        ).rejects.toThrow('temporary object store write failure')
        expect(published).toHaveLength(0)
    })

    it('passes generation-run metadata through partial and complete image events', async () => {
        const onProseMirrorContent = vi.fn()
        const { publisher, published } = makePublisher(baseGenerationRun, onProseMirrorContent)

        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')
        await publisher.partial(pngBase64, 2)
        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'cat prompt',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            partialIndex: 2,
            generationRun: baseGenerationRun,
        })
        expect(published[1]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            responseId: 'resp-1',
            revisedPrompt: 'cat prompt',
            generationRun: baseGenerationRun,
        })
        expect(onProseMirrorContent).toHaveBeenCalledTimes(2)
        expect(onProseMirrorContent.mock.calls[0]?.[0]).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            generationRun: baseGenerationRun,
        })
        expect(onProseMirrorContent.mock.calls[1]?.[0]).toMatchObject({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            generationRun: baseGenerationRun,
        })
    })

    it('settles the generated Asset and attaches canvas geometry before publishing completion', async () => {
        const { publisher, published } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(generatedAssetStorageMocks.settleGeneratedAssetOriginal).toHaveBeenCalledWith(expect.objectContaining({
            generationRun: baseGenerationRun,
            workspaceId: 'ws-1',
            originalName: 'generated-image.png',
            mimeType: 'image/png',
            kind: 'image',
        }))
        expect(generatedAssetStorageMocks.attachGeneratedAssetNode).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            workspaceId: 'ws-1',
            kind: 'image',
            generationRun: baseGenerationRun,
            conversationAssetId: 'thread-1',
        }))
        expect(published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            imageUrl: '/api/assets/asset-1/renditions/original',
            assetId: 'asset-1',
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
        })
    })

    it('materializes Asset provenance after publishing completion', async () => {
        const { publisher } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(assetProvenanceMaterializerMocks.materializeAssetProvenance).toHaveBeenCalledWith({
            assetId: 'asset-1',
            organizationId: 'org-1',
            workspaceId: 'ws-1',
            conversationAssetId: 'thread-1',
            generationRun: baseGenerationRun,
            terminalStatus: 'completed',
        })
        expect(assetMaintenanceQueueMocks.enqueueProvenanceRebuild).not.toHaveBeenCalled()
    })

    it('enqueues a provenance rebuild when materialization fails', async () => {
        assetProvenanceMaterializerMocks.materializeAssetProvenance.mockRejectedValueOnce(new Error('provenance write failed'))
        const { publisher, published } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(assetMaintenanceQueueMocks.enqueueProvenanceRebuild).toHaveBeenCalledWith({
            assetId: 'asset-1',
            organizationId: 'org-1',
            workspaceId: 'ws-1',
            conversationAssetId: 'thread-1',
            generationRun: baseGenerationRun,
            terminalStatus: 'completed',
        })
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.IMAGE_COMPLETE)
    })

    it('routes image events through onPipelineContent when durable pipeline publishing is supplied', async () => {
        const published: Published[] = []
        const nats = makeNats(published)
        const onProseMirrorContent = vi.fn()
        const onPipelineContent = vi.fn()
        const publisher = new ImagePublisher(
            nats,
            'org-1',
            'ws-1',
            'thread-1',
            'Google',
            baseGenerationRun,
            onProseMirrorContent,
            onPipelineContent,
        )
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.partial(pngBase64, 3)

        expect(published).toHaveLength(0)
        expect(onProseMirrorContent).not.toHaveBeenCalled()
        expect(onPipelineContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            assetId: 'asset-1',
            partialIndex: 3,
            aiProvider: 'Google',
        }))
    })
})

describe('readImageIntrinsicSize', () => {
    it('reads PNG dimensions from the IHDR chunk', () => {
        const png = Buffer.alloc(24)
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
        png.writeUInt32BE(13, 8)
        png.write('IHDR', 12)
        png.writeUInt32BE(1600, 16)
        png.writeUInt32BE(900, 20)
        expect(readImageIntrinsicSize(png)).toEqual({ width: 1600, height: 900 })
    })

    it('reads JPEG dimensions from the SOF segment', () => {
        // SOI, APP0 (16-byte segment), SOF0 with height 800 / width 1200.
        const jpeg = Buffer.concat([
            Buffer.from([0xff, 0xd8]),
            Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14),
            Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0xb0]), Buffer.alloc(10),
        ])
        expect(readImageIntrinsicSize(jpeg)).toEqual({ width: 1200, height: 800 })
    })

    it('returns null for unreadable bytes', () => {
        expect(readImageIntrinsicSize(Buffer.from('not an image'))).toBeNull()
        expect(readImageIntrinsicSize(Buffer.alloc(0))).toBeNull()
    })
})

describe('ImagePublisher canvas geometry', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        generatedAssetStorageMocks.settleGeneratedAssetOriginal.mockImplementation(async (input: any) => ({
            assetId: input.generationRun.lineageAssignment.assetId,
            organizationId: 'org-1',
            url: `/api/assets/${input.generationRun.lineageAssignment.assetId}/renditions/original`,
        }))
    })

    it('threads the resolved canvasGeometry onto the IMAGE_COMPLETE event', async () => {
        const canvasGeometry = {
            layoutRevision: 99,
            nodes: [{ nodeId: 'node-asset-1', position: { x: 1, y: 2 }, dimensions: { width: 3, height: 4 } }],
        }
        generatedAssetStorageMocks.attachGeneratedAssetNode.mockResolvedValueOnce(canvasGeometry as any)
        const { publisher, published } = makePublisher()

        await publisher.complete({
            imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
            responseId: 'resp-1',
            revisedPrompt: 'brighter',
            imageModelId: 'gemini-2.5-flash-image',
        })

        const complete = published.find(({ payload }) => payload.content.status === STREAM_STATUS.IMAGE_COMPLETE)
        expect(complete?.payload.content.canvasGeometry).toEqual(canvasGeometry)
    })
})
