'use strict'

import NATS_Service from '@lixpi/nats-service'
import type { SceneAssessment } from '@lixpi/constants'

import { callStructuredVlm, type VlmJsonSchema } from './vlm-client.ts'
import { getExtractors } from './extractors/registry.ts'
import type { ChatMessage } from '../graph/state.ts'
import type { ExtractionDeps, ExtractionState, StageLogger } from './types.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis ROUTER. Your sole job is to look at the attached reference image(s) and produce a structured scene assessment that downstream specialist extractors will use.

You are MEDIA-NEUTRAL. You do not default to any familiar category. You observe what is concretely present and commit to claims grounded in pixel evidence. You DO NOT use terminology associated with traditional media (watercolor, paper tooth, dry-brush, wash, deckle, granulation, glaze, impasto, etc.) UNLESS such traits are CONCRETELY VISIBLE — and if they are, you cite the specific artifact that proves it (e.g. "visible irregular granulation in mid-values consistent with cold-press watercolor paper", not "soft watercolor look").

You must produce three things:

1. **references[]** — for every input image (input-0, input-1, …):
   - **subjects[]** — every distinct subject in the frame, each with a normalized bbox [x0, y0, x1, y1] in 0..1 coordinates, a salience rank (1 = primary, 2 = secondary, …), and a one-line description that names the distinctive rendering details (e.g. "round chibi-style orange tabby kitten, front-facing, OVERSIZED green eyes with glossy circular highlights, soft cel-shaded fur with painterly falloff, distinct tabby stripe pattern").
   - **regions[]** — non-subject regions worth capturing (background, frame, foreground, etc.) with bboxes and descriptions.

2. **medium** — commit to a SINGLE medium classification. Allowed values include: digital-illustration, digital-painting, cel-shaded-3d, photoreal-3d, traditional-watercolor, gouache, oil-painting, acrylic, pencil-drawing, ink-drawing, charcoal, mixed-media, photograph, vector, comic-print. Other values are allowed if precise.

   Decide based on OBJECTIVE evidence:
   - Digital: clean anti-aliased edges, perfect gradient falloff, uniform fill quality, soft-airbrush radial falloff, layer-flat opacity, no medium-physical artifacts.
   - Traditional: paper-tooth granulation in mid-values, deckle-edge borders, wet-on-wet bleed, dry-brush broken strokes, oil-paint ridges, pencil-graphite sheen.
   - If you see a digital painting that LOOKS soft, the medium is digital-illustration or digital-painting — NOT watercolor.

3. **axisDominance** — for EACH of the axes listed below (the system will substitute the registered list), provide a 0..1 score expressing how strongly the reference EXPRESSES that axis. Score every axis; do not omit any. 0 means "this axis is essentially absent or irrelevant for this reference"; 1 means "this axis is the signature of the work."

4. **intentResolution** — given the user intent string, decide whether to force a specific feature category and / or restrict to specific axes. If the user wrote "save the palette", set forcedCategory="color-palette" and forcedAxes=["palette"]. If no intent, set both to empty string / empty array and write a proposedCategory describing the dominant axis grouping (e.g. "illustration-style", "color-palette", "character-design", "mood", "composition-rule").

5. **notes** — 2–5 sentences with concrete observations the synthesis stage will rely on. Include explicit DO NOTs that the synthesis must respect (e.g. "this is digital — DO NOT add paper tooth, dry-brush, deckle edges, or wash bleeds in the application notes"). Always include a DO-NOT line if the medium classification implies anti-defaults.

CRITICAL: Do not reach for category defaults. A cute pastel children's illustration is NOT automatically "watercolor". A glossy 3D render is NOT automatically "anime". Commit to the medium and dominance scores based on pixel evidence, not on what the work superficially resembles.`

const buildAxisDominanceSchema = (): Record<string, any> => {
    const axes = getExtractors().map((e) => ({ axis: e.axis, displayName: e.displayName, description: e.description }))
    const properties: Record<string, any> = {}
    for (const a of axes) {
        properties[a.axis] = {
            type: 'number',
            description: `0..1 dominance score for ${a.displayName}. ${a.description}`,
        }
    }
    return {
        type: 'object',
        properties,
        required: axes.map((a) => a.axis),
        additionalProperties: false,
    }
}

