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
    activeTargetNodeId: string | undefined,
): string {
    const candidateLines = candidates.map((candidate) => [
        `nodeId=${candidate.nodeId}`,
        `kind=${candidate.mediaKind ?? 'image'}`,
        `roles=${candidate.roleHints.join(',')}`,
        candidate.branchId ? `branchId=${candidate.branchId}` : undefined,
        candidate.visualEntitySummary ? `visualEntity=${candidate.visualEntitySummary}` : undefined,
        candidate.visualStyleSummary ? `visualStyle=${candidate.visualStyleSummary}` : undefined,
        candidate.promptText ? `promptText=${candidate.promptText.slice(0, 800)}` : undefined,
    ].filter(Boolean).join(' | '))

    return [
        `Current user prompt: ${promptText}`,
        activeTargetNodeId ? `Active target nodeId: ${activeTargetNodeId}` : undefined,
        'Candidate media labels:',
        ...candidateLines,
    ].filter((line): line is string => typeof line === 'string').join('\n')
}

// The browser sends the snapshot unfiltered by design — the API is the source
// of truth for explicit-context exclusivity. When the user attached explicit
// references, drop every other candidate and rebuild the transcript so the VLM
// never sees (or selects) non-explicit media.
export function restrictSnapshotToExplicitRefs(
    snapshot: MediaBranchCandidateSnapshot | undefined,
): MediaBranchCandidateSnapshot | undefined {
    if (!snapshot?.explicitReferenceNodeIds?.length) return snapshot

    const explicitNodeIds = new Set(snapshot.explicitReferenceNodeIds)
    const candidates = snapshot.candidates.filter((candidate) => explicitNodeIds.has(candidate.nodeId))
    if (candidates.length === snapshot.candidates.length) return snapshot

    const activeTargetNodeId = snapshot.activeTargetNodeId && explicitNodeIds.has(snapshot.activeTargetNodeId)
        ? snapshot.activeTargetNodeId
        : undefined
    const restricted: MediaBranchCandidateSnapshot = {
        ...snapshot,
        candidates,
        transcriptContext: buildCandidateTranscriptContext(candidates, snapshot.promptText, activeTargetNodeId),
    }
    if (activeTargetNodeId) restricted.activeTargetNodeId = activeTargetNodeId
    else delete restricted.activeTargetNodeId
    return restricted
}
