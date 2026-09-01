'use strict'

import sharp from 'sharp'
import {
    info,
    warn,
} from '@lixpi/debug-tools'

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
    fidelityError?: CharacterFidelityAssessmentResponse['error']
    vlmAssessor: string
    vlmError?: CharacterPanelVlmAssessmentError
    failedDimensions: string[]
}

export type CharacterPanelVlmAssessmentError = {
    code: string
    message: string
    diagnostic: string
}

export type CharacterPanelVlmAssessmentResult = {
    dimensions: CharacterPanelDimensionAssessment[]
    assessor: string
    error?: CharacterPanelVlmAssessmentError
}

export type CharacterPanelVlmAssessorPort = {
    assess: (args: {
        panel: CharacterPanelSpec
        candidateDataUrl: string
        poseReferenceDataUrl?: string
        authoritativePrompt: string
        capabilityInstructions: readonly string[]
        capabilityReferenceDataUrls: readonly string[]
        evidence: CharacterEvidenceProfile
        sourceDataUrls: string[]
        signal?: AbortSignal
    }) => Promise<CharacterPanelVlmAssessmentResult>
}

const CHARACTER_PANEL_HARD_ACCEPTANCE_THRESHOLD = 0.85
const CHARACTER_PANEL_HARD_DIMENSIONS = new Set([
    'single-panel-composition',
    'target-view',
    'action-pose',
])

export function getCharacterPanelStructuralFailures(
    panel: CharacterPanelSpec,
    assessment: CharacterPanelAssessment,
): string[] {
    if (!assessment.valid) return []
    const assessmentsByDimension = new Map(assessment.dimensions.map(dimension => [
        dimension.dimension,
        dimension,
    ]))
    return panel.acceptanceDimensions
        .filter(dimension => CHARACTER_PANEL_HARD_DIMENSIONS.has(dimension))
        .filter(dimension => {
            const result = assessmentsByDimension.get(dimension)
            return !result
                || result.score < CHARACTER_PANEL_HARD_ACCEPTANCE_THRESHOLD
                || result.mismatchCodes.length > 0
        })
}

export async function assessCharacterPanel(args: {
    panel: CharacterPanelSpec
    attemptId: string
    candidateBytes: Buffer
    candidateCoordinate: CharacterFidelityObjectCoordinate
    sourceCoordinates: CharacterFidelityObjectCoordinate[]
    sourceDataUrls: string[]
    authoritativePrompt: string
    capabilityInstructions: readonly string[]
    capabilityReferenceDataUrls: readonly string[]
    poseReferenceDataUrl?: string
    evidence: CharacterEvidenceProfile
    vlm: CharacterPanelVlmAssessorPort
    fidelity?: CharacterFidelityPort
    signal?: AbortSignal
}): Promise<CharacterPanelAssessment> {
    await assertUsablePanel(args.candidateBytes)
    const candidateDataUrl = `data:image/png;base64,${args.candidateBytes.toString('base64')}`
    const [vlmAssessment, fidelity] = await Promise.all([
        assessPanelDimensions(args, candidateDataUrl),
        assessFaceFidelity(args),
    ])
    const dimensions = vlmAssessment.dimensions
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
    if (
        !fidelity.metric.available
        && fidelity.metric.unavailableReason !== 'face-not-required'
        && fidelity.metric.unavailableReason !== 'non-photographic'
    ) {
        failedDimensions.push('face-similarity-unavailable')
    }
    if (dimensions.length === 0) failedDimensions.push('per-dimension-evaluation-unavailable')
    return {
        panelId: args.panel.panelId,
        attemptId: args.attemptId,
        valid: dimensions.length > 0,
        score,
        dimensions,
        fidelityMetric: fidelity.metric,
        fidelityModelIds: fidelity.detector.artifactId && fidelity.recognizer.artifactId
            ? { detector: fidelity.detector.artifactId, recognizer: fidelity.recognizer.artifactId }
            : undefined,
        ...(fidelity.error ? { fidelityError: fidelity.error } : {}),
        vlmAssessor: vlmAssessment.assessor,
        ...(vlmAssessment.error ? { vlmError: vlmAssessment.error } : {}),
        failedDimensions: [...new Set(failedDimensions)],
    }
}

const assessPanelDimensions = async (
    args: Parameters<typeof assessCharacterPanel>[0],
    candidateDataUrl: string,
): Promise<CharacterPanelVlmAssessmentResult> => {
    try {
        return await args.vlm.assess({
            panel: args.panel,
            candidateDataUrl,
            ...(args.poseReferenceDataUrl
                ? { poseReferenceDataUrl: args.poseReferenceDataUrl }
                : {}),
            authoritativePrompt: args.authoritativePrompt,
            capabilityInstructions: args.capabilityInstructions,
            capabilityReferenceDataUrls: args.capabilityReferenceDataUrls,
            evidence: args.evidence,
            sourceDataUrls: args.sourceDataUrls,
            signal: args.signal,
        })
    } catch (error) {
        if (args.signal?.aborted) throw error
        const diagnostic = error instanceof Error ? error.message : String(error)
        warn(`[CharacterCreatorFidelity] dimension-assessor-unavailable ${
            JSON.stringify({
                attemptId: args.attemptId,
                panelId: args.panel.panelId,
                errorName: error instanceof Error ? error.name : 'Error',
                diagnostic: diagnostic.slice(0, 320),
            })
        }`)
        return {
            dimensions: [],
            assessor: 'unavailable',
            error: {
                code: 'CHARACTER_PANEL_ASSESSMENT_UNAVAILABLE',
                message: 'The per-dimension evaluator could not produce a usable score set.',
                diagnostic,
            },
        }
    }
}

const assessFaceFidelity = async (args: Parameters<typeof assessCharacterPanel>[0]): Promise<CharacterFidelityAssessmentResponse> => {
    const requiresFaceFidelity = args.panel.acceptanceDimensions.includes('facial-identity')
    if (
        !args.fidelity || args.evidence.medium !== 'photograph'
        || !requiresFaceFidelity
    ) {
        const reason: CharacterFidelityUnavailableReason = args.evidence.medium !== 'photograph'
            ? 'non-photographic'
            : !requiresFaceFidelity
            ? 'face-not-required'
            : 'assessor-unavailable'
        info(`[CharacterFidelity] local-skip ${
            JSON.stringify({
                attemptId: args.attemptId,
                panelId: args.panel.panelId,
                panelKind: args.panel.kind,
                sourceMedium: args.evidence.medium,
                requiresFaceFidelity,
                fidelityPortAvailable: Boolean(args.fidelity),
                reason,
            })
        }`)
        return unavailableMetric(args, reason)
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
        warn(`[CharacterFidelity] assessor-unavailable ${
            JSON.stringify({
                attemptId: args.attemptId,
                panelId: args.panel.panelId,
                error: error instanceof Error ? error.message : String(error),
            })
        }`)
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
