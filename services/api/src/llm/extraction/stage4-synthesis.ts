'use strict'

import NATS_Service from '@lixpi/nats-service'
import type { FeatureDraft } from '@lixpi/constants'

import { callStructuredVlm, type VlmJsonSchema } from './vlm-client.ts'
import type { ChatMessage } from '../graph/state.ts'
import type { ExtractionDeps, ExtractionState, StageLogger } from './types.ts'

const SYSTEM_PROMPT = `You are a senior visual-feature SYNTHESIZER. You receive a structured scene assessment from a media-neutral router plus a set of per-axis extractions from specialist axis extractors. Your sole job is to synthesize a single coherent Feature definition that captures the reference's actually-distinctive traits — weighted proportionally to each axis's dominance.

Rules:
1. **Dominance-weighted structure.** Axes with dominance >= 0.8 are signature axes and get dedicated top-level sections in the markdown instructions. Axes with dominance 0.5–0.8 get short sections. Axes with dominance 0.3–0.5 get a single sentence. Axes with dominance < 0.3 are absent from instructions but their extractor outputs (if present) stay in parameters.

2. **Category.** Pick a category that reflects the dominant axis grouping:
   - If forcedCategory is non-empty in the router's intentResolution, use it verbatim.
   - Else if palette dominance is the single highest (≥ 0.8) and others are < 0.5, category = "color-palette".
   - Else if character-design dominance is highest, category = "character-design" or "illustration-style" (prefer the latter if multiple axes are strong).
   - Else if surface-texture dominance is highest, category = "surface-texture".
   - Else if mood dominance is highest, category = "mood".
   - Else if composition dominance is highest, category = "composition-rule".
   - Else, fallback to "illustration-style" or "painting-style" depending on the medium.

3. **Name.** Kebab-case derived from the dominant traits and medium. Examples: cel-shaded-chibi-cat-warm-window, dusty-sage-coral-palette, melancholy-late-autumn-mood. Maximum 8 words. Do NOT default to "loose-watercolor" or other training-prior tropes — the name must reflect what's actually distinctive.

4. **Summary.** One sentence that names the dominant traits AND, when relevant, includes an explicit negative claim like "— digital, NOT traditional watercolor".

5. **Tags.** 6–12 short tags derived from concrete dominant-axis observations. Do NOT include training-prior tropes that the router or medium-signature extractor rejected (e.g. no "watercolor" tag for a digital illustration; the medium-signature extractor's medium classification is authoritative on this).

6. **Instructions (markdown).**
   - **First section is "## DO NOT"** — enumerate training-prior tropes the system rejected, derived from the router's medium classification and the medium-signature extractor's notes. For a digital illustration, say "this is digital — DO NOT add paper tooth, dry-brush, deckle edges, wash bleeds, granulation, or any other traditional-medium artifacts." Be specific. This section is non-negotiable.
   - Then "## Application notes" with a brief intro.
   - Then dominance-weighted sections per axis. Each section names the axis (e.g. "### Character design (signature, dominance 0.95)"), describes the axis's transferable traits, and gives a 1–3 sentence transfer recipe to a new subject.
   - Tone: imperative, concrete, transferable. Write for another LLM to follow.
   - Length: 600–2500 words depending on how many strong axes there are.

7. **Parameters.** A nested JSON object with:
   - **axisDominance** — copy of the router's dominance map.
   - **sceneAssessment** — copy of the router's full assessment (for downstream consumers).
   - One nested block per axis that was extracted. Each block has the axis's full extracted "fields" object plus its dominance and rationale.

8. **recommendedSampleSubjects.** 1–3 neutral subjects that will be rendered in Stage 5 to demonstrate the feature. For palette-dominant features: { kind: "palette-board", prompt: "labeled palette swatch board" }. For character-design-dominant features: { kind: "applied-medium-probe", prompt: "a generic neutral cartoon character head, front-facing" }. For surface-texture-dominant features: { kind: "texture-specimen", prompt: "2x2 texture composite from source crops" }. Always pick neutral subjects that won't reproduce the source subject. Each entry has kind, prompt (short text), aspectRatio (default "1024x1024"), rationale (1 sentence).

Critically: the synthesized feature must NOT misrepresent the medium. If the router classified the medium as digital-illustration and the medium-signature extractor agreed, the synthesis MUST NOT describe the look as "watercolor" or "painterly traditional" — it can describe digital techniques that imitate painterly softness, but the medium label is authoritative.`

