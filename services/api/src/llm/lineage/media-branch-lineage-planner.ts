'use strict'

import type {
    AiModelId,
    BranchForkLineagePlan,
    BranchLineLineagePlan,
    BranchOriginLineagePlan,
    ImageBranchCandidateImage,
    ImageBranchCandidateSnapshot,
    ImageBranchVlmResolution,
    MediaBranchLineagePlan,
    MediaRunLineageAssignment,
    WorkspaceContextSnapshot,
} from '@lixpi/constants'
import { MediaGenerationRunPlanner } from './media-generation-run-planner.ts'

export type MediaBranchLineagePlannerInput = {
    generationRequestId: string
    reasoningModelIds: AiModelId[]
    // Media-generation axis. Each reasoning run fans out across every selected
    // media model, so the total generation count is
    // reasoningCount * (imageModelIds.length + videoModelIds.length).
    imageModelIds?: AiModelId[]
    videoModelIds?: AiModelId[]
    imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
    imageBranchResolution?: ImageBranchVlmResolution
    workspaceContextSnapshot?: WorkspaceContextSnapshot
    createdAt?: number
}

type SourceDecision = {
    sourceNodeId?: string
    placementAnchorNodeId?: string
    parentMediaNodeId?: string
}

// One concrete media generation. The mediaRunId mirrors the scheme used by
// MediaGenerationRunPlanner.buildProviderMediaRun so the planner can pre-assign
// a marker node per generation before any provider fanout runs.
type MediaRunSpec = {
    reasoningModelId: AiModelId
    reasoningIndex: number
    reasoningRunId: string
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    mediaIndex: number
    mediaRunId?: string
}

const PLAN_VERSION: MediaBranchLineagePlan['planVersion'] = 'media-branch-lineage-v1'

// Converts API-owned media routing decisions into the topology contract consumed
// by the browser. This class owns branch/fork/line marker IDs, lineage parent
// IDs, and marker provenance; the browser only applies the plan and computes
// layout.
//
// Marker rules (single combined level across the reasoning x media grid):
//   - More than one media generation in the request  -> one `branchFork` per
//     generation (a split), flat under the lineage source / branch origin.
//   - Exactly one media generation that continues an existing generated branch
//     -> one `branchLine` continuation marker between the source media and the
//     new generation, carrying the prompt that drove the continuation.
//   - Exactly one fresh generation with no generated source -> no per-generation
//     marker; the request roots on its `branchOrigin` / chat source as before.
export class MediaBranchLineagePlanner {
    private readonly mediaGenerationRunPlanner = new MediaGenerationRunPlanner()

    // Builds one immutable lineage plan for a media request before reasoning or
    // media-provider fanout emits partial/complete events.
    buildPlan(input: MediaBranchLineagePlannerInput): MediaBranchLineagePlan {
        const resolution = input.imageBranchResolution
        const snapshot = input.imageBranchCandidateSnapshot
        const branchId = resolution?.branchId ?? `branch-${input.generationRequestId}`
        const promptText = snapshot?.promptText ?? input.workspaceContextSnapshot?.promptText ?? ''
        const promptFingerprint = snapshot?.promptFingerprint
        const referenceNodeIds = this.getReferenceNodeIds(resolution, snapshot)
        const providedReferenceNodeIds = this.getProvidedReferenceNodeIds(input.workspaceContextSnapshot)
        const sourceContextNodeIds = resolution?.sourceContextNodeIds ?? []
        const createdAt = input.createdAt ?? Date.now()
        const sourceDecision = this.getSourceDecision(resolution, snapshot, referenceNodeIds)
        const mediaRuns = this.enumerateMediaRuns(input)
        const isSplit = mediaRuns.length > 1
        const branchOrigin = this.buildBranchOrigin({
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            providedReferenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
            mediaRunCount: mediaRuns.length,
        })
        const parentBranchNodeId = sourceDecision.sourceNodeId ?? branchOrigin?.nodeId
        const markerArgs = {
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            providedReferenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
            parentBranchNodeId,
            mediaRuns,
            isSplit,
        }
        const branchForks = this.buildBranchForks(markerArgs)
        const branchLines = this.buildBranchLines(markerArgs)
        const runAssignments = this.buildRunAssignments({
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
            branchOrigin,
            parentBranchNodeId,
            branchForks,
            branchLines,
            mediaRuns,
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
            branchLines,
            runAssignments,
            createdAt,
        }
    }

    // Expands the reasoning x media grid into one spec per concrete generation.
    // When no media model IDs are supplied (legacy callers) it falls back to one
    // synthetic run per reasoning model so the plan still has run assignments.
    private enumerateMediaRuns(input: MediaBranchLineagePlannerInput): MediaRunSpec[] {
        const imageModelIds = input.imageModelIds ?? []
        const videoModelIds = input.videoModelIds ?? []
        const specs: MediaRunSpec[] = []

        for (const [reasoningIndex, reasoningModelId] of input.reasoningModelIds.entries()) {
            const reasoningRunId = this.mediaGenerationRunPlanner.buildReasoningRunId(input.generationRequestId, reasoningIndex)
            const base = { reasoningModelId, reasoningIndex, reasoningRunId }

            if (imageModelIds.length === 0 && videoModelIds.length === 0) {
                specs.push({ ...base, mediaIndex: 0 })
                continue
            }
            imageModelIds.forEach((mediaModelId, mediaIndex) => {
                specs.push({ ...base, mediaModelId, mediaType: 'image', mediaIndex, mediaRunId: `${reasoningRunId}:image:${mediaIndex}` })
            })
            videoModelIds.forEach((mediaModelId, mediaIndex) => {
                specs.push({ ...base, mediaModelId, mediaType: 'video', mediaIndex, mediaRunId: `${reasoningRunId}:video:${mediaIndex}` })
            })
        }
        return specs
    }

    private getReferenceNodeIds(
        resolution: ImageBranchVlmResolution | undefined,
        snapshot: ImageBranchCandidateSnapshot | undefined,
    ): string[] {
        const nodeIds = resolution?.referenceImageNodeIds ?? snapshot?.candidates.map(candidate => candidate.nodeId) ?? []
        return Array.from(new Set(nodeIds.filter(Boolean)))
    }

    private getProvidedReferenceNodeIds(snapshot: WorkspaceContextSnapshot | undefined): string[] {
        const nodeIds = snapshot?.nodes
            .filter(node => node.isExplicitChip)
            .map(node => node.nodeId)
            ?? []
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
                parentMediaNodeId: sourceNodeId,
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
            if (!this.isGeneratedLineageCandidate(candidate)) continue
            const continuesSelectedBranch = resolution.mode === 'edit-active-branch'
                || resolution.operationKind === 'edit_existing'
                || Boolean(resolution.branchId && candidate?.branchId === resolution.branchId)
            if (continuesSelectedBranch) return nodeId
        }
        return undefined
    }

