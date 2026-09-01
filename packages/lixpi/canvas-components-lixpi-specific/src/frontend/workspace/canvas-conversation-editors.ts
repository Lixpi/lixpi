import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type Dispose,
} from '@lixpi/canvas-engine/shared'

export type CanvasConversationEditorScope = {
    container: HTMLDivElement
    signal: AbortSignal
    own: (dispose: Dispose) => Dispose
    isCurrent: () => boolean
}

export type CanvasConversationEditorsPorts = {
    pane: HTMLElement
    setTimer: (callback: () => void, delayMs: number) => number
    clearTimer: (handle: number) => void
}

type EditorSlot<Entry> = { lifetime: Lifetime; entry?: Entry; cancelDeferred?: Dispose }

// Hidden conversation editors back the visible canvas generation projections.
export class CanvasConversationEditors<Entry> {
    private readonly lifetime = new Lifetime()
    private readonly slots = new Map<string, EditorSlot<Entry>>()
    private host: HTMLDivElement | null = null

    constructor(private readonly ports: CanvasConversationEditorsPorts) {}

    has(threadId: string): boolean {
        return this.slots.has(threadId)
    }
    get(threadId: string): Entry | undefined {
        return this.slots.get(threadId)?.entry
    }
    keys(): IterableIterator<string> {
        return this.slots.keys()
    }

    mount(threadId: string, create: (scope: CanvasConversationEditorScope) => Entry): Entry {
        if (this.lifetime.signal.aborted) throw new Error('Canvas conversation editors are disposed')
        this.remove(threadId)
        const lifetime = this.lifetime.child()
        const slot: EditorSlot<Entry> = { lifetime }
        this.slots.set(threadId, slot)
        const html = createDocumentHtml(this.ports.pane.ownerDocument)
        try {
            const container = html`<div className="workspace-detached-ai-chat-thread-instance"></div>` as HTMLDivElement
            lifetime.own(() => container.remove())
            this.ensureHost().appendChild(container)
            const isCurrent = () => !lifetime.signal.aborted && this.slots.get(threadId) === slot
            const entry = create({ container, signal: lifetime.signal, own: dispose => lifetime.own(dispose), isCurrent })
            if (!isCurrent()) throw new DOMException('Canvas conversation editor was replaced during mounting', 'AbortError')
            slot.entry = entry
            return entry
        } catch (error) {
            if (this.slots.get(threadId) === slot) this.slots.delete(threadId)
            try {
                lifetime.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Canvas conversation editor mounting failed')
            }
            throw error
        }
    }

    remove(threadId: string): void {
        const slot = this.slots.get(threadId)
        if (!slot) return
        this.slots.delete(threadId)
        slot.lifetime.destroy()
    }

    defer(threadId: string, delayMs: number, callback: () => void): void {
        const slot = this.slots.get(threadId)
        if (!slot || slot.lifetime.signal.aborted) return
        slot.cancelDeferred?.()
        const deferred = slot.lifetime.child()
        slot.cancelDeferred = () => deferred.destroy()
        try {
            const timer = this.ports.setTimer(() => {
                if (deferred.signal.aborted || this.slots.get(threadId) !== slot) return
                deferred.destroy()
                callback()
            }, delayMs)
            deferred.own(() => this.ports.clearTimer(timer))
        } catch (error) {
            try {
                deferred.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Canvas conversation timer allocation failed')
            }
            throw error
        }
    }

    clear(): void {
        const slots = [...this.slots.values()]
        this.slots.clear()
        const cleanup = new Lifetime()
        for (const slot of slots) cleanup.own(() => slot.lifetime.destroy())
        cleanup.destroy()
    }

    destroy(): void {
        this.slots.clear()
        this.lifetime.destroy()
    }

    private ensureHost(): HTMLDivElement {
        if (this.host) return this.host
        const html = createDocumentHtml(this.ports.pane.ownerDocument)
        const style = { position: 'absolute' as const, left: '-10000px', top: '-10000px', width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' as const, opacity: '0' }
        this.host = html`<div className="workspace-detached-ai-chat-thread-host" style=${style}></div>` as HTMLDivElement
        const host = this.host
        this.lifetime.own(() => {
            host.remove()
            this.host = null
        })
        this.ports.pane.appendChild(host)
        return host
    }
}
