'use strict'

import { describe, expect, it, vi } from 'vitest'

import { buildMediaDescriptorSchema, buildTextDescriptorSchema, describeMediaStill, describeTextContent } from './media-descriptor.ts'

// =============================================================================
// MEDIA DESCRIPTOR — schema + describe contract
// =============================================================================

describe('buildMediaDescriptorSchema', () => {
    it('requires a summary plus entity and style tags', () => {
        const schema = buildMediaDescriptorSchema()
        expect(schema.name).toBe('describe_media')
        expect(schema.schema.required).toEqual(['title', 'summary', 'entityTags', 'styleTags'])
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
        expect(result).toEqual({ title: '', summary: '', entityTags: [], styleTags: [] })
    })
})

// =============================================================================
// TEXT DESCRIPTOR — schema + describe contract (documents / chat threads)
// =============================================================================

describe('buildTextDescriptorSchema', () => {
    it('requires a summary plus entity and style tags', () => {
        const schema = buildTextDescriptorSchema()
        expect(schema.name).toBe('describe_text')
        expect(schema.schema.required).toEqual(['title', 'summary', 'entityTags', 'styleTags'])
    })
})

describe('describeTextContent', () => {
    const baseArgs = {
        provider: 'OpenAI' as const,
        modelVersion: 'gpt-4.1',
        natsService: {} as any,
    }

    it('sends a text-only message (no pixels) with the title + text and trims/dedupes the result', async () => {
        const callVlm = vi.fn(async (args: any) => {
            const blocks = args.userMessages[0].content
            // No image is ever attached for a text node.
            expect(blocks.some((b: any) => b.type === 'input_image')).toBe(false)
            const text = blocks.map((b: any) => b.text).join('')
            expect(text).toContain('Title: Roadmap')
            expect(text).toContain('Ship the relevance engine in Q3.')
            return {
                parsed: {
                    summary: '  A product roadmap focused on the relevance engine.  ',
                    entityTags: ['roadmap', 'roadmap', 'relevance engine'],
                    styleTags: ['notes', ''],
                },
                rawText: '',
                modelName: 'gpt-4.1',
            }
        })

        const result = await describeTextContent({
            ...baseArgs,
            text: 'Ship the relevance engine in Q3.',
            title: 'Roadmap',
            callVlm,
        })

        expect(callVlm).toHaveBeenCalledOnce()
        expect(result.summary).toBe('A product roadmap focused on the relevance engine.')
        expect(result.entityTags).toEqual(['roadmap', 'relevance engine'])
        expect(result.styleTags).toEqual(['notes'])
    })

    it('skips the model call and returns empty fields for blank text', async () => {
        const callVlm = vi.fn(async () => ({ parsed: {} as any, rawText: '', modelName: 'gpt-4.1' }))
        const result = await describeTextContent({ ...baseArgs, text: '   \n  ', callVlm })
        expect(callVlm).not.toHaveBeenCalled()
        expect(result).toEqual({ title: '', summary: '', entityTags: [], styleTags: [] })
    })

    it('sends text beyond the former 20,000-character boundary without clipping', async () => {
        const text = `prefix-${'x'.repeat(25000)}-suffix`
        const callVlm = vi.fn(async (args: any) => {
            expect(args.userMessages[0].content.map((block: any) => block.text).join('')).toContain(text)
            return {
                parsed: { title: 'Long Notes', summary: 'Complete notes.', entityTags: [], styleTags: [] },
                rawText: '',
                modelName: 'gpt-4.1',
            }
        })

        await describeTextContent({ ...baseArgs, text, callVlm })

        expect(callVlm).toHaveBeenCalledOnce()
    })

    it('rejects an oversized descriptor result instead of shortening it', async () => {
        const summary = 'x'.repeat(10000)
        const callVlm = vi.fn(async () => ({
            parsed: { title: 'Long Notes', summary, entityTags: [], styleTags: [] },
            rawText: '',
            modelName: 'gpt-4.1',
        }))

        await expect(describeTextContent({ ...baseArgs, text: 'content', callVlm }))
            .rejects.toThrow('MEDIA_DESCRIPTOR_SUMMARY_TOO_LONG')
        expect(summary).toHaveLength(10000)
    })

    it('returns empty fields when the model yields nothing usable', async () => {
        const callVlm = vi.fn(async () => ({ parsed: {} as any, rawText: '', modelName: 'gpt-4.1' }))
        const result = await describeTextContent({ ...baseArgs, text: 'some content', callVlm })
        expect(result).toEqual({ title: '', summary: '', entityTags: [], styleTags: [] })
    })
})
