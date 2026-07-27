'use strict'

import type { StyleExtractor } from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on LINE QUALITY: line presence, weight, variation, color, outline behavior, and interior linework.

Rules:
- linePresence: line-less | thin-contour | thick-ink | sketchy | hatched | mixed.
- lineWeight: a short phrase (e.g. "uniform fine 1-2px equivalent", "tapered varying 0.5–4px equivalent", "heavy bold 3-6px equivalent", "no visible lines").
- lineVariation: how much line weight varies along a single stroke (none | subtle | pronounced).
- lineColor: short description of line color (e.g. "warm umber, slightly darker than midtones", "pure black", "near-subject color of darker value", "no lines").
- outlineBehavior: how the subject silhouette is bounded (no-outline | hairline-contour | broken-sketchy | full-thick-ink | painterly-implied-edge).
- interiorLines: how interior shape divisions are rendered (no-interior-lines | thin-shading-lines | crosshatched-fill | brush-pattern | line-art-shading).
- transferGuidance: 1–2 sentences on how to reproduce this line treatment on a new subject.

If the reference has no visible lines at all (lineless painterly rendering), say so explicitly in linePresence ("line-less") and write "no lines" or empty placeholders for line-specific fields, with a full transferGuidance explaining that subjects should be rendered without contour lines.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        linePresence: { type: 'string' },
        lineWeight: { type: 'string' },
        lineVariation: { type: 'string' },
        lineColor: { type: 'string' },
        outlineBehavior: { type: 'string' },
        interiorLines: { type: 'string' },
        transferGuidance: { type: 'string' },
    },
    required: ['linePresence', 'lineWeight', 'lineVariation', 'lineColor', 'outlineBehavior', 'interiorLines', 'transferGuidance'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'line-quality',
    displayName: 'Line quality',
    description: 'Extracts the line treatment: presence, weight, variation, color, outline behavior, interior linework.',
    minDominance: 0.3,
    applicableTo: (scene) => (scene.axisDominance['line-quality'] ?? 0) >= 0.3,
    extract: async ({ scene, state, logger }) =>
        runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
