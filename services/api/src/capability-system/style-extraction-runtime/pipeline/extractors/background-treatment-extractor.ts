'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on how the background is rendered RELATIVE TO the subject(s).

Rules:
- backgroundStyle: a short evidence-grounded phrase describing rendering behavior, without naming unobserved content.
- backgroundFocus: classify the degree and type of focus or abstraction.
- backgroundElements[]: zero to eight short strings naming only visible background regions or elements.
- backgroundPalette: a concise description derived from visible background colors.
- relationshipToSubject: describe continuity, contrast, decoration, or functional context in the reference's own terms.
- depthCues[]: zero to four visible mechanisms that establish depth.
- transferGuidance: 1–2 sentences on how to render the background of a NEW subject so the relationship is preserved.

Stay concrete. Describe what's there and how it reads, not what would be typical.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        backgroundStyle: { type: 'string' },
        backgroundFocus: { type: 'string' },
        backgroundElements: { type: 'array', items: { type: 'string' } },
        backgroundPalette: { type: 'string' },
        relationshipToSubject: { type: 'string' },
        depthCues: { type: 'array', items: { type: 'string' } },
        transferGuidance: { type: 'string' },
    },
    required: ['backgroundStyle', 'backgroundFocus', 'backgroundElements', 'backgroundPalette', 'relationshipToSubject', 'depthCues', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'background-treatment',
    displayName: 'Background treatment',
    description: 'Extracts how the background is rendered relative to the subject: style, focus, elements, palette, relationship, depth cues.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['background-treatment'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
