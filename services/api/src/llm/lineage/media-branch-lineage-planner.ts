'use strict'

import { v4 as uuid } from 'uuid'

import type {
    AiModelId,
    BranchForkLineagePlan,
    BranchLineLineagePlan,
    BranchOriginLineagePlan,
    MediaBranchCandidateImage,
    MediaBranchCandidateSnapshot,
    MediaBranchVlmResolution,
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
    preassignedMediaRuns?: Array<{
        assetId: string
        reasoningModelId: AiModelId
        reasoningRunId: string
        reasoningIndex: number
        mediaModelId: AiModelId
        mediaType: 'image' | 'video'
        mediaIndex: number
        mediaRunId: string
    }>
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot
    mediaBranchResolution?: MediaBranchVlmResolution
    workspaceContextSnapshot?: WorkspaceContextSnapshot
    regenerationTarget?: {
        branchId: string
        lineageParentNodeId: string
        lineageParentType: 'branchOrigin' | 'branchFork' | 'branchLine'
    }
    forceFreshLineage?: boolean
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
    assetId?: string
    reasoningModelId: AiModelId
    reasoningIndex: number
    reasoningRunId: string
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    mediaIndex: number
    mediaRunId?: string
}

type ReasoningRunSpec = {
    reasoningModelId: AiModelId
    reasoningIndex: number
    reasoningRunId: string
    mediaRunCount: number
}

const PLAN_VERSION: MediaBranchLineagePlan['planVersion'] = 'media-branch-lineage-v1'

