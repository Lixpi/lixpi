import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type BranchOriginCanvasNode,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import { WorkspaceBranchMarkerModels } from './workspace-branch-marker-models.ts'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

const marker = (overrides: Partial<BranchOriginCanvasNode> = {}): BranchOriginCanvasNode => ({
    nodeId: 'marker-1',
    type: 'branchOrigin',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 80 },
    temporary: true,
    ...overrides,
})

const image = (modelId: string, positionY = 0): ImageCanvasNode => ({
    nodeId: `image-${positionY}`,
    type: 'image',
    assetId: `asset-image-${positionY}`,
    position: { x: 400, y: positionY },
    dimensions: { width: 300, height: 300 },
    generatedBy: {
        conversationAssetId: 'thread-1',
        responseId: 'response-1',
        aiModel: modelId,
        mediaModelId: modelId,
        revisedPrompt: 'draw it',
        branchOriginNodeId: 'marker-1',
        mediaType: 'image',
    },
})

const video = (modelId: string): VideoCanvasNode => ({
    nodeId: 'video-1',
    type: 'video',
    assetId: 'asset-video-1',
    position: { x: 400, y: 400 },
    dimensions: { width: 320, height: 180 },
    generatedBy: {
        conversationAssetId: 'thread-1',
        responseId: 'response-1',
        videoModel: modelId,
        mediaModelId: modelId,
        revisedPrompt: 'animate it',
        branchOriginNodeId: 'marker-1',
        mediaType: 'video',
    },
})

function modelPorts(entries: ReturnType<WorkspaceCanvasHost['models']['read']>): WorkspaceCanvasHost['models'] {
    return {
        read: () => entries,
        subscribe: () => vi.fn(),
        modelIcon: name => name ? `model:${name}` : null,
        providerIcon: name => name ? `provider:${name}` : null,
        createBadge: () => null,
        styleBadge: vi.fn(),
    }
}

describe('WorkspaceBranchMarkerModels', () => {
    it('resolves reasoning metadata with short titles, model icons and normalized colors', () => {
        const source = marker({
            pendingState: {
                phase: 'planned',
                promptText: 'draw it',
                reasoningModelIds: ['openai:gpt-5'],
                imageModelIds: [],
                videoModelIds: [],
            },
        })
        const owner = new WorkspaceBranchMarkerModels({
            models: modelPorts([{
                provider: 'openai',
                model: 'gpt-5',
                title: 'GPT 5',
                shortTitle: 'GPT',
                iconName: 'gpt',
                color: '#0a49a7',
            }]),
            getCanvasNodes: () => [source],
            getGeneratedOutputNodes: () => [],
        })

        expect(owner.getReasoningModel(source)).toEqual({
            title: 'GPT',
            icon: 'model:gpt',
            color: '#0A49A7',
        })
        expect(owner.getReasoningDescriptor(source)).toEqual({ modelId: 'openai:gpt-5' })
    })

    it('deduplicates media descriptors by type and model while retaining image and video labels', () => {
        const source = marker()
        const nodes: CanvasNode[] = [
            source,
            image('black-forest-labs:flux-1', 0),
            image('BLACK-FOREST-LABS:FLUX-1', 10),
            video('google:veo-3'),
        ]
        const owner = new WorkspaceBranchMarkerModels({
            models: modelPorts([
                { provider: 'black-forest-labs', model: 'flux-1', shortTitle: 'Flux', color: '#123456' },
                { provider: 'google', model: 'veo-3', shortTitle: 'Veo', color: '#654321' },
            ]),
            getCanvasNodes: () => nodes,
            getGeneratedOutputNodes: () => [],
        })

        expect(owner.getDetails(source)).toEqual([
            { label: 'Image', entries: [{ title: 'Flux', icon: 'provider:black-forest-labs', color: '#123456' }] },
            { label: 'Video', entries: [{ title: 'Veo', icon: 'provider:google', color: '#654321' }] },
        ])
        expect(owner.getSummary(source)).toBe('Image: Flux · Video: Veo')
    })

    it('falls back to the model id when catalog metadata is unavailable', () => {
        const source = marker({
            pendingState: {
                phase: 'planned',
                promptText: 'draw it',
                reasoningModelIds: ['provider:unknown-model'],
                imageModelIds: [],
                videoModelIds: [],
            },
        })
        const owner = new WorkspaceBranchMarkerModels({
            models: modelPorts([]),
            getCanvasNodes: () => [source],
            getGeneratedOutputNodes: () => [],
        })

        expect(owner.getReasoningModel(source)).toEqual({
            title: 'unknown-model',
            icon: 'provider:provider',
            color: null,
        })
    })
})
