import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    STREAM_STATUS,
    type MediaGenerationRunMeta,
} from '@lixpi/constants'

const assetStorageMocks = vi.hoisted(() => ({
    attachGeneratedAssetNode: vi.fn(),
    settleGeneratedAssetOriginal: vi.fn(),
}))
const provenanceMocks = vi.hoisted(() => ({
    materializeAssetProvenance: vi.fn(),
}))
const maintenanceMocks = vi.hoisted(() => ({
    enqueueProvenanceRebuild: vi.fn(),
}))

vi.mock('../../services/generated-asset-storage.ts', () => assetStorageMocks)
vi.mock('../../services/asset-provenance-materializer.ts', () => provenanceMocks)
vi.mock('../../services/asset-maintenance-queue.ts', () => maintenanceMocks)

import { VideoPublisher } from './video-publisher.ts'

type Published = { subject: string; payload: { content: Record<string, unknown> } }

const canvasGeometry = {
    generationRequestId: 'request-1',
    layoutRevision: 100,
    nodes: [],
    nodeSnapshots: [],
    edgeSnapshots: [],
}

const generationRun = {
    generationRequestId: 'request-1',
    reasoningRunId: 'request-1:reasoning:0',
    mediaRunId: 'request-1:reasoning:0:video:0',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    mediaModelId: 'Google:veo-3.1-generate-preview',
    mediaType: 'video',
    reasoningIndex: 0,
    mediaIndex: 0,
    variantIndex: 0,
    lineageAssignment: {
        assetId: 'asset-video-1',
        generationRequestId: 'request-1',
        reasoningRunId: 'request-1:reasoning:0',
        mediaRunId: 'request-1:reasoning:0:video:0',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        mediaModelId: 'Google:veo-3.1-generate-preview',
        mediaType: 'video',
        mediaIndex: 0,
        branchId: 'branch-1',
        branchForkNodeId: 'branch-fork-1',
        lineageParentNodeId: 'branch-fork-1',
        referenceAssetIds: [],
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        promptText: 'animate the subject',
        createdAt: 1,
    },
} as MediaGenerationRunMeta

const mp4Sample = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x20,
    0x66,
    0x74,
    0x79,
    0x70,
    0x6d,
    0x70,
    0x34,
    0x20,
    0x00,
    0x00,
    0x00,
    0x00,
    0x69,
    0x6d,
    0x6f,
    0x76,
    0x00,
    0x00,
    0x00,
    0x00,
])
const pngSample = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
])

function createPublisher(options: { onPipelineContent?: (content: Record<string, unknown>) => void } = {}) {
    const published: Published[] = []
    const nats = {
        publish: (subject: string, payload: Published['payload']) => published.push({ subject, payload }),
    } as any
    const publisher = new VideoPublisher(
        nats,
        'organization-1',
        'workspace-1',
        'thread-1',
        'Google',
        generationRun,
        undefined,
        options.onPipelineContent as any,
    )
    return { publisher, published }
}

describe('VideoPublisher', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        assetStorageMocks.attachGeneratedAssetNode.mockResolvedValue(canvasGeometry)
        assetStorageMocks.settleGeneratedAssetOriginal.mockResolvedValue({
            assetId: 'asset-video-1',
            organizationId: 'organization-1',
            url: '/api/assets/asset-video-1/original',
        })
        provenanceMocks.materializeAssetProvenance.mockResolvedValue(undefined)
        maintenanceMocks.enqueueProvenanceRebuild.mockResolvedValue(undefined)
    })

    it('persists API-owned pending geometry before publishing VIDEO_PENDING', async () => {
        const { publisher, published } = createPublisher()

        await publisher.pending()

        expect(assetStorageMocks.attachGeneratedAssetNode).toHaveBeenCalledWith({
            assetId: 'asset-video-1',
            workspaceId: 'workspace-1',
            kind: 'video',
            aspectRatio: 1,
            generationRun,
            conversationAssetId: 'thread-1',
        })
        expect(published).toHaveLength(1)
        expect(published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.VIDEO_PENDING,
            assetId: 'asset-video-1',
            canvasGeometry,
            generationRun,
        })
    })

    it('routes pending geometry through the durable pipeline publisher without publishing NATS directly', async () => {
        const onPipelineContent = vi.fn()
        const { publisher, published } = createPublisher({ onPipelineContent })

        await publisher.pending()

        expect(published).toEqual([])
        expect(onPipelineContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.VIDEO_PENDING,
            canvasGeometry,
        }))
    })

    it('settles the assigned Asset and publishes final API geometry', async () => {
        const completionGeometry = { ...canvasGeometry, layoutRevision: 101 }
        assetStorageMocks.attachGeneratedAssetNode
            .mockResolvedValueOnce(canvasGeometry)
            .mockResolvedValueOnce(completionGeometry)
        const { publisher, published } = createPublisher()

        await publisher.pending()
        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: null,
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'response-1',
            revisedPrompt: 'animate the subject',
            videoModelId: 'veo-3.1-generate-preview',
        })

        expect(assetStorageMocks.settleGeneratedAssetOriginal).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            kind: 'video',
            generationRun,
        }))
        expect(assetStorageMocks.attachGeneratedAssetNode).toHaveBeenLastCalledWith(expect.objectContaining({
            assetId: 'asset-video-1',
            kind: 'video',
            aspectRatio: 16 / 9,
            generationRun,
        }))
        expect(published.at(-1)?.payload.content).toMatchObject({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            assetId: 'asset-video-1',
            canvasGeometry: completionGeometry,
            generationRun,
        })
        expect(provenanceMocks.materializeAssetProvenance).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-video-1',
            terminalStatus: 'completed',
        }))
    })

    it('rejects invalid video bytes before mutating Asset or canvas state', async () => {
        const { publisher } = createPublisher()

        await expect(publisher.complete({
            videoBuffer: Buffer.from('not-an-mp4'),
            posterBuffer: null,
            durationSeconds: 1,
            aspectRatio: '16:9',
            hasAudio: false,
            responseId: 'response-1',
            revisedPrompt: 'bad input',
            videoModelId: 'veo-3.1-generate-preview',
        })).rejects.toThrow('without an ISO base-media ftyp box')

        expect(assetStorageMocks.settleGeneratedAssetOriginal).not.toHaveBeenCalled()
        expect(assetStorageMocks.attachGeneratedAssetNode).not.toHaveBeenCalled()
    })

    it('stores MOV output as QuickTime and preserves a provider-returned last frame', async () => {
        const { publisher } = createPublisher()

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: null,
            frameBuffer: pngSample,
            durationSeconds: 12,
            aspectRatio: '16:9',
            hasAudio: false,
            responseId: 'seedance-25-response',
            revisedPrompt: 'animate the subject',
            videoModelId: 'dreamina-seedance-2-5-260628',
            containerFormat: 'mov',
        })

        expect(assetStorageMocks.settleGeneratedAssetOriginal).toHaveBeenCalledWith(expect.objectContaining({
            originalName: 'generated-video.mov',
            mimeType: 'video/quicktime',
            posterBuffer: null,
            representativeFrameBuffer: pngSample,
        }))
    })
})
