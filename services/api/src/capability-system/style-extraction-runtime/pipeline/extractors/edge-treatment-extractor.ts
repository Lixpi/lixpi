'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on the EDGE TREATMENT of the reference: image borders, framing edges, vignettes, and how forms terminate within the canvas.

Rules:
- framePresence: classify whether a distinct frame treatment is visible and name only its observed behavior.
- frameTreatment: one to two sentences describing the visible frame or stating its absence.
- vignette: state presence or absence and, when present, describe visible direction and intensity.
- falloffBehavior: describe how form edges resolve at the background or canvas boundary using only observed evidence.
- transferGuidance: 1–2 sentences on how to reproduce this edge treatment on a new subject.

Stay concrete. Describe what's observed at the edges of the canvas and of forms.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        framePresence: { type: 'string' },
        frameTreatment: { type: 'string' },
        vignette: { type: 'string' },
        falloffBehavior: { type: 'string' },
        transferGuidance: { type: 'string' },
    },
    required: ['framePresence', 'frameTreatment', 'vignette', 'falloffBehavior', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'edge-treatment',
    displayName: 'Edge treatment',
    description: 'Extracts the canvas-edge treatment and how forms terminate at their boundaries: frame presence, vignette, falloff behavior.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['edge-treatment'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) => runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
