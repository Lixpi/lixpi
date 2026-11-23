import {
    type Asset,
    type AssetMediaKind,
    type AssetScope,
    type CanvasCollaborationLease,
    type CanvasCollaborationSnapshot,
    type CanvasNode,
    type CanvasState,
    type MediaGenerationRequest,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    type CanvasAgentSession,
} from './canvas-agent-ports.ts'
import {
    type CanvasAssetMetadataPatch,
    type CanvasAssetTarget,
    type CanvasExtendedSession,
    type CanvasGeneratedOutputReview,
    type CanvasGeneratedOutputReviewPlan,
} from './canvas-extended-agent-ports.ts'

const mediaNodeTypes: Readonly<Record<AssetMediaKind, CanvasNode['type']>> = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    document: 'mediaDocument',
}

const graph = (snapshot: CanvasCollaborationSnapshot): CanvasState => {
    if (!snapshot.canvasState)
        throw new Error('CANVAS_STATE_UNAVAILABLE')

    return snapshot.canvasState
}

const nodeById = (
    state: CanvasState,
    nodeId: string,
): CanvasNode => {
    const node = state.nodes.find(item => item.nodeId === nodeId)

    if (!node)
        throw new Error('CANVAS_NODE_NOT_FOUND')

    return node
}

const placedAssetId = (node: CanvasNode): string | undefined => 'assetId' in node
    && node.assetId
    && node.type !== 'operationStatus'
    ? node.assetId
    : undefined

const assetOf = (node: CanvasNode): string => {
    const assetId = placedAssetId(node)

    if (!assetId)
        throw new Error('CANVAS_NODE_HAS_NO_ASSET')

    return assetId
}

const generationOf = (node: CanvasNode): string | undefined => {
    const record = node as {
        generationRequestId?: unknown
        generatedBy?: { generationRequestId?: unknown }
        generationProgress?: { generationRequestId?: unknown }
    }
    const id = record.generationRequestId
        ?? record.generatedBy?.generationRequestId
        ?? record.generationProgress?.generationRequestId

    return typeof id === 'string' ? id : undefined
}

const nodeTarget = (id: string): string => `node:${id}`
const edgeTarget = (id: string): string => `edge:${id}`
const assetTarget = (id: string): string => `asset:${id}`

const incidentEdges = (
    state: CanvasState,
    nodeId: string,
): WorkspaceEdge[] => state.edges.filter(edge => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)

const neighborhoodTargets = (
    state: CanvasState,
    nodeIds: readonly string[],
): string[] => {
    const present = nodeIds.filter(nodeId => state.nodes.some(node => node.nodeId === nodeId))

    return [
        ...present.map(nodeTarget),
        ...present.flatMap(nodeId => incidentEdges(state, nodeId).map(edge => edgeTarget(edge.edgeId))),
        ...present.flatMap(nodeId => state.nodes.filter(node => node.parentId === nodeId).map(node => nodeTarget(node.nodeId))),
    ]
}

const assertWithin = (
    targets: readonly string[],
    held: readonly string[],
    code: string,
): void => {
    if (targets.some(target => !held.includes(target)))
        throw new Error(code)
}

const withLeases = async <T>(
    session: CanvasAgentSession,
    targets: string[],
    work: (
        leases: CanvasCollaborationLease[],
        held: string[],
    ) => Promise<T>,
): Promise<T> => {
    const held = [...new Set(targets)].sort()
    const leases: CanvasCollaborationLease[] = []

    try {
        for (const target of held)
            leases.push(await session.acquire(target))

        session.signal.throwIfAborted()

        return await work(leases, held)
    } finally {
        await Promise.allSettled(
            leases.map(lease => session.release(lease)),
        )
    }
}

const describeAsset = (
    asset: Asset,
    state: CanvasState,
): object => ({
    assetId: asset.assetId,
    title: asset.title,
    revision: asset.revision,
    scope: asset.scope,
    placements: state.nodes.filter(node => placedAssetId(node) === asset.assetId).map(node => node.nodeId),
    documentRoles: Object.keys(asset.documents),
    ...(asset.media
        ? {
            media: {
                kind: asset.media.kind,
                status: asset.states.media,
                originalReady: asset.media.renditions.original?.status === 'ready',
                width: asset.media.width,
                height: asset.media.height,
                aspectRatio: asset.media.aspectRatio,
                durationSeconds: asset.media.durationSeconds,
            },
        }
        : {}),
    ...(asset.artifact ? { artifactTypeId: asset.artifact.artifactTypeId } : {}),
    depictionMedium: asset.depictionMedium,
    ...(asset.descriptor
        ? {
            descriptor: {
                status: asset.descriptor.status,
                summary: asset.descriptor.summary,
                entityTags: asset.descriptor.entityTags,
                styleTags: asset.descriptor.styleTags,
            },
        }
        : {}),
    subjectIdentity: {
        classification: asset.subjectIdentity.classification,
        source: asset.subjectIdentity.source,
        attested: Boolean(asset.subjectIdentity.currentAttestationId),
        validProviderVerifications: asset.subjectIdentity.providerVerifications.filter(verification => verification.status === 'valid').length,
    },
    ...(asset.lineage
        ? {
            generatedOutput: {
                review: asset.generatedOutputReview?.status ?? 'candidate',
                provenance: asset.states.provenance,
                ...(asset.lineage.generationRequestId ? { generationRequestId: asset.lineage.generationRequestId } : {}),
            },
        }
        : {}),
})

