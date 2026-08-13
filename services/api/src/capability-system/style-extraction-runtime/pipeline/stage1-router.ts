'use strict'

import NATS_Service from '@lixpi/nats-service'
import type { SceneAssessment } from './types.ts'

import { callStructuredVlm, type VlmJsonSchema } from '../../../llm/structured-vlm/structured-vlm-client.ts'
import { getExtractors } from './extractors/registry.ts'
import type { ChatMessage } from '../../../llm/graph/state.ts'
import type { StyleExtractionDependencies, StyleExtractionState, StageLogger } from './types.ts'

const SYSTEM_PROMPT = `You are a senior visual-analysis router. Inspect the attached reference image(s) and produce a structured scene assessment for downstream specialist extractors.

Remain content- and medium-neutral. Do not default to a familiar subject, medium, style, mood, or category. Every claim must be grounded in visible pixel evidence. Use a medium or technique term only when visible process signatures support it, and describe those signatures without introducing stock examples.

You must produce these structured sections:

1. **references[]** — for every input image in supplied order:
   - **subjects[]** — every distinct visible subject, each with a normalized bbox [x0, y0, x1, y1], a salience rank, and a one-line description limited to distinctive visible rendering details.
   - **regions[]** — non-subject regions worth capturing, with normalized bboxes and evidence-grounded descriptions.

2. **medium** — commit to one precise medium classification based only on observable production signatures. Distinguish physical, digital, photographic, rendered, and mixed processes from evidence rather than resemblance or subject matter.

3. **axisDominance** — for every registered axis, provide a 0..1 score expressing how strongly the reference expresses that axis. Score every axis; do not omit any. The endpoints mean absent and signature-defining.

4. **intentResolution** — use the user intent to decide whether a category or axis restriction is explicit. Preserve explicit category wording, use registered axis ids, and otherwise leave forced fields empty while proposing a category derived from the dominant axes.

5. **notes** — two to five concrete observations for synthesis. Include source-derived negative constraints only when they prevent a conflicting interpretation. Never add a stock prohibition list.

Do not reach for category defaults. Commit to the medium and dominance scores from pixel evidence, not from subject, mood, familiarity, or superficial resemblance.`

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
                                    label: { type: 'string', description: 'Short label derived only from the visible subject.' },
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

const buildUserMessages = (state: StyleExtractionState): ChatMessage[] => {
    const blocks: Array<Record<string, any>> = []
    const intent = state.input.intent ?? '(none — extract the dominant traits of the reference)'
    const refsList = state.references.map((r, idx) => `  - ${r.imageRef ?? `input-${idx}`}: image attached below`).join('\n')

    blocks.push({
        type: 'input_text',
        text: [
            'You are routing a style-extraction run.',
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

export const runRouter = async (state: StyleExtractionState, logger: StageLogger, _deps: StyleExtractionDependencies): Promise<Partial<StyleExtractionState>> => {
    return await logger.span('router', state.input.analysisModel.modelVersion, async () => {
        const natsService = NATS_Service.getInstance()
        if (!natsService) throw new Error('NATS service not initialized')

        const schema = buildRouterSchema()
        const messages = buildUserMessages(state)

        const result = await callStructuredVlm<SceneAssessment>({
            provider: state.input.analysisProvider,
            modelVersion: state.input.analysisModel.modelVersion,
            inferenceCapabilities: state.input.analysisModel.inferenceCapabilities,
            systemPrompt: SYSTEM_PROMPT,
            userMessages: messages,
            schema,
            natsService,
            temperature: 0.2,
            maxTokens: state.input.analysisModel.maxCompletionSize ?? 4096,
            maxOutputTokensCeiling: state.input.analysisModel.maxCompletionSize,
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
