import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { ConversationTextBatch } from './conversation-text-batch.ts'

describe('ConversationTextBatch', () => {
    it('drains a chunk arriving during a boundary flush before returning', async () => {
        const first = Promise.withResolvers<void>()
        const second = Promise.withResolvers<void>()
        const third = Promise.withResolvers<void>()
        const write = vi.fn<(text: string) => Promise<void>>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise)
            .mockReturnValueOnce(third.promise)
        const batch = new ConversationTextBatch(
            new AbortController().signal,
            write,
        )
        await batch.append('first')
        await batch.append('second')
        const drain = batch.flush()
        first.resolve()
        await vi.waitFor(() => expect(write.mock.calls).toEqual([['first'], ['second']]))

        await batch.append('third')
        second.resolve()
        await vi.waitFor(() => expect(write.mock.calls).toEqual([['first'], ['second'], ['third']]))
        third.resolve()
        await drain
    })

    it('waits for an in-flight write but discards pending text on stop', async () => {
        const controller = new AbortController()
        const first = Promise.withResolvers<void>()
        const write = vi.fn(() => first.promise)
        const batch = new ConversationTextBatch(controller.signal, write)
        await batch.append('first')
        await batch.append('discard this')
        controller.abort(new Error('stopped'))
        const discard = batch.discard()
        first.resolve()
        await discard

        expect(write.mock.calls).toHaveLength(1)
        await expect(batch.append('late')).rejects.toThrow('stopped')
    })

    it('reports a write failure when the boundary drains', async () => {
        const failure = new Error('write failed')
        const write = vi.fn(async () => {
            throw failure
        })
        const batch = new ConversationTextBatch(new AbortController().signal, write)
        await batch.append('first')
        await expect(batch.flush()).rejects.toThrow(failure)
        await batch.discard()
    })
})
