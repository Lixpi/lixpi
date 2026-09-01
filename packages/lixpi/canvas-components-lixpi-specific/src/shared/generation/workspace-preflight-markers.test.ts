import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
    type CanvasNode,
    type MediaBranchLineagePlan,
    type MediaBranchCandidateSnapshot,
} from '@lixpi/constants'
import { createLixpiCanvasSettings } from '../../frontend/settings/canvas-settings.ts'
import {
    buildCanvasConversationContent,
    type AiPromptComposerSubmitData,
} from '../composer/canvas-conversation-content.ts'
import { WorkspaceGeometry } from '../branch-tree-layout/workspace-geometry.ts'
import { WorkspaceLineageProjection } from '../branch-tree-layout/workspace-lineage-projection.ts'
import { WorkspaceBranchMarkerHandoff } from './workspace-branch-marker-handoff.ts'
import { WorkspaceGenerationPlacements } from './workspace-generation-placements.ts'
import {
    WorkspacePreflightMarkers,
    type WorkspacePreflightMarkersPorts,
    type WorkspacePreflightConversation,
} from './workspace-preflight-markers.ts'

function submit(patch: Partial<AiPromptComposerSubmitData> = {}): AiPromptComposerSubmitData {
    return { contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'saved prompt' }] }], capabilityInputs: {}, mediaGenerationMode: 'image', aiReasoningModels: ['provider:reasoning-one', 'provider:reasoning-two'], useMultipleReasoningModels: true, useMultipleImageModels: true, useMultipleVideoModels: false, imageOptions: { aiImageModels: ['provider:image-one', 'provider:image-two'], imageGenerationSize: 'auto' }, videoOptions: { aiVideoModels: ['provider:video-one', 'provider:video-two'] }, ...patch }
}
function conversation(threadId = 'thread', data = submit()): WorkspacePreflightConversation {
    return { threadId, content: buildCanvasConversationContent(data, { threadId, messageId: 'message', createdAt: 1, referenceNodeIds: [] }) }
}
function setup(nodes: CanvasNode[] = []) {
    let state: CanvasState | null = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    let scope: { workspaceId: string; sceneKey: string } | null = { workspaceId: 'workspace', sceneKey: 'scene' }
    let nextId = 0
    const settings = createLixpiCanvasSettings()
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    const geometry = new WorkspaceGeometry({ workspaceId: 'workspace', settings, getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getPaneSize: () => ({ width: 1000, height: 800 }), getWorldPosition: node => node.position, getWorldRect: node => ({ ...node.position, ...node.dimensions }), getLiveDimensions: () => undefined, isPending: () => false })
    const lineage = new WorkspaceLineageProjection({ readCanvasState: () => state, placements, geometry, settings: settings.mediaBranchLineage, getWorldPosition: node => node.position, getWorldRect: node => ({ ...node.position, ...node.dimensions }), resizeMarker: node => node })
    const handoff = new WorkspaceBranchMarkerHandoff({ readScope: () => scope, readCanvasState: () => state, placements, lineage, geometry, resizeMarker: node => node, liveGeometry: node => node, isManuallyPositioned: () => false, preservePreview: (_, node) => node, cleanup: () => {}, clearProjection: () => {}, commit: () => {}, syncMarker: () => {}, refreshConversation: () => {}, hasElement: () => false, debugHandoff: () => {}, log: () => {} })
    const threads = new Map<string, WorkspacePreflightConversation>()
    const active = new Set<string>()
    const ports: WorkspacePreflightMarkersPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        placements,
        lineage,
        geometry,
        handoff,
        activeThreadIds: () => [...threads.keys()],
        isRunActive: id => active.has(id),
        readThread: id => threads.get(id),
        resizeMarker: vi.fn(node => node),
        rebalance: vi.fn(nodes => nodes),
        commit: vi.fn(value => {
            state = value
        }),
        append: vi.fn(),
        createId: () => String(++nextId),
        log: vi.fn(),
    }
    return {
        owner: new WorkspacePreflightMarkers(ports),
        ports,
        placements,
        threads,
        active,
        read: () => state!,
        setScope: (value: typeof scope) => {
            scope = value
        },
        setState: (value: CanvasState | null) => {
            state = value
        },
    }
}

