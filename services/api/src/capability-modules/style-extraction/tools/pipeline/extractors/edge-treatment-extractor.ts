'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on the EDGE TREATMENT of the reference: image borders, framing edges, vignettes, and how forms terminate within the canvas.

Rules:
- framePresence: none | painterly | torn | clean-line | hard-vector | vignette-falloff.
- frameTreatment: 1–2 sentences describing the visible frame (e.g. "soft painterly square frame with a lavender tint, edges slightly inset", or "no visible frame").
- vignette: present | absent. If present, describe direction / intensity in 1 sentence.
- falloffBehavior: how form edges resolve as they meet the background or canvas border (e.g. "soft blurred edges with painterly halo", "hard anti-aliased silhouette", "feathered watercolor bleed").
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
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
