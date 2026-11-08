import {
    setGeneratedMediaTracker,
    type PendingGeneratedMediaTracker,
} from '../../shared/generation/workspace-media-trackers.ts'
import {
    type Asset,
    type CanvasNode,
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type Dispose,
} from '@lixpi/canvas-engine/shared'
import {
    type GeneratingMediaOutlineTarget,
} from './workspace-media-layer.ts'

export type WorkspaceGenerationVisualsPorts = {
    getState: () => CanvasState | null
    getAsset: (assetId: string) => Asset | undefined
    images: Map<string, PendingGeneratedMediaTracker>
    videos: Map<string, PendingGeneratedMediaTracker>
    alwaysOn: () => boolean
    setTargets: (targets: Map<string, GeneratingMediaOutlineTarget>) => void
    onFinalized: (nodeId: string) => void
    getPendingInset: (dimensions: {
        width: number
        height: number
    }) => {
        x: number
        y: number
        size: number
    }
    completionTimeoutMs: number
    setTimer: (
        callback: () => void,
        delayMs: number,
    ) => number
    clearTimer: (handle: number) => void
}

type Completion = {
    runKey: string
    cancel: Dispose
}

// Owns the visual handoff from a pending run to decoded media pixels.
export class WorkspaceGenerationVisuals {
    private readonly completions = new Map<string, Completion>()
    private readonly decodedImages = new Set<string>()
    private readonly references = new Map<string, Set<string>>()
    private timers = new Lifetime()
    private disposed = false

    constructor(private readonly ports: WorkspaceGenerationVisualsPorts) {}

    isFinalizing(nodeId: string): boolean {
        return this.completions.has(nodeId)
    }
    hasDecodedFrame(nodeId: string): boolean {
        return this.decodedImages.has(nodeId)
    }
    markFrameDecoded(nodeId: string): void {
        if (!this.disposed)
            this.decodedImages.add(nodeId)
    }
    forgetDecodedFrame(nodeId: string): void {
        this.decodedImages.delete(nodeId)
    }

    setReferences(
        key: string,
        nodeIds: Iterable<string>,
    ): void {
        if (this.disposed)
            return

        const values = new Set(nodeIds)

        if (values.size)
            this.references.set(key, values)
        else
            this.references.delete(key)
    }

    removeReferences(key: string): boolean {
        return this.references.delete(key)
    }

    sync(state: CanvasState | null = this.ports.getState()): void {
        if (this.disposed)
            return

        const targets = new Map<string, GeneratingMediaOutlineTarget>()

        if (this.ports.alwaysOn()) {
            for (const node of state?.nodes ?? []) {
                if (
                    node.type !== 'image'
                    && node.type !== 'video'
                )
                    continue

                const pending = this.isPending(node.nodeId)
                targets.set(
                    node.nodeId,
                    {
                        direction: pending ? 'clockwise' : 'counterclockwise',
                        shape: pending ? 'preFrameCircle' : 'node',
                    },
                )
            }

            this.ports.setTargets(targets)

            return
        }

        for (const partial of this.ports.images.values()) {
            targets.set(
                partial.nodeId,
                {
                    direction: 'clockwise',
                    shape: partial.hasReceivedFrame ? 'node' : 'preFrameCircle',
                    ...(this.isFinalizing(partial.nodeId) ? { sourceRendition: 'original' as const } : {}),
                },
            )
        }

        for (const pending of this.ports.videos.values()) {
            targets.set(
                pending.nodeId,
                {
                    direction: 'clockwise',
                    shape: pending.hasReceivedFrame ? 'node' : 'preFrameCircle',
                },
            )
        }

        for (const node of state?.nodes ?? []) {
            if (
                !targets.has(node.nodeId)
                && this.isWaitingForFrame(node)
            )
                targets.set(
                    node.nodeId,
                    {
                        direction: 'clockwise',
                        shape: 'preFrameCircle',
                    },
                )
        }

        for (const references of this.references.values()) {
            for (const nodeId of references)
                if (!targets.has(nodeId))
                    targets.set(nodeId, { direction: 'counterclockwise' })
        }

        this.ports.setTargets(targets)
    }