    private isGeneratedLineageCandidate(candidate: ImageBranchCandidateImage | undefined): boolean {
        if (!candidate) return false
        return candidate.roleHints.includes('generated-variant')
            || candidate.roleHints.includes('branch-leaf')
            || candidate.roleHints.includes('branch-ancestor')
            || Boolean(candidate.branchId)
            || Boolean(candidate.parentMediaNodeId)
            || Boolean(candidate.parentImageNodeId)
    }

    private buildBranchOrigin(args: {
        input: MediaBranchLineagePlannerInput
        branchId: string
        promptText: string
        promptFingerprint?: string
        referenceNodeIds: string[]
        providedReferenceNodeIds: string[]
        sourceContextNodeIds: string[]
        sourceDecision: SourceDecision
        mediaRunCount: number
    }): BranchOriginLineagePlan | undefined {
        if (args.sourceDecision.sourceNodeId) return undefined
        const forkCount = Math.max(0, args.mediaRunCount)
        return {
            nodeId: `branch-origin-${args.input.generationRequestId}`,
            generationRequestId: args.input.generationRequestId,
            branchId: args.branchId,
            ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
            provenance: {
                kind: 'branch-root-fork-decision',
                promptText: args.promptText,
                providedReferenceNodeIds: args.providedReferenceNodeIds,
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                forked: args.mediaRunCount > 1,
                forkCount,
            },
        }
    }

    private buildBranchForks(args: MediaMarkerArgs): BranchForkLineagePlan[] {
        if (!args.isSplit) return []
        if (!args.parentBranchNodeId) return []

        return args.mediaRuns.map((run) => ({
            nodeId: this.buildForkNodeId(args.input.generationRequestId, run),
            generationRequestId: args.input.generationRequestId,
            branchId: args.branchId,
            parentBranchNodeId: args.parentBranchNodeId as string,
            reasoningRunId: run.reasoningRunId,
            reasoningModelId: run.reasoningModelId,
            reasoningIndex: run.reasoningIndex,
            ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
            ...(run.mediaModelId ? { mediaModelId: run.mediaModelId } : {}),
            ...(run.mediaType ? { mediaType: run.mediaType } : {}),
            ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
            provenance: {
                kind: 'reasoning-run',
                promptText: args.promptText,
                providedReferenceNodeIds: args.providedReferenceNodeIds,
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                reasoningRunId: run.reasoningRunId,
                reasoningModelId: run.reasoningModelId,
                reasoningIndex: run.reasoningIndex,
                ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                ...(run.mediaModelId ? { mediaModelId: run.mediaModelId } : {}),
                ...(run.mediaType ? { mediaType: run.mediaType } : {}),
            },
        }))
    }

