'use strict'

import type {
    AiModelInferenceCapabilities,
    ProviderName,
} from '@lixpi/constants'

import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'
import type {
    CharacterEvidenceAnalysis,
    CharacterEvidenceAnalyzerPort,
} from './evidence-analyzer.ts'
import type {
    CharacterEditTargetPolicy,
    CharacterEvidenceRegion,
    CharacterRegenerationScope,
} from './character-evidence.ts'
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
    editTargetApprovedRegions: CharacterEvidenceRegion[]
    editTargetRejectedRegions: CharacterEvidenceRegion[]
    regenerationScope: CharacterRegenerationScope
    affectedPanelIds: string[]
    palette: string[]
    costumeNotes: string[]
    materialNotes: string[]
    distinguishingDetailNotes: string[]
    sourceCoverage: NonNullable<CharacterEvidenceAnalysis['sourceCoverage']>
}

type CharacterPanelAssessmentFailureDescription = {
    code: string
    progressMessage: string
    diagnostic: string
    context?: Readonly<Record<string, unknown>>
}

class CharacterPanelAssessmentResponseError extends Error {
    readonly code = 'CHARACTER_PANEL_ASSESSMENT_RESPONSE_INVALID'
    readonly progressMessage: string
    readonly context: Readonly<Record<string, unknown>>

    constructor(
        progressMessage: string,
        diagnostic: string,
        context: Readonly<Record<string, unknown>>,
    ) {
        super(diagnostic)
        this.name = 'CharacterPanelAssessmentResponseError'
        this.progressMessage = progressMessage
        this.context = context
    }
}

const EVIDENCE_SYSTEM_PROMPT = [
    'Analyze the supplied character references as an observation set for consistent image generation.',
    'Original reference inputs and editable prior-panel inputs are labeled separately. Derive observed facts only from original references. Use editable prior panels only to determine what the request approves, rejects, or replaces.',
    'Record the visible identity, design, construction, proportion, material, depiction, target-geometry, source-coverage, and crop evidence required by the response schema.',
    'Read the complete character request as authoritative. Extract every explicit requested visual attribute, design change, state change, transformation, material change, costume change, and depiction instruction into promptDirectives without substituting a capability-authored interpretation.',
    'Resolve an obvious misspelling conservatively from the surrounding request. Put the corrected intended term in promptDirectives only when context makes that correction unambiguous; otherwise preserve the user term instead of inventing a meaning.',
    'Never reinterpret an unknown or misspelled character term as a depiction-medium or visual-style change unless the request explicitly asks for that change. A requested subject or design transformation does not imply a depiction-medium change.',
    'List in promptChangedFeatures the exact feature names from facts that those directives override. Set each fact region from the closed region axis. Set requestAuthority to assigned only when the request assigns that source to the target trait, supporting when the request explicitly makes it secondary context, and unassigned otherwise. Explicit requested changes outrank source pixels; stable identity evidence remains authoritative only where the request does not change it.',
    'Mark a fact observed only when pixels directly support it. Mark hidden geometry, unseen views, and prompt-derived details inferred.',
    'Every observed fact must name the exact asset ID of the original reference that supplies its pixels in sourceAssetId. Use null only for inferred facts. Never use an editable prior-panel asset ID as observed source evidence.',
    'Use conflictGroupId when references disagree about one feature. Never average conflicting alternatives.',
    'Return editTargetApprovedRegions and editTargetRejectedRegions from the closed region axis. Classify editTargetPolicy from those region decisions and the request: preserve-panel for mixed retained and changed regions, identity-only when only the face region is approved and any non-face region is rejected, discard when every region is rejected, and not-present when no editable prior panel exists.',
    'Classify regenerationScope against the supplied panel IDs. Return selected-panels only when the request clearly limits every visible change to a strict subset; otherwise return full-sheet. affectedPanelIds must contain every panel where any requested change would be visible.',
    'Coordinates are pixel coordinates in the named source image. Keep them inside that image.',
].join(' ')

