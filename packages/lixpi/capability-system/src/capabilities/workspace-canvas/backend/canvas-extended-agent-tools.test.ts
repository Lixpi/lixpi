import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Asset,
    type CanvasCollaborationLease,
    type CanvasCollaborationSnapshot,
    type CanvasNode,
    type CanvasState,
    type MediaGenerationRequest,
} from '@lixpi/constants'
import { createExtendedCanvasAgentTools } from './canvas-extended-agent-tools.ts'
import {
    type CanvasAgentAsset,
    type CanvasAgentSession,
} from './canvas-agent-ports.ts'
import {
    type CanvasExtendedSession,
} from './canvas-extended-agent-ports.ts'

type Execute = (
    input: Readonly<Record<string, unknown>>,
    context: never,
) => Promise<{
    status: string
    data?: Record<string, unknown>
    error?: { code: string }
}>

const node = (
    nodeId: string,
    type: CanvasNode['type'],
    assetId: string,
): CanvasNode => ({
    nodeId,
    type,
    assetId,
    position: {
        x: 10,
        y: 20,
    },
    dimensions: {
        width: 400,
        height: 300,
    },
}) as CanvasNode

const media = (
    assetId: string,
    kind: 'image' | 'video',
): CanvasAgentAsset => ({
    assetId,
    title: assetId,
    revision: 1,
    documents: {},
    media: {
        kind,
        originalName: `${assetId}.bin`,
        sourceMimeType: `${kind}/x`,
        modelSafe: true,
        renditions: {
            original: {
                name: 'original',
                status: 'ready',
                updatedAt: 1,
            },
        },
    },
})

const createHarness = (initial: CanvasState) => {
    let state = structuredClone(initial)
    let revision = 1
    const held = new Set<string>()
    const acquired: string[] = []
    const assets = new Map<string, CanvasAgentAsset>()
    const snapshot = (): CanvasCollaborationSnapshot => ({
        actorId: 'agent',
        canvasRevision: revision,
        canvasState: structuredClone(state),
        actors: [],
    }) as unknown as CanvasCollaborationSnapshot
    const write = (next: CanvasState) => {
        state = structuredClone(next)
        revision += 1
    }
    const session = {
        requestId: 'request',
        signal: new AbortController().signal,
        inspect: vi.fn(async () => snapshot()),
        acquire: vi.fn(async (target: string): Promise<CanvasCollaborationLease> => {
            held.add(target)
            acquired.push(target)

            return {
                target,
                actorId: 'agent',
                leaseId: `lease-${target}`,
            }
        }),
        release: vi.fn(async (lease: CanvasCollaborationLease) => void held.delete(lease.target)),
        readAsset: vi.fn(async (assetId: string) => {
            const asset = assets.get(assetId)

            if (!asset)
                throw new Error('NOT_FOUND')

            return asset
        }),
        replaceAsset: vi.fn(async ({
            nodeId,
            assetId,
        }: {
            nodeId: string
            assetId: string
        }) => write({
            ...state,
            nodes: state.nodes.map(node => node.nodeId === nodeId ? {
                ...node,
                assetId,
            } : node),
        })),
    }

    return {
        session: session as unknown as CanvasAgentSession,
        mocks: session,
        assets,
        held,
        acquired,
        state: () => state,
    }
}

const tool = (
    name: string,
    session: CanvasAgentSession,
    extended: Partial<CanvasExtendedSession>,
): Execute => {
    const registration = createExtendedCanvasAgentTools(
        async () => session,
        async () => extended as CanvasExtendedSession,
    ).find(entry => entry.name === name)

    if (
        !registration
        || !('execute' in registration)
    )
        throw new Error(`missing ${name}`)

    return registration.execute as unknown as Execute
}

// =============================================================================
// MEDIA REPLACEMENT
// =============================================================================

