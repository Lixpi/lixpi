'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    extractVideoToolCall,
    getVideoToolForProvider,
} from './video-generation.ts'

describe('getVideoToolForProvider', () => {
    it.each(['OpenAI', 'Anthropic', 'Google'] as const)('publishes the optional negative prompt field for %s', (provider) => {
        const tool = getVideoToolForProvider(provider)
        const parameters = tool.parameters ?? tool.input_schema

        expect(parameters.properties.negativePrompt).toMatchObject({ type: 'string' })
        expect(parameters.required).toEqual(['prompt'])
    })
})

describe('extractVideoToolCall', () => {
    it('extracts the OpenAI prompt and explicit negative prompt', () => {
        expect(extractVideoToolCall('OpenAI', {
            output: [{
                type: 'function_call',
                name: 'generate_video',
                call_id: 'call-1',
                arguments: JSON.stringify({ prompt: 'Animate it.', negativePrompt: 'no subtitles' }),
            }],
        })).toEqual({
            prompt: 'Animate it.',
            negativePrompt: 'no subtitles',
            toolCallId: 'call-1',
        })
    })

    it('extracts the Anthropic prompt and explicit negative prompt', () => {
        expect(extractVideoToolCall('Anthropic', {
            content: [{
                type: 'tool_use',
                name: 'generate_video',
                id: 'tool-1',
                input: { prompt: 'Animate it.', negativePrompt: 'no captions' },
            }],
        })).toEqual({
            prompt: 'Animate it.',
            negativePrompt: 'no captions',
            toolCallId: 'tool-1',
        })
    })

    it('extracts the Google prompt and omits an empty negative prompt', () => {
        expect(extractVideoToolCall('Google', {
            candidates: [{
                content: {
                    parts: [{
                        functionCall: {
                            name: 'generate_video',
                            args: { prompt: 'Animate it.', negativePrompt: '' },
                        },
                    }],
                },
            }],
        })).toEqual({ prompt: 'Animate it.' })
    })
})
