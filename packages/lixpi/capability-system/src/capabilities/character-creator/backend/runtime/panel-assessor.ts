'use strict'

import sharp from 'sharp'

import type {
    CharacterFidelityAssessmentRequest,
    CharacterFidelityAssessmentResponse,
    CharacterFidelityObjectCoordinate,
    CharacterFidelityUnavailableReason,
} from '@lixpi/constants'
import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'

import type { CharacterEvidenceProfile } from './character-evidence.ts'
import type { CharacterFidelityPort } from './runtime-ports.ts'

export type CharacterPanelDimensionAssessment = {
    dimension: string
    score: number
    mismatchCodes: string[]
}

export type CharacterPanelAssessment = {
    panelId: string
    attemptId: string
    valid: boolean
    score: number
    dimensions: CharacterPanelDimensionAssessment[]
    fidelityMetric: CharacterFidelityAssessmentResponse['metric']
    fidelityModelIds?: {
        detector: string
        recognizer: string
    }
    vlmAssessor: string
    failedDimensions: string[]
}

export type CharacterPanelVlmAssessmentResult = {
    dimensions: CharacterPanelDimensionAssessment[]
    assessor: string
}

export type CharacterPanelVlmAssessorPort = {
    assess: (args: {
        panel: CharacterPanelSpec
        candidateDataUrl: string
        evidence: CharacterEvidenceProfile
        sourceDataUrls: string[]
        signal?: AbortSignal
    }) => Promise<CharacterPanelVlmAssessmentResult>
}

export async function assessCharacterPanel(args: {
    panel: CharacterPanelSpec
    attemptId: string
    candidateBytes: Buffer
    candidateCoordinate: CharacterFidelityObjectCoordinate
    sourceCoordinates: CharacterFidelityObjectCoordinate[]
    sourceDataUrls: string[]
    evidence: CharacterEvidenceProfile
    vlm: CharacterPanelVlmAssessorPort
    fidelity?: CharacterFidelityPort
    signal?: AbortSignal
}): Promise<CharacterPanelAssessment> {
    await assertUsablePanel(args.candidateBytes)
    const candidateDataUrl = `data:image/png;base64,${args.candidateBytes.toString('base64')}`
    // Assessment is advisory. An assessor that cannot produce scores leaves the
    // preserved candidate unscored so the sheet still completes.
    let vlmAssessment: CharacterPanelVlmAssessmentResult
    try {
        vlmAssessment = await args.vlm.assess({
            panel: args.panel,
            candidateDataUrl,
            evidence: args.evidence,
            sourceDataUrls: args.sourceDataUrls,
            signal: args.signal,
        })
    } catch (error) {
        if (args.signal?.aborted) throw error
        vlmAssessment = { dimensions: [], assessor: 'assessment-unavailable' }
    }
    const dimensions = vlmAssessment.dimensions
    const fidelity = await assessFaceFidelity(args)
    const scores = dimensions.map(dimension => clamp(dimension.score))
    if (fidelity.metric.available && fidelity.metric.cosineSimilarity !== undefined) {
        scores.push(clamp(fidelity.metric.cosineSimilarity))
    }
    const score = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length)
    const failedDimensions = dimensions
        .filter(dimension => dimension.score < 0.72 || dimension.mismatchCodes.length > 0)
        .map(dimension => dimension.dimension)
    if (fidelity.metric.available && (fidelity.metric.cosineSimilarity ?? 0) < 0.45) {
        failedDimensions.push('facial-identity')
    }
    return {
        panelId: args.panel.panelId,
        attemptId: args.attemptId,
        valid: true,
        score,
        dimensions,
        fidelityMetric: fidelity.metric,
        fidelityModelIds: fidelity.detector.artifactId && fidelity.recognizer.artifactId
            ? { detector: fidelity.detector.artifactId, recognizer: fidelity.recognizer.artifactId }
            : undefined,
        vlmAssessor: vlmAssessment.assessor,
        failedDimensions: [...new Set(failedDimensions)],
    }
}

const assessFaceFidelity = async (args: Parameters<typeof assessCharacterPanel>[0]): Promise<CharacterFidelityAssessmentResponse> => {
    if (!args.fidelity || args.evidence.medium !== 'photograph'
        || !['head', 'action'].includes(args.panel.kind)) {
        return unavailableMetric(args, args.evidence.medium === 'photograph' ? 'face-not-required' : 'non-photographic')
    }
    const request: CharacterFidelityAssessmentRequest = {
        jobId: args.attemptId,
        organizationId: args.candidateCoordinate.organizationId,
        panelId: args.panel.panelId,
        attemptId: args.attemptId,
        sources: args.sourceCoordinates,
        candidate: args.candidateCoordinate,
        expectedFaceVisibility: 'required',
        sourceMedium: args.evidence.medium,
    }
    // Face fidelity is one scoring signal among the VLM dimensions, never a
    // hard dependency: an unreachable or cold-starting assessor must degrade to
    // an unavailable metric instead of failing the panel and killing the sheet.
    try {
        return await args.fidelity.assess(request, args.signal)
    } catch (error) {
        if (args.signal?.aborted) throw error
        return unavailableMetric(args, 'assessor-unavailable')
    }
}

const unavailableMetric = (
    args: Parameters<typeof assessCharacterPanel>[0],
    reason: CharacterFidelityUnavailableReason,
): CharacterFidelityAssessmentResponse => ({
    jobId: args.attemptId,
    panelId: args.panel.panelId,
    attemptId: args.attemptId,
    metric: { available: false, unavailableReason: reason },
    sourceDetections: [],
    candidateDetections: [],
    detector: { artifactId: '', sha256: '' },
    recognizer: { artifactId: '', sha256: '' },
})

const assertUsablePanel = async (bytes: Buffer): Promise<void> => {
    try {
        const metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) {
            throw new Error('dimensions')
        }
    } catch (error) {
        throw new Error(`CHARACTER_PANEL_CORRUPT:${(error as Error).message}`)
    }
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value))
