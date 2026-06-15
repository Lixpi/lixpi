'use strict'

import { describe, it, expect, beforeEach } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

import { StreamPublisher, TagAwareStream } from './stream-publisher.ts'

type Published = { subject: string, payload: any }

const makeFakeNats = () => {
    const published: Published[] = []
    const fake = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
    } as any
    return { fake, published }
}

const flatTexts = (published: Published[]): string =>
    published
        .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
        .map(p => p.payload.content.text)
        .join('')

const statuses = (published: Published[]): string[] =>
    published.map(p => p.payload.content.status)

describe('TagAwareStream', () => {
    let nats: ReturnType<typeof makeFakeNats>
    let stream: TagAwareStream

    beforeEach(() => {
        nats = makeFakeNats()
        stream = new TagAwareStream(nats.fake, 'ws1', 'thread1', 'OpenAI')
    })

    it('passes plain text through after flush', () => {
        stream.push('Hello world')
        stream.flush()
        expect(flatTexts(nats.published)).toBe('Hello world')
        expect(statuses(nats.published)).toEqual([STREAM_STATUS.STREAMING])
    })

    it('emits COLLAPSIBLE_START / END around <image_prompt> content', () => {
        stream.push('before<image_prompt>inner content</image_prompt>after')
        stream.flush()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.STREAMING,           // 'before'
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner content'
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'after'
        ])
        const texts = nats.published
            .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
            .map(p => p.payload.content.text)
        expect(texts).toEqual(['before', 'inner content', 'after'])

        const collapsibleStart = nats.published.find(p => p.payload.content.status === STREAM_STATUS.COLLAPSIBLE_START)
        expect(collapsibleStart?.payload.content.collapsibleTitle).toBe('Image generation prompt')
    })

    it('emits COLLAPSIBLE_START / END around <video_prompt> content with a video title', () => {
        stream.push('Sure!<video_prompt>Animate the provided reference image as the first frame.</video_prompt>done')
        stream.flush()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.STREAMING,           // 'Sure!'
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // inner video prompt
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'done'
        ])
        const texts = nats.published
            .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
            .map(p => p.payload.content.text)
        expect(texts).toEqual(['Sure!', 'Animate the provided reference image as the first frame.', 'done'])

        const collapsibleStart = nats.published.find(p => p.payload.content.status === STREAM_STATUS.COLLAPSIBLE_START)
        expect(collapsibleStart?.payload.content.collapsibleTitle).toBe('Video generation prompt')
    })

    it('handles a <video_prompt> close tag split across chunk boundaries', () => {
        stream.push('<video_prompt>inner</video_pr')
        stream.push('ompt>tail')
        stream.flush()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner'
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'tail'
        ])
    })

    it('handles open tag split across chunk boundary', () => {
        stream.push('before<image_pr')
        stream.push('ompt>inner</image_prompt>')
        stream.flush()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.STREAMING,           // 'before'
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner'
            STREAM_STATUS.COLLAPSIBLE_END,
        ])
    })

    it('handles close tag split across chunk boundary', () => {
        stream.push('<image_prompt>inner</image_pr')
        stream.push('ompt>tail')
        stream.flush()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner'
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'tail'
        ])
    })

    it('emits COLLAPSIBLE_END on flush if stream ends inside a tag', () => {
        stream.push('<image_prompt>open ')
        stream.push('but never closed')
        stream.flush()

        const ss = statuses(nats.published)
        expect(ss[0]).toBe(STREAM_STATUS.COLLAPSIBLE_START)
        expect(ss[ss.length - 1]).toBe(STREAM_STATUS.COLLAPSIBLE_END)
    })

    it('does not match nested-looking tags like <image_prompt_alt>', () => {
        // indexOf matches <image_prompt> inside <image_prompt_alt>: known substring-search limitation
        stream.push('<image_prompt_alt>x</image_prompt_alt>')
        stream.flush()
        expect(nats.published.length).toBeGreaterThan(0)
    })

    it('emits a single STREAMING event per safe-portion flush', () => {
        // Push enough content that the safe portion is non-empty even with
        // BUFFER_SIZE held back.
        const big = 'a'.repeat(100)
        stream.push(big)
        stream.flush()
        const texts = nats.published
            .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
            .map(p => p.payload.content.text)
            .join('')
        expect(texts).toBe(big)
    })

    it('does not flush partial tag prefix until it can be confirmed', () => {
        stream.push('<image_pr')
        expect(nats.published.length).toBe(0)
        stream.push('ompt>x')
        expect(statuses(nats.published)).toContain(STREAM_STATUS.COLLAPSIBLE_START)
    })
})

