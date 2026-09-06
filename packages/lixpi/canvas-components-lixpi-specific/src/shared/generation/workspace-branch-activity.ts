import {
    type Asset,
    type CanvasNode,
    type MediaBranchLineagePlan,
    type MediaRunLineageAssignment,
} from '@lixpi/constants'
import {
    type GeneratedOutputCanvasNode,
} from '../canvas-node/generated-media-node.ts'
import { getBranchMarkerThreadId } from '../review/workspace-history.ts'
import { isPersistedMediaGenerationActive } from './progress-state.ts'

type BranchMarkerNode = Extract<CanvasNode, { type: 'branchOrigin' | 'branchFork' | 'branchLine' }>
export type BranchActivityPlacement = {
    activeRunKeys?: ReadonlySet<string>
    lineagePlan?: MediaBranchLineagePlan
}
export type WorkspaceBranchActivityPorts = {
    getNodes: () => readonly CanvasNode[]
    getOutputs: (node: BranchMarkerNode) => readonly GeneratedOutputCanvasNode[]
    getAsset: (assetId: string) => Asset | undefined
    getPlacements: () => ReadonlyMap<string, BranchActivityPlacement>
    isCancelled: (node: BranchMarkerNode) => boolean
    hasStartedMedia: (nodeId: string) => boolean
    isPending: (node: BranchMarkerNode) => boolean
}

export const lineagePlanReferencesBranchMarkerNode = (
    lineagePlan: MediaBranchLineagePlan,
    node: BranchMarkerNode,
): boolean => {
    return (
        lineagePlan.regenerationTarget?.lineageParentNodeId === node.nodeId
            || lineagePlan.branchOrigin?.nodeId === node.nodeId
            || lineagePlan.branchForks.some(branchFork => branchFork.nodeId === node.nodeId)
            || lineagePlan.branchLines.some(branchLine => branchLine.nodeId === node.nodeId)
            || lineagePlan.runAssignments.some(
                assignment =>
                    assignment.branchOriginNodeId === node.nodeId
                    || assignment.branchForkNodeId === node.nodeId
                    || assignment.branchLineNodeId === node.nodeId,
            )
    )
}

export const getBranchMarkerPlacementKeys = (node: BranchMarkerNode): string[] => {
    const threadId = getBranchMarkerThreadId(node)

    if (!threadId)
        return []

    const keys = [threadId]

    if (
        node.generationRequestId
        && node.generationRequestId !== threadId
    )
        keys.push(`${threadId}:${node.generationRequestId}`)

    return Array.from(
        new Set(keys),
    )
}

export const assignmentMatchesBranchMarker = (
    assignment: MediaRunLineageAssignment,
    node: BranchMarkerNode,
): boolean => {
    if (assignment.branchOriginNodeId === node.nodeId)
        return true

    if (assignment.branchForkNodeId === node.nodeId)
        return true

    if (assignment.branchLineNodeId === node.nodeId)
        return true

    if (
        node.type === 'branchFork'
        && node.reasoningRunId
        && assignment.reasoningRunId === node.reasoningRunId
    )
        return true

    if (
        node.type === 'branchLine'
        && node.reasoningRunId
        && assignment.reasoningRunId === node.reasoningRunId
    )
        return true

    if (
        node.type === 'branchLine'
        && node.mediaRunId
        && assignment.mediaRunId === node.mediaRunId
    )
        return true

    return false
}

export const isLineageAssignmentActive = (
    assignment: MediaRunLineageAssignment,
    activeRunKeys: ReadonlySet<string>,
): boolean => {
    return Boolean(
        (assignment.mediaRunId && activeRunKeys.has(assignment.mediaRunId))
            || (assignment.reasoningRunId && activeRunKeys.has(assignment.reasoningRunId)),
    )
}

// Projects stop-control and pending-marker state from authoritative run data.
export class WorkspaceBranchActivity {
    constructor(private readonly ports: WorkspaceBranchActivityPorts) {}

