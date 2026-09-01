import {
    describe,
    expect,
    it,
} from 'vitest'
import type {
    Asset,
    CanvasNode,
    MediaPromptReference,
    BranchOriginCanvasNode,
} from '@lixpi/constants'
import type { BranchMarkerConversationPreview } from '@lixpi/prosemirror/shared/thread-doc'
import {
    WorkspaceReferenceProjection,
    getBranchMarkerPromptText,
    getBranchMarkerReasoningResponseText,
} from './workspace-reference-projection.ts'
import type { BranchMarkerPromptPart } from '../branch-tree-layout/marker-prompt-parts.ts'

const geometry = { position: { x: 10, y: 20 }, dimensions: { width: 300, height: 200 } }
const canvasNode = (nodeId: string, type: CanvasNode['type'] = 'image', assetId = 'asset'): CanvasNode => ({ ...geometry, nodeId, type, assetId } as CanvasNode)
const reference = (overrides: Partial<MediaPromptReference> = {}): MediaPromptReference => ({ referenceType: 'media', nodeId: 'node', assetId: 'asset', mediaKind: 'image', displayName: 'Prompt label', ...overrides })
const marker = (provenance: object = {}): BranchOriginCanvasNode => ({ ...geometry, nodeId: 'origin', type: 'branchOrigin', conversationAssetId: 'thread', generationRequestId: 'request', provenance } as BranchOriginCanvasNode)
function fixture() {
    let nodes: CanvasNode[] = []
    const assets = new Map<string, Asset>()
    const titles = new Map<string, string>()
    const parts = new Map<string, BranchMarkerPromptPart[]>()
    const projection = new WorkspaceReferenceProjection({ getNodes: () => nodes, getAsset: id => assets.get(id), getDocumentTitles: () => titles, getSubmittedPromptParts: key => parts.get(key) })
    return {
        projection,
        assets,
        titles,
        parts,
        setNodes: (value: CanvasNode[]) => {
            nodes = value
        },
    }
}

