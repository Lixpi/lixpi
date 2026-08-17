'use strict'

import NATS_Service from '@lixpi/nats-service'
import type { AxisExtraction, SceneAssessment } from '../types.ts'

import { callStructuredVlm, type VlmJsonSchema } from '../../../../llm/structured-vlm/structured-vlm-client.ts'
import type { ChatMessage } from '../../../../llm/graph/state.ts'
import type { StyleExtractionState, StyleExtractor, StageLogger } from '../types.ts'

// Returns a user-message array attaching the scene-assessment summary as text
// and every reference image as an input_image block. The VLM client resolves
// nats-obj:// URLs to base64 internally and converts per provider.
export const buildExtractorMessages = (state: StyleExtractionState, scene: SceneAssessment): ChatMessage[] => {
    const blocks: Array<Record<string, any>> = []

    const intent = state.input.intent ?? '(none — extract the dominant traits)'
    blocks.push({
        type: 'input_text',
        text: [
            `User intent: ${intent}`,
            '',
            `Scene assessment (from the upstream router): ${JSON.stringify(scene, null, 2)}`,
            '',
            'Analyze the reference image(s) attached below. Populate every field in your structured response with concrete observations. Do not invent details that are not visible. If a field genuinely does not apply, write a short rationale explaining why and leave the field empty (empty string or empty array), but populate everything else exhaustively.',
        ].join('\n'),
    })

    for (const ref of state.references) {
        blocks.push({ type: 'input_image', image_url: ref.url })
    }

    return [{ role: 'user', content: blocks }]
}

export type AxisVlmResponse<T = Record<string, any>> = {
    fields: T
    rationale: string
}

// Each per-axis extractor wraps a focused VLM call with this schema envelope.
// The "fields" object is the axis-specific structured output; "rationale" is
// the model's brief justification.
export const wrapAxisSchema = (axis: string, description: string, fieldsSchema: Record<string, any>): VlmJsonSchema => ({
    name: `extract_${axis.replace(/[^a-z0-9]/gi, '_')}`,
    description,
    schema: {
        type: 'object',
        properties: {
            fields: fieldsSchema,
            rationale: {
                type: 'string',
                description: 'A 1–3 sentence justification grounded in concrete observations of the reference. Cite specific visual evidence.',
            },
        },
        required: ['fields', 'rationale'],
        additionalProperties: false,
    },
})

export const runAxisVlm = async <T = Record<string, any>>(args: {
    extractor: StyleExtractor
    state: StyleExtractionState
    scene: SceneAssessment
    systemPrompt: string
    fieldsSchema: Record<string, any>
    logger: StageLogger
}): Promise<AxisExtraction> => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service not initialized')

    const schema = wrapAxisSchema(args.extractor.axis, args.extractor.description, args.fieldsSchema)
    const messages = buildExtractorMessages(args.state, args.scene)

    const result = await callStructuredVlm<AxisVlmResponse<T>>({
        provider: args.state.input.analysisProvider,
        modelVersion: args.state.input.analysisModel.modelVersion,
        inferenceCapabilities: args.state.input.analysisModel.inferenceCapabilities,
        systemPrompt: args.systemPrompt,
        userMessages: messages,
        schema,
        natsService,
        temperature: 0.2,
        maxTokens: args.state.input.analysisModel.maxCompletionSize ?? 4096,
        maxOutputTokensCeiling: args.state.input.analysisModel.maxCompletionSize,
    })

    return {
        axis: args.extractor.axis,
        dominance: args.scene.axisDominance[args.extractor.axis] ?? 0,
        fields: (result.parsed?.fields ?? {}) as Record<string, any>,
        rationale: result.parsed?.rationale ?? '',
    }
}
