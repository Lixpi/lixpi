// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    ImageCanvasNode,
    ImageGenerationTraceReference,
    MediaGenerationProgressState,
} from '@lixpi/constants'
import type {
    MediaGenerationProgressInstance,
    MediaGenerationProgressOptions,
} from '../progress/index.ts'
import {
    WorkspaceGenerationHistory,
    mountWorkspaceMediaHistory,
    type WorkspaceGenerationHistoryPorts,
    type WorkspaceHistoryEditorRequest,
} from './workspace-generation-history.ts'

const progressViews = vi.hoisted(() => [] as { options: MediaGenerationProgressOptions; instance: MediaGenerationProgressInstance }[])
vi.mock('../progress/index.ts', () => ({
    createMediaGenerationProgress: (options: MediaGenerationProgressOptions) => {
        const instance = { element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() }
        progressViews.push({ options, instance })
        return instance
    },
}))

const owners: WorkspaceGenerationHistory[] = []
const node = { nodeId: 'node', type: 'image', assetId: 'asset', position: { x: 0, y: 0 }, dimensions: { width: 400, height: 240 }, generatedBy: { conversationAssetId: 'thread', responseMessageId: 'response', reasoningModelId: 'reasoning:model' } } as ImageCanvasNode
const reference = (nodeId: string) => ({ nodeId } as ImageGenerationTraceReference)