const PANEL_SYSTEM_PROMPT = [
    'Judge one generated character panel against the complete authoritative request, shared Capability instructions and references, supplied source images, structured evidence, and target panel requirements.',
    'The candidate must be one isolated shot, never a contact sheet, montage, lineup, split view, inset composition, or collection of alternate poses. Score single-panel-composition below the acceptance threshold and report a MULTIPLE_SHOTS mismatch whenever more than the one requested shot is visible.',
    'When a grayscale pose template is supplied, compare the candidate against that template for subject count, camera direction, crop, subject scale, posture, limb placement, and silhouette. Score template-conformance below the review threshold for material crop, scale, posture, or silhouette deviation. Do not use ordinary crop or scale variance as evidence of an extra shot or wrong target view.',
    'The request and shared Capability instructions outrank the unmodified source state. A recognizable source identity that ignores a requested transformation is a request-compliance failure.',
    'The structured evidence medium is the required baseline depiction medium unless the authoritative request or shared Capability instructions explicitly change it. Treat any unrequested depiction-medium or visual-style conversion as both a depiction-medium and request-compliance failure.',
    'Score each requested dimension from 0 to 1. Weight directly observed evidence over polish.',
    'Use short stable mismatch codes for concrete failures. Do not penalize inferred regions for lacking unavailable source truth.',
    'Treat any unrequested visible content, incorrect target geometry, or composition artifact as a failure in the relevant dimension.',
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
                    schema: buildEvidenceSchema(request.panels ?? []),
                    temperature: 0.1,
                    maxTokens: 8_192,
                    maxOutputTokensCeiling: args.maxOutputTokensCeiling,
                    abortSignal: request.signal,
                    enableThinking: false,
                    singleAttempt: true,
                })
                return normalizeEvidence(result.parsed)
            },
        },
        panelAssessor: {
            // Comparison is advisory and runs once. A malformed response is
            // surfaced as comparison-unavailable; it never triggers paid work.
            assess: async request => {
                try {
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
                        singleAttempt: true,
                    })
                    return {
                        dimensions: normalizePanelDimensions(result.parsed, request.panel.acceptanceDimensions),
                        assessor: `${args.provider}/${result.modelName || args.modelVersion}`,
                    }
                } catch (error) {
                    if (request.signal?.aborted) throw error
                    const failure = describeCharacterPanelAssessmentFailure(error)
                    console.warn('[CharacterCreatorFidelity] structured panel assessment unavailable', {
                        panelId: request.panel.panelId,
                        panelTitle: request.panel.title,
                        provider: args.provider,
                        modelVersion: args.modelVersion,
                        code: failure.code,
                        diagnostic: failure.diagnostic,
                        ...failure.context,
                    })
                    return {
                        dimensions: [],
                        assessor: `${args.provider}/${args.modelVersion}`,
                        error: {
                            code: failure.code,
                            message: failure.progressMessage,
                            diagnostic: failure.diagnostic,
                        },
                    }
                }
            },
        },
    }
}

export function describeCharacterPanelAssessmentFailure(
    error: unknown,
): CharacterPanelAssessmentFailureDescription {
    if (error instanceof CharacterPanelAssessmentResponseError) {
        return {
            code: error.code,
            progressMessage: error.progressMessage,
            diagnostic: error.message,
            context: error.context,
        }
    }

    const diagnostic = error instanceof Error ? error.message : String(error)
    if (/truncated structured output|max(?:imum)?[_ -]?tokens/iu.test(diagnostic)) {
        return {
            code: 'CHARACTER_PANEL_ASSESSMENT_RESPONSE_TRUNCATED',
            progressMessage: 'The evaluator response ended before all requested scores were returned.',
            diagnostic,
        }
    }
    if (/did not call tool|empty structured output|non-JSON|invalid JSON payload/iu.test(diagnostic)) {
        return {
            code: 'CHARACTER_PANEL_ASSESSMENT_STRUCTURED_OUTPUT_UNAVAILABLE',
            progressMessage: 'The evaluator did not return a usable structured score set.',
            diagnostic,
        }
    }
    if (/CHARACTER_PANEL_CORRUPT/iu.test(diagnostic)) {
        return {
            code: 'CHARACTER_PANEL_ASSESSMENT_CANDIDATE_INVALID',
            progressMessage: 'The rendered shot could not be decoded for fidelity evaluation.',
            diagnostic,
        }
    }
    return {
        code: 'CHARACTER_PANEL_ASSESSMENT_UNAVAILABLE',
        progressMessage: 'The evaluation service could not produce a usable score set.',
        diagnostic,
    }
}

