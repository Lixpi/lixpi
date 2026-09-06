import {
    assertCanvasBounds,
    computeResizedBounds,
    getResizeCursor,
    type CanvasEngineRect,
    type CanvasViewport,
    type Dispose,
    type ResizeConstraints,
    type ResizeHandle,
} from '../../shared/index.ts'
import {
    type GestureController,
    type CanvasGesture,
    type GestureCancelReason,
} from './gesture-controller.ts'
import {
    type GeometryOverrides,
    type GeometryOverrideScope,
} from './geometry-overrides.ts'

export type NodeTransformTarget = {
    nodeId: string
    bounds: CanvasEngineRect
}
export type NodeTransformOptions = {
    event: MouseEvent | PointerEvent
    targets: readonly NodeTransformTarget[]
    threshold?: number
    lock?: () => Dispose
    onStart?: () => void
    onChange: (bounds: ReadonlyMap<string, CanvasEngineRect>) => void
    onEnd: (
        event: MouseEvent | PointerEvent,
        bounds: ReadonlyMap<string, CanvasEngineRect>,
        moved: boolean,
    ) => void
    onCancel: (reason: GestureCancelReason) => void
}
export type NodeResizeOptions = Omit<NodeTransformOptions, 'targets'> & {
    target: NodeTransformTarget
    handle: ResizeHandle
    constraints: ResizeConstraints
}
export type NodeTransformControllerOptions = {
    root: HTMLElement
    gestures: GestureController
    overrides: GeometryOverrides
    getViewport: () => CanvasViewport
}

class NodeTransformSession {
    readonly gesture: CanvasGesture
    private readonly scope: GeometryOverrideScope
    private readonly releaseLock: Dispose | undefined
    private readonly starts = new Map<string, CanvasEngineRect>()
    private readonly bounds = new Map<string, CanvasEngineRect>()
    private readonly zoom: number
    private moved = false
    private ended = false

    constructor(
        private readonly host: NodeTransformControllerOptions,
        private readonly options: NodeTransformOptions,
        private readonly resize?: Pick<NodeResizeOptions, 'handle' | 'constraints'>,
    ) {
        this.zoom = host.getViewport().zoom

        if (
            !Number.isFinite(this.zoom)
            || this.zoom <= 0
        )
            throw new Error('Node transforms require a finite positive zoom')

        if (
            !Number.isFinite(options.threshold ?? 0)
            || (options.threshold ?? 0) < 0
        )
            throw new Error('Node transform threshold must be finite and nonnegative')

        for (const target of options.targets) {
            assertCanvasBounds(target.bounds, target.nodeId)

            if (this.starts.has(target.nodeId))
                throw new Error(`Duplicate transform target: ${target.nodeId}`)

            this.starts.set(target.nodeId, { ...target.bounds })
            this.bounds.set(target.nodeId, { ...target.bounds })
        }

        this.scope = host.overrides.createScope(1)

        try {
            this.releaseLock = options.lock?.()
            this.gesture = host.gestures.start({
                root: host.root,
                event: options.event,
                cursor: resize ? getResizeCursor(resize.handle) : undefined,
                onMove: this.move,
                onEnd: this.end,
                onCancel: this.cancel,
            })
        } catch (error) {
            this.cleanup()

            throw error
        }
    }

    private snapshot(): ReadonlyMap<string, CanvasEngineRect> {
        return new Map(
            Array.from(this.bounds, ([id, bounds]) => [id, { ...bounds }]),
        )
    }

    private move = (event: MouseEvent | PointerEvent): void => {
        const x = event.clientX - this.options.event.clientX
        const y = event.clientY - this.options.event.clientY

        try {
            if (!this.moved) {
                if (Math.hypot(x, y) < (this.options.threshold ?? 0))
                    return

                this.moved = true
                this.options.onStart?.()

                if (this.ended)
                    return
            }

            for (const [nodeId, start] of this.starts) {
                const bounds = this.resize
                    ? computeResizedBounds(
                        start,
                        {
                            x: x / this.zoom,
                            y: y / this.zoom,
                        },
                        this.resize.handle,
                        this.resize.constraints,
                    )
                    : {
                        ...start,
                        x: start.x + x / this.zoom,
                        y: start.y + y / this.zoom,
                    }
                assertCanvasBounds(bounds, nodeId)
                this.bounds.set(nodeId, bounds)
                this.scope.set(
                    nodeId,
                    {
                        position: {
                            x: bounds.x,
                            y: bounds.y,
                        },
                        dimensions: {
                            width: bounds.width,
                            height: bounds.height,
                        },
                    },
                )
            }

            this.options.onChange(
                this.snapshot(),
            )
        } catch (error) {
            this.gesture.cancel('replaced')

            throw error
        }
    }

    private end = (event: MouseEvent | PointerEvent): void => {
        this.cleanup()
        this.options.onEnd(
            event,
            this.snapshot(),
            this.moved,
        )
    }

    private cancel = (reason: GestureCancelReason): void => {
        this.cleanup()
        this.options.onCancel(reason)
    }

    private cleanup(): void {
        if (this.ended)
            return

        this.ended = true

        try {
            this.scope.destroy()
        } finally {
            this.releaseLock?.()
        }
    }
}

// Shared by canvas node drags and resizes; product callbacks only project and commit results.
export class NodeTransformController {
    constructor(private readonly options: NodeTransformControllerOptions) {}

    startDrag(options: NodeTransformOptions): CanvasGesture {
        return new NodeTransformSession(this.options, options).gesture
    }

    startResize(options: NodeResizeOptions): CanvasGesture {
        return new NodeTransformSession(
            this.options,
            {
                ...options,
                targets: [options.target],
            },
            options,
        ).gesture
    }
}