describe('replace_canvas_media', () => {
    const initial: CanvasState = {
        nodes: [
            node('first', 'image', 'old'),
            node('second', 'image', 'other'),
        ],
        edges: [{
            edgeId: 'edge',
            sourceNodeId: 'first',
            targetNodeId: 'second',
        }],
    } as unknown as CanvasState

    it('keeps the node identity, stacking position and connections while swapping its Asset', async () => {
        const harness = createHarness(initial)
        harness.assets.set('new', media('new', 'image'))

        const result = await tool('replace_canvas_media', harness.session, {})({
            nodeId: 'first',
            assetId: 'new',
        }, undefined as never)

        expect(result.status).toBe('completed')
        expect(harness.state().nodes.map(item => [item.nodeId, 'assetId' in item ? item.assetId : null])).toEqual([
            ['first', 'new'],
            ['second', 'other'],
        ])
        expect(harness.state().edges.map(edge => edge.edgeId)).toEqual(['edge'])
        expect([...harness.acquired].sort()).toEqual([
            'asset:new',
            'asset:old',
            'edge:edge',
            'node:first',
        ])
        expect(harness.held.size).toBe(0)
    })

    it('rejects a replacement of a different media kind before detaching', async () => {
        const harness = createHarness(initial)
        harness.assets.set('clip', media('clip', 'video'))

        const result = await tool('replace_canvas_media', harness.session, {})({
            nodeId: 'first',
            assetId: 'clip',
        }, undefined as never)

        expect(result.error?.code).toBe('CANVAS_MEDIA_KIND_MISMATCH')
        expect(harness.mocks.replaceAsset).not.toHaveBeenCalled()
    })

    it('retains the previous media when the atomic replacement is rejected', async () => {
        const harness = createHarness(initial)
        harness.assets.set('new', media('new', 'image'))
        harness.mocks.replaceAsset.mockImplementationOnce(async () => {
            throw new Error('ASSET_NOT_ATTACHABLE')
        })

        const result = await tool('replace_canvas_media', harness.session, {})({
            nodeId: 'first',
            assetId: 'new',
        }, undefined as never)

        expect(result.error?.code).toBe('ASSET_NOT_ATTACHABLE')
        expect(harness.state().nodes.map(item => 'assetId' in item ? item.assetId : null)).toEqual([
            'old',
            'other',
        ])
    })
})

// =============================================================================
// ASSET LIBRARY
// =============================================================================

describe('Asset library tools', () => {
    const initial = {
        nodes: [node('placed', 'document', 'doc')],
        edges: [],
    } as unknown as CanvasState

    it('changes scope through the placed Asset under its Asset lease', async () => {
        const harness = createHarness(initial)
        const changeAssetScope = vi.fn(async () => ({
            assetId: 'doc',
            scope: 'user',
            revision: 4,
        }) as Asset)

        const result = await tool('change_canvas_asset_scope', harness.session, { changeAssetScope })({
            target: { nodeId: 'placed' },
            scope: 'user',
            expectedRevision: 3,
        }, undefined as never)

        expect(result.data).toEqual({
            assetId: 'doc',
            scope: 'user',
            revision: 4,
        })
        expect(changeAssetScope).toHaveBeenCalledWith('doc', 'user', 3, expect.objectContaining({ target: 'asset:doc' }))
    })

    it('publishes no input field for a scope owner or acting user', () => {
        const registration = createExtendedCanvasAgentTools(
            async () => createHarness(initial).session,
            async () => ({}) as CanvasExtendedSession,
        ).find(entry => entry.name === 'change_canvas_asset_scope')
        const properties = Object.keys((registration?.schema as { properties: object }).properties)

        expect(properties.sort()).toEqual([
            'expectedRevision',
            'scope',
            'target',
        ])
    })

    it('refuses an empty metadata change', async () => {
        const harness = createHarness(initial)
        const updateAssetMetadata = vi.fn()

        const result = await tool('update_canvas_asset_metadata', harness.session, { updateAssetMetadata })({
            target: { assetId: 'doc' },
            expectedRevision: 1,
        }, undefined as never)

        expect(result.error?.code).toBe('CANVAS_ASSET_METADATA_EMPTY')
        expect(updateAssetMetadata).not.toHaveBeenCalled()
    })
})

