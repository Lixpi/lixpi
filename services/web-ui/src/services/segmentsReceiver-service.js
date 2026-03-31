'use strict'

class SegmentsReceiver {
    static instance

    static getInstance() {
        if (!SegmentsReceiver.instance) {
            new SegmentsReceiver()
        }
        return SegmentsReceiver.instance
    }

    constructor() {
        if (SegmentsReceiver.instance) {
            return SegmentsReceiver.instance
        }

        // Thread-scoped listeners: Map<threadId, Set<listener>>
        this.threadListeners = new Map()

        // Ensure the instance is available statically
        SegmentsReceiver.instance = this
    }

    /**
     * Subscribe to segments for a specific thread only.
     * Segments are dispatched exclusively to listeners registered for the matching threadId.
     */
    subscribeForThread(threadId, listener) {
        if (!this.threadListeners.has(threadId)) {
            this.threadListeners.set(threadId, new Set())
        }
        this.threadListeners.get(threadId).add(listener)
        return () => {
            const listeners = this.threadListeners.get(threadId)
            if (listeners) {
                listeners.delete(listener)
                if (listeners.size === 0) {
                    this.threadListeners.delete(threadId)
                }
            }
        }
    }

    // Dispatch segment to the thread-specific listeners only
    receiveSegment(chunk) {
        const threadId = chunk.aiChatThreadId || chunk.threadId
        if (!threadId) {
            console.warn('[SegmentsReceiver] Segment has no threadId, dropping:', chunk.status || chunk.type)
            return
        }

        const listeners = this.threadListeners.get(threadId)
        if (listeners) {
            listeners.forEach(listener => listener(chunk))
        }
    }
}


// Ensure that SegmentsReceiver.getInstance() is now the only way to get an instance of the parser
const markdownStreamParserInstance = SegmentsReceiver.getInstance()

export default markdownStreamParserInstance
