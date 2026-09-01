import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
} from 'vitest'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'

type SegmentChunk = {
    conversationAssetId?: string
    status?: string
    type?: string
    [key: string]: unknown
}

type InternalReceiver = {
    threadListeners: Map<string, Set<(chunk: SegmentChunk) => void>>
}

function resetReceiverState(): void {
    ;(SegmentsReceiver as InternalReceiver).threadListeners = new Map()
}

describe('segmentsReceiver-service — singleton delivery behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetReceiverState()
    })

    afterEach(() => {
        resetReceiverState()
    })

    it('returns the same singleton instance from repeated imports', async () => {
        const firstImport = await import('$src/services/segmentsReceiver-service.ts')
        const secondImport = await import('$src/services/segmentsReceiver-service.ts')

        expect(firstImport.default).toBe(secondImport.default)
        expect(firstImport.default).toBe(SegmentsReceiver)
    })

    it('delivers chunks only to listeners registered for matching conversationAssetId', () => {
        const threadOneListener = vi.fn()
        const threadTwoListener = vi.fn()

        SegmentsReceiver.subscribeForThread('thread-1', threadOneListener)
        SegmentsReceiver.subscribeForThread('thread-2', threadTwoListener)

        const threadOneChunk: SegmentChunk = { conversationAssetId: 'thread-1', type: 'image_partial' }
        const threadTwoChunk: SegmentChunk = { conversationAssetId: 'thread-2', type: 'image_partial' }

        SegmentsReceiver.receiveSegment(threadOneChunk)
        SegmentsReceiver.receiveSegment(threadTwoChunk)

        expect(threadOneListener).toHaveBeenCalledOnce()
        expect(threadOneListener).toHaveBeenCalledWith(threadOneChunk)
        expect(threadTwoListener).toHaveBeenCalledOnce()
        expect(threadTwoListener).toHaveBeenCalledWith(threadTwoChunk)
    })

    it('unregisters a listener and removes an empty thread entry', () => {
        const listener = vi.fn()
        const unsubscribe = SegmentsReceiver.subscribeForThread('thread-1', listener)

        unsubscribe()
        SegmentsReceiver.receiveSegment({ conversationAssetId: 'thread-1', type: 'image_partial' })

        expect(listener).not.toHaveBeenCalled()
        expect((SegmentsReceiver as InternalReceiver).threadListeners.has('thread-1')).toBe(false)
    })

    it('warns and drops chunks with no conversationAssetId', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const listener = vi.fn()
        SegmentsReceiver.subscribeForThread('thread-1', listener)

        SegmentsReceiver.receiveSegment({ status: 'END_STREAM', type: 'trace' })

        expect(listener).not.toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledOnce()
        expect(warnSpy).toHaveBeenCalledWith(
            '[SegmentsReceiver] Segment has no conversationAssetId, dropping:',
            'END_STREAM',
        )
        warnSpy.mockRestore()
    })
})