// =============================================================================
// GENERATED OUTPUT REVIEW AND GENERATION CONTROL
// =============================================================================

describe('Generated output review and generation control', () => {
    const initial = {
        nodes: [
            node('marker', 'branchOrigin' as CanvasNode['type'], 'conversation'),
            node('output', 'image', 'generated'),
            node('status', 'operationStatus' as CanvasNode['type'], 'status-asset'),
        ],
        edges: [],
    } as unknown as CanvasState

    it('reviews while holding every planned node and Asset target', async () => {
        const harness = createHarness(initial)
        const plan = {
            nodeIds: ['output'],
            edgeIds: [],
            assetIds: ['generated'],
        }
        const reviewGeneratedOutput = vi.fn(async () => {
            expect([...harness.held].sort()).toEqual([
                'asset:generated',
                'node:marker',
                'node:output',
            ])

            return {
                success: true,
                workspaceId: 'workspace',
                affectedAssetIds: ['generated'],
                acceptedAssetIds: ['generated'],
                supersededAssetIds: [],
                rejectedAssetIds: [],
            }
        })

        const result = await tool('review_canvas_generated_output', harness.session, {
            planGeneratedOutputReview: async () => plan,
            reviewGeneratedOutput: reviewGeneratedOutput as unknown as CanvasExtendedSession['reviewGeneratedOutput'],
        })({
            nodeId: 'marker',
            scope: 'branch-lineage',
            action: 'accept',
        }, undefined as never)

        expect(result.data?.acceptedAssetIds).toEqual(['generated'])
        expect(reviewGeneratedOutput).toHaveBeenCalledOnce()
    })

    it('stops when the reviewed outputs change while it waits for leases', async () => {
        const harness = createHarness(initial)
        const plans = [
            {
                nodeIds: [],
                edgeIds: [],
                assetIds: [],
            },
            {
                nodeIds: ['output'],
                edgeIds: [],
                assetIds: ['generated'],
            },
        ]
        const reviewGeneratedOutput = vi.fn()

        const result = await tool('review_canvas_generated_output', harness.session, {
            planGeneratedOutputReview: async () => plans.shift()!,
            reviewGeneratedOutput,
        })({
            nodeId: 'marker',
            scope: 'branch-lineage',
            action: 'reject',
        }, undefined as never)

        expect(result.error?.code).toBe('CANVAS_REVIEW_TARGETS_CHANGED')
        expect(reviewGeneratedOutput).not.toHaveBeenCalled()
    })

    it('cancels a generation while holding its canvas placements', async () => {
        const harness = createHarness(initial)
        const request = {
            generationRequestId: 'generation',
            status: 'running',
            revision: 7,
            plannedCanvasNodeIds: ['output'],
            runs: [{ operationNodeId: 'status' }],
            unresolvedBindings: [],
        } as unknown as MediaGenerationRequest
        const cancelGeneration = vi.fn(async (_id: string, _revision: number, leases: CanvasCollaborationLease[]) => {
            expect(leases.map(lease => lease.target).sort()).toEqual([
                'node:output',
                'node:status',
            ])

            return {
                ...request,
                status: 'cancelled',
                revision: 8,
            } as MediaGenerationRequest
        })

        const result = await tool('cancel_canvas_generation', harness.session, {
            readGeneration: async () => request,
            cancelGeneration,
        })({
            generationRequestId: 'generation',
            expectedRevision: 7,
        }, undefined as never)

        expect(result.data).toMatchObject({
            status: 'cancelled',
            revision: 8,
        })
        expect(cancelGeneration).toHaveBeenCalledWith('generation', 7, expect.any(Array))
    })
})
