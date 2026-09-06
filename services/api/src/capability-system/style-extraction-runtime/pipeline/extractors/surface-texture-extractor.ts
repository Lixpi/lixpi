import {
    type StyleExtractor,
} from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on SURFACE TEXTURE: substrate, grain, mark morphology, edge behavior, density, scale, repeatability, application guidance.

Only describe texture artifacts that are concretely visible. When no substrate or mark texture is visible, state absence directly and keep unsupported fields empty or absence-marked. Do not infer medium from the absence of texture.

Rules when texture IS present:
- baseSurface: describe only the visible substrate or explicitly state that none is visible. Distinguish simulated and physical texture only when evidence supports it.
- grain: a short description of visible granularity and its scale or value-range behavior.
- markPattern: describe the visible morphology and repetition of marks without naming unobserved tools.
- edgeBehavior: describe how marks visibly terminate at form boundaries.
- density: a short relational description of coverage and layering.
- scale: an image-relative or pixel-equivalent estimate of mark size.
- repeatability: state whether the observed texture could repeat without obvious seams and explain uncertainty when needed.
- applicationGuidance: 2–3 sentences on how to apply this surface texture to a new subject — how it should appear on the subject's body, not just as a backdrop.
- avoid: one to four source-derived visual conditions that would falsify the observed texture; never use a stock list.`

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
        avoid: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: ['baseSurface', 'grain', 'markPattern', 'edgeBehavior', 'density', 'scale', 'repeatability', 'applicationGuidance', 'avoid'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'surface-texture',
    displayName: 'Surface texture',
    description: 'Extracts surface texture only when visibly present: substrate, grain, mark morphology, edge behavior, density, scale, repeatability, application guidance, and a list of what to avoid.',
    minDominance: 0.3,
    applicableTo: scene => (scene.axisDominance['surface-texture'] ?? 0) >= 0.3,
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
