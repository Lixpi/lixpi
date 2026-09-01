'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on composition: framing, layout, focus hierarchy, perspective, viewpoint, balance.

Rules:
- framing: a short description of visible frame shape, crop, and boundary behavior.
- aspectRatio: the observed width-to-height ratio as two positive numeric terms, or the literal auto when uncertain.
- focusHierarchy: visible regions ordered from most to least prominent, using generic spatial or role labels when possible.
- negativeSpace: 1 sentence on how negative space is handled.
- compositionRule: name the observed organizing geometry without forcing a stock rule.
- perspective: a short evidence-grounded phrase describing projection and angle.
- viewpoint: a short description of visible distance and angle.
- balance: a short relational description of visual weight.
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

const extractor: StyleExtractor = {
    axis: 'composition',
    displayName: 'Composition',
    description: 'Extracts the composition: framing, aspect ratio, focus hierarchy, negative space, composition rule, perspective, viewpoint, balance.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['composition'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) => runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
