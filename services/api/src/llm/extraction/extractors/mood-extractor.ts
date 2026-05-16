'use strict'

import type { FeatureExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on the mood and emotional atmosphere of the reference. You extract the emotional register, atmosphere, intended audience, season, time of day, and the visual factors that drive them.

Rules:
- primaryMood: the dominant emotional register in 1–3 words (e.g. "warm cozy friendly", "melancholy contemplative", "tense dramatic", "playful energetic", "serene meditative").
- secondaryMoods[]: 0–3 additional moods that coexist.
- atmosphere: a 1–2 sentence concrete description (e.g. "afternoon indoor coziness with warm window light and softened edges").
- intendedAudience: a short phrase if discernible (e.g. "children's-book", "adult-art-collector", "casual-illustration-fan", "marketing-target-millennial-parents"). Empty string if unclear.
- pace: still | slow | medium | dynamic | frenetic.
- season: spring | summer | autumn | winter | indoor-undefined | unspecified.
- timeOfDay: morning | midday | afternoon | golden-hour | dusk | night | indoor-artificial | unspecified.
- moodDrivers[]: 2–6 short strings naming what produces the mood (e.g. ["warm cream palette", "soft window light", "oversized cute proportions", "warm window light spilling onto floor"]).
- transferGuidance: 1–2 sentences on how to reproduce this mood on a new subject (e.g. "warm-cream palette, soft sidelight from the right, soft edges, low contrast, focus on subject's expression").

Be concrete. Cite specific visual evidence for each mood claim.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        primaryMood: { type: 'string' },
        secondaryMoods: { type: 'array', items: { type: 'string' } },
        atmosphere: { type: 'string' },
        intendedAudience: { type: 'string' },
        pace: { type: 'string' },
        season: { type: 'string' },
        timeOfDay: { type: 'string' },
        moodDrivers: { type: 'array', items: { type: 'string' } },
        transferGuidance: { type: 'string' },
    },
    required: ['primaryMood', 'secondaryMoods', 'atmosphere', 'intendedAudience', 'pace', 'season', 'timeOfDay', 'moodDrivers', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: FeatureExtractor = {
    axis: 'mood',
    displayName: 'Mood',
    description: 'Extracts the mood / emotional register: primary mood, secondary moods, atmosphere, pace, season, time-of-day, and concrete drivers.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['mood'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
