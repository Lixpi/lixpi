import {
    CanvasConversationEditors,
    type CanvasConversationEditorsPorts,
    type CanvasConversationEditorScope,
} from './canvas-conversation-editors.ts'

export type WorkspaceConversationRunsPorts = CanvasConversationEditorsPorts & {
    setReceiving?: (threadId: string, receiving: boolean) => void
}

export class WorkspaceConversationRuns<Entry> {
    private readonly editors: CanvasConversationEditors<Entry>
    private readonly active = new Set<string>()
    private readonly settled = new Set<string>()
    private destroyed = false

    constructor(private readonly ports: WorkspaceConversationRunsPorts) {
        this.editors = new CanvasConversationEditors<Entry>(ports)
    }

    isActive(threadId: string): boolean {
        return this.active.has(threadId)
    }
    isSettled(threadId: string): boolean {
        return this.settled.has(threadId)
    }
    activeIds(): IterableIterator<string> {
        return this.active.keys()
    }
    has(threadId: string): boolean {
        return this.editors.has(threadId)
    }
    get(threadId: string): Entry | undefined {
        return this.editors.get(threadId)
    }
    keys(): IterableIterator<string> {
        return this.editors.keys()
    }

    activate(threadId: string): void {
        if (this.destroyed) throw new Error('Workspace conversation runs are disposed')
        this.settled.delete(threadId)
        this.active.add(threadId)
        this.ports.setReceiving?.(threadId, true)
    }

    settle(threadId: string): void {
        if (this.destroyed) return
        this.settled.add(threadId)
        this.active.delete(threadId)
        this.ports.setReceiving?.(threadId, false)
    }

    mount(threadId: string, create: (scope: CanvasConversationEditorScope) => Entry): Entry {
        if (this.destroyed) throw new Error('Workspace conversation runs are disposed')
        return this.editors.mount(threadId, create)
    }

    defer(threadId: string, delayMs: number): void {
        this.editors.defer(threadId, delayMs, () => this.teardown(threadId))
    }

    teardown(threadId: string): void {
        this.active.delete(threadId)
        const errors: unknown[] = []
        try {
            this.editors.remove(threadId)
        } catch (error) {
            errors.push(error)
        }
        try {
            this.ports.setReceiving?.(threadId, false)
        } catch (error) {
            errors.push(error)
        }
        if (errors.length) throw new AggregateError(errors, 'Workspace conversation teardown failed')
    }

    clear(): void {
        const threadIds = new Set([...this.active, ...this.editors.keys()])
        this.active.clear()
        this.settled.clear()
        const errors: unknown[] = []
        try {
            this.editors.clear()
        } catch (error) {
            errors.push(error)
        }
        for (const threadId of threadIds) {
            try {
                this.ports.setReceiving?.(threadId, false)
            } catch (error) {
                errors.push(error)
            }
        }
        if (errors.length) throw new AggregateError(errors, 'Workspace conversation cleanup failed')
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        const errors: unknown[] = []
        try {
            this.clear()
        } catch (error) {
            errors.push(error)
        }
        try {
            this.editors.destroy()
        } catch (error) {
            errors.push(error)
        }
        if (errors.length) throw new AggregateError(errors, 'Workspace conversation disposal failed')
    }
}
