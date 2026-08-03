'use strict'

import type { AiModelInferenceCapabilities, ProviderName } from '@lixpi/constants'

import type { CharacterEvidenceAnalysis, CharacterEvidenceAnalyzerPort } from './evidence-analyzer.ts'
import type {
    CharacterPanelVlmAssessmentResult,
    CharacterPanelVlmAssessorPort,
} from './panel-assessor.ts'
import type {
    CharacterStructuredVlmPort,
    CharacterVlmJsonSchema,
    CharacterVlmMessage,
} from './runtime-ports.ts'

type CharacterVlmArgs = {
    provider: ProviderName
    modelVersion: string
    inferenceCapabilities: AiModelInferenceCapabilities
    maxOutputTokensCeiling?: number
    vlm: CharacterStructuredVlmPort
}

type RawEvidenceFact = NonNullable<CharacterEvidenceAnalysis['facts']>[number] & {
    sourceAssetId: string | null
    sourceRegion: NonNullable<NonNullable<CharacterEvidenceAnalysis['facts']>[number]['sourceRegion']> | null
    conflictGroupId: string | null
}

type RawEvidenceAnalysis = Omit<CharacterEvidenceAnalysis, 'facts'> & {
    facts: RawEvidenceFact[]
    palette: string[]
    costumeNotes: string[]
    materialNotes: string[]
    distinguishingDetailNotes: string[]
    sourceCoverage: NonNullable<CharacterEvidenceAnalysis['sourceCoverage']>
}

const EVIDENCE_SYSTEM_PROMPT = [
    'Analyze the supplied character references as an observation set for consistent image generation.',
    'Record visible face, hair, skin, clothing, accessories, props, body proportions, materials, medium, target angles, source coverage, and useful crop boxes.',
    'Mark a fact observed only when pixels directly support it. Mark hidden geometry, unseen views, and prompt-derived details inferred.',
    'Use conflictGroupId when references disagree about one feature. Never average conflicting outfits or designs.',
    'Coordinates are pixel coordinates in the named source image. Keep them inside that image.',
].join(' ')

const PANEL_ASSESSMENT_ATTEMPTS = 2

const PANEL_SYSTEM_PROMPT = [
    'Judge one generated character panel against the supplied source images, structured evidence, accepted anchors, and target panel requirements.',
    'Score each requested dimension from 0 to 1. Weight directly observed evidence over polish.',
    'Use short stable mismatch codes for concrete failures. Do not penalize inferred regions for lacking unavailable source truth.',
    'Treat extra people, duplicates, text, watermarks, wrong view, wrong crop, and layout artifacts as failures in the relevant dimensions.',
].join(' ')

export function createCharacterVlmPorts(args: CharacterVlmArgs): {
    evidenceAnalyzer: CharacterEvidenceAnalyzerPort
    panelAssessor: CharacterPanelVlmAssessorPort
} {
    const callVlm = args.vlm.call
    return {
        evidenceAnalyzer: {
            analyze: async request => {
                const result = await callVlm({
                    provider: args.provider,
                    modelVersion: args.modelVersion,
                    inferenceCapabilities: args.inferenceCapabilities,
                    systemPrompt: EVIDENCE_SYSTEM_PROMPT,
                    userMessages: buildEvidenceMessages(request),
                    schema: buildEvidenceSchema(),
                    temperature: 0.1,
                    maxTokens: 8_192,
                    maxOutputTokensCeiling: args.maxOutputTokensCeiling,
                    abortSignal: request.signal,
                    enableThinking: true,
                })
                return normalizeEvidence(result.parsed)
            },
        },
        panelAssessor: {
            // Structured output is occasionally returned without the scored
            // dimensions even under a forced tool call, so one clean re-ask is
            // made before the caller has to fall back to an unscored panel.
            assess: async request => {
                let lastError: unknown
                for (let attempt = 1; attempt <= PANEL_ASSESSMENT_ATTEMPTS; attempt += 1) {
                    const result = await callVlm({
                        provider: args.provider,
                        modelVersion: args.modelVersion,
                        inferenceCapabilities: args.inferenceCapabilities,
                        systemPrompt: PANEL_SYSTEM_PROMPT,
                        userMessages: buildPanelMessages(request),
                        schema: buildPanelAssessmentSchema(request.panel.acceptanceDimensions),
                        temperature: 0,
                        maxTokens: 2_048,
                        maxOutputTokensCeiling: args.maxOutputTokensCeiling,
                        abortSignal: request.signal,
                    })
                    try {
                        return {
                            dimensions: normalizePanelDimensions(result.parsed, request.panel.acceptanceDimensions),
                            assessor: `${args.provider}/${result.modelName || args.modelVersion}`,
                        }
                    } catch (error) {
                        if (request.signal?.aborted) throw error
                        lastError = error
                    }
                }
                throw lastError
            },
        },
    }
}

const buildEvidenceMessages = (
    request: Parameters<CharacterEvidenceAnalyzerPort['analyze']>[0],
): CharacterVlmMessage[] => [{
    role: 'user',
    content: [
        { type: 'input_text', text: `Character request: ${request.userPrompt}` },
        ...request.sources.flatMap(source => [
            {
                type: 'input_text',
                text: `Source asset ${source.assetId}; pixel size ${source.width}x${source.height}.`,
            },
            {
                type: 'input_image',
                image_url: `data:${source.mimeType};base64,${source.bytes.toString('base64')}`,
                detail: 'high',
            },
        ]),
    ],
}]