    private buildBranchLines(args: MediaMarkerArgs): BranchLineLineagePlan[] {
        // A continuation marker only makes sense for a single generation that
        // descends from an existing generated branch. Splits use branchFork, and
        // fresh single generations root on their origin/chat source directly.
        if (args.isSplit) return []
        if (!args.sourceDecision.parentMediaNodeId) return []
        const run = args.mediaRuns[0]
        if (!run || !args.parentBranchNodeId) return []

        return [{
            nodeId: this.buildLineNodeId(args.input.generationRequestId, run),
            generationRequestId: args.input.generationRequestId,
            branchId: args.branchId,
            parentBranchNodeId: args.parentBranchNodeId,
            reasoningRunId: run.reasoningRunId,
            reasoningModelId: run.reasoningModelId,
            reasoningIndex: run.reasoningIndex,
            ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
            ...(run.mediaModelId ? { mediaModelId: run.mediaModelId } : {}),
            ...(run.mediaType ? { mediaType: run.mediaType } : {}),
            ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
            provenance: {
                kind: 'branch-continuation',
                promptText: args.promptText,
                providedReferenceNodeIds: args.providedReferenceNodeIds,
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                reasoningRunId: run.reasoningRunId,
                reasoningModelId: run.reasoningModelId,
                reasoningIndex: run.reasoningIndex,
                ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                ...(run.mediaModelId ? { mediaModelId: run.mediaModelId } : {}),
                ...(run.mediaType ? { mediaType: run.mediaType } : {}),
            },
        }]
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
        parentBranchNodeId?: string
        branchForks: BranchForkLineagePlan[]
        branchLines: BranchLineLineagePlan[]
        mediaRuns: MediaRunSpec[]
        createdAt: number
    }): MediaRunLineageAssignment[] {
        const forkByMarkerKey = new Map(args.branchForks.map(fork => [fork.mediaRunId ?? fork.reasoningRunId, fork]))
        const lineByMarkerKey = new Map(args.branchLines.map(line => [line.mediaRunId ?? line.reasoningRunId, line]))

        return args.mediaRuns.map((run, runOrdinal) => {
            const markerKey = run.mediaRunId ?? run.reasoningRunId
            const branchFork = forkByMarkerKey.get(markerKey)
            const branchLine = lineByMarkerKey.get(markerKey)
            const lineageParentNodeId = branchFork?.nodeId
                ?? branchLine?.nodeId
                ?? args.sourceDecision.sourceNodeId
                ?? args.branchOrigin?.nodeId
            return {
                generationRequestId: args.input.generationRequestId,
                reasoningRunId: run.reasoningRunId,
                reasoningModelId: run.reasoningModelId,
                ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                ...(run.mediaModelId ? { mediaModelId: run.mediaModelId } : {}),
                ...(run.mediaType ? { mediaType: run.mediaType } : {}),
                branchId: args.branchId,
                ...(args.sourceDecision.parentMediaNodeId
                    ? {
                        parentMediaNodeId: args.sourceDecision.parentMediaNodeId,
                        parentImageNodeId: args.sourceDecision.parentMediaNodeId,
                    }
                    : {}),
                ...(args.branchOrigin ? { branchOriginNodeId: args.branchOrigin.nodeId } : {}),
                ...(branchFork ? { branchForkNodeId: branchFork.nodeId } : {}),
                ...(branchLine ? { branchLineNodeId: branchLine.nodeId } : {}),
                ...(lineageParentNodeId ? { lineageParentNodeId } : {}),
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                ...(args.input.imageBranchResolution?.operationKind
                    ? { operationKind: args.input.imageBranchResolution.operationKind }
                    : {}),
                promptText: args.promptText,
                ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
                createdAt: args.createdAt + runOrdinal,
            }
        })
    }

    private buildForkNodeId(generationRequestId: string, run: MediaRunSpec): string {
        return run.mediaRunId
            ? `branch-fork-${generationRequestId}-r${run.reasoningIndex}-${run.mediaType}-${run.mediaIndex}`
            : `branch-fork-${generationRequestId}-reasoning-${run.reasoningIndex}`
    }

    private buildLineNodeId(generationRequestId: string, run: MediaRunSpec): string {
        return run.mediaRunId
            ? `branch-line-${generationRequestId}-r${run.reasoningIndex}-${run.mediaType}-${run.mediaIndex}`
            : `branch-line-${generationRequestId}-reasoning-${run.reasoningIndex}`
    }

}

type MediaMarkerArgs = {
    input: MediaBranchLineagePlannerInput
    branchId: string
    promptText: string
    promptFingerprint?: string
    referenceNodeIds: string[]
    providedReferenceNodeIds: string[]
    sourceContextNodeIds: string[]
    sourceDecision: SourceDecision
    parentBranchNodeId?: string
    mediaRuns: MediaRunSpec[]
    isSplit: boolean
}
