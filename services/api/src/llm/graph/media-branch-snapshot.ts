'use strict'

import type {
    MediaBranchCandidateImage,
    MediaBranchCandidateSnapshot,
} from '@lixpi/constants'

// Rebuild a snapshot's transcript from the current candidate list. Whenever the
// candidate set is narrowed, the textual labels must be rebuilt alongside it —
// stale nodeIds in the transcript make the VLM produce decisions for media it
// can no longer see. Mirrors the browser-side builder in
// services/web-ui/src/services/ai-image-branching.ts.
export function buildCandidateTranscriptContext(
    candidates: MediaBranchCandidateImage[],
    promptText: string,
    activeTargetCandidateId: string | undefined,
): string {
    const candidateLines = candidates.map((candidate) => [
        `candidateId=${candidate.candidateId}`,
        candidate.nodeId ? `nodeId=${candidate.nodeId}` : undefined,
        `assetId=${candidate.assetId}`,
        `kind=${candidate.mediaKind ?? 'image'}`,
        `roles=${candidate.roleHints.join(',')}`,
        candidate.branchId ? `branchId=${candidate.branchId}` : undefined,
        candidate.visualEntitySummary ? `visualEntity=${candidate.visualEntitySummary}` : undefined,
        candidate.visualStyleSummary ? `visualStyle=${candidate.visualStyleSummary}` : undefined,
        candidate.promptText ? `promptText=${candidate.promptText.slice(0, 800)}` : undefined,
    ].filter(Boolean).join(' | '))

    return [
        `Current user prompt: ${promptText}`,
        activeTargetCandidateId ? `Active target candidateId: ${activeTargetCandidateId}` : undefined,
        'Candidate media labels:',
        ...candidateLines,
    ].filter((line): line is string => typeof line === 'string').join('\n')
}

// Only explicitly attached references may reach branch resolution. Rebuild the
// transcript from that allowlist even when the browser submits extra candidates
// or omits the allowlist entirely.
export function restrictSnapshotToExplicitRefs(
    snapshot: MediaBranchCandidateSnapshot | undefined,
): MediaBranchCandidateSnapshot | undefined {
    if (!snapshot) return undefined

    const explicitCandidateIds = new Set(snapshot.explicitReferenceCandidateIds ?? [])
    const candidates = snapshot.candidates.filter((candidate) => explicitCandidateIds.has(candidate.candidateId))
    const activeTargetCandidateId = snapshot.activeTargetCandidateId && explicitCandidateIds.has(snapshot.activeTargetCandidateId)
        ? snapshot.activeTargetCandidateId
        : undefined
    if (candidates.length === snapshot.candidates.length
        && activeTargetCandidateId === snapshot.activeTargetCandidateId) return snapshot

    const restricted: MediaBranchCandidateSnapshot = {
        ...snapshot,
        candidates,
        transcriptContext: buildCandidateTranscriptContext(candidates, snapshot.promptText, activeTargetCandidateId),
    }
    if (activeTargetCandidateId) restricted.activeTargetCandidateId = activeTargetCandidateId
    else delete restricted.activeTargetCandidateId
    return restricted
}
