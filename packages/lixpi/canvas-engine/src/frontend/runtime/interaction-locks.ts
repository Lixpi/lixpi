import type { Dispose } from '../../shared/index.ts'

export type InteractionLock = { selection?: boolean }
export type InteractionLockState = { locked: boolean; selection: boolean }

export class InteractionLocks {
    private readonly owners = new Map<symbol, InteractionLock>()
    private readonly listeners = new Set<(state: InteractionLockState) => void>()
    private destroyed = false

    get state(): InteractionLockState {
        return { locked: this.owners.size > 0, selection: Array.from(this.owners.values()).some(owner => owner.selection) }
    }

    acquire(options: InteractionLock = {}): Dispose {
        if (this.destroyed) throw new Error('Interaction locks are disposed')
        const owner = Symbol()
        this.owners.set(owner, { ...options })
        try {
            this.publish()
        } catch (error) {
            this.owners.delete(owner)
            throw error
        }
        return () => {
            if (!this.owners.delete(owner)) return
            this.publish()
        }
    }

    subscribe(listener: (state: InteractionLockState) => void): Dispose {
        if (this.destroyed) throw new Error('Interaction locks are disposed')
        this.listeners.add(listener)
        try {
            listener(this.state)
        } catch (error) {
            this.listeners.delete(listener)
            throw error
        }
        return () => this.listeners.delete(listener)
    }

    private publish(): void {
        const state = this.state
        for (const listener of Array.from(this.listeners)) {
            if (this.listeners.has(listener)) listener(state)
        }
    }

    clear(): void {
        if (!this.owners.size) return
        this.owners.clear()
        this.publish()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.clear()
        this.listeners.clear()
    }
}
