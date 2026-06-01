'use strict'

import { describe, expect, it, vi } from 'vitest'

import { buildMediaDescriptorSchema, describeMediaStill } from './media-descriptor.ts'

// =============================================================================
// MEDIA DESCRIPTOR — schema + describe contract
// =============================================================================

describe('buildMediaDescriptorSchema', () => {
    it('requires a summary plus entity and style tags', () => {
        const schema = buildMediaDescriptorSchema()
        expect(schema.name).toBe('describe_media')
        expect(schema.schema.required).toEqual(['summary', 'entityTags', 'styleTags'])
    })
})

describe('describeMediaStill', () => {
    const baseArgs = {
        provider: 'OpenAI' as const,
        modelVersion: 'gpt-4.1',
        imageUrl: 'nats-obj://workspace-ws-1-files/file-1',
        natsService: {} as any,
    }

    it('sends a single input_image still to the VLM and trims/dedupes the result', async () => {
        const callVlm = vi.fn(async (args: any) => {
            // The still is sent as one input_image block — never the MP4.
            const blocks = args.userMessages[0].content
            expect(blocks.some((b: any) => b.type === 'input_image' && b.image_url === baseArgs.imageUrl)).toBe(true)
            return {
                parsed: {
                    summary: '  A red sports car on a wet street.  ',
                    entityTags: ['car', 'car', 'street'],
                    styleTags: ['neon', ''],
                },
                rawText: '',
                modelName: 'gpt-4.1',
            }
        })

        const result = await describeMediaStill({ ...baseArgs, callVlm })

        expect(callVlm).toHaveBeenCalledOnce()
        expect(result.summary).toBe('A red sports car on a wet street.')
        expect(result.entityTags).toEqual(['car', 'street'])
        expect(result.styleTags).toEqual(['neon'])
    })

    it('returns empty fields when the model yields nothing usable', async () => {
        const callVlm = vi.fn(async () => ({ parsed: {} as any, rawText: '', modelName: 'gpt-4.1' }))
        const result = await describeMediaStill({ ...baseArgs, callVlm })
        expect(result).toEqual({ summary: '', entityTags: [], styleTags: [] })
    })
})
