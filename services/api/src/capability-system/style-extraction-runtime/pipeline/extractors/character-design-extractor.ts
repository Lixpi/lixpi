import {
    type StyleExtractor,
} from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

// Captures rendering-of-the-subject as a first-class signature. Only runs when
// the scene assessment contains visible subjects.
const SYSTEM_PROMPT = `You are a senior character-design analyst. Your sole job is to extract the rendering of subject(s) in the attached reference — anatomy, proportions, expression, feature emphasis, shading approach, line treatment, and silhouette style.

Rules:
- archetype: a short rendering-category label that excludes species, identity, occupation, and narrative content.
- proportions:
  - headToBody: an approximate visible ratio expressed as two numeric terms.
  - eyeToFace: a 0..1 estimate of visible eye height relative to visible face height; use zero when inapplicable.
  - limbProportions: a short relational description grounded in visible measurements.
- featureEmphasis[]: one to five visible features receiving unusual scale, contrast, detail, or rendering emphasis.
- expression: one short phrase grounded in visible expression; use a neutral inapplicable marker when no face is visible.
- pose: one short phrase describing only visible orientation and posture.
- shadingApproach: a precise evidence-derived description of value grouping and transition behavior.
- lineTreatment: a precise evidence-derived description of contour and interior line behavior.
- silhouetteStyle: one short relational description of the visible silhouette.
- distinctiveDetails[]: two to six transferable rendering details; exclude content identity and unobserved anatomy.
- transferGuidance: one to three sentences explaining how to apply the rendering language to unrelated requested content without copying source content.

Describe how the subject is rendered, not what the subject is. Do not place any source content label in transferable design fields.`

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
        featureEmphasis: {
            type: 'array',
            items: { type: 'string' },
        },
        expression: { type: 'string' },
        pose: { type: 'string' },
        shadingApproach: { type: 'string' },
        lineTreatment: { type: 'string' },
        silhouetteStyle: { type: 'string' },
        distinctiveDetails: {
            type: 'array',
            items: { type: 'string' },
        },
        transferGuidance: { type: 'string' },
    },
    required: ['archetype', 'proportions', 'featureEmphasis', 'expression', 'pose', 'shadingApproach', 'lineTreatment', 'silhouetteStyle', 'distinctiveDetails', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'character-design',
    displayName: 'Character design',
    description: 'Captures rendering-of-the-subject as a first-class signature: archetype, proportions, feature emphasis, shading approach, line treatment, and transfer guidance to unrelated subjects.',
    minDominance: 0.3,
    applicableTo: scene => scene.references.some(r => r.subjects.length > 0),
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