const buildEvidenceMessages = (
    request: Parameters<CharacterEvidenceAnalyzerPort['analyze']>[0],
): CharacterVlmMessage[] => {
    const referenceAliases = new Map((request.referenceAliases ?? []).map(reference => [
        reference.assetId,
        reference.alias,
    ]))
    const panelContract = (request.panels ?? []).map(panel => ({
        panelId: panel.panelId,
        kind: panel.kind,
        target: panel.target,
        crop: panel.crop,
    }))
    return [{
        role: 'user',
        content: [
            { type: 'input_text', text: `Character request: ${request.userPrompt}` },
            {
                type: 'input_text',
                text: `Planned panel contract: ${JSON.stringify(panelContract)}.`,
            },
            ...request.sources.flatMap((source, index) => [
                {
                    type: 'input_text',
                    text: [
                        `Original reference ${referenceAliases.get(source.assetId) ?? `SOURCE_${index + 1}`}.`,
                        `Asset ${source.assetId}; pixel size ${source.width}x${source.height}.`,
                        'This input may provide observed facts and source regions.',
                    ].join(' '),
                },
                {
                    type: 'input_image',
                    image_url: `data:${source.mimeType};base64,${source.bytes.toString('base64')}`,
                    detail: 'high',
                },
            ]),
            ...(request.editTargets ?? []).flatMap((source, index) => [
                {
                    type: 'input_text',
                    text: [
                        `Editable prior panel ${referenceAliases.get(source.assetId) ?? `EDIT_TARGET_${index + 1}`}.`,
                        `Panel ${source.componentId ?? 'unknown'}; asset ${source.assetId}; pixel size ${source.width}x${source.height}.`,
                        'Use this input only to determine approved and rejected edit-target regions. Do not record it as original-source evidence.',
                    ].join(' '),
                },
                {
                    type: 'input_image',
                    image_url: `data:${source.mimeType};base64,${source.bytes.toString('base64')}`,
                    detail: 'high',
                },
            ]),
        ],
    }]
}

const buildPanelMessages = (
    request: Parameters<CharacterPanelVlmAssessorPort['assess']>[0],
): CharacterVlmMessage[] => [{
    role: 'user',
    content: [
        {
            type: 'input_text',
            text: [
                `Authoritative request: ${request.authoritativePrompt}`,
                `Shared Capability instructions: ${request.capabilityInstructions.join('\n') || 'none'}`,
                `Panel: ${request.panel.panelId}`,
                `Target: ${request.panel.target}`,
                `Crop: ${request.panel.crop}`,
                `Required dimensions: ${request.panel.acceptanceDimensions.join(', ')}`,
                'Categorical single-panel-composition and target-view or action-pose dimensions are release gates. Treat an extra pose, extra character view, inset, montage, or wrong camera view as a concrete categorical mismatch. Template-conformance and framing are review dimensions: score their crop, scale, clearance, and silhouette differences without turning those differences alone into a categorical structural failure.',
                `Evidence: ${JSON.stringify(request.evidence)}`,
            ].join('\n'),
        },
        ...request.sourceDataUrls.flatMap((imageUrl, index) => [
            { type: 'input_text', text: `Authoritative source ${index + 1}.` },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ]),
        ...request.capabilityReferenceDataUrls.flatMap((imageUrl, index) => [
            { type: 'input_text', text: `Shared Capability reference ${index + 1}. Apply only according to the shared Capability instructions.` },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ]),
        ...(request.poseReferenceDataUrl
            ? [
                { type: 'input_text', text: 'Exact grayscale spatial template for this panel. Compare structure only; ignore its identity and design.' },
                { type: 'input_image', image_url: request.poseReferenceDataUrl, detail: 'high' },
            ]
            : []),
        { type: 'input_text', text: 'Candidate to assess.' },
        { type: 'input_image', image_url: request.candidateDataUrl, detail: 'high' },
    ],
}]