function fixture(media = true) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = { destroy: vi.fn() }
    const abort = new AbortController()
    const hydration: AbortSignal[] = []
    const nodeMap = new Map<string, CanvasNode>([[node.nodeId, node]])
    const onProgress = vi.fn()
    let request!: WorkspaceHistoryEditorRequest
    const ports: WorkspaceGenerationHistoryPorts = {
        getNode: id => nodeMap.get(id),
        renditionPath: (assetId, rendition) => `/assets/${assetId}/${rendition}`,
        getContextEnvironment: () => ({
            document,
            tooltipHideDelayMs: 0,
            getDocuments: () => [],
            getThreads: () => [],
            getArtifactIcon: () => '',
            extractDocumentText: () => '',
            initialRenditionUrl: () => '',
            resolveRenditionUrl: (_asset, _rendition, signal) => {
                hydration.push(signal)
                return new Promise(() => {})
            },
            onError: vi.fn(),
        }),
        getMediaContent: vi.fn(() => ({
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread' },
                content: [{
                    type: 'aiResponseMessage',
                    attrs: { id: 'response' },
                    content: [{ type: 'aiGeneratedImage', attrs: { assetId: 'asset' } }],
                }],
            }],
        })),
        getProgress: () => ({ mediaRunId: 'live-run', status: 'running' } as MediaGenerationProgressState),
        mountEditor: vi.fn(input => {
            request = input
            return editor
        }),
        createReasoningBadge: vi.fn(() => document.createElement('span')),
        styleReasoningHeader: vi.fn(),
        progressDetails: {},
        onError: vi.fn(),
    }
    const mount = () => {
        const owner = new WorkspaceGenerationHistory({ host, projection: { threadId: 'thread', content: { type: 'doc', content: [] } }, signal: abort.signal, ...(media ? { media: { node, limitToSelectedMedia: false, onProgress } } : {}) }, ports)
        owners.push(owner)
        return owner
    }
    return {
        host,
        ports,
        editor,
        abort,
        nodeMap,
        onProgress,
        hydration,
        mount,
        get request() {
            return request
        },
    }
}
beforeEach(() => {
    progressViews.length = 0
})
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('WorkspaceGenerationHistory', () => {
    it('mounts sealed media content through the editor port with a reasoning badge', () => {
        const f = fixture()
        const owner = mountWorkspaceMediaHistory({ host: f.host, node, lineageProjectionScope: 'media-run', limitToSelectedMedia: true, onProgress: f.onProgress }, f.ports)
        expect(owner).not.toBeNull()
        owners.push(owner!)
        expect(f.request.threadId).toBe('thread')
        expect(f.request.content.type).toBe('doc')
        expect(f.request.traceDetailsOptions.hideToolPrompt).toBe(true)
        expect(f.ports.createReasoningBadge).toHaveBeenCalledWith('reasoning:model')
        expect(f.host.querySelector('.canvas-generated-media-reasoning-model-caption')?.textContent).toBe('Reasoning model:')
        expect(f.request.mediaGenerationProgress).toBeTypeOf('function')
    })

    it('keeps branch projections free of media-specific headers and timelines', () => {
        const f = fixture(false)
        f.mount()
        expect(f.request.mediaGenerationProgress).toBeUndefined()
        expect(f.request.traceDetailsOptions.hideToolPrompt).toBe(false)
        expect(f.ports.createReasoningBadge).not.toHaveBeenCalled()
    })

    it('resolves image and video reference renditions through the supplied path port', () => {
        const f = fixture(false)
        f.nodeMap.set('video', { ...node, type: 'video', nodeId: 'video', assetId: 'video-asset' } as CanvasNode)
        f.mount()
        expect(f.request.traceDetailsOptions.getAdditionalReferenceImageSources(reference('node'))).toEqual(['/assets/asset/preview'])
        expect(f.request.traceDetailsOptions.getAdditionalReferenceImageSources(reference('video'))).toEqual(['/assets/video-asset/representativeFrame', '/assets/video-asset/poster'])
        expect(f.request.traceDetailsOptions.renderReferenceTile(reference('missing'))).toBeNull()
    })

    it('releases reference previews and blocks callbacks after the owning view aborts', () => {
        const f = fixture()
        f.mount()
        const tile = f.request.traceDetailsOptions.renderReferenceTile(reference('node'))!
        f.request.mount.appendChild(tile)
        expect(f.hydration).toHaveLength(2)
        f.abort.abort()
        expect(f.request.signal.aborted).toBe(true)
        expect(f.hydration.every(signal => signal.aborted)).toBe(true)
        expect(f.editor.destroy).toHaveBeenCalledOnce()
        expect(f.host.childElementCount).toBe(0)
        expect(f.request.traceDetailsOptions.renderReferenceTile(reference('node'))).toBeNull()
        expect(f.request.traceDetailsOptions.getAdditionalReferenceImageSources(reference('node'))).toEqual([])
        expect(() => f.request.mediaGenerationProgress!({ id: 'late', state: { status: 'running' } as MediaGenerationProgressState, showSummaryWhenCollapsedItemIds: [] })).toThrow('disposed')
        expect(progressViews).toHaveLength(0)
    })

    it('replaces only the matching projected run with live progress and shares one disposer', () => {
        const f = fixture()
        const owner = f.mount()
        const create = f.request.mediaGenerationProgress!
        const otherState = { mediaRunId: 'other-run', status: 'completed' } as MediaGenerationProgressState
        create({ id: 'other', state: otherState, showSummaryWhenCollapsedItemIds: [] })
        expect(progressViews[0].options.state).toBe(otherState)
        expect(f.onProgress).not.toHaveBeenCalled()
        const view = create({ id: 'live', state: { mediaRunId: 'live-run', status: 'pending' } as MediaGenerationProgressState, showSummaryWhenCollapsedItemIds: ['reasoning'] })
        expect(progressViews[1].options.state.status).toBe('running')
        expect(f.onProgress).toHaveBeenCalledWith(view)
        view.destroy()
        owner.destroy()
        expect(progressViews[0].instance.destroy).toHaveBeenCalledOnce()
        expect(progressViews[1].instance.destroy).toHaveBeenCalledOnce()
    })

    it('releases progress created during an editor mount that subsequently fails', () => {
        const f = fixture()
        f.ports.mountEditor = request => {
            request.mediaGenerationProgress!({ id: 'run', state: { status: 'running' } as MediaGenerationProgressState, showSummaryWhenCollapsedItemIds: [] })
            throw new Error('editor failed')
        }
        expect(() => f.mount()).toThrow('editor failed')
        expect(progressViews[0].instance.destroy).toHaveBeenCalledOnce()
        expect(f.host.childElementCount).toBe(0)
    })

    it('skips aborted or non-generated requests before reading history', () => {
        const f = fixture()
        f.abort.abort()
        expect(mountWorkspaceMediaHistory({ host: f.host, node, signal: f.abort.signal, lineageProjectionScope: 'media-run', limitToSelectedMedia: true, onProgress: f.onProgress }, f.ports)).toBeNull()
        expect(mountWorkspaceMediaHistory({ host: f.host, node: { ...node, generatedBy: undefined }, lineageProjectionScope: 'media-run', limitToSelectedMedia: true, onProgress: f.onProgress }, f.ports)).toBeNull()
        expect(f.ports.getMediaContent).not.toHaveBeenCalled()
    })

    it('reports abort cleanup errors without interrupting another canvas', () => {
        const first = fixture()
        const second = fixture()
        first.mount()
        second.mount()
        first.editor.destroy.mockImplementationOnce(() => {
            throw new Error('editor cleanup failed')
        })
        first.abort.abort()
        expect(first.ports.onError).toHaveBeenCalledOnce()
        expect(first.host.childElementCount).toBe(0)
        expect(second.editor.destroy).not.toHaveBeenCalled()
        expect(second.host.childElementCount).toBeGreaterThan(0)
    })
})