const generationNodeIds = (
    request: MediaGenerationRequest,
    state: CanvasState,
): string[] => {
    const candidates = new Set([
        ...request.plannedCanvasNodeIds,
        ...request.runs.flatMap(run => run.outputNodeId ? [run.operationNodeId, run.outputNodeId] : [run.operationNodeId]),
        ...state.nodes.filter(node => generationOf(node) === request.generationRequestId).map(node => node.nodeId),
    ])

    return state.nodes.filter(node => candidates.has(node.nodeId)).map(node => node.nodeId)
}

const describeGeneration = (
    request: MediaGenerationRequest,
    state: CanvasState,
): object => ({
    generationRequestId: request.generationRequestId,
    status: request.status,
    revision: request.revision,
    canvasNodeIds: generationNodeIds(request, state),
    runs: request.runs.map(
        run => ({
            generationRun: run.generationRun,
            status: run.status,
            modelId: run.modelId,
            ...(run.mediaType ? { mediaType: run.mediaType } : {}),
            operationNodeId: run.operationNodeId,
            ...(run.outputNodeId ? { outputNodeId: run.outputNodeId } : {}),
            ...(run.outputAssetId ? { outputAssetId: run.outputAssetId } : {}),
            ...(run.progress
                ? {
                    progress: {
                        phase: run.progress.phase,
                        completedSteps: run.progress.completedSteps,
                        totalSteps: run.progress.totalSteps,
                        message: run.progress.message,
                    },
                }
                : {}),
            ...(run.problem
                ? {
                    problem: {
                        category: run.problem.category,
                        title: run.problem.title,
                    },
                }
                : {}),
        }),
    ),
    unresolvedReferences: request.unresolvedBindings.map(
        binding => ({
            bindingId: binding.bindingId,
            text: binding.originalText,
            candidateAssetIds: binding.candidates.map(candidate => candidate.assetId),
        }),
    ),
})

const reviewTargets = (
    review: CanvasGeneratedOutputReview,
    plan: CanvasGeneratedOutputReviewPlan,
    state: CanvasState,
): string[] => [
    ...neighborhoodTargets(
        state,
        [
            review.nodeId,
            ...plan.nodeIds,
        ],
    ),
    ...plan.edgeIds.map(edgeTarget),
    ...plan.assetIds.map(assetTarget),
]

export class CanvasExtendedOperations {
    constructor(
        private readonly session: CanvasAgentSession,
        private readonly extended: CanvasExtendedSession,
    ) {}

    async inspectAsset(target: CanvasAssetTarget): Promise<object> {
        const { assetId } = await this.resolve(target)
        const asset = await this.extended.readAsset(assetId)

        return describeAsset(
            asset,
            graph(await this.session.inspect()),
        )
    }

    async replaceMedia(
        nodeId: string,
        assetId: string,
    ): Promise<object> {
        const initial = graph(await this.session.inspect())
        const previousAssetId = assetOf(
            nodeById(initial, nodeId),
        )

        if (previousAssetId === assetId)
            return {
                nodeId,
                assetId,
                replaced: false,
            }

        return await withLeases(
            this.session,
            [
                ...neighborhoodTargets(initial, [nodeId]),
                assetTarget(previousAssetId),
                assetTarget(assetId),
            ],
            async (leases, held) => {
                const snapshot = await this.session.inspect()
                const state = graph(snapshot)
                const node = nodeById(state, nodeId)

                if (assetOf(node) !== previousAssetId)
                    throw new Error('CANVAS_NODE_ASSET_CHANGED')

                assertWithin(
                    neighborhoodTargets(state, [nodeId]),
                    held,
                    'CANVAS_REMOVAL_NEIGHBORS_CHANGED',
                )

                const replacement = await this.session.readAsset(assetId)

                if (
                    !replacement.media
                    || mediaNodeTypes[replacement.media.kind] !== node.type
                )
                    throw new Error('CANVAS_MEDIA_KIND_MISMATCH')

                if (replacement.media.renditions.original?.status !== 'ready')
                    throw new Error('CANVAS_MEDIA_NOT_READY')

                await this.session.replaceAsset({
                    nodeId,
                    previousAssetId,
                    assetId,
                    revision: snapshot.canvasRevision,
                    leases,
                })

                return {
                    nodeId,
                    previousAssetId,
                    assetId,
                    replaced: true,
                    revision: (await this.session.inspect()).canvasRevision,
                }
            },
        )
    }