    keepCompletion(
        runKey: string,
        previous: PendingGeneratedMediaTracker,
        node: Pick<ImageCanvasNode, 'nodeId' | 'assetId'>,
    ): void {
        if (this.disposed)
            return

        for (const [nodeId, completion] of this.completions) {
            if (
                completion.runKey === runKey
                || nodeId === node.nodeId
            )
                this.clearCompletion(nodeId)
        }

        setGeneratedMediaTracker(
            this.ports.images,
            runKey,
            {
                ...previous,
                nodeId: node.nodeId,
                assetId: node.assetId || previous.assetId,
                hasReceivedFrame: false,
            },
        )
        const completion: Completion = {
            runKey,
            cancel: () => {},
        }
        this.completions.set(node.nodeId, completion)

        try {
            const timer = this.ports.setTimer(
                () => {
                    if (this.completions.get(node.nodeId) === completion)
                        this.clearCompletion(node.nodeId)
                },
                this.ports.completionTimeoutMs,
            )
            completion.cancel = this.timers.own(() => this.ports.clearTimer(timer))
        } catch (error) {
            this.completions.delete(node.nodeId)

            if (this.ports.images.get(runKey)?.nodeId === node.nodeId)
                this.ports.images.delete(runKey)

            throw error
        }

        this.sync()
    }

    clearCompletion(nodeId: string): void {
        const completion = this.completions.get(nodeId)

        if (!completion)
            return

        this.completions.delete(nodeId)

        if (this.ports.images.get(completion.runKey)?.nodeId === nodeId)
            this.ports.images.delete(completion.runKey)

        try {
            completion.cancel()
        } finally {
            if (!this.disposed)
                this.ports.onFinalized(nodeId)
        }
    }

    pendingNodeIds(): Set<string> {
        const ids = new Set<string>()

        if (this.disposed)
            return ids

        for (const tracker of [this.ports.images, this.ports.videos]) {
            for (const node of tracker.values())
                if (
                    !node.hasReceivedFrame
                    && !this.hasTerminalProgress(node.nodeId)
                )
                    ids.add(node.nodeId)
        }

        for (const node of this.ports.getState()?.nodes ?? [])
            if (this.isWaitingForFrame(node))
                ids.add(node.nodeId)

        return ids
    }

    hasTerminalProgress(nodeId: string): boolean {
        const node = this.ports.getState()?.nodes.find(candidate => candidate.nodeId === nodeId)

        return Boolean(
            node && (node.type === 'image' || node.type === 'video') && node.generationProgress
                && ['completed', 'failed', 'cancelled'].includes(node.generationProgress.status),
        )
    }

    isWaitingForFrame(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode {
        if (
            this.disposed
            || (node.type !== 'image' && node.type !== 'video')
        )
            return false

        if (
            node.generationProgress
            && ['completed', 'failed', 'cancelled'].includes(node.generationProgress.status)
        )
            return false

        if (
            node.type === 'image'
            && this.decodedImages.has(node.nodeId)
        )
            return false

        if (node.mediaGenerationPhase)
            return node.mediaGenerationPhase === 'pending-before-first-frame'

        return Boolean(node.generatedBy) && this.ports.getAsset(node.assetId)?.media?.renditions.original?.status !== 'ready'
    }

    isPending(nodeId: string): boolean {
        if (
            this.disposed
            || this.hasTerminalProgress(nodeId)
        )
            return false

        for (const tracker of [this.ports.images, this.ports.videos]) {
            for (const pending of tracker.values())
                if (pending.nodeId === nodeId)
                    return !pending.hasReceivedFrame
        }

        const node = this.ports.getState()?.nodes.find(candidate => candidate.nodeId === nodeId)

        return node ? this.isWaitingForFrame(node) : false
    }

    updateHitArea(
        element: HTMLElement,
        nodeId: string,
    ): void {
        if (this.disposed)
            return

        const pending = this.isPending(nodeId)
        element.classList.toggle('is-pending-generated-media-before-frame', pending)

        if (!pending)
            return

        const node = this.ports.getState()?.nodes.find(candidate => candidate.nodeId === nodeId)

        if (
            !node
            || (node.type !== 'image' && node.type !== 'video')
        )
            return

        const inset = this.ports.getPendingInset(node.dimensions)
        element.style.setProperty('--workspace-pending-media-hit-left', `${inset.x}px`)
        element.style.setProperty('--workspace-pending-media-hit-top', `${inset.y}px`)
        element.style.setProperty('--workspace-pending-media-hit-size', `${inset.size}px`)
    }

    clear(): void {
        const timers = this.timers
        this.timers = new Lifetime()
        this.completions.clear()
        this.decodedImages.clear()
        this.references.clear()
        timers.destroy()
    }

    destroy(): void {
        if (this.disposed)
            return

        this.disposed = true
        this.clear()
    }
}
