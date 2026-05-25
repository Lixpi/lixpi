'use strict'

import type { FeatureExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on lighting. Your sole job is to describe the lighting setup of the reference: direction, quality, temperature, key/fill/rim balance, ambient, shadow behavior, time of day, and practicals.

Rules:
- direction: a short phrase grounded in observation (e.g. "right-window soft sidelight", "above-left top-down", "frontal flat", "rim-only behind").
- quality: hard | soft | diffused | dappled.
- temperature: a 1–2-word description (e.g. "warm-afternoon", "cool-overcast", "neutral-noon", "warm-magic-hour").
- keyLight: where the dominant illumination comes from and its character (1 sentence).
- fillLight: how the shadow side is filled (cool fill, warm bounce, dark/no fill).
- rimLight: present or not, and where (e.g. "subtle warm rim on the head/ears from the right", "none").
- ambient: short description of ambient/atmospheric light (e.g. "warm cream wash in highlights, cool dust-grey in deep shadows").
- shadowSoftness: hard | medium | soft.
- shadowColor: short description (e.g. "cool dust-grey", "deep umber", "near-black").
- timeOfDay: morning | midday | afternoon | golden-hour | dusk | night | indoor-artificial | unspecified.
- practicals[]: 0–4 visible practical light sources (e.g. ["window-right", "ceiling-overhead"]). Empty if none.
- transferGuidance: 1–2 sentences on how to apply this lighting to a new subject (e.g. "place the key light off-right with warm window quality, fill cool, soft shadows pooled toward the lower-left").

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
        practicals: { type: 'array', items: { type: 'string' } },
        transferGuidance: { type: 'string' },
    },
    required: ['direction', 'quality', 'temperature', 'keyLight', 'fillLight', 'rimLight', 'ambient', 'shadowSoftness', 'shadowColor', 'timeOfDay', 'practicals', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: FeatureExtractor = {
    axis: 'lighting',
    displayName: 'Lighting',
    description: 'Extracts the lighting setup: direction, quality, temperature, key/fill/rim balance, ambient, shadow behavior, time of day, practicals.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['lighting'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
