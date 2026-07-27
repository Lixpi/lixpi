'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on SURFACE TEXTURE: substrate, grain, mark morphology, edge behavior, density, scale, repeatability, application guidance.

CRITICAL — only describe texture artifacts that are CONCRETELY VISIBLE. If the reference is a clean digital illustration with no visible substrate texture, no granulation, no broken strokes, no traditional-media artifacts, then say so explicitly: set baseSurface="clean digital — no substrate texture visible", grain="none", and write minimal-or-empty values for the other fields with a rationale noting that surface texture is essentially absent.

Rules when texture IS present:
- baseSurface: the substrate (e.g. "cold-press watercolor paper", "smooth digital canvas", "rough oil-paint canvas", "vellum"). If digital with simulated texture, say so.
- grain: short description of granulation and how it manifests (visible in mid-values? at scale?).
- markPattern: the morphology of marks (e.g. "broken dry-brush fibers along subject perimeters", "uniform soft-airbrush falloff", "stippled pointillist dots").
- edgeBehavior: how marks terminate at form boundaries (e.g. "feathered wet bleed", "clean anti-aliased", "ragged torn").
- density: short description (sparse | medium | dense | layered-translucent).
- scale: short description of mark scale (e.g. "fine 1-2px equivalent", "medium 4-8px", "large painterly 20-40px").
- repeatability: whether the texture would tile / repeat without obvious seams (yes | no | partial).
- applicationGuidance: 2–3 sentences on how to apply this surface texture to a new subject — how it should appear on the subject's body, not just as a backdrop.
- avoid: 1–4 short strings naming markers that would falsify the look (e.g. for traditional surfaces: "perfect clean gradients", "anti-aliased edges").`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        baseSurface: { type: 'string' },
        grain: { type: 'string' },
        markPattern: { type: 'string' },
        edgeBehavior: { type: 'string' },
        density: { type: 'string' },
        scale: { type: 'string' },
        repeatability: { type: 'string' },
        applicationGuidance: { type: 'string' },
        avoid: { type: 'array', items: { type: 'string' } },
    },
    required: ['baseSurface', 'grain', 'markPattern', 'edgeBehavior', 'density', 'scale', 'repeatability', 'applicationGuidance', 'avoid'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'surface-texture',
    displayName: 'Surface texture',
    description: 'Extracts surface texture only when visibly present: substrate, grain, mark morphology, edge behavior, density, scale, repeatability, application guidance, and a list of what to avoid.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['surface-texture'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
