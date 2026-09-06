import {
    Position,
    type Connection,
    type ConnectionInProgress,
    type Handle,
    type HandleType,
    type NodeLookup,
    type Transform,
} from '@xyflow/system'
import { Lifetime } from '../runtime/lifetime.ts'

type Point = {
    x: number
    y: number
}
export type HandleConnectionGestureOptions = {
    domNode: HTMLElement
    nodeLookup: NodeLookup
    nodeId: string
    handleId: string
    isTarget: boolean
    connectionRadius: number
    getTransform: () => Transform
    panBy: (delta: Point) => Promise<boolean>
    isValidConnection: (connection: Connection) => boolean
    updateConnection: (state: ConnectionInProgress) => void
    cancelConnection: () => void
    onConnect: (connection: Connection) => void
    onError: (error: unknown) => void
    onReconnectEnd: (
        event: MouseEvent | TouchEvent,
        state: ConnectionInProgress,
    ) => void
}

// Unlike XYHandle.onPointerDown, this gesture exposes cancellation and owns its listeners and frames.
export class HandleConnectionGesture {
    private readonly lifetime = new Lifetime()
    private readonly document: Document
    private readonly view: Window
    private readonly touchId: number | undefined
    private readonly start: Point
    private pointer: Point
    private state: ConnectionInProgress | null = null
    private connection: Connection | null = null
    private frame: number | null = null
    private panning = false
    private moving = false
    private ended = false