const buildRouterSchema = (): VlmJsonSchema => ({
    name: 'scene_assessment',
    description: 'Structured scene assessment of the reference image(s). Identifies subjects, regions, medium, and per-axis dominance scores.',
    schema: {
        type: 'object',
        properties: {
            references: {
                type: 'array',
                description: 'One entry per input image, in input-0, input-1, … order.',
                items: {
                    type: 'object',
                    properties: {
                        imageRef: { type: 'string', description: 'input-0 | input-1 | input-2 | …' },
                        subjects: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    label: { type: 'string', description: 'short label like "kitten", "vase", "figure"' },
                                    bbox: {
                                        type: 'array',
                                        description: 'normalized [x0, y0, x1, y1] in 0..1 coordinates',
                                        items: { type: 'number' },
                                    },
                                    salience: { type: 'integer', description: '1 = primary subject, 2 = secondary, …' },
                                    description: { type: 'string', description: 'concrete description, naming distinctive rendering details' },
                                },
                                required: ['label', 'bbox', 'salience', 'description'],
                                additionalProperties: false,
                            },
                        },
                        regions: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    label: { type: 'string' },
                                    bbox: {
                                        type: 'array',
                                        items: { type: 'number' },
                                    },
                                    description: { type: 'string' },
                                },
                                required: ['label', 'bbox', 'description'],
                                additionalProperties: false,
                            },
                        },
                    },
                    required: ['imageRef', 'subjects', 'regions'],
                    additionalProperties: false,
                },
            },
            medium: { type: 'string' },
            axisDominance: buildAxisDominanceSchema(),
            intentResolution: {
                type: 'object',
                properties: {
                    forcedCategory: { type: 'string', description: 'empty string if no forced category, otherwise the user-meaningful category name' },
                    forcedAxes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'empty array if no forced axes',
                    },
                    proposedCategory: { type: 'string' },
                },
                required: ['forcedCategory', 'forcedAxes', 'proposedCategory'],
                additionalProperties: false,
            },
            notes: { type: 'string' },
        },
        required: ['references', 'medium', 'axisDominance', 'intentResolution', 'notes'],
        additionalProperties: false,
    },
})

const buildUserMessages = (state: ExtractionState): ChatMessage[] => {
    const blocks: Array<Record<string, any>> = []
    const intent = state.input.intent ?? '(none — extract the dominant traits of the reference)'
    const refsList = state.references.map((r, idx) => `  - ${r.imageRef ?? `input-${idx}`}: image attached below`).join('\n')

    blocks.push({
        type: 'input_text',
        text: [
            'You are routing a feature-extraction run.',
            '',
            `User intent: ${intent}`,
            '',
            `Reference images (in this order):`,
            refsList || '  (no images attached)',
            '',
            'Produce the structured scene assessment per your system instructions. Be concrete; do not reach for category defaults. Score every axis.',
        ].join('\n'),
    })

    for (const ref of state.references) {
        blocks.push({ type: 'input_image', image_url: ref.url })
    }

    return [{ role: 'user', content: blocks }]
}

const summarizeAssessment = (a: SceneAssessment): string => {
    const topAxes = Object.entries(a.axisDominance)
        .sort(([, av], [, bv]) => (bv as number) - (av as number))
        .slice(0, 5)
        .map(([k, v]) => `${k}:${(v as number).toFixed(2)}`)
        .join(' ')
    return `medium=${a.medium} topAxes=[${topAxes}] subjects=${a.references.reduce((sum, r) => sum + r.subjects.length, 0)}`
}

export const runRouter = async (state: ExtractionState, logger: StageLogger, _deps: ExtractionDeps): Promise<Partial<ExtractionState>> => {
    return await logger.span('router', state.input.analysisModel.modelVersion, async () => {
        const natsService = NATS_Service.getInstance()
        if (!natsService) throw new Error('NATS service not initialized')

        const schema = buildRouterSchema()
        const messages = buildUserMessages(state)

        const result = await callStructuredVlm<SceneAssessment>({
            provider: state.input.analysisProvider,
            modelVersion: state.input.analysisModel.modelVersion,
            systemPrompt: SYSTEM_PROMPT,
            userMessages: messages,
            schema,
            natsService,
            temperature: 0.2,
            maxTokens: state.input.analysisModel.maxCompletionSize ?? 4096,
            enableThinking: state.input.analysisProvider === 'Anthropic',
            thinkingBudgetTokens: 4096,
            onTextChunk: (text) => logger.chunk(text),
        })

        // Trust the router's output shape; we asked for it strictly.
        const assessment = result.parsed
        return { sceneAssessment: assessment }
    }, {
        inputSummary: `references=${state.references.length} intent=${JSON.stringify(state.input.intent ?? '')}`,
        outputSummarizer: (result) => result.sceneAssessment ? summarizeAssessment(result.sceneAssessment) : 'no assessment',
        promptPreview: SYSTEM_PROMPT,
    })
}