const buildEvidenceSchema = (
    panels: readonly CharacterPanelSpec[],
): CharacterVlmJsonSchema => ({
    name: 'character_evidence',
    description: 'Observed and inferred character evidence from source images.',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            medium: { type: 'string', enum: ['photograph', 'illustration', 'render', 'mixed', 'unknown'] },
            editTargetPolicy: {
                type: 'string',
                enum: ['not-present', 'preserve-panel', 'identity-only', 'discard'],
            },
            editTargetApprovedRegions: {
                type: 'array',
                items: { type: 'string', enum: ['face', 'body', 'outfit', 'hands', 'feet', 'prop'] },
            },
            editTargetRejectedRegions: {
                type: 'array',
                items: { type: 'string', enum: ['face', 'body', 'outfit', 'hands', 'feet', 'prop'] },
            },
            regenerationScope: {
                type: 'string',
                enum: ['full-sheet', 'selected-panels'],
            },
            affectedPanelIds: {
                type: 'array',
                items: panels.length > 0
                    ? { type: 'string', enum: panels.map(panel => panel.panelId) }
                    : { type: 'string' },
            },
            promptDirectives: { type: 'array', items: { type: 'string' } },
            promptChangedFeatures: { type: 'array', items: { type: 'string' } },
            facts: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        feature: { type: 'string' },
                        value: { type: 'string' },
                        region: {
                            type: 'string',
                            enum: ['face', 'body', 'outfit', 'hands', 'feet', 'prop'],
                        },
                        requestAuthority: {
                            type: 'string',
                            enum: ['assigned', 'supporting', 'unassigned'],
                        },
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
                        'feature',
                        'value',
                        'region',
                        'requestAuthority',
                        'visibility',
                        'sourceAssetId',
                        'sourceRegion',
                        'targetAngles',
                        'confidence',
                        'conflictGroupId',
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
            'medium',
            'editTargetPolicy',
            'editTargetApprovedRegions',
            'editTargetRejectedRegions',
            'regenerationScope',
            'affectedPanelIds',
            'promptDirectives',
            'promptChangedFeatures',
            'facts',
            'palette',
            'costumeNotes',
            'materialNotes',
            'distinguishingDetailNotes',
            'sourceCoverage',
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
        editTargetPolicy: normalizeEditTargetPolicy(analysis.editTargetPolicy),
        editTargetApprovedRegions: normalizeEvidenceRegions(analysis.editTargetApprovedRegions),
        editTargetRejectedRegions: normalizeEvidenceRegions(analysis.editTargetRejectedRegions),
        regenerationScope: normalizeRegenerationScope(analysis.regenerationScope),
        affectedPanelIds: normalizeStringList(analysis.affectedPanelIds),
        promptDirectives: normalizeStringList(analysis.promptDirectives),
        promptChangedFeatures: normalizeStringList(analysis.promptChangedFeatures),
        facts: analysis.facts.map(({ sourceAssetId, sourceRegion, conflictGroupId, ...fact }) => ({
            ...fact,
            ...(sourceAssetId ? { sourceAssetId } : {}),
            ...(sourceRegion ? { sourceRegion } : {}),
            ...(conflictGroupId ? { conflictGroupId } : {}),
        })),
    }
}

const normalizeEditTargetPolicy = (value: unknown): CharacterEditTargetPolicy => {
    if (value === 'not-present' || value === 'preserve-panel' || value === 'identity-only' || value === 'discard') {
        return value
    }
    throw new Error('CHARACTER_EVIDENCE_EDIT_TARGET_POLICY_INVALID')
}

const normalizeEvidenceRegions = (value: unknown): CharacterEvidenceRegion[] => {
    if (!Array.isArray(value)) return []
    return [
        ...new Set(value.flatMap(region => (
            region === 'face'
                || region === 'body'
                || region === 'outfit'
                || region === 'hands'
                || region === 'feet'
                || region === 'prop'
                ? [region]
                : []
        ))),
    ]
}

