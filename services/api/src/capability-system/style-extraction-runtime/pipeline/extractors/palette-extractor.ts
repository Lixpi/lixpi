'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on color palette extraction. Your sole job is to identify the concrete colors that compose the attached reference image(s) and describe how they relate.

Rules:
- Identify 5–12 distinct colors that meaningfully compose the image. Prefer 7–9 for typical illustrations.
- For each color, sample a hex value as closely as you can from the actual pixels you see. Do not invent canonical names — describe what is actually present.
- Estimate the usage proportion (0..100) as a rough percentage of the canvas this color occupies. The proportions across all entries should sum to roughly 100.
- Classify each color's role: subject-primary, subject-secondary, subject-shadow, subject-highlight, background-primary, background-secondary, accent, ambient-light, etc.
- Classify each color's temperature: warm | cool | neutral.
- For "harmony", name the actual harmony (analogous, complementary, split-complementary, triadic, monochromatic, neutral, etc.). Do not invent jargon.
- For "contrast", classify low | medium | high.
- usageGuidance: 1–3 sentences describing how to apply this palette to an UNRELATED subject. Be concrete (e.g. "lead with warm cream and orange tones for the subject body, recede to cool sage and dust-grey in the background, never invert").
- backgroundTreatment / shadowStrategy / highlightStrategy: brief concrete observations (e.g. shadow uses cool dust-grey not pure black; highlights use warm cream, not white).
- avoid[]: 2–6 short strings listing colors / hues that would falsify the look (e.g. "pure black", "saturated primary red", "neon").

Do NOT include color terminology associated with traditional media (watercolor washes, oil paint glazing, gouache density) UNLESS those traits are visibly present in the reference. Stay grounded in what you actually see.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        palette: {
            type: 'array',
            description: '5–12 distinct colors composing the reference.',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'short human-readable name, e.g. "warm cream", "muted sage"' },
                    hex: { type: 'string', description: '#rrggbb' },
                    role: { type: 'string' },
                    usage: { type: 'integer', description: 'rough 0..100 percent of canvas occupied by this color' },
                    temperature: { type: 'string', description: 'warm | cool | neutral' },
                    notes: { type: 'string', description: '0–1 sentence on where this color appears' },
                },
                required: ['name', 'hex', 'role', 'usage', 'temperature', 'notes'],
                additionalProperties: false,
            },
        },
        harmony: { type: 'string' },
        contrast: { type: 'string', description: 'low | medium | high' },
        usageGuidance: { type: 'string' },
        backgroundTreatment: { type: 'string' },
        shadowStrategy: { type: 'string' },
        highlightStrategy: { type: 'string' },
        avoid: { type: 'array', items: { type: 'string' } },
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
        if (intent && /palette|colou?r/i.test(intent)) return true
        return (scene.axisDominance['palette'] ?? 0) >= 0.3
    },
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