// Converts API-owned media routing decisions into the topology contract consumed
// by the browser. This class owns branch/fork/line marker IDs, lineage parent
// IDs, marker provenance, and persisted layout; the browser only applies the
// resulting API canvas projection.
//
// Marker rules:
//   - One `branchFork` per reasoning run when a request fans out by reasoning
//     model or media model. The concrete media runs from that reasoning run
//     share the fork marker. If there is no lineage source, the fork itself is
//     the visible root marker.
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
        const referenceResolution = input.mediaBranchResolution
        const lineageResolution = input.forceFreshLineage || input.regenerationTarget
            ? undefined
            : referenceResolution
        const snapshot = input.mediaBranchCandidateSnapshot
        const branchId = input.forceFreshLineage
            ? `branch-${input.generationRequestId}`
            : (input.regenerationTarget?.branchId
                ?? lineageResolution?.branchId
                ?? `branch-${input.generationRequestId}`)
        const promptText = snapshot?.promptText ?? input.workspaceContextSnapshot?.promptText ?? ''
        const promptFingerprint = snapshot?.promptFingerprint
        const referenceNodeIds = this.getReferenceNodeIds(referenceResolution, snapshot)
        const providedReferenceNodeIds = this.getProvidedReferenceNodeIds(input.workspaceContextSnapshot)
        const sourceContextNodeIds = referenceResolution?.sourceContextNodeIds ?? []
        const createdAt = input.createdAt ?? Date.now()
        const sourceDecision = this.getSourceDecision(lineageResolution, snapshot, referenceNodeIds)
        const mediaRuns = this.enumerateMediaRuns(input)
        const reasoningRuns = this.enumerateReasoningRuns(mediaRuns)
        const usesReasoningForks = this.shouldCreateReasoningForks(reasoningRuns)
        const branchOrigin = input.regenerationTarget ? undefined : this.buildBranchOrigin({
            input,
            branchId,
            promptText,
            promptFingerprint,
            referenceNodeIds,
            providedReferenceNodeIds,
            sourceContextNodeIds,
            sourceDecision,
            usesReasoningForks,
            reasoningBranchCount: reasoningRuns.length,
        })
        const parentBranchNodeId = input.regenerationTarget?.lineageParentNodeId
            ?? sourceDecision.sourceNodeId
            ?? branchOrigin?.nodeId
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
            reasoningRuns,
            usesReasoningForks,
        }
        const branchForks = input.regenerationTarget ? [] : this.buildBranchForks(markerArgs)
        const branchLines = input.regenerationTarget ? [] : this.buildBranchLines(markerArgs)
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
            regenerationLineageParentNodeId: input.regenerationTarget?.lineageParentNodeId,
            regenerationLineageParentType: input.regenerationTarget?.lineageParentType,
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
            ...(input.regenerationTarget ? { regenerationTarget: input.regenerationTarget } : {}),
            ...(branchOrigin ? { branchOrigin } : {}),
            branchForks,
            branchLines,
            runAssignments,
            createdAt,
        }
    }

    // Expands the reasoning x media grid into one spec per concrete media
    // generation. A reasoning-only matrix has no media run assignments and
    // therefore creates no pending output Assets.
    private enumerateMediaRuns(input: MediaBranchLineagePlannerInput): MediaRunSpec[] {
        if (input.preassignedMediaRuns) return input.preassignedMediaRuns
        const imageModelIds = input.imageModelIds ?? []
        const videoModelIds = input.videoModelIds ?? []
        const specs: MediaRunSpec[] = []

        for (const [reasoningIndex, reasoningModelId] of input.reasoningModelIds.entries()) {
            const reasoningRunId = this.mediaGenerationRunPlanner.buildReasoningRunId(input.generationRequestId, reasoningIndex)
            const base = { reasoningModelId, reasoningIndex, reasoningRunId }

            imageModelIds.forEach((mediaModelId, mediaIndex) => {
                specs.push({ ...base, mediaModelId, mediaType: 'image', mediaIndex, mediaRunId: `${reasoningRunId}:image:${mediaIndex}` })
            })
            videoModelIds.forEach((mediaModelId, mediaIndex) => {
                specs.push({ ...base, mediaModelId, mediaType: 'video', mediaIndex, mediaRunId: `${reasoningRunId}:video:${mediaIndex}` })
            })
        }
        return specs
    }

    private enumerateReasoningRuns(mediaRuns: MediaRunSpec[]): ReasoningRunSpec[] {
        const reasoningRunsById = new Map<string, ReasoningRunSpec>()
        for (const run of mediaRuns) {
            const existing = reasoningRunsById.get(run.reasoningRunId)
            if (existing) {
                existing.mediaRunCount += 1
                continue
            }
            reasoningRunsById.set(run.reasoningRunId, {
                reasoningModelId: run.reasoningModelId,
                reasoningIndex: run.reasoningIndex,
                reasoningRunId: run.reasoningRunId,
                mediaRunCount: 1,
            })
        }
        return Array.from(reasoningRunsById.values())
    }

    private shouldCreateReasoningForks(reasoningRuns: ReasoningRunSpec[]): boolean {
        return reasoningRuns.length > 1 || reasoningRuns.some(run => run.mediaRunCount > 1)
    }

    private getReferenceNodeIds(
        resolution: MediaBranchVlmResolution | undefined,
        snapshot: MediaBranchCandidateSnapshot | undefined,
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
        resolution: MediaBranchVlmResolution | undefined,
        snapshot: MediaBranchCandidateSnapshot | undefined,
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
        resolution: MediaBranchVlmResolution,
        snapshot: MediaBranchCandidateSnapshot | undefined,
    ): string | undefined {
        const candidateByNodeId = new Map<string, MediaBranchCandidateImage>(
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

    private isGeneratedLineageCandidate(candidate: MediaBranchCandidateImage | undefined): boolean {
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
        usesReasoningForks: boolean
        reasoningBranchCount: number
    }): BranchOriginLineagePlan | undefined {
        if (args.reasoningBranchCount === 0) return undefined
        if (args.sourceDecision.sourceNodeId) return undefined
        if (args.usesReasoningForks) return undefined
        const forkCount = Math.max(0, args.reasoningBranchCount)
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
                forked: args.reasoningBranchCount > 1,
                forkCount,
            },
        }
    }

    private buildBranchForks(args: MediaMarkerArgs): BranchForkLineagePlan[] {
        if (!args.usesReasoningForks) return []

        return args.reasoningRuns.map((run) => ({
            nodeId: this.buildForkNodeId(args.input.generationRequestId, run),
            generationRequestId: args.input.generationRequestId,
            branchId: args.branchId,
            ...(args.parentBranchNodeId ? { parentBranchNodeId: args.parentBranchNodeId } : {}),
            reasoningRunId: run.reasoningRunId,
            reasoningModelId: run.reasoningModelId,
            reasoningIndex: run.reasoningIndex,
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
            },
        }))
    }

    private buildBranchLines(args: MediaMarkerArgs): BranchLineLineagePlan[] {
        // A continuation marker only makes sense for a single generation that
        // descends from an existing generated branch. Reasoning fanouts use
        // branchFork, and fresh single generations root on their origin/chat
        // source directly.
        if (args.usesReasoningForks) return []
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
        regenerationLineageParentNodeId?: string
        regenerationLineageParentType?: 'branchOrigin' | 'branchFork' | 'branchLine'
        createdAt: number
    }): MediaRunLineageAssignment[] {
        const forkByReasoningRunId = new Map(args.branchForks.map(fork => [fork.reasoningRunId, fork]))
        const lineByMarkerKey = new Map(args.branchLines.map(line => [line.mediaRunId ?? line.reasoningRunId, line]))

        return args.mediaRuns.map((run, runOrdinal) => {
            const markerKey = run.mediaRunId ?? run.reasoningRunId
            const branchFork = forkByReasoningRunId.get(run.reasoningRunId)
            const branchLine = lineByMarkerKey.get(markerKey)
            const lineageParentNodeId = branchFork?.nodeId
                ?? branchLine?.nodeId
                ?? args.regenerationLineageParentNodeId
                ?? args.sourceDecision.sourceNodeId
                ?? args.branchOrigin?.nodeId
            return {
                assetId: run.assetId ?? uuid(),
                generationRequestId: args.input.generationRequestId,
                reasoningRunId: run.reasoningRunId,
                reasoningModelId: run.reasoningModelId,
                reasoningIndex: run.reasoningIndex,
                ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                ...(run.mediaModelId ? { mediaModelId: run.mediaModelId } : {}),
                ...(run.mediaType ? { mediaType: run.mediaType } : {}),
                mediaIndex: run.mediaIndex,
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
                ...(args.regenerationLineageParentNodeId && args.regenerationLineageParentType === 'branchOrigin'
                    ? { branchOriginNodeId: args.regenerationLineageParentNodeId }
                    : {}),
                ...(args.regenerationLineageParentNodeId && args.regenerationLineageParentType === 'branchFork'
                    ? { branchForkNodeId: args.regenerationLineageParentNodeId }
                    : {}),
                ...(args.regenerationLineageParentNodeId && args.regenerationLineageParentType === 'branchLine'
                    ? { branchLineNodeId: args.regenerationLineageParentNodeId }
                    : {}),
                ...(lineageParentNodeId ? { lineageParentNodeId } : {}),
                referenceNodeIds: args.referenceNodeIds,
                sourceContextNodeIds: args.sourceContextNodeIds,
                ...(args.input.mediaBranchResolution?.operationKind
                    ? { operationKind: args.input.mediaBranchResolution.operationKind }
                    : {}),
                promptText: args.promptText,
                ...(args.promptFingerprint ? { promptFingerprint: args.promptFingerprint } : {}),
                createdAt: args.createdAt + runOrdinal,
            }
        })
    }

    private buildForkNodeId(generationRequestId: string, run: ReasoningRunSpec): string {
        return `branch-fork-${generationRequestId}-reasoning-${run.reasoningIndex}`
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
    reasoningRuns: ReasoningRunSpec[]
    usesReasoningForks: boolean
}