const normalizeRegenerationScope = (value: unknown): CharacterRegenerationScope => {
    if (value === 'full-sheet' || value === 'selected-panels') return value
    throw new Error('CHARACTER_EVIDENCE_REGENERATION_SCOPE_INVALID')
}

const normalizeStringList = (value: unknown): string[] =>
    Array.isArray(value)
        ? [...new Set(value.flatMap(item => typeof item === 'string' && item.trim() ? [item.trim()] : []))]
        : []

const normalizePanelDimensions = (
    value: unknown,
    expectedDimensions: readonly string[],
): CharacterPanelVlmAssessmentResult['dimensions'] => {
    const response = isRecord(value) ? value : undefined
    const rawDimensions = response?.dimensions
    const dimensions = coercePanelDimensionCollection(rawDimensions, expectedDimensions)
    if (!dimensions) {
        throw new CharacterPanelAssessmentResponseError(
            'The evaluator returned no usable per-dimension score list.',
            'The structured response dimensions field could not be normalized to dimension entries.',
            {
                responseType: describeValueType(value),
                responseKeys: response ? Object.keys(response) : [],
                dimensionsType: describeValueType(rawDimensions),
                dimensionsKeys: isRecord(rawDimensions) ? Object.keys(rawDimensions) : [],
                dimensionsShape: summarizeDimensionPayloadShape(rawDimensions),
                ...(typeof rawDimensions === 'string'
                    ? { dimensionsPreview: rawDimensions.slice(0, 320) }
                    : {}),
                expectedDimensions: [...expectedDimensions],
            },
        )
    }

    const normalizedDimensions: CharacterPanelVlmAssessmentResult['dimensions'] = []
    const invalidEntries: string[] = []
    dimensions.forEach((dimension, index) => {
        if (!isRecord(dimension)) {
            invalidEntries.push(`entry ${index + 1} is ${describeValueType(dimension)}`)
            return
        }
        const dimensionName = normalizeRequestedDimensionName(
            dimension.dimension,
            expectedDimensions,
        )
        const score = normalizePanelDimensionScore(dimension.score)
        const mismatchCodes = normalizeMismatchCodes(dimension.mismatchCodes)
        if (!dimensionName) {
            invalidEntries.push(`entry ${index + 1}: dimension`)
            return
        }
        if (score === undefined) {
            invalidEntries.push(`${dimensionName}: score`)
            return
        }
        if (!mismatchCodes) {
            invalidEntries.push(`${dimensionName}: mismatchCodes`)
            return
        }
        normalizedDimensions.push({
            dimension: dimensionName,
            score,
            mismatchCodes,
        })
    })

    if (invalidEntries.length > 0) {
        throw new CharacterPanelAssessmentResponseError(
            `The evaluator returned unusable fields for ${invalidEntries.join('; ')}.`,
            `Invalid per-dimension entries: ${invalidEntries.join('; ')}.`,
            {
                dimensionCount: dimensions.length,
                expectedDimensions: [...expectedDimensions],
                invalidEntries,
            },
        )
    }

    const receivedDimensionNames = normalizedDimensions.map(dimension => dimension.dimension)
    const missingDimensions = expectedDimensions.filter(dimension => !receivedDimensionNames.includes(dimension))
    const unexpectedDimensions = receivedDimensionNames.filter(dimension => !expectedDimensions.includes(dimension))
    const duplicateDimensions = [
        ...new Set(receivedDimensionNames.filter((dimension, index) => (
            receivedDimensionNames.indexOf(dimension) !== index
        ))),
    ]
    if (missingDimensions.length > 0 || unexpectedDimensions.length > 0 || duplicateDimensions.length > 0) {
        const issues = [
            missingDimensions.length > 0 ? `missing ${missingDimensions.join(', ')}` : '',
            unexpectedDimensions.length > 0 ? `unexpected ${unexpectedDimensions.join(', ')}` : '',
            duplicateDimensions.length > 0 ? `duplicated ${duplicateDimensions.join(', ')}` : '',
        ].filter(Boolean)
        throw new CharacterPanelAssessmentResponseError(
            `The evaluator returned an incomplete score set (${issues.join('; ')}).`,
            `Dimension set mismatch: ${issues.join('; ')}.`,
            {
                expectedDimensions: [...expectedDimensions],
                receivedDimensions: receivedDimensionNames,
                missingDimensions,
                unexpectedDimensions,
                duplicateDimensions,
            },
        )
    }

    const byDimension = new Map(normalizedDimensions.map(dimension => [dimension.dimension, dimension]))
    return expectedDimensions.map(dimension => byDimension.get(dimension)!)
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
)