const buildSynthesisSchema = (): VlmJsonSchema => ({
    name: 'synthesize_feature',
    description: 'Synthesize a single coherent Feature definition from per-axis extractions, weighted by router dominance scores.',
    // `parameters` is intentionally open-ended (dynamic per-axis keys via additionalProperties),
    // which OpenAI strict structured output forbids — opt this schema out of strict mode.
    strict: false,
    schema: {
        type: 'object',
        properties: {
            category: { type: 'string' },
            name: { type: 'string', description: 'kebab-case feature name, max 8 words' },
            summary: { type: 'string', description: 'one sentence naming dominant traits with explicit negatives' },
            tags: { type: 'array', items: { type: 'string' } },
            instructions: { type: 'string', description: 'markdown body; first section is "## DO NOT", then "## Application notes", then dominance-weighted per-axis sections' },
            parameters: {
                type: 'object',
                description: 'Nested per-axis JSON. Properties: axisDominance, sceneAssessment, and one block per extracted axis.',
                properties: {
                    axisDominance: { type: 'object', additionalProperties: { type: 'number' } },
                    sceneAssessment: { type: 'object', additionalProperties: true },
                    axes: { type: 'object', additionalProperties: true, description: 'one entry per extracted axis with its full fields + dominance + rationale' },
                },
                required: ['axisDominance', 'sceneAssessment', 'axes'],
                additionalProperties: true,
            },
            recommendedSampleSubjects: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        kind: { type: 'string', description: 'palette-board | texture-specimen | applied-medium-probe' },
                        prompt: { type: 'string' },
                        aspectRatio: { type: 'string', description: 'e.g. 1024x1024, 1536x1024' },
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

const buildSynthesisUserMessages = (state: ExtractionState): ChatMessage[] => {
    const scene = state.sceneAssessment
    const axesPayload: Record<string, any> = {}
    for (const [axis, extraction] of Object.entries(state.axisExtractions)) {
        axesPayload[axis] = extraction
    }

    const intent = state.input.intent ?? '(none — synthesize the dominant-axis feature)'
    const failedSummary = state.failedAxes.length === 0 ? 'none' : state.failedAxes.map((f) => `${f.axis}: ${f.error}`).join('; ')

    const text = [
        `User intent: ${intent}`,
        '',
        '## Router scene assessment',
        JSON.stringify(scene, null, 2),
        '',
        '## Axis extractions (succeeded)',
        JSON.stringify(axesPayload, null, 2),
        '',
        `## Failed axes: ${failedSummary}`,
        '',
        'Synthesize the Feature definition per your system instructions. Weight axes by dominance. Honor the router\'s medium classification. Include the mandatory "## DO NOT" section.',
    ].join('\n')

    return [{ role: 'user', content: text }]
}

export const synthesizeFeature = async (state: ExtractionState, logger: StageLogger, _deps: ExtractionDeps): Promise<Partial<ExtractionState>> => {
    return await logger.span('synthesis', state.input.analysisModel.modelVersion, async () => {
        const natsService = NATS_Service.getInstance()
        if (!natsService) throw new Error('NATS service not initialized')

        const schema = buildSynthesisSchema()
        const messages = buildSynthesisUserMessages(state)

        const result = await callStructuredVlm<FeatureDraft>({
            provider: state.input.analysisProvider,
            modelVersion: state.input.analysisModel.modelVersion,
            systemPrompt: SYSTEM_PROMPT,
            userMessages: messages,
            schema,
            natsService,
            temperature: 0.3,
            maxTokens: state.input.analysisModel.maxCompletionSize ?? 8192,
            enableThinking: state.input.analysisProvider === 'Anthropic',
            thinkingBudgetTokens: 6144,
            onTextChunk: (text) => logger.chunk(text),
        })

        return { draft: result.parsed }
    }, {
        inputSummary: `extractedAxes=${Object.keys(state.axisExtractions).length} failedAxes=${state.failedAxes.length} sourceCrops=${state.sourceCrops.length}`,
        outputSummarizer: (result) => `category=${result.draft?.category} name=${result.draft?.name} sampleSubjects=${result.draft?.recommendedSampleSubjects.length ?? 0}`,
        promptPreview: SYSTEM_PROMPT,
    })
}
