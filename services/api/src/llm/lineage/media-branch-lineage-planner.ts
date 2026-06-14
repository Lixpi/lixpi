'use strict'

import type {
    AiModelId,
    BranchForkLineagePlan,
    BranchOriginLineagePlan,
    ImageBranchCandidateImage,
    ImageBranchCandidateSnapshot,
    ImageBranchVlmResolution,
    MediaBranchLineagePlan,
    MediaRunLineageAssignment,
    WorkspaceContextSnapshot,
} from '@lixpi/constants'

export type MediaBranchLineagePlannerInput = {
    generationRequestId: string
    reasoningModelIds: AiModelId[]
    imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
    imageBranchResolution?: ImageBranchVlmResolution
    workspaceContextSnapshot?: WorkspaceContextSnapshot
    createdAt?: number
}

type SourceDecision = {
    sourceNodeId?: string
    placementAnchorNodeId?: string
    parentImageNodeId?: string
}

const PLAN_VERSION: MediaBranchLineagePlan['planVersion'] = 'media-branch-lineage-v1'

/**
 * Converts API-owned media routing decisions into the topology contract consumed
 * by the browser. This class owns branch/fork marker IDs, lineage parent IDs,
 * and marker provenance; the browser only applies the plan and computes layout.
 */
export class MediaBranchLineagePlanner {
    /**
     * Builds one immutable lineage plan for a media request before reasoning or
     * media-provider fanout emits partial/complete events.
     */
    buildPlan(input: MediaBranchLineagePlannerInput): MediaBranchLineagePlan {
        const resolution = input.imageBranchResolution
        const snapshot = input.imageBranchCandidateSnapshot
        const branchId = resolution?.branchId ?? `branch-${input.generationRequestId}`
        const promptText = snapshot?.promptText ?? input.workspaceContextSnapshot?.promptText ?? ''
        const promptFingerprint = snapshot?.promptFingerprint
        const referenceNodeIds = this.getReferenceNodeIds(resolution, snapshot)
        const sourceContextNodeIds = resolution?.sourceContextNodeIds ?? []
        const createdAt = input.createdAt ?? Date.now()
        const sourceDecision = this.getSourceDecision(resolution, snapshot, referenceNodeIds)
        const branchOrigin = this.buildBranchOrigin({
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
        })
        const branchForks = this.buildBranchForks({
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
            branchOrigin,
        })
        const runAssignments = this.buildRunAssignments({
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
            branchOrigin,
            branchForks,
            createdAt,
        })

        return {
            planVersion: PLAN_VERSION,
            generationRequestId: input.generationRequestId,
            branchId,
            promptText,
            ...(promptFingerprint ? { promptFingerprint } : {}),
            ...(sourceDecision.sourceNodeId ? { sourceNodeId: sourceDecision.sourceNodeId } : {}),
            ...(sourceDecision.placementAnchorNodeId ? { placementAnchorNodeId: sourceDecision.placementAnchorNodeId } : {}),
            referenceNodeIds,
            sourceContextNodeIds,
            ...(branchOrigin ? { branchOrigin } : {}),
            branchForks,
            runAssignments,
            createdAt,
        }
    }

    private getReferenceNodeIds(
        resolution: ImageBranchVlmResolution | undefined,
        snapshot: ImageBranchCandidateSnapshot | undefined,
    ): string[] {
        const nodeIds = resolution?.referenceImageNodeIds ?? snapshot?.candidates.map(candidate => candidate.nodeId) ?? []
        return Array.from(new Set(nodeIds.filter(Boolean)))
    }

    private getSourceDecision(
        resolution: ImageBranchVlmResolution | undefined,
        snapshot: ImageBranchCandidateSnapshot | undefined,
        referenceNodeIds: string[],
    ): SourceDecision {
        const sourceNodeId = resolution ? this.getLineageSourceNodeId(resolution, snapshot) : undefined
        if (sourceNodeId) {
            return {
                sourceNodeId,
                placementAnchorNodeId: sourceNodeId,
                parentImageNodeId: sourceNodeId,
            }
        }

        const rootNodeId = snapshot?.regionNodeId && !snapshot.regionNodeId.startsWith('standalone:')
            ? snapshot.regionNodeId
            : undefined
        if (rootNodeId) {
            return {
                sourceNodeId: rootNodeId,
                placementAnchorNodeId: rootNodeId,
            }
        }

        return {
            placementAnchorNodeId: referenceNodeIds[0],
        }
    }

    private getLineageSourceNodeId(
        resolution: ImageBranchVlmResolution,
        snapshot: ImageBranchCandidateSnapshot | undefined,
    ): string | undefined {
        const candidateByNodeId = new Map<string, ImageBranchCandidateImage>(
            snapshot?.candidates.map(candidate => [candidate.nodeId, candidate]) ?? [],
        )
        for (const nodeId of [resolution.targetImageNodeId, resolution.parentImageNodeId]) {
            if (!nodeId) continue
            const candidate = candidateByNodeId.get(nodeId)
            const continuesSelectedBranch = resolution.mode === 'edit-active-branch'
                || resolution.operationKind === 'edit_existing'
                || Boolean(resolution.branchId && candidate?.branchId === resolution.branchId)
            if (continuesSelectedBranch) return nodeId
        }
        return undefined
    }