describe('WorkspaceReferenceProjection', () => {
    it('prefers the explicit placement when it references the expected Asset', () => {
        const f = fixture()
        const explicit = canvasNode('node')
        const other = canvasNode('other')
        f.setNodes([other, explicit])
        expect(f.projection.getPromptReferencePreviewNode(reference())).toBe(explicit)
        f.setNodes([canvasNode('node', 'image', 'wrong-asset'), other])
        expect(f.projection.getPromptReferencePreviewNode(reference())).toBe(other)
    })

    it('projects uploaded documents into document previews without modifying their canvas placement', () => {
        const f = fixture()
        const node = canvasNode('node', 'mediaDocument')
        f.setNodes([node])
        expect(f.projection.getPromptReferencePreviewNode(reference({ mediaKind: 'document' }))).toEqual({ ...node, type: 'document' })
        expect(node.type).toBe('mediaDocument')
    })

    it('synthesizes an off-canvas preview from Asset dimensions without inserting a canvas node', () => {
        const f = fixture()
        f.assets.set('asset', { title: 'Asset', media: { kind: 'video', width: 1920, height: 1080 } } as Asset)
        expect(f.projection.getPromptReferencePreviewNode(reference({ mediaKind: 'video', nodeId: undefined }))).toEqual({ nodeId: 'prompt-reference-asset', assetId: 'asset', type: 'video', position: { x: 0, y: 0 }, dimensions: { width: 1920, height: 1080 } })
        expect(f.projection.getPromptReferencePreviewNode(reference({ assetId: 'missing', nodeId: undefined }))?.dimensions).toEqual({ width: 320, height: 240 })
    })

    it('uses the requested kind and bounds nonpositive fallback dimensions', () => {
        const f = fixture()
        f.assets.set('asset', { title: 'Asset', media: { width: 0, height: -1 } } as Asset)
        expect(f.projection.getPromptReferencePreviewNode(reference({ mediaKind: 'audio' }))).toMatchObject({ type: 'audio', dimensions: { width: 1, height: 1 } })
    })

    it('resolves media kind from Asset metadata before falling back to a canvas node', () => {
        const f = fixture()
        f.setNodes([canvasNode('node', 'mediaDocument')])
        expect(f.projection.getReferenceResolutionMediaKind('asset')).toBe('document')
        f.assets.set('asset', { title: 'Asset', media: { kind: 'audio' } } as Asset)
        expect(f.projection.getReferenceResolutionMediaKind('asset')).toBe('audio')
        expect(f.projection.getReferenceResolutionMediaKind('missing')).toBeUndefined()
    })

    it('preserves repeated prompt references but emits only the API-selected media handles', () => {
        const f = fixture()
        const repeated: BranchMarkerPromptPart = { type: 'media', reference: reference() }
        f.parts.set('thread', [repeated, { type: 'text', text: ' again ' }, repeated, { type: 'media', reference: reference({ assetId: 'unselected', nodeId: 'unselected' }) }])
        f.setNodes([canvasNode('node')])
        const node = marker({ referenceAssetIds: ['asset'] })
        expect(f.projection.getBranchMarkerPromptPartsForNode(node, null).filter(part => part.type === 'media')).toHaveLength(3)
        expect(f.projection.getBranchMarkerPromptTraceHandles(node, null)).toEqual([{ kind: 'media', id: 'asset', displayName: 'Prompt label', mediaKind: 'image', nodeId: 'node', role: 'message-reference' }])
    })

    it('keeps an explicitly empty authoritative reference list empty', () => {
        const f = fixture()
        f.parts.set('thread', [{ type: 'media', reference: reference() }])
        f.setNodes([canvasNode('node')])
        expect(f.projection.getBranchMarkerPromptTraceHandles(marker({ referenceAssetIds: [], referenceNodeIds: ['node'] }), null)).toEqual([])
    })

    it('resolves older node-based provenance and prefers the current Asset title', () => {
        const f = fixture()
        f.setNodes([canvasNode('node')])
        f.assets.set('asset', { title: '  Current title  ', media: { kind: 'image' } } as Asset)
        expect(f.projection.getBranchMarkerPromptTraceHandles(marker({ referenceNodeIds: ['node', 'missing'] }), null)).toEqual([{ kind: 'media', id: 'asset', displayName: 'Current title', mediaKind: 'image', nodeId: 'node', role: 'message-reference' }])
    })

    it('keeps requested Capability handles separate from media provenance', () => {
        const f = fixture()
        f.parts.set('thread', [{ type: 'capability-module', reference: { referenceType: 'capability-module', moduleId: 'test-module', displayName: 'Test module' } }])
        expect(f.projection.getBranchMarkerPromptTraceHandles(marker(), null)).toEqual([{ kind: 'capability-module', id: 'test-module', displayName: 'Test module', role: 'requested-by-user' }])
    })

    it('uses submitted parts until the persisted user message is available', () => {
        const f = fixture()
        f.parts.set('thread:request', [{ type: 'text', text: 'Submitted prompt' }])
        const node = marker({ promptText: 'Provenance fallback' })
        expect(f.projection.getBranchMarkerPromptPartsForNode(node, null)).toEqual([{ type: 'text', text: 'Submitted prompt' }])
        const preview = { userMessage: { type: 'aiUserMessage', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Persisted prompt' }] }] } } as BranchMarkerConversationPreview
        expect(f.projection.getBranchMarkerPromptPartsForNode(node, preview)).toEqual([{ type: 'text', text: 'Persisted prompt' }])
    })

    it('includes hydrated document titles without inventing titles for other node kinds', () => {
        const f = fixture()
        f.titles.set('document', 'Document title')
        const nodes = [canvasNode('doc', 'document', 'document'), canvasNode('media-doc', 'mediaDocument', 'document'), canvasNode('missing', 'document', 'missing')]
        expect(f.projection.buildWorkspaceContextTitlesByNodeId(nodes)).toEqual({ doc: 'Document title' })
    })

    it('preserves prompt normalization and response-text fallback', () => {
        const node = marker({ promptText: '  one\n two ', reasoningResponseText: ' stored response ' })
        expect(getBranchMarkerPromptText(node)).toBe('one two')
        expect(getBranchMarkerReasoningResponseText(node, null)).toBe('stored response')
        expect(getBranchMarkerReasoningResponseText(node, { responseText: ' streamed response ' } as BranchMarkerConversationPreview)).toBe('streamed response')
    })
})
