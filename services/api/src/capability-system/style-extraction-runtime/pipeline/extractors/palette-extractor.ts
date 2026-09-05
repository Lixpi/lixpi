import {
    type StyleExtractor,
} from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on color palette extraction. Your sole job is to identify the concrete colors that compose the attached reference image(s) and describe how they relate.

Rules:
- Identify 5–12 distinct colors that meaningfully compose the image. Prefer 7–9 for typical illustrations.
- For each color, sample a hex value as closely as you can from the actual pixels you see. Do not invent canonical names — describe what is actually present.
- Estimate the usage proportion (0..100) as a rough percentage of the canvas this color occupies. The proportions across all entries should sum to roughly 100.
- Classify each color's role from its visible spatial and value function without assuming a subject category.
- Classify each color's temperature from its sampled value.
- For harmony, name the observed color relationship without forcing a stock label.
- For contrast, describe the observed luminance and chroma separation.
- usageGuidance: one to three sentences explaining how to preserve color roles and proportions on unrelated requested content.
- backgroundTreatment, shadowStrategy, and highlightStrategy: brief concrete observations derived from sampled regions.
- avoid[]: two to six source-derived color conditions that would falsify the observed relationship; never use a fixed list.

Do not infer medium from palette. Stay grounded in sampled color and visible relationships.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        palette: {
            type: 'array',
            description: '5–12 distinct colors composing the reference.',
            items: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Short human-readable name derived from the sampled color.',
                    },
                    hex: {
                        type: 'string',
                        description: '#rrggbb',
                    },
                    role: { type: 'string' },
                    usage: {
                        type: 'integer',
                        description: 'rough 0..100 percent of canvas occupied by this color',
                    },
                    temperature: {
                        type: 'string',
                        description: 'warm | cool | neutral',
                    },
                    notes: {
                        type: 'string',
                        description: '0–1 sentence on where this color appears',
                    },
                },
                required: ['name', 'hex', 'role', 'usage', 'temperature', 'notes'],
                additionalProperties: false,
            },
        },
        harmony: { type: 'string' },
        contrast: {
            type: 'string',
            description: 'low | medium | high',
        },
        usageGuidance: { type: 'string' },
        backgroundTreatment: { type: 'string' },
        shadowStrategy: { type: 'string' },
        highlightStrategy: { type: 'string' },
        avoid: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: ['palette', 'harmony', 'contrast', 'usageGuidance', 'backgroundTreatment', 'shadowStrategy', 'highlightStrategy', 'avoid'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'palette',
    displayName: 'Color palette',
    description: 'Extracts the concrete color palette of the reference: 5–12 named hex colors with role, usage proportion, temperature, and palette-level harmony / contrast / strategy.',
    minDominance: 0.3,
    applicableTo: (scene, intent) => {
        if (
            intent
            && /palette|colou?r/i.test(intent)
        )
            return true

        return (scene.axisDominance['palette'] ?? 0) >= 0.3
    },
    extract: async ({
        scene,
        state,
        logger,
    }) => runAxisVlm({
        extractor,
        state,
        scene,
        systemPrompt: SYSTEM_PROMPT,
        fieldsSchema: FIELDS_SCHEMA,
        logger,
    }),
}

registerExtractor(extractor)
export default extractor
