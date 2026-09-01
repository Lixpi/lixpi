import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    GeneratedOutputReviewResponse,
    ImageCanvasNode,
    ImageGenerationTrace,
} from '@lixpi/constants'
import {
    WorkspaceOutputReview,
    type WorkspaceOutputReviewPorts,
} from './workspace-output-review.ts'

const geometry = { layoutRevision: 1, nodes: [], removedNodeIds: ['removed'] }
const response = (): GeneratedOutputReviewResponse => ({
    success: true,
    workspaceId: 'workspace',
    affectedAssetIds: [],
    acceptedAssetIds: [],
    rejectedAssetIds: [],
    supersededAssetIds: [],
    canvasGeometry: geometry,
})
const imageNode = (nodeId = 'image'): ImageCanvasNode => ({
    type: 'image',
    nodeId,
    assetId: `asset-${nodeId}`,
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: { conversationAssetId: 'conversation', responseId: 'response', aiModel: 'reasoner:model', reasoningModelId: 'reasoner:model', mediaModelId: 'renderer:model', mediaRunId: nodeId, lineageParentNodeId: 'branch', branchId: 'branch-id', referenceImageNodeIds: ['reference'], sourceContextNodeIds: ['context'] },
} as ImageCanvasNode)
const trace = (nodeId: string): ImageGenerationTrace => ({
    traceVersion: 'image-generation-trace-v1',
    generationRun: { mediaRunId: nodeId },
    chatModelProvider: 'reasoner',
    chatModelId: 'model',
    imageModelProvider: 'renderer',
    imageModelId: 'model',
    imageSize: 'landscape',
    toolPrompt: 'prompt',
    finalPrompt: `final-${nodeId}`,
    promptWasChanged: false,
    referenceImages: [],
    excludedReferences: [],
} as ImageGenerationTrace)
function setup(overrides: Partial<WorkspaceOutputReviewPorts> = {}) {
    let scope = { workspaceId: 'workspace', sceneKey: 'scene' }
    const ports: WorkspaceOutputReviewPorts = {
        readScope: () => scope,
        readCanvasState: () => ({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
        readAsset: () => undefined,
        readProvenance: () => ({}),
        readMediaHistory: node => ({ attrs: { imageGenerationTrace: trace(node.nodeId) } }),
        readArtifactReplay: vi.fn(),
        readPrompt: () => 'original user prompt',
        findNode: () => ({ type: 'branchOrigin', nodeId: 'branch' } as CanvasNode),
        review: vi.fn(async () => response()),
        refreshAsset: vi.fn(async () => ({})),
        applyGeometry: vi.fn(),
        removeContextChips: vi.fn(),
        refreshChrome: vi.fn(),
        refreshMarkers: vi.fn(),
        submit: vi.fn(async () => {}),
        reportError: vi.fn(),
        ...overrides,
    }
    const owner = new WorkspaceOutputReview(ports)
    return {
        owner,
        ports,
        setScope: (next: typeof scope) => {
            scope = next
        },
    }
}

describe('workspace output review', () => {
    it('applies accepted geometry and prunes removed context after the server accepts', async () => {
        const { owner, ports } = setup()
        await owner.acceptGeneratedOutput('output-node', 'image')
        expect(ports.review).toHaveBeenCalledWith({ workspaceId: 'workspace', scope: 'output-node', action: 'accept', nodeId: 'image' })
        expect(ports.applyGeometry).toHaveBeenCalledWith(geometry)
        expect(ports.removeContextChips).toHaveBeenCalledWith(['removed'])
        expect(ports.refreshMarkers).toHaveBeenCalledTimes(1)
    })

    it('rejects foreign-workspace acceptance and rejection geometry', async () => {
        const { owner, ports } = setup({ review: vi.fn(async () => ({ ...response(), workspaceId: 'other' })) })
        await owner.acceptGeneratedOutput('output-node', 'image')
        expect(await owner.rejectGeneratedOutput('output-node', 'image')).toBe('failed')
        expect(ports.applyGeometry).not.toHaveBeenCalled()
        expect(ports.removeContextChips).not.toHaveBeenCalled()
        expect(ports.reportError).toHaveBeenCalledTimes(2)
    })

    it('distinguishes missing rejection targets from failed requests', async () => {
        const { owner, ports } = setup({ review: vi.fn(async () => ({ error: 'GENERATED_OUTPUT_NOT_FOUND' })) })
        expect(await owner.rejectGeneratedOutput('output-node', 'image')).toBe('not-found')
        expect(ports.reportError).not.toHaveBeenCalled()
        ports.review = vi.fn(async () => ({ error: 'denied' }))
        expect(await owner.rejectGeneratedOutput('branch-lineage', 'branch')).toBe('failed')
        expect(ports.reportError).toHaveBeenCalledOnce()
        expect(ports.applyGeometry).not.toHaveBeenCalled()
    })

    it.each(['workspace', 'scene', 'clear', 'destroy'])('suppresses a late review after %s changes', async reason => {
        let finish!: (value: GeneratedOutputReviewResponse) => void
        const fixture = setup({
            review: () =>
                new Promise(resolve => {
                    finish = resolve
                }),
        })
        const accepted = fixture.owner.acceptGeneratedOutput('output-node', 'image')
        if (reason === 'workspace') fixture.setScope({ workspaceId: 'other', sceneKey: 'scene' })
        if (reason === 'scene') fixture.setScope({ workspaceId: 'workspace', sceneKey: 'other' })
        if (reason === 'clear') fixture.owner.clear()
        if (reason === 'destroy') fixture.owner.destroy()
        finish(response())
        await accepted
        expect(fixture.ports.applyGeometry).not.toHaveBeenCalled()
        expect(fixture.ports.refreshMarkers).not.toHaveBeenCalled()
    })

    it('stops subsequent UI callbacks when geometry application replaces the scene', async () => {
        const fixture = setup()
        fixture.ports.applyGeometry = () => fixture.owner.clear()
        await fixture.owner.acceptGeneratedOutput('output-node', 'image')
        expect(fixture.ports.removeContextChips).not.toHaveBeenCalled()
        expect(fixture.ports.refreshChrome).not.toHaveBeenCalled()
    })

    it('replays a sealed media prompt with its saved lineage, references and configuration', async () => {
        const { owner, ports } = setup()
        await owner.regenerateGeneratedOutputs({ scope: 'output-node', mode: 'existing-prompt', targetNodeId: 'image', outputNodes: [imageNode()] })
        expect(ports.review).not.toHaveBeenCalled()
        expect(ports.submit).toHaveBeenCalledWith(
            expect.objectContaining({
                aiReasoningModels: ['reasoner:model'],
                imageOptions: {
                    aiImageModels: ['renderer:model'],
                    imageGenerationSize: 'landscape',
                    configGroups: [{ groupId: 'regeneration-image-0', modelIds: ['renderer:model'], values: { imageSize: 'landscape' } }],
                },
            }),
            {
                explicitContextNodeIds: ['reference', 'context'],
                excludedCanvasNodeIds: ['image'],
                regeneration: { mode: 'existing-prompt', branchId: 'branch-id', lineageParentNodeId: 'branch', lineageParentType: 'branchOrigin', sourceNodeId: 'image', replayPrompts: [{ sourceAssetId: 'asset-image', reasoningModelId: 'reasoner:model', mediaModelId: 'renderer:model', mediaType: 'image', finalPrompt: 'final-image' }] },
            },
        )
    })

    it('replays branch variants separately and preserves their individual prompts', async () => {
        const { owner, ports } = setup()
        await owner.regenerateGeneratedOutputs({ scope: 'branch-lineage', mode: 'existing-prompt', targetNodeId: 'branch', outputNodes: [imageNode('one'), imageNode('two')] })
        expect(ports.submit).toHaveBeenCalledTimes(2)
        expect(vi.mocked(ports.submit).mock.calls.map(call => call[1].regeneration?.replayPrompts?.[0].finalPrompt)).toEqual(['final-one', 'final-two'])
    })

    it('supersedes before regenerating the prompt and never submits into a replacement scene', async () => {
        const fixture = setup()
        fixture.ports.review = vi.fn(async () => {
            fixture.owner.clear()
            return response()
        })
        await fixture.owner.regenerateGeneratedOutputs({ scope: 'branch-lineage', mode: 'regenerate-prompt', targetNodeId: 'branch', outputNodes: [imageNode()] })
        expect(fixture.ports.review).toHaveBeenCalledWith({ workspaceId: 'workspace', scope: 'branch-lineage', action: 'supersede', nodeId: 'branch', preserveLineage: false })
        expect(fixture.ports.submit).not.toHaveBeenCalled()
        expect(fixture.ports.applyGeometry).not.toHaveBeenCalled()
    })

    it('uses the captured workspace for missing provenance and ignores its late response', async () => {
        let finish!: (value: {}) => void
        const fixture = setup({
            readProvenance: () => undefined,
            refreshAsset: vi.fn(() =>
                new Promise(resolve => {
                    finish = resolve
                })
            ),
        })
        const pending = fixture.owner.regenerateGeneratedOutputs({ scope: 'output-node', mode: 'existing-prompt', targetNodeId: 'image', outputNodes: [imageNode()] })
        fixture.setScope({ workspaceId: 'other', sceneKey: 'other' })
        finish({})
        await pending
        expect(fixture.ports.refreshAsset).toHaveBeenCalledWith('asset-image', 'workspace')
        expect(fixture.ports.submit).not.toHaveBeenCalled()
    })

    it('does not substitute an unrelated trace when sealed provenance is absent', async () => {
        const { owner, ports } = setup({ readProvenance: () => undefined, readMediaHistory: () => ({ attrs: { imageGenerationTrace: trace('other') } }) })
        await owner.regenerateGeneratedOutputs({ scope: 'output-node', mode: 'existing-prompt', targetNodeId: 'image', outputNodes: [imageNode()] })
        expect(ports.submit).not.toHaveBeenCalled()
        expect(ports.reportError).toHaveBeenCalledOnce()
    })
})