    private buildBranchOrigin(args: {
        input: MediaBranchLineagePlannerInput
        branchId: string
        promptText: string
        promptFingerprint?: string
        referenceNodeIds: string[]
        sourceContextNodeIds: string[]
        sourceDecision: SourceDecision
    }): BranchOriginLineagePlan | undefined {
        if (args.sourceDecision.sourceNodeId) return undefined
        const forkCount = Math.max(0, args.input.reasoningModelIds.length)
        return {
            nodeId: `branch-origin-${args.input.generationRequestId}`,
            generationRequestId: args.input.generationRequestId,
            branchId: args.branchId,
            ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
            provenance: {
                kind: 'branch-root-fork-decision',
                promptText: args.promptText,
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                ...(args.input.imageBranchResolution?.operationKind
                    ? { operationKind: args.input.imageBranchResolution.operationKind }
                    : {}),
                ...(args.input.imageBranchResolution?.rationale
                    ? { resolverRationale: args.input.imageBranchResolution.rationale }
                    : {}),
                forked: args.input.reasoningModelIds.length > 1,
                forkCount,
            },
        }
    }

    private buildBranchForks(args: {
        input: MediaBranchLineagePlannerInput
        branchId: string
        promptText: string
        promptFingerprint?: string
        referenceNodeIds: string[]
        sourceContextNodeIds: string[]
        sourceDecision: SourceDecision
        branchOrigin?: BranchOriginLineagePlan
    }): BranchForkLineagePlan[] {
        if (args.input.reasoningModelIds.length <= 1) return []
        const parentBranchNodeId = args.sourceDecision.sourceNodeId ?? args.branchOrigin?.nodeId
        if (!parentBranchNodeId) return []

        return args.input.reasoningModelIds.map((reasoningModelId, reasoningIndex) => {
            const reasoningRunId = this.buildReasoningRunId(args.input.generationRequestId, reasoningIndex)
            return {
                nodeId: `branch-fork-${args.input.generationRequestId}-reasoning-${reasoningIndex}`,
                generationRequestId: args.input.generationRequestId,
                branchId: args.branchId,
                parentBranchNodeId,
                reasoningRunId,
                reasoningModelId,
                reasoningIndex,
                ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
                provenance: {
                    kind: 'reasoning-run',
                    promptText: args.promptText,
                    referenceNodeIds: args.referenceNodeIds,
                    sourceContextNodeIds: args.sourceContextNodeIds,
                    reasoningRunId,
                    reasoningModelId,
                    reasoningIndex,
                },
            }
        })
    }

    private buildRunAssignments(args: {
        input: MediaBranchLineagePlannerInput
        branchId: string
        promptText: string
        promptFingerprint?: string
        referenceNodeIds: string[]
        sourceContextNodeIds: string[]
        sourceDecision: SourceDecision
        branchOrigin?: BranchOriginLineagePlan
        branchForks: BranchForkLineagePlan[]
        createdAt: number
    }): MediaRunLineageAssignment[] {
        const forkByReasoningRunId = new Map(args.branchForks.map(fork => [fork.reasoningRunId, fork]))
        return args.input.reasoningModelIds.map((reasoningModelId, reasoningIndex) => {
            const reasoningRunId = this.buildReasoningRunId(args.input.generationRequestId, reasoningIndex)
            const branchFork = forkByReasoningRunId.get(reasoningRunId)
            const lineageParentNodeId = branchFork?.nodeId
                ?? args.sourceDecision.sourceNodeId
                ?? args.branchOrigin?.nodeId
            return {
                generationRequestId: args.input.generationRequestId,
                reasoningRunId,
                reasoningModelId,
                branchId: args.branchId,
                ...(args.sourceDecision.parentImageNodeId ? { parentImageNodeId: args.sourceDecision.parentImageNodeId } : {}),
                ...(args.branchOrigin ? { branchOriginNodeId: args.branchOrigin.nodeId } : {}),
                ...(branchFork ? { branchForkNodeId: branchFork.nodeId } : {}),
                ...(lineageParentNodeId ? { lineageParentNodeId } : {}),
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                ...(args.input.imageBranchResolution?.operationKind
                    ? { operationKind: args.input.imageBranchResolution.operationKind }
                    : {}),
                promptText: args.promptText,
                ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
                createdAt: args.createdAt + reasoningIndex,
            }
        })
    }

    private buildReasoningRunId(generationRequestId: string, reasoningIndex: number): string {
        return `${generationRequestId}:reasoning:${reasoningIndex}`
    }
}
