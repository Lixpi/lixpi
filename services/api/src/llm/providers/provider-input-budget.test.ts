import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type CapabilityError,
} from '@lixpi/capability-system/backend'

import { assessProviderInputBudget } from './provider-input-budget.ts'

const state = (contextWindow?: number) =>
    ({
        modelVersion: 'reasoning-model',
        maxCompletionSize: 100,
        aiModelMetaInfo: {
            model: 'reasoning-model',
            modelVersion: 'reasoning-model',
            ...(contextWindow !== undefined ? { contextWindow } : {}),
        },
    }) as any

describe('provider translated-request context admission', () => {
    it('rejects complete oversized text without mutating or clipping it', () => {
        const text = 'timeline-segment\n'.repeat(100)
        const request = { input: [{ role: 'user', content: text }] }

        expect(() => assessProviderInputBudget({ state: state(200), request })).toThrowError(
            expect.objectContaining<Partial<CapabilityError>>({
                code: 'MODEL_INPUT_CONTEXT_EXCEEDED',
                details: expect.objectContaining({ contextWindow: 200 }),
            }),
        )
        expect(request.input[0]!.content).toBe(text)
    })

    it('accounts translated media separately from base64 text inflation', () => {
        const bytes = Buffer.alloc(2400).toString('base64')
        const result = assessProviderInputBudget({
            state: state(10000),
            request: {
                contents: [{
                    parts: [{ inlineData: { mimeType: 'audio/wav', data: bytes } }],
                }],
            },
        })

        expect(result).toEqual(expect.objectContaining({
            mediaTokens: 100,
            reservedCompletionTokens: 100,
            contextWindow: 10000,
        }))
        expect(result!.inputTokens).toBeLessThan(1000)
    })

    it('defers admission only for legacy fixtures without model context metadata', () => {
        expect(assessProviderInputBudget({ state: state(), request: { input: 'complete' } })).toBeUndefined()
    })
})