const coercePanelDimensionCollection = (
    value: unknown,
    expectedDimensions: readonly string[],
): unknown[] | undefined => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
        try {
            return coercePanelDimensionCollection(JSON.parse(value), expectedDimensions)
        } catch {
            return undefined
        }
    }
    if (!isRecord(value)) return undefined
    for (const candidateKey of ['items', 'scores', 'values', 'dimensions']) {
        const candidate = value[candidateKey]
        if (candidate !== value) {
            const nested = coercePanelDimensionCollection(candidate, expectedDimensions)
            if (nested) return nested
        }
    }
    const expectedByNormalizedName = new Map(expectedDimensions.map(dimension => [
        normalizeDimensionToken(dimension),
        dimension,
    ]))
    const entries = Object.entries(value).flatMap(([dimensionKey, dimensionValue]) => {
        const expectedDimension = expectedByNormalizedName.get(normalizeDimensionToken(dimensionKey))
        if (
            !expectedDimension || (!isRecord(dimensionValue)
                && typeof dimensionValue !== 'number'
                && typeof dimensionValue !== 'string')
        ) return []
        const normalizedValue = isRecord(dimensionValue)
            ? dimensionValue
            : { score: dimensionValue, mismatchCodes: [] }
        const suppliedDimension = isRecord(dimensionValue)
            ? dimensionValue.dimension
            : undefined
        return [{
            ...normalizedValue,
            dimension: suppliedDimension ?? expectedDimension,
        }]
    })
    if (entries.length > 0) return entries
    const recordValues = Object.values(value)
    return recordValues.length > 0 && recordValues.every(isRecord)
        ? recordValues
        : undefined
}

const summarizeDimensionPayloadShape = (value: unknown): Readonly<Record<string, unknown>> => {
    if (Array.isArray(value)) {
        return {
            kind: 'array',
            entryCount: value.length,
            entryShapes: value.slice(0, 12).map(entry =>
                isRecord(entry)
                    ? Object.keys(entry)
                    : [describeValueType(entry)]
            ),
        }
    }
    if (isRecord(value)) {
        return {
            kind: 'object',
            entryCount: Object.keys(value).length,
            entries: Object.entries(value).slice(0, 12).map(([key, entry]) => ({
                key,
                type: describeValueType(entry),
                fields: isRecord(entry) ? Object.keys(entry) : [],
            })),
        }
    }
    return { kind: describeValueType(value) }
}

const normalizeRequestedDimensionName = (
    value: unknown,
    expectedDimensions: readonly string[],
): string => {
    if (typeof value !== 'string') return ''
    const normalized = normalizeDimensionToken(value)
    return expectedDimensions.find(dimension => normalizeDimensionToken(dimension) === normalized)
        ?? value.trim()
}

const normalizeDimensionToken = (value: string): string =>
    value
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '')

const normalizePanelDimensionScore = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
    }
    if (typeof value !== 'string') return undefined
    const normalized = value.trim()
    const percent = /^(\d+(?:\.\d+)?)%$/u.exec(normalized)
    const parsed = percent?.[1] ? Number(percent[1]) / 100 : Number(normalized)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined
}

const normalizeMismatchCodes = (value: unknown): string[] | undefined => {
    if (typeof value === 'string') return value.trim() ? [value.trim()] : []
    if (!Array.isArray(value) || value.some(code => typeof code !== 'string')) return undefined
    return value.map(code => code.trim()).filter(Boolean)
}

const describeValueType = (value: unknown): string => {
    if (Array.isArray(value)) return 'array'
    if (value === null) return 'null'
    return typeof value
}
