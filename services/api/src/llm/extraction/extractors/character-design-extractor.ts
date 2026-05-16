'use strict'

import type { FeatureExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

// The CharacterDesignExtractor captures the rendering-of-the-subject as a first-class
// signature. This is the axis that fixes the cat-bug: oversized cel-shaded green eyes,
// chibi proportions, soft cel-shaded fur, tabby markings — these are the actually
// distinctive traits of the reference and must be foregrounded in the final feature.
// Only runs when subjects are present in the scene assessment.
const SYSTEM_PROMPT = `You are a senior character-design analyst. Your sole job is to extract the rendering of subject(s) in the attached reference — anatomy, proportions, expression, feature emphasis, shading approach, line treatment, and silhouette style.

Rules:
- archetype: a short type label (e.g. "chibi-kitten", "stylized-figure", "realistic-portrait", "anthropomorphic-mascot", "cartoon-mecha", "creature-design"). Be specific.
- proportions:
  - headToBody: ratio expressed as "X:Y" (e.g. "1.2:1" for chibi, "1:6" for realistic adult). Use approximate measurement from the visible subject.
  - eyeToFace: a 0..1 number — how large the eye occupies the face vertically. Chibi/anime often 0.25–0.40, realistic 0.10–0.15.
  - limbProportions: a short description (e.g. "short stubby limbs, oversized paws", "elongated graceful").
- featureEmphasis[]: 1–5 named features that are oversized or specially rendered (e.g. ["eyes", "paws", "ear-tufts", "tail"]). These are the SIGNATURE traits.
- expression: 1 short phrase (e.g. "soft warm friendly", "neutral observant", "intense focused").
- pose: 1 short phrase (e.g. "front-facing sitting", "three-quarter standing", "dynamic action").
- shadingApproach: one of cel-shaded | soft-cel-shaded-with-painterly-falloff | painterly-rendered | flat-vector | rim-light-only | lineless-painterly | photoreal. Be specific.
- lineTreatment: lineless | thin-contour | thick-ink | sketchy | mixed.
- silhouetteStyle: 1 short phrase (e.g. "rounded-compact", "elongated-graceful", "angular-mecha").
- distinctiveDetails[]: 2–6 specific visual details that define this character's rendering (e.g. "perfectly circular highlights in the eyes", "white whiskers rendered as fine bright strokes", "tabby stripe pattern with broken edges", "pink triangular nose with subtle highlight").
- transferGuidance: 1–3 sentences on how to apply this character-design language to UNRELATED subjects (e.g. a dog, a fox) so they share the same design DNA while remaining their own species.

Do NOT describe the species or breed of the subject as part of the design (cat / kitten is content, not design). Describe HOW the subject is drawn, not WHAT the subject is.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        archetype: { type: 'string' },
        proportions: {
            type: 'object',
            properties: {
                headToBody: { type: 'string' },
                eyeToFace: { type: 'number' },
                limbProportions: { type: 'string' },
            },
            required: ['headToBody', 'eyeToFace', 'limbProportions'],
            additionalProperties: false,
        },
        featureEmphasis: { type: 'array', items: { type: 'string' } },
        expression: { type: 'string' },
        pose: { type: 'string' },
        shadingApproach: { type: 'string' },
        lineTreatment: { type: 'string' },
        silhouetteStyle: { type: 'string' },
        distinctiveDetails: { type: 'array', items: { type: 'string' } },
        transferGuidance: { type: 'string' },
    },
    required: ['archetype', 'proportions', 'featureEmphasis', 'expression', 'pose', 'shadingApproach', 'lineTreatment', 'silhouetteStyle', 'distinctiveDetails', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: FeatureExtractor = {
    axis: 'character-design',
    displayName: 'Character design',
    description: 'Captures the rendering-of-the-subject as a first-class signature: archetype, proportions, feature emphasis (oversized eyes etc.), shading approach, line treatment, and transfer guidance to unrelated subjects.',
    minDominance: 0.3,
    applicableTo: (scene) => {
        return scene.references.some((r) => r.subjects.length > 0)
    },
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
