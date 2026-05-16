'use strict'

import type { FeatureExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on composition: framing, layout, focus hierarchy, perspective, viewpoint, balance.

Rules:
- framing: short description (e.g. "square frame with painterly soft border", "wide cinematic 21:9", "tight portrait crop").
- aspectRatio: a string like "1:1", "3:2", "16:9", "9:16", or "auto" if uncertain.
- focusHierarchy: order of focus from most to least prominent (e.g. ["central subject", "left background plant", "window light"]).
- negativeSpace: 1 sentence on how negative space is handled.
- compositionRule: one of rule-of-thirds | center-weighted | golden-ratio | symmetrical | leading-lines | rule-of-odds | radial | layered-depth | flat-graphic.
- perspective: a short phrase (e.g. "eye-level frontal", "three-quarter elevated", "worm's-eye", "isometric flat", "no-perspective vector").
- viewpoint: subjective distance and angle (e.g. "close intimate", "medium-shot", "long landscape").
- balance: short description (e.g. "centered symmetric", "left-weighted with right counter-light", "diagonal tension").
- transferGuidance: 1–2 sentences on how to apply this composition to a new subject.

Stay concrete; describe what you observe.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        framing: { type: 'string' },
        aspectRatio: { type: 'string' },
        focusHierarchy: { type: 'array', items: { type: 'string' } },
        negativeSpace: { type: 'string' },
        compositionRule: { type: 'string' },
        perspective: { type: 'string' },
        viewpoint: { type: 'string' },
        balance: { type: 'string' },
        transferGuidance: { type: 'string' },
    },
    required: ['framing', 'aspectRatio', 'focusHierarchy', 'negativeSpace', 'compositionRule', 'perspective', 'viewpoint', 'balance', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: FeatureExtractor = {
    axis: 'composition',
    displayName: 'Composition',
    description: 'Extracts the composition: framing, aspect ratio, focus hierarchy, negative space, composition rule, perspective, viewpoint, balance.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['composition'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
