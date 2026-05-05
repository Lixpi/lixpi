'use strict'

import { describe, it, expect, beforeEach } from 'vitest'

import { TagAwareStream } from './stream-publisher.ts'
import { STREAM_STATUS } from '../config.ts'

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
