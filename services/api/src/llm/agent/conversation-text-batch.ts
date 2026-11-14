const maxBatchCharacters = 128
const maxBatchDelayMs = 100

export class ConversationTextBatch {
    private pendingText = ''
    private timer?: ReturnType<typeof setTimeout>
    private writing?: Promise<void>
    private failure?: { error: unknown }
    private started = false
    private discarded = false

    constructor(
        private readonly signal: AbortSignal,
        private readonly write: (text: string) => Promise<void>,
    ) {}

    async append(text: string): Promise<void> {
        this.assertActive()

        if (!text)
            return

        this.pendingText += text

        if (
            !this.started
            || this.pendingText.length >= maxBatchCharacters
        ) {
            this.startWrite()

            // Bound the buffer if the durable writer cannot keep up.
            if (this.pendingText.length >= maxBatchCharacters) {
                await this.writing
                this.assertActive()
                this.startWrite()
            }
        } else if (!this.timer) {
            this.timer = setTimeout(() => {
                this.timer = undefined
                this.startWrite()
            }, maxBatchDelayMs)
            this.timer.unref()
        }
    }

    async flush(): Promise<void> {
        do {
            this.clearTimer()

            if (!this.writing) {
                this.assertActive()
                this.startWrite()
            }

            await this.writing
            this.assertActive()
        } while (
            this.writing
            || this.pendingText
        )

        this.started = false
    }

    async discard(): Promise<void> {
        this.discarded = true
        this.clearTimer()
        this.pendingText = ''
        await this.writing
    }

    private startWrite(): void {
        if (
            this.writing
            || this.discarded
            || this.signal.aborted
            || this.failure
            || !this.pendingText
        )
            return

        this.clearTimer()
        const text = this.pendingText
        this.pendingText = ''
        this.started = true
        this.writing = this.writeBatch(text)
    }

    private async writeBatch(text: string): Promise<void> {
        // Let startWrite register this promise before invoking its writer.
        await Promise.resolve()

        try {
            this.assertActive()
            await this.write(text)
        } catch (error) {
            this.failure = { error }
        } finally {
            this.writing = undefined

            // If a deadline elapsed during the write, immediately drain its batch.
            if (!this.timer)
                this.startWrite()
        }
    }

    private clearTimer(): void {
        clearTimeout(this.timer)
        this.timer = undefined
    }

    private assertActive(): void {
        this.signal.throwIfAborted()

        if (this.discarded)
            throw new Error('CONVERSATION_CONTINUATION_STOPPED')

        if (this.failure)
            throw this.failure.error
    }
}
