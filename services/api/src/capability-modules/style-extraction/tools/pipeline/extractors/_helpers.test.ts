'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    callStructuredVlm: vi.fn(),
    natsInstance: { connectionId: 'nats-1' } as any,
}))

vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: () => mocks.natsInstance },
}))
vi.mock('../../../../../llm/structured-vlm/structured-vlm-client.ts', () => ({
    callStructuredVlm: mocks.callStructuredVlm,
}))

import { buildExtractorMessages, runAxisVlm, wrapAxisSchema } from './_helpers.ts'
import type { SceneAssessment, StyleExtractionState } from '../types.ts'

function makeScene(overrides: Partial<SceneAssessment> = {}): SceneAssessment {
    return {
        references: [],
        medium: 'digital-illustration',
        axisDominance: { mood: 0.8 } as SceneAssessment['axisDominance'],
        intentResolution: { proposedCategory: 'illustration-style' },
        notes: 'Do not invent traditional media.',
        ...overrides,
    }
}

function makeState(overrides: Partial<StyleExtractionState> = {}): StyleExtractionState {
    return {
        input: {
            intent: 'gritty texture',
            analysisProvider: 'OpenAI',
            analysisModel: { provider: 'OpenAI', model: 'gpt-5', modelVersion: 'gpt-5', maxCompletionSize: 4096 },
        },
        references: [{ url: 'nats-obj://bucket/object-1' }, { url: 'nats-obj://bucket/object-2' }],
        ...overrides,
    } as StyleExtractionState
}

describe('buildExtractorMessages', () => {
    it('attaches the scene assessment and every reference image as blocks on one user message', () => {
        const scene = makeScene()
        const state = makeState()

        const messages = buildExtractorMessages(state, scene)

        expect(messages).toHaveLength(1)
        expect(messages[0]!.role).toBe('user')
        const content = messages[0]!.content as Array<Record<string, unknown>>
        expect(content[0]).toMatchObject({ type: 'input_text' })
        expect((content[0] as { text: string }).text).toContain('User intent: gritty texture')
        expect((content[0] as { text: string }).text).toContain(JSON.stringify(scene, null, 2))
        expect(content.slice(1)).toEqual([
            { type: 'input_image', image_url: 'nats-obj://bucket/object-1' },
            { type: 'input_image', image_url: 'nats-obj://bucket/object-2' },
        ])
    })

    it('substitutes a placeholder when no user intent was provided', () => {
        const state = makeState({ input: { ...makeState().input, intent: undefined } })

        const messages = buildExtractorMessages(state, makeScene())

        const content = messages[0]!.content as Array<{ text?: string }>
        expect(content[0]!.text).toContain('User intent: (none — extract the dominant traits)')
    })

    it('includes no image blocks when there are no references', () => {
        const state = makeState({ references: [] })

        const messages = buildExtractorMessages(state, makeScene())

        expect(messages[0]!.content).toHaveLength(1)
    })
})

describe('wrapAxisSchema', () => {
    it('names the schema from the sanitized axis and requires fields + rationale', () => {
        const schema = wrapAxisSchema('mood/tone', 'Mood and tone axis', { type: 'object', properties: {} })

        expect(schema.name).toBe('extract_mood_tone')
        expect(schema.schema).toMatchObject({
            type: 'object',
            required: ['fields', 'rationale'],
            additionalProperties: false,
        })
        expect((schema.schema.properties as any).fields).toEqual({ type: 'object', properties: {} })
    })

    it('strips every non-alphanumeric character from the axis name', () => {
        const schema = wrapAxisSchema('Edge Treatment!!', 'desc', {})
        expect(schema.name).toBe('extract_Edge_Treatment__')
    })
})

describe('runAxisVlm', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.callStructuredVlm.mockResolvedValue({
            parsed: { fields: { grain: 'coarse' }, rationale: 'visible fibrous texture' },
        })
    })

    it('calls the structured VLM with the axis schema and returns a populated AxisExtraction', async () => {
        const state = makeState()
        const scene = makeScene({ axisDominance: { 'surface-texture': 0.6 } as SceneAssessment['axisDominance'] })

        const result = await runAxisVlm({
            extractor: { axis: 'surface-texture', description: 'Surface texture axis' } as any,
            state,
            scene,
            systemPrompt: 'You extract surface texture.',
            fieldsSchema: { type: 'object', properties: {} },
            logger: {} as any,
        })

        expect(mocks.callStructuredVlm).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'OpenAI',
            modelVersion: 'gpt-5',
            systemPrompt: 'You extract surface texture.',
            temperature: 0.2,
            maxTokens: 4096,
        }))
        expect(result).toEqual({
            axis: 'surface-texture',
            dominance: 0.6,
            fields: { grain: 'coarse' },
            rationale: 'visible fibrous texture',
        })
    })

    it('defaults dominance to 0 when the axis is absent from scene.axisDominance', async () => {
        const result = await runAxisVlm({
            extractor: { axis: 'missing-axis', description: 'desc' } as any,
            state: makeState(),
            scene: makeScene({ axisDominance: {} as SceneAssessment['axisDominance'] }),
            systemPrompt: 'prompt',
            fieldsSchema: {},
            logger: {} as any,
        })

        expect(result.dominance).toBe(0)
    })

    it('falls back to empty fields and rationale when the VLM returns no parsed payload', async () => {
        mocks.callStructuredVlm.mockResolvedValue({ parsed: undefined })

        const result = await runAxisVlm({
            extractor: { axis: 'mood', description: 'desc' } as any,
            state: makeState(),
            scene: makeScene(),
            systemPrompt: 'prompt',
            fieldsSchema: {},
            logger: {} as any,
        })

        expect(result.fields).toEqual({})
        expect(result.rationale).toBe('')
    })

    it('falls back to the default max completion size when the model omits one', async () => {
        const state = makeState({
            input: {
                ...makeState().input,
                analysisModel: { provider: 'OpenAI', model: 'gpt-5', modelVersion: 'gpt-5' },
            },
        } as any)

        await runAxisVlm({
            extractor: { axis: 'mood', description: 'desc' } as any,
            state,
            scene: makeScene(),
            systemPrompt: 'prompt',
            fieldsSchema: {},
            logger: {} as any,
        })

        expect(mocks.callStructuredVlm).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 4096 }))
    })
})