const buildPanelMessages = (
    request: Parameters<CharacterPanelVlmAssessorPort['assess']>[0],
): CharacterVlmMessage[] => [{
    role: 'user',
    content: [
        {
            type: 'input_text',
            text: [
                `Panel: ${request.panel.panelId}`,
                `Target: ${request.panel.target}`,
                `Crop: ${request.panel.crop}`,
                `Required dimensions: ${request.panel.acceptanceDimensions.join(', ')}`,
                `Evidence: ${JSON.stringify(request.evidence)}`,
            ].join('\n'),
        },
        ...request.sourceDataUrls.flatMap((imageUrl, index) => [
            { type: 'input_text', text: `Authoritative source ${index + 1}.` },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ]),
        ...request.anchorDataUrls.flatMap((imageUrl, index) => [
            { type: 'input_text', text: `Accepted generated anchor ${index + 1}.` },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ]),
        { type: 'input_text', text: 'Candidate to assess.' },
        { type: 'input_image', image_url: request.candidateDataUrl, detail: 'high' },
    ],
}]

const buildEvidenceSchema = (): CharacterVlmJsonSchema => ({
    name: 'character_evidence',
    description: 'Observed and inferred character evidence from source images.',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            medium: { type: 'string', enum: ['photograph', 'illustration', 'render', 'mixed', 'unknown'] },
            facts: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        feature: { type: 'string' },
                        value: { type: 'string' },
                        visibility: { type: 'string', enum: ['observed', 'inferred'] },
                        sourceAssetId: { type: ['string', 'null'] },
                        sourceRegion: {
                            anyOf: [
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        x: { type: 'number', minimum: 0 },
                                        y: { type: 'number', minimum: 0 },
                                        width: { type: 'number', exclusiveMinimum: 0 },
                                        height: { type: 'number', exclusiveMinimum: 0 },
                                    },
                                    required: ['x', 'y', 'width', 'height'],
                                },
                                { type: 'null' },
                            ],
                        },
                        targetAngles: {
                            type: 'array',
                            items: {
                                type: 'string',
                                enum: ['front', 'three-quarter-front', 'profile', 'three-quarter-back', 'back', 'unspecified'],
                            },
                        },
                        confidence: { type: 'number', minimum: 0, maximum: 1 },
                        conflictGroupId: { type: ['string', 'null'] },
                    },
                    required: [
                        'feature', 'value', 'visibility', 'sourceAssetId', 'sourceRegion',
                        'targetAngles', 'confidence', 'conflictGroupId',
                    ],
                },
            },
            palette: { type: 'array', items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, maxItems: 8 },
            costumeNotes: { type: 'array', items: { type: 'string' } },
            materialNotes: { type: 'array', items: { type: 'string' } },
            distinguishingDetailNotes: { type: 'array', items: { type: 'string' } },
            sourceCoverage: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        sourceAssetId: { type: 'string' },
                        angles: {
                            type: 'array',
                            items: {
                                type: 'string',
                                enum: ['front', 'three-quarter-front', 'profile', 'three-quarter-back', 'back', 'unspecified'],
                            },
                        },
                        regions: {
                            type: 'array',
                            items: { type: 'string', enum: ['face', 'body', 'outfit', 'hands', 'feet', 'prop'] },
                        },
                    },
                    required: ['sourceAssetId', 'angles', 'regions'],
                },
            },
        },
        required: [
            'medium', 'facts', 'palette', 'costumeNotes', 'materialNotes',
            'distinguishingDetailNotes', 'sourceCoverage',
        ],
    },
})

const buildPanelAssessmentSchema = (dimensions: readonly string[]): CharacterVlmJsonSchema => ({
    name: 'character_panel_assessment',
    description: 'Evidence-aware scores and mismatch codes for one generated character panel.',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            dimensions: {
                type: 'array',
                minItems: dimensions.length,
                maxItems: dimensions.length,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        dimension: { type: 'string', enum: [...dimensions] },
                        score: { type: 'number', minimum: 0, maximum: 1 },
                        mismatchCodes: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['dimension', 'score', 'mismatchCodes'],
                },
            },
        },
        required: ['dimensions'],
    },
})

const normalizeEvidence = (value: unknown): CharacterEvidenceAnalysis => {
    const analysis = value as RawEvidenceAnalysis
    if (!analysis || !['photograph', 'illustration', 'render', 'mixed', 'unknown'].includes(analysis.medium)) {
        throw new Error('CHARACTER_EVIDENCE_RESPONSE_INVALID')
    }
    return {
        ...analysis,
        facts: analysis.facts.map(({ sourceAssetId, sourceRegion, conflictGroupId, ...fact }) => ({
            ...fact,
            ...(sourceAssetId ? { sourceAssetId } : {}),
            ...(sourceRegion ? { sourceRegion } : {}),
            ...(conflictGroupId ? { conflictGroupId } : {}),
        })),
    }
}

const normalizePanelDimensions = (
    value: unknown,
    expectedDimensions: readonly string[],
): CharacterPanelVlmAssessmentResult['dimensions'] => {
    const dimensions = (value as { dimensions?: CharacterPanelVlmAssessmentResult['dimensions'] })?.dimensions
    if (!Array.isArray(dimensions)) throw new Error('CHARACTER_PANEL_ASSESSMENT_RESPONSE_INVALID')
    const byDimension = new Map(dimensions.map(dimension => [dimension.dimension, dimension]))
    if (byDimension.size !== expectedDimensions.length
        || expectedDimensions.some(dimension => !byDimension.has(dimension))) {
        throw new Error('CHARACTER_PANEL_ASSESSMENT_DIMENSIONS_INVALID')
    }
    return expectedDimensions.map(dimension => byDimension.get(dimension)!)
}