    async updateMetadata(
        target: CanvasAssetTarget,
        patch: CanvasAssetMetadataPatch,
        expectedRevision: number,
    ): Promise<object> {
        if (
            patch.title === undefined
            && patch.depictionMedium === undefined
        )
            throw new Error('CANVAS_ASSET_METADATA_EMPTY')

        return await this.withAsset(
            target,
            async (assetId, lease) => {
                const asset = await this.extended.updateAssetMetadata(
                    assetId,
                    patch,
                    expectedRevision,
                    lease,
                )

                return {
                    assetId,
                    title: asset.title,
                    depictionMedium: asset.depictionMedium,
                    revision: asset.revision,
                }
            },
        )
    }

    async removeLibraryEntry(
        target: CanvasAssetTarget,
        expectedRevision: number,
    ): Promise<object> {
        return await this.withAsset(
            target,
            (assetId, lease) => this.extended.removeLibraryEntry(
                assetId,
                expectedRevision,
                lease,
            ),
        )
    }

    async changeScope(
        target: CanvasAssetTarget,
        scope: AssetScope,
        expectedRevision: number,
    ): Promise<object> {
        return await this.withAsset(
            target,
            async (assetId, lease) => {
                const asset = await this.extended.changeAssetScope(
                    assetId,
                    scope,
                    expectedRevision,
                    lease,
                )

                return {
                    assetId,
                    scope: asset.scope,
                    revision: asset.revision,
                }
            },
        )
    }

    async review(review: CanvasGeneratedOutputReview): Promise<object> {
        const initial = graph(await this.session.inspect())
        nodeById(initial, review.nodeId)

        return await withLeases(
            this.session,
            reviewTargets(
                review,
                await this.extended.planGeneratedOutputReview(review),
                initial,
            ),
            async (leases, held) => {
                const state = graph(await this.session.inspect())
                assertWithin(
                    reviewTargets(
                        review,
                        await this.extended.planGeneratedOutputReview(review),
                        state,
                    ),
                    held,
                    'CANVAS_REVIEW_TARGETS_CHANGED',
                )
                const result = await this.extended.reviewGeneratedOutput(review, leases)

                return {
                    nodeId: review.nodeId,
                    scope: review.scope,
                    action: review.action,
                    acceptedAssetIds: result.acceptedAssetIds,
                    supersededAssetIds: result.supersededAssetIds,
                    rejectedAssetIds: result.rejectedAssetIds,
                    removedNodeIds: result.canvasGeometry?.removedNodeIds ?? [],
                    revision: (await this.session.inspect()).canvasRevision,
                }
            },
        )
    }

    async inspectGeneration(generationRequestId: string): Promise<object> {
        const request = await this.extended.readGeneration(generationRequestId)

        return describeGeneration(
            request,
            graph(await this.session.inspect()),
        )
    }

    async cancelGeneration(
        generationRequestId: string,
        expectedRevision: number,
    ): Promise<object> {
        const initial = graph(await this.session.inspect())
        const request = await this.extended.readGeneration(generationRequestId)

        return await withLeases(
            this.session,
            neighborhoodTargets(
                initial,
                generationNodeIds(request, initial),
            ),
            async (leases, held) => {
                const state = graph(await this.session.inspect())
                assertWithin(
                    neighborhoodTargets(
                        state,
                        generationNodeIds(await this.extended.readGeneration(generationRequestId), state),
                    ),
                    held,
                    'CANVAS_GENERATION_TARGETS_CHANGED',
                )
                const cancelled = await this.extended.cancelGeneration(
                    generationRequestId,
                    expectedRevision,
                    leases,
                )

                return {
                    generationRequestId,
                    status: cancelled.status,
                    revision: cancelled.revision,
                    canvasRevision: (await this.session.inspect()).canvasRevision,
                }
            },
        )
    }

    private async resolve(target: CanvasAssetTarget): Promise<{
        assetId: string
        nodeId?: string
    }> {
        if (!('nodeId' in target))
            return { assetId: target.assetId }

        return {
            assetId: assetOf(
                nodeById(
                    graph(await this.session.inspect()),
                    target.nodeId,
                ),
            ),
            nodeId: target.nodeId,
        }
    }

    private async withAsset<T>(
        target: CanvasAssetTarget,
        work: (
            assetId: string,
            lease: CanvasCollaborationLease,
        ) => Promise<T>,
    ): Promise<T> {
        const {
            assetId,
            nodeId,
        } = await this.resolve(target)

        return await withLeases(
            this.session,
            [assetTarget(assetId)],
            async leases => {
                if (
                    nodeId
                    && (await this.resolve({ nodeId })).assetId !== assetId
                )
                    throw new Error('CANVAS_NODE_ASSET_CHANGED')

                return await work(assetId, leases[0]!)
            },
        )
    }
}
