import {
    type StyleExtractor,
} from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on LINE QUALITY: line presence, weight, variation, color, outline behavior, and interior linework.

Rules:
- linePresence: describe presence, absence, and continuity of visible lines.
- lineWeight: a short relational or image-scale measurement of visible width.
- lineVariation: describe visible variation along individual marks.
- lineColor: describe only sampled visible line color and its value relation to adjacent regions.
- outlineBehavior: describe how visible silhouettes are bounded.
- interiorLines: describe how visible interior divisions and shading marks are rendered.
- transferGuidance: 1–2 sentences on how to reproduce this line treatment on a new subject.

If no visible lines are present, say so explicitly and keep line-specific fields empty or absence-marked. Do not infer a medium from line absence alone.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        linePresence: { type: 'string' },
        lineWeight: { type: 'string' },
        lineVariation: { type: 'string' },
        lineColor: { type: 'string' },
        outlineBehavior: { type: 'string' },
        interiorLines: { type: 'string' },
        transferGuidance: { type: 'string' },
    },
    required: ['linePresence', 'lineWeight', 'lineVariation', 'lineColor', 'outlineBehavior', 'interiorLines', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'line-quality',
    displayName: 'Line quality',
    description: 'Extracts the line treatment: presence, weight, variation, color, outline behavior, interior linework.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['line-quality'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) => runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
