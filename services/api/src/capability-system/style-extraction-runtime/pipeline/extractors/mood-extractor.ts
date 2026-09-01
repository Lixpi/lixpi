'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on the mood and emotional atmosphere of the reference. You extract the emotional register, atmosphere, intended audience, season, time of day, and the visual factors that drive them.

Rules:
- primaryMood: the dominant emotional register in one to three evidence-grounded words.
- secondaryMoods[]: 0–3 additional moods that coexist.
- atmosphere: a one- or two-sentence description grounded in visible factors.
- intendedAudience: leave empty unless visual evidence makes a target context explicit; do not infer demographics.
- pace: describe the apparent visual energy without inventing action.
- season: infer only from visible evidence; otherwise mark unspecified.
- timeOfDay: infer only from visible evidence; otherwise mark unspecified.
- moodDrivers[]: two to six short strings naming visible factors that produce the mood.
- transferGuidance: one to two sentences preserving those factors on unrelated requested content.

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

const extractor: StyleExtractor = {
    axis: 'mood',
    displayName: 'Mood',
    description: 'Extracts the mood / emotional register: primary mood, secondary moods, atmosphere, pace, season, time-of-day, and concrete drivers.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['mood'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) => runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
