'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

// The MediumSignatureExtractor is the structural fix for the v0 "digital labeled
// watercolor" bug. It is run with a focused prompt that forces the model to commit
// to a medium classification grounded in concrete artifacts (clean anti-aliased
// edges vs paper-tooth granulation, gradient-tool falloff vs wet-on-wet bleed,
// etc.) and to enumerate the specific technique signatures present.
const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on identifying the medium and technique signature of the attached reference. Your sole job is to decide what physical or digital medium the work appears to be made in, and to enumerate the concrete artifacts that justify that classification.

Rules:
- Look for OBJECTIVE evidence, not stylistic vibes:
  - Digital evidence: clean anti-aliased edges, perfect smooth gradients, identical / mirrored details, soft-airbrush radial falloff, vector-clean shapes, layer-uniform opacity, undegraded color across the canvas, perfectly symmetric reflections, render-engine quality.
  - Traditional-media evidence: paper-tooth granulation visible in mid-values, deckle-edge borders, wet-on-wet bleeding, dry-brush broken strokes, charcoal smudge halos, oil-paint impasto ridges, pencil-graphite sheen, ink-pooled corners.
- Classify the medium with one of: digital-illustration, digital-painting, cel-shaded-3d, photoreal-3d, traditional-watercolor, gouache, oil-painting, acrylic, pencil-drawing, ink-drawing, charcoal, mixed-media, photograph, vector, comic-print.
- If you classify as digital, the "traditionalArtifacts" list should be empty OR contain only intentional digital imitations of traditional media (e.g. "digital airbrush imitating soft watercolor pooling, but with clean edges and no paper grain").
- If you classify as traditional, the "digitalArtifacts" list should be empty OR contain incidental digital post-processing (e.g. "digital scan with adjusted contrast").
- techniqueSignatures[]: the specific named techniques visible (e.g. "cel-shading", "soft-painterly-edges", "glazing", "dry-brush", "ink-line-with-color-fill", "lineless-painterly", "rim-light-only", "halftone-shading").
- softwareGuess[]: 0–3 plausible tools (e.g. "Procreate", "Photoshop", "Blender", "traditional watercolor on cold-press", "ink + digital color"). If uncertain, leave empty.
- mediumConfidence: 0..1 — how confident you are.
- mediumMismatchWarning: 1 sentence ONLY IF this medium classification CONTRADICTS the upstream router's classification — explain which evidence forced the override.

Do NOT use the word "watercolor" unless paper tooth and / or wash bleeding is concretely visible. A clean digital illustration with painterly-looking soft edges is digital, not watercolor.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        medium: { type: 'string' },
        mediumConfidence: { type: 'number', description: '0..1' },
        techniqueSignatures: { type: 'array', items: { type: 'string' } },
        softwareGuess: { type: 'array', items: { type: 'string' } },
        digitalArtifacts: { type: 'array', items: { type: 'string' } },
        traditionalArtifacts: { type: 'array', items: { type: 'string' } },
        mediumMismatchWarning: { type: 'string', description: 'empty string if no mismatch with the router; 1 sentence otherwise' },
    },
    required: ['medium', 'mediumConfidence', 'techniqueSignatures', 'softwareGuess', 'digitalArtifacts', 'traditionalArtifacts', 'mediumMismatchWarning'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'medium-signature',
    displayName: 'Medium signature',
    description: 'Classifies the medium (digital-illustration, watercolor, oil, photograph, etc.) and enumerates the concrete technique signatures and artifacts that justify the classification. Cross-checks the router\'s medium claim.',
    minDominance: 0.0,
    applicableTo: () => true,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