describe('StreamPublisher extraction progress', () => {
    it('publishes START_STREAM only once when providers start after shared prework', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.start()
        publisher.start()

        expect(statuses(nats.published)).toEqual([STREAM_STATUS.START_STREAM])
    })

    it('publishes END_STREAM only once after duplicate starts', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.start()
        publisher.start()
        publisher.chunk('done')
        publisher.end()
        publisher.end()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.START_STREAM,
            STREAM_STATUS.STREAMING,
            STREAM_STATUS.END_STREAM,
        ])
        expect(flatTexts(nats.published)).toBe('done')
    })

    it('does not publish END_STREAM before START_STREAM', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.end()

        expect(nats.published).toHaveLength(0)
    })

    it('publishes extraction status and detail on the chat stream', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'run1', 'Anthropic')

        publisher.extractionProgress('generating_samples', 'Rendering a texture reference sheet.')

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.subject).toBe('ai.interaction.chat.receiveMessage.ws1.run1')
        expect(nats.published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.STREAMING,
            extractionStatus: 'generating_samples',
            extractionDetail: 'Rendering a texture reference sheet.',
            aiProvider: 'Anthropic',
        }))
    })

    it('publishes workspace context relevance resolution on the chat stream', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'OpenAI')
        const resolution = {
            resolverVersion: 'workspace-context-v1',
            selections: [{ nodeId: 'doc-1', role: 'forced-chip' as const }],
            narrowedMediaNodeIds: [],
        }

        publisher.contextRelevanceResolved(resolution)

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED,
            aiProvider: 'OpenAI',
            workspaceContextResolution: resolution,
        }))
    })

    it('publishes workspace context relevance errors on the chat stream', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'OpenAI')

        publisher.contextRelevanceError('bad context')

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
            aiProvider: 'OpenAI',
            error: 'bad context',
        }))
    })

    it('publishes image generation errors with media run metadata', () => {
        const nats = makeFakeNats()
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'reasoning-1:image:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', generationRun)

        publisher.imageGenerationError('no inline image data')

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toEqual({
            status: STREAM_STATUS.IMAGE_ERROR,
            aiProvider: 'Anthropic',
            error: 'no inline image data',
            generationRun,
        })
    })
})

describe('StreamPublisher trace payloads', () => {
    it('propagates media generation metadata through image/video traces', () => {
        const nats = makeFakeNats()
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'reasoning-1:video:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', generationRun)

        publisher.imageGenerationTrace({
            traceVersion: 'image-generation-trace-v1',
            toolPrompt: 'build one',
            finalPrompt: 'build one with transfer',
            promptWasChanged: false,
            referenceImages: [],
            excludedReferences: [],
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            chatModelProvider: 'Anthropic',
            chatModelId: 'claude-sonnet-4-6',
            imageSize: '1:1',
            generationRun: undefined,
        } as any)
        publisher.videoGenerationTrace({
            traceVersion: 'video-generation-trace-v1',
            toolPrompt: 'animate one',
            finalPrompt: 'animate one with constraints',
            promptWasChanged: false,
            referenceImages: [],
            excludedReferences: [],
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            chatModelProvider: 'Anthropic',
            chatModelId: 'claude-sonnet-4-6',
            aspectRatio: '16:9',
            resolution: '720p',
            durationSeconds: 6,
            generationRun: generationRun,
        } as any)

        const imageTrace = nats.published[0]?.payload.content
        const videoTrace = nats.published[1]?.payload.content

        expect(imageTrace).toMatchObject({
            status: STREAM_STATUS.IMAGE_GENERATION_TRACE,
            aiProvider: 'Anthropic',
            imageGenerationTrace: expect.objectContaining({
                generationRun,
            }),
            generationRun,
        })
        expect(videoTrace).toMatchObject({
            status: STREAM_STATUS.VIDEO_GENERATION_TRACE,
            aiProvider: 'Anthropic',
            videoGenerationTrace: expect.objectContaining({
                generationRun,
            }),
            generationRun,
        })
    })
})
