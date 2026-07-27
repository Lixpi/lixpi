'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on how the background is rendered RELATIVE TO the subject(s).

Rules:
- backgroundStyle: a short phrase (e.g. "painterly-blurred interior", "flat-vector gradient", "photoreal depth-of-field", "abstract wash", "decorative-pattern-tile").
- backgroundFocus: sharp | soft-blurred | abstracted | minimal | absent.
- backgroundElements[]: 0–8 short strings naming background objects/regions (e.g. ["potted plant left", "window with curtain right", "wood floor", "wall-art frame"]).
- backgroundPalette: short description of the background's color palette (e.g. "muted sage-and-cream with cool grey accents").
- relationshipToSubject: continuous (same medium / palette) | contrasting | decorative | functional-context.
- depthCues[]: 0–4 named depth cues used (e.g. ["atmospheric perspective", "size-recession", "blur-falloff", "occlusion overlap"]).
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
