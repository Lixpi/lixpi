import NATS_Service from '@lixpi/nats-service'
import {
    type StyleDraft,
    type StyleExtractionDependencies,
    type StyleExtractionState,
    type StageLogger,
} from './types.ts'

import {
    callStructuredVlm,
    type VlmJsonSchema,
} from '../../../llm/structured-vlm/structured-vlm-client.ts'
import {
    type ChatMessage,
} from '../../../llm/graph/state.ts'

const SYSTEM_PROMPT = `You are a senior visual-style SYNTHESIZER. You receive a structured scene assessment from a media-neutral router plus a set of per-axis extractions from specialist axis extractors. Your sole job is to synthesize a single coherent Style definition that captures the reference's actually-distinctive traits — weighted proportionally to each axis's dominance.

Rules:
1. **Dominance-weighted structure.** Axes with dominance >= 0.8 are signature axes and get dedicated top-level sections in the markdown instructions. Axes with dominance 0.5–0.8 get short sections. Axes with dominance 0.3–0.5 get a single sentence. Axes with dominance < 0.3 are absent from instructions but their extractor outputs (if present) stay in parameters.

2. **Category.** Use a non-empty forced category verbatim. Otherwise derive a concise reusable category from the highest-dominance registered axis or axis group. Do not select a category from subject content or a stock aesthetic association.

3. **Name.** Produce a kebab-case name of at most eight words derived only from observed dominant traits and the evidence-supported medium. Do not include source subject identity or stock aesthetic tropes.

4. **Summary.** Write one sentence naming the dominant observed traits and any evidence-required medium distinction without introducing a comparison that was absent from the analysis.

5. **Tags.** Produce six to twelve short tags derived from concrete dominant-axis observations. Exclude source content and any interpretation rejected by the router or medium-signature extractor.

6. **Instructions (markdown).**
   - **First section is "## DO NOT"** — include only constraints derived from observed evidence or explicit router negatives. Never populate it from a fixed list.
   - Then "## Application notes" with a brief intro.
   - Then add dominance-weighted sections per axis. Each section names the registered axis, states its dominance class and score, describes transferable traits, and gives concise application guidance for unrelated requested content.
   - Tone: imperative, concrete, transferable. Write for another LLM to follow.
   - Length: proportional to the supported axes and evidence. Do not pad with unsupported detail.

7. **Parameters.** A nested JSON object with:
   - **axisDominance** — copy of the router's dominance map.
   - **sceneAssessment** — copy of the router's full assessment (for downstream consumers).
   - One nested block per axis that was extracted. Each block has the axis's full extracted "fields" object plus its dominance and rationale.

8. **recommendedSampleSubjects.** Return one to three content-neutral probes appropriate to the dominant axes. Prompts must describe only the minimum abstract form, spatial arrangement, or non-semantic surface needed to reveal those axes. They must not name a real-world entity, character type, source subject, setting, narrative, brand, or text content. Each entry has kind, a short prompt, aspectRatio, and a one-sentence rationale.

The synthesis must not misrepresent the medium. The evidence-supported medium classification is authoritative, and technique language must remain consistent with its observed signatures.`