describe('workspace preflight markers', () => {
    it('projects each enabled reasoning selection while showing only the selected media mode', () => {
        const { owner } = setup()
        const data = submit({ mediaGenerationMode: 'video', useMultipleReasoningModels: false, useMultipleVideoModels: false })
        expect(owner.getPendingBranchMarkerModelStates(data, 'prompt')).toEqual([{
            phase: 'preflight',
            promptText: 'prompt',
            reasoningModelIds: ['provider:reasoning-one'],
            reasoningModelId: 'provider:reasoning-one',
            reasoningIndex: 0,
            imageModelIds: [],
            videoModelIds: ['provider:video-one'],
        }])
        expect(data.aiReasoningModels).toHaveLength(2)
    })

    it('keeps a placeholder displayable when no reasoning selection was supplied', () => {
        const { owner } = setup()
        const states = owner.getPendingBranchMarkerModelStates(submit({ aiReasoningModels: [], imageOptions: undefined, videoOptions: undefined }), 'prompt')
        expect(states).toEqual([{ phase: 'preflight', promptText: 'prompt', reasoningModelIds: [], reasoningIndex: 0, imageModelIds: [], videoModelIds: [] }])
    })

    it('restores pending display selections and prompt text from the persisted conversation', () => {
        const view = setup()
        const thread = conversation()
        expect(view.owner.getLatestAiUserMessageText(thread)).toBe('saved prompt')
        expect(view.owner.getDetachedThreadPendingModelStates(thread, 'saved prompt')).toEqual([
            expect.objectContaining({ reasoningModelId: 'provider:reasoning-one', imageModelIds: ['provider:image-one', 'provider:image-two'], videoModelIds: [] }),
            expect.objectContaining({ reasoningModelId: 'provider:reasoning-two', imageModelIds: ['provider:image-one', 'provider:image-two'], videoModelIds: [] }),
        ])
        view.owner.insertPendingBranchMarkerForPersistedCanvasThread(thread)
        expect(view.read().nodes.map(node => node.nodeId)).toEqual(['pending-branch-thread-0', 'pending-branch-thread-1'])
        expect(view.ports.append).toHaveBeenCalledTimes(2)
        view.owner.insertPendingBranchMarkerForPersistedCanvasThread(thread)
        expect(view.ports.commit).toHaveBeenCalledOnce()
    })

    it('skips active editors while restoring other detached conversations', () => {
        const view = setup()
        view.threads.set('active', conversation('active'))
        view.threads.set('detached', conversation('detached'))
        view.active.add('active')
        view.owner.restoreDetachedCanvasPreflightMarkersForActiveThreads()
        expect(view.read().nodes.map(node => node.nodeId)).toEqual(['pending-branch-detached-0', 'pending-branch-detached-1'])
    })

    it('places submitted markers in the canvas and records separate reasoning aliases', () => {
        const view = setup()
        view.placements.placements.set('thread', { createdAt: 1, promptText: 'prompt', promptParts: [{ type: 'text', text: 'saved prompt' }] })
        view.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())
        expect(view.read().nodes).toHaveLength(2)
        expect(view.read().nodes[0].position.y).toBeLessThan(view.read().nodes[1].position.y)
        expect([...view.placements.markers.keys()]).toEqual(expect.arrayContaining(['thread:reasoning-index:0', 'thread:reasoning-index:1']))
        expect(view.placements.phases.size).toBe(2)
        expect(view.ports.rebalance).not.toHaveBeenCalled()
        expect(view.ports.append).toHaveBeenNthCalledWith(1, view.read().nodes[0])
    })

    it('attaches provisional markers only to an explicitly selected generated candidate', () => {
        const source: CanvasNode = { nodeId: 'source', type: 'image', assetId: 'asset', position: { x: 10, y: 20 }, dimensions: { width: 200, height: 100 } }
        const view = setup([source])
        const snapshot = { activeTargetCandidateId: 'target', candidates: [{ candidateId: 'target', nodeId: 'source', roleHints: ['generated-variant'] }] } as MediaBranchCandidateSnapshot
        view.placements.placements.set('thread', { promptText: 'prompt', createdAt: 1, mediaBranchCandidateSnapshot: snapshot })
        view.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())
        expect(view.ports.rebalance).toHaveBeenCalledOnce()
        expect(view.read().edges).toHaveLength(2)
        expect(view.read().edges.every(edge => edge.sourceNodeId === 'source')).toBe(true)
        expect(view.owner.getProvisionalGeneratedLineageSourceNode({ ...snapshot, candidates: [{ ...snapshot.candidates[0], roleHints: [] }] })).toBeUndefined()
    })

    it('does not fabricate pending nodes for an empty persisted prompt', () => {
        const view = setup()
        view.owner.insertPendingBranchMarkerForPersistedCanvasThread(conversation('thread', submit({ contentJSON: [] })))
        expect(view.read().nodes).toEqual([])
        expect(view.placements.markers.size).toBe(0)
        expect(view.ports.commit).not.toHaveBeenCalled()
    })

    it('uses API marker IDs and request identity when restoring a lineage plan', () => {
        const view = setup()
        const plan: MediaBranchLineagePlan = {
            planVersion: 'media-branch-lineage-v1',
            generationRequestId: 'request',
            branchId: 'branch',
            promptText: 'prompt',
            referenceAssetIds: [],
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            createdAt: 1,
            branchForks: [],
            branchLines: [],
            runAssignments: [{ assetId: 'output', generationRequestId: 'request', branchId: 'branch', branchForkNodeId: 'api-marker', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', referenceAssetIds: [], referenceNodeIds: [], sourceContextNodeIds: [], promptText: 'prompt', createdAt: 1 }],
        }
        view.owner.insertPendingBranchMarkersFromLineagePlan('thread', plan)
        expect(view.read().nodes).toEqual([expect.objectContaining({ nodeId: 'api-marker', conversationAssetId: 'thread', generationRequestId: 'request' })])
        expect(view.placements.markers.get('thread:request')?.nodeId).toBe('api-marker')
        expect(view.ports.append).toHaveBeenCalledOnce()
    })

    it('does not publish partial aliases or nodes if a later marker resize fails', () => {
        const view = setup()
        vi.mocked(view.ports.resizeMarker).mockImplementationOnce(node => node).mockImplementationOnce(() => {
            throw new Error('resize')
        })
        expect(() => view.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())).toThrow('resize')
        expect(view.placements.markers.size).toBe(0)
        expect(view.placements.phases.size).toBe(0)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.append).not.toHaveBeenCalled()
    })

    it('abandons prepared nodes when their scene changes before publication', () => {
        const view = setup()
        vi.mocked(view.ports.resizeMarker).mockImplementation(node => {
            view.setScope({ workspaceId: 'other', sceneKey: 'other' })
            return node
        })
        view.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.placements.markers.size).toBe(0)
        expect(view.placements.phases.size).toBe(0)
    })

    it('does not append old-scene nodes after the commit changes its scope', () => {
        const view = setup()
        vi.mocked(view.ports.commit).mockImplementation(() => {
            view.setScope(null)
        })
        view.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())
        expect(view.ports.commit).toHaveBeenCalledOnce()
        expect(view.ports.append).not.toHaveBeenCalled()
    })

    it('keeps separate canvas instances independent and ignores closed scopes', () => {
        const first = setup()
        const second = setup()
        first.setScope(null)
        first.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())
        second.owner.insertPendingBranchMarkerForCanvasRun('thread', 'prompt', submit())
        expect(first.placements.markers.size).toBe(0)
        expect(second.read().nodes).toHaveLength(2)
    })
})
