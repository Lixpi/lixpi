import {
    type StyleExtractor,
} from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on lighting. Your sole job is to describe the lighting setup of the reference: direction, quality, temperature, key/fill/rim balance, ambient, shadow behavior, time of day, and practicals.

Rules:
- direction: a short relational phrase grounded in visible illumination and shadows.
- quality: describe visible hardness, diffusion, and spatial variation.
- temperature: a one- or two-word evidence-grounded description.
- keyLight: where the dominant illumination comes from and its character (1 sentence).
- fillLight: describe visible shadow-side illumination without inventing a source.
- rimLight: state presence or absence and visible direction.
- ambient: a short description of visible ambient or atmospheric illumination.
- shadowSoftness: describe the visible transition width.
- shadowColor: a short color description sampled from visible shadows.
- timeOfDay: infer only when visual evidence supports it; otherwise mark unspecified.
- practicals[]: zero to four visible light-emitting sources; empty when none are visible.
- transferGuidance: one to two sentences preserving observed lighting relationships on unrelated requested content.

Stay concrete. Describe what you observe, not what would be typical.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        direction: { type: 'string' },
        quality: { type: 'string' },
        temperature: { type: 'string' },
        keyLight: { type: 'string' },
        fillLight: { type: 'string' },
        rimLight: { type: 'string' },
        ambient: { type: 'string' },
        shadowSoftness: { type: 'string' },
        shadowColor: { type: 'string' },
        timeOfDay: { type: 'string' },
        practicals: {
            type: 'array',
            items: { type: 'string' },
        },
        transferGuidance: { type: 'string' },
    },
    required: ['direction', 'quality', 'temperature', 'keyLight', 'fillLight', 'rimLight', 'ambient', 'shadowSoftness', 'shadowColor', 'timeOfDay', 'practicals', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'lighting',
    displayName: 'Lighting',
    description: 'Extracts the lighting setup: direction, quality, temperature, key/fill/rim balance, ambient, shadow behavior, time of day, practicals.',
    minDominance: 0.3,
    applicableTo: scene => (scene.axisDominance['lighting'] ?? 0) >= 0.3,
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
