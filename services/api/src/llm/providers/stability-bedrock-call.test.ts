import { describe, expect, it, vi } from 'vitest'
import { type BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { StabilityBedrockCall } from './stability-bedrock-call.ts'

vi.mock('./bedrock-inference.ts', () => ({ bedrockInference: { resolveModelId: async () => 'stability-model' } }))

describe('single Stability Bedrock invocation', () => {
    it('sends only supported text-to-image fields and keeps the native request identity', async () => {
        const send = vi.fn(async () => ({
            body: Buffer.from(JSON.stringify({
                images: ['base64-image'],
                seeds: [13],
                finish_reasons: [null],
            })),
            $metadata: { requestId: 'native-request' },
        }))
        const call = new StabilityBedrockCall({ send } as unknown as BedrockRuntimeClient)
        const result = await call.invoke({
            modelVersion: 'ultra',
            prompt: 'A sphere.',
            imageSize: '1:1',
            seed: 13,
        })
        expect(JSON.parse(send.mock.calls[0][0].input.body)).toEqual({
            prompt: 'A sphere.',
            mode: 'text-to-image',
            aspect_ratio: '1:1',
            output_format: 'png',
            seed: 13,
        })
        expect(result).toEqual({
            imageBase64: 'base64-image',
            seed: 13,
            filtered: false,
            providerRequestId: 'native-request',
        })
    })

    it('does not repeat a transport error', async () => {
        const send = vi.fn(async () => { throw new Error('Connection interrupted') })
        const call = new StabilityBedrockCall({ send } as unknown as BedrockRuntimeClient)
        await expect(call.invoke({
            modelVersion: 'ultra',
            prompt: 'A sphere.',
            imageSize: '1:1',
            seed: 13,
        })).rejects.toThrow('Connection interrupted')
        expect(send).toHaveBeenCalledTimes(1)
    })
})