    isBranchMarkerGenerationActive(node: BranchMarkerNode): boolean {
        if (this.ports.isCancelled(node))
            return false

        if (this.ports.hasStartedMedia(node.nodeId))
            return false

        if (
            node.pendingState
            || this.ports.isPending(node)
        )
            return true

        for (const placementKey of getBranchMarkerPlacementKeys(node)) {
            const placement = this.ports.getPlacements().get(placementKey)
            const activeRunKeys = placement?.activeRunKeys

            if (
                !placement
                || !activeRunKeys?.size
            )
                continue

            const assignments = placement.lineagePlan?.runAssignments ?? []

            if (assignments.length === 0)
                return true

            const matchingAssignments = assignments.filter(assignment => assignmentMatchesBranchMarker(assignment, node))

            if (matchingAssignments.length === 0)
                continue

            if (matchingAssignments.some(assignment => isLineageAssignmentActive(assignment, activeRunKeys)))
                return true
        }

        return false
    }

    isBranchMarkerGenerationGroupActive(node: BranchMarkerNode): boolean {
        if (this.ports.isCancelled(node))
            return false

        const generatedOutputNodes = this.ports.getOutputs(node)
        const hasPersistedActiveOutput = generatedOutputNodes.some(outputNode => {
            if (outputNode.type === 'capabilityArtifact')
                return false

            return isPersistedMediaGenerationActive({
                progressStatus: outputNode.generationProgress?.status,
                reviewStatus: this.ports.getAsset(outputNode.assetId)?.generatedOutputReview?.status,
                mediaGenerationPhase: outputNode.mediaGenerationPhase,
            })
        })

        if (hasPersistedActiveOutput)
            return true

        // A pending output persists with `generationProgress` only — `generatedBy`
        // lineage is attached when the output materializes. After a reload the
        // in-memory placement maps are empty, so the marker must recognize such a
        // run through the persisted lineage assignment or the shared generation
        // request; otherwise a restored in-flight branch loses its stop control.
        const hasPersistedActiveRunForMarker = this.ports.getNodes().some(candidate => {
            if (
                candidate.type !== 'image'
                && candidate.type !== 'video'
            )
                return false

            const progress = candidate.generationProgress

            if (!progress)
                return false

            if (!isPersistedMediaGenerationActive({
                progressStatus: progress.status,
                reviewStatus: this.ports.getAsset(candidate.assetId)?.generatedOutputReview?.status,
                mediaGenerationPhase: candidate.mediaGenerationPhase,
            }))
                return false

            const assignment = progress.lineageAssignment

            if (
                assignment
                && (assignment.branchOriginNodeId === node.nodeId
                    || assignment.branchForkNodeId === node.nodeId
                    || assignment.branchLineNodeId === node.nodeId)
            )
                return true

            return Boolean(
                node.generationRequestId
                    && !node.generationRequestId.startsWith('canvas-')
                    && progress.generationRequestId === node.generationRequestId,
            )
        })

        if (hasPersistedActiveRunForMarker)
            return true

        // Capability artifacts (e.g. a character sheet) complete long before the
        // media runs they belong to are even persisted under the marker. While
        // artifacts are the only outputs hanging off the marker, they say nothing
        // about the group being done, so they must not conclude it — otherwise
        // the stop control disappears mid-generation.
        const hasGeneratedMediaOutput = generatedOutputNodes.some(outputNode => outputNode.type !== 'capabilityArtifact')
        const everyGeneratedOutputCompleted = hasGeneratedMediaOutput
            && generatedOutputNodes.every(
                outputNode =>
                    outputNode.type === 'capabilityArtifact'
                        ? Boolean(this.ports.getAsset(outputNode.assetId)?.documents.capabilityArtifact)
                        : this.ports.getAsset(outputNode.assetId)?.media?.renditions.original?.status === 'ready',
            )

        if (everyGeneratedOutputCompleted)
            return false

        if (
            node.pendingState
            || this.ports.isPending(node)
        )
            return true

        const threadId = getBranchMarkerThreadId(node)
        const generationRequestId = node.generationRequestId

        for (const [placementKey, placement] of this.ports.getPlacements().entries()) {
            if (!placement.activeRunKeys?.size)
                continue

            if (
                threadId
                && placementKey !== threadId
                && !placementKey.startsWith(`${threadId}:`)
            )
                continue

            const lineagePlan = placement.lineagePlan

            if (
                lineagePlan
                && lineagePlanReferencesBranchMarkerNode(lineagePlan, node)
            )
                return true

            if (
                generationRequestId
                && lineagePlan?.generationRequestId === generationRequestId
            )
                return true

            if (
                threadId
                && generationRequestId
                && placementKey === `${threadId}:${generationRequestId}`
            )
                return true

            if (
                threadId
                && generationRequestId
                && !generationRequestId.startsWith('canvas-')
                && placementKey === threadId
            )
                return true
        }

        return false
    }
}