    constructor(
        event: MouseEvent | TouchEvent,
        private readonly options: HandleConnectionGestureOptions,
    ) {
        this.document = options.domNode.ownerDocument
        const view = this.document.defaultView

        if (!view)
            throw new Error('Connection gestures require a browser document')

        this.view = view
        this.touchId = 'touches' in event ? event.changedTouches[0]?.identifier : undefined
        const point = this.eventPoint(event)

        if (!point)
            throw new Error('Connection gesture requires a pointer position')

        this.start = point
        this.pointer = point

        try {
            const moveType = this.touchId === undefined ? 'mousemove' : 'touchmove'
            const endType = this.touchId === undefined ? 'mouseup' : 'touchend'
            this.document.addEventListener(
                moveType,
                this.move,
                { passive: false },
            )
            this.lifetime.own(() => this.document.removeEventListener(moveType, this.move))
            this.document.addEventListener(endType, this.end)
            this.lifetime.own(() => this.document.removeEventListener(endType, this.end))
            this.document.addEventListener('touchcancel', this.touchCancel)
            this.lifetime.own(() => this.document.removeEventListener('touchcancel', this.touchCancel))
            this.document.addEventListener(
                'keydown',
                this.keyDown,
                true,
            )
            this.lifetime.own(
                () => this.document.removeEventListener(
                    'keydown',
                    this.keyDown,
                    true,
                ),
            )
            this.view.addEventListener('blur', this.cancel)
            this.lifetime.own(() => this.view.removeEventListener('blur', this.cancel))
            this.lifetime.own(() => {
                if (this.frame !== null)
                    this.view.cancelAnimationFrame(this.frame)

                this.frame = null
            })
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private eventPoint(event: MouseEvent | TouchEvent): Point | null {
        if (!('changedTouches' in event))
            return {
                x: event.clientX,
                y: event.clientY,
            }

        const touch = Array.from(event.changedTouches).find(candidate => candidate.identifier === this.touchId)

        return touch ? {
            x: touch.clientX,
            y: touch.clientY,
        } : null
    }

    private handles(): Handle[] {
        const result: Handle[] = []

        for (const [nodeId, node] of this.options.nodeLookup) {
            for (const type of ['source', 'target'] as const) {
                for (const handle of node.internals.handleBounds?.[type] ?? []) {
                    const {
                        x,
                        y,
                    } = node.internals.positionAbsolute
                    result.push({
                        ...handle,
                        nodeId,
                        type,
                        x: x + handle.x + handle.width / 2,
                        y: y + handle.y + handle.height / 2,
                    })
                }
            }
        }

        return result
    }

    private update(): void {
        const options = this.options
        const handles = this.handles()
        const type: HandleType = options.isTarget ? 'target' : 'source'
        const fromHandle = handles.find(handle => handle.nodeId === options.nodeId && handle.id === options.handleId && handle.type === type)

        if (!fromHandle) {
            this.cancel()

            return
        }

        const rect = options.domNode.getBoundingClientRect()
        const [x, y, zoom] = options.getTransform()
        const pointer = {
            x: this.pointer.x - rect.left,
            y: this.pointer.y - rect.top,
        }
        const world = {
            x: (pointer.x - x) / zoom,
            y: (pointer.y - y) / zoom,
        }
        const element = this.document.elementFromPoint?.(this.pointer.x, this.pointer.y)
        const directHandle = element?.closest<HTMLElement>('.xy-flow__handle')
        const inside = pointer.x >= 0
            && pointer.y >= 0
            && pointer.x <= rect.width
            && pointer.y <= rect.height
        let target: Handle | null = null
        let distance = options.connectionRadius

        if (
            inside
            && (!directHandle || options.domNode.contains(directHandle))
        ) {
            for (const handle of handles) {
                if (
                    handle.type === type
                    || handle.nodeId === fromHandle.nodeId
                )
                    continue

                const nextDistance = Math.hypot(handle.x - world.x, handle.y - world.y)

                if (nextDistance <= distance) {
                    target = handle
                    distance = nextDistance
                }
            }

            if (directHandle)
                target = handles.find(
                    handle => handle.nodeId === directHandle.dataset.nodeid && handle.id === directHandle.dataset.handleid && handle.type !== type,
                ) ?? target
        }

        const source = type === 'source' ? fromHandle : target
        const destination = type === 'source' ? target : fromHandle
        this.connection = source
            && destination
            ? {
                source: source.nodeId,
                sourceHandle: source.id ?? null,
                target: destination.nodeId,
                targetHandle: destination.id ?? null,
            }
            : null
        const isValid = this.connection ? options.isValidConnection(this.connection) : null
        this.state = {
            inProgress: true,
            isValid,
            pointer,
            from: {
                x: fromHandle.x,
                y: fromHandle.y,
            },
            fromHandle,
            fromPosition: fromHandle.position,
            fromNode: options.nodeLookup.get(fromHandle.nodeId)!,
            to: target
                && isValid
                ? {
                    x: target.x * zoom + x,
                    y: target.y * zoom + y,
                }
                : pointer,
            toHandle: target,
            toPosition: target?.position ?? Position.Left,
            toNode: target ? options.nodeLookup.get(target.nodeId) ?? null : null,
        }
        options.updateConnection(this.state)
    }

    private move = (event: Event): void => {
        if (this.ended)
            return

        const point = this.eventPoint(event as MouseEvent | TouchEvent)

        if (!point)
            return

        this.pointer = point

        if (
            !this.moving
            && Math.hypot(point.x - this.start.x, point.y - this.start.y) <= 1
        )
            return

        event.preventDefault()
        this.moving = true

        try {
            this.update()

            if (
                !this.ended
                && !this.panning
                && this.frame === null
            )
                this.frame = this.view.requestAnimationFrame(this.autoPan)
        } catch (error) {
            this.cancel()

            throw error
        }
    }

    private autoPan = async (): Promise<void> => {
        this.frame = null

        if (this.ended)
            return

        const rect = this.options.domNode.getBoundingClientRect()
        // Match the connector gesture's existing 40px edge zone and 15px maximum step.
        const speed = (
            position: number,
            size: number,
        ) => 15 * (Math.max(
            0,
            Math.min(1, (40 - position) / 40),
        ) - Math.max(
            0,
            Math.min(1, (position - size + 40) / 40),
        ))
        const delta = {
            x: speed(this.pointer.x - rect.left, rect.width),
            y: speed(this.pointer.y - rect.top, rect.height),
        }
        this.panning = true

        try {
            if (
                (delta.x || delta.y)
                && (await this.options.panBy(delta))
                && !this.ended
            )
                this.update()
        } catch (error) {
            this.cancel()
            this.options.onError(error)
        } finally {
            this.panning = false
        }

        if (!this.ended)
            this.frame = this.view.requestAnimationFrame(this.autoPan)
    }

    private end = (event: Event): void => {
        const point = this.eventPoint(event as MouseEvent | TouchEvent)

        if (
            this.ended
            || !point
        )
            return

        this.pointer = point

        if (this.moving) {
            try {
                this.update()
            } catch (error) {
                this.cancel()

                throw error
            }
        }

        if (this.ended)
            return

        this.cleanup()

        try {
            if (
                this.state?.isValid
                && this.connection
            )
                this.options.onConnect(this.connection)

            if (
                this.moving
                && this.state
            )
                this.options.onReconnectEnd(event as MouseEvent | TouchEvent, this.state)
        } finally {
            this.options.cancelConnection()
        }
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape')
            return

        event.preventDefault()
        this.cancel()
    }

    private touchCancel = (event: TouchEvent): void => {
        if (this.eventPoint(event))
            this.cancel()
    }

    private cleanup(): void {
        this.ended = true
        this.lifetime.destroy()
    }

    cancel = (): void => {
        if (this.ended)
            return

        this.cleanup()
        this.options.cancelConnection()
    }
}