const buildSynthesisSchema = (): VlmJsonSchema => ({
    name: 'synthesize_style',
    description: 'Synthesize a single coherent Style definition from per-axis extractions, weighted by router dominance scores.',
    // `parameters` is intentionally open-ended (dynamic per-axis keys via additionalProperties),
    // which OpenAI strict structured output forbids — opt this schema out of strict mode.
    strict: false,
    schema: {
        type: 'object',
        properties: {
            category: { type: 'string' },
            name: {
                type: 'string',
                description: 'kebab-case style name, max 8 words',
            },
            summary: {
                type: 'string',
                description: 'one sentence naming dominant traits with explicit negatives',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
            },
            instructions: {
                type: 'string',
                description: 'markdown body; first section is "## DO NOT", then "## Application notes", then dominance-weighted per-axis sections',
            },
            parameters: {
                type: 'object',
                description: 'Nested per-axis JSON. Properties: axisDominance, sceneAssessment, and one block per extracted axis.',
                properties: {
                    axisDominance: {
                        type: 'object',
                        additionalProperties: { type: 'number' },
                    },
                    sceneAssessment: {
                        type: 'object',
                        additionalProperties: true,
                    },
                    axes: {
                        type: 'object',
                        additionalProperties: true,
                        description: 'one entry per extracted axis with its full fields + dominance + rationale',
                    },
                },
                required: ['axisDominance', 'sceneAssessment', 'axes'],
                additionalProperties: true,
            },
            recommendedSampleSubjects: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        kind: {
                            type: 'string',
                            description: 'palette-board | texture-specimen | applied-medium-probe',
                        },
                        prompt: { type: 'string' },
                        aspectRatio: {
                            type: 'string',
                            description: 'Positive integer width and height joined by x.',
                        },
                        rationale: { type: 'string' },
                    },
                    required: ['kind', 'prompt', 'aspectRatio', 'rationale'],
                    additionalProperties: false,
                },
            },
        },
        required: ['category', 'name', 'summary', 'tags', 'instructions', 'parameters', 'recommendedSampleSubjects'],
        additionalProperties: false,
    },
})

const buildSynthesisUserMessages = (state: StyleExtractionState): ChatMessage[] => {
    const scene = state.sceneAssessment
    const axesPayload: Record<string, any> = {}

    for (const [axis, extraction] of Object.entries(state.axisExtractions)) {
        axesPayload[axis] = extraction
    }

    const intent = state.input.intent ?? '(none — synthesize the dominant-axis style)'
    const failedSummary = state.failedAxes.length === 0 ? 'none' : state.failedAxes.map(f => `${f.axis}: ${f.error}`).join('; ')

    const text = [
        `User intent: ${intent}`,
        '',
        '## Router scene assessment',
        JSON.stringify(
            scene,
            null,
            2,
        ),
        '',
        '## Axis extractions (succeeded)',
        JSON.stringify(
            axesPayload,
            null,
            2,
        ),
        '',
        `## Failed axes: ${failedSummary}`,
        '',
        'Synthesize the Style definition per your system instructions. Weight axes by dominance. Honor the router\'s medium classification. Include the mandatory "## DO NOT" section.',
    ].join('\n')

    return [{
        role: 'user',
        content: text,
    }]
}

export const synthesizeStyle = async (
    state: StyleExtractionState,
    logger: StageLogger,
    _deps: StyleExtractionDependencies,
): Promise<Partial<StyleExtractionState>> => {
    return await logger.span(
        'synthesis',
        state.input.analysisModel.modelVersion,
        async () => {
            const natsService = NATS_Service.getInstance()

            if (!natsService)
                throw new Error('NATS service not initialized')

            const schema = buildSynthesisSchema()
            const messages = buildSynthesisUserMessages(state)
    
            const result = await callStructuredVlm<StyleDraft>({
                provider: state.input.analysisProvider,
                modelVersion: state.input.analysisModel.modelVersion,
                inferenceCapabilities: state.input.analysisModel.inferenceCapabilities,
                systemPrompt: SYSTEM_PROMPT,
                userMessages: messages,
                schema,
                natsService,
                temperature: 0.3,
                maxTokens: state.input.analysisModel.maxCompletionSize ?? 8192,
                maxOutputTokensCeiling: state.input.analysisModel.maxCompletionSize,
                enableThinking: state.input.analysisProvider === 'Anthropic',
                thinkingBudgetTokens: 6144,
                onTextChunk: text => logger.chunk(text),
            })

            return { draft: result.parsed }
        },
        {
            inputSummary: `extractedAxes=${Object.keys(state.axisExtractions).length} failedAxes=${state.failedAxes.length} sourceCrops=${state.sourceCrops.length}`,
            outputSummarizer: result =>
                `category=${result.draft?.category} name=${result.draft?.name} sampleSubjects=${result.draft?.recommendedSampleSubjects.length ?? 0}`,
            promptPreview: SYSTEM_PROMPT,
        },
    )
}
