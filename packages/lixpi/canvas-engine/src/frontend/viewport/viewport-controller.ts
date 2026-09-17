import { ViewportInput } from './viewport-input.ts'
import {
    assertViewport,
    type CanvasTransform,
} from '../../shared/viewport/coordinates.ts'
import {
    defaultPanZoomConfig,
    type CanvasPanZoomConfig,
} from './viewport-input-config.ts'
export { defaultPanZoomConfig } from './viewport-input-config.ts'
export type { CanvasPanZoomConfig } from './viewport-input-config.ts'
export type { CanvasTransform } from '../../shared/viewport/coordinates.ts'
import {
    type CanvasViewport,
    type Dispose,
} from '../../shared/index.ts'
import {
    InteractionLocks,
    type InteractionLock,
} from '../runtime/interaction-locks.ts'

export type ViewportControllerOptions = {
    root: HTMLElement
    viewport: CanvasViewport
    config?: Partial<Omit<CanvasPanZoomConfig, 'onTransformChange'>>
    minZoom?: number
    maxZoom?: number
    onTransformChange: (transform: CanvasTransform) => void
    onDraggingChange?: (dragging: boolean) => void
}

export class ViewportController {
    private readonly backend: ViewportInput
    private readonly locks = new InteractionLocks()
    private readonly config: CanvasPanZoomConfig
    private viewport: CanvasViewport
    private destroyed = false

    constructor(private readonly options: ViewportControllerOptions) {
        this.validate(options.viewport)
        this.viewport = { ...options.viewport }
        this.config = {
            ...defaultPanZoomConfig(this.onTransformChange),
            ...options.config,
            onTransformChange: this.onTransformChange,
        }
        this.backend = new ViewportInput({
            root: options.root,
            viewport: this.viewport,
            minZoom: options.minZoom ?? 0.1,
            maxZoom: options.maxZoom ?? 2,
            onDraggingChange: dragging => options.onDraggingChange?.(dragging),
        })

        try {
            this.locks.subscribe(
                state =>
                    this.backend.update(
                        state.locked
                            ? {
                                ...this.config,
                                panOnDrag: false,
                                panOnScroll: false,
                                zoomOnScroll: false,
                                zoomOnPinch: false,
                                zoomOnDoubleClick: false,
                                userSelectionActive: true,
                                connectionInProgress: true,
                                selectionOnDrag: state.selection,
                            }
                            : this.config,
                    ),
            )
        } catch (error) {
            this.backend.destroy()
            this.locks.destroy()

            throw error
        }
    }

    private validate = assertViewport

    private onTransformChange = (transform: CanvasTransform): void => {
        if (this.destroyed)
            return

        if (this.locked) {
            this.backend.syncViewport(this.viewport)

            return
        }

        const viewport = {
            x: transform[0],
            y: transform[1],
            zoom: transform[2],
        }
        this.validate(viewport)
        this.viewport = viewport
        this.options.onTransformChange([...transform])
    }

    get locked(): boolean {
        return this.locks.state.locked
    }
    getViewport(): CanvasViewport {
        return { ...this.viewport }
    }
    lock(options?: InteractionLock): Dispose {
        return this.locks.acquire(options)
    }

    syncViewport(viewport: CanvasViewport): void {
        if (this.destroyed)
            return

        this.validate(viewport)
        this.viewport = { ...viewport }
        this.backend.syncViewport(viewport)
    }

    async setViewport(viewport: CanvasViewport): Promise<boolean> {
        if (
            this.destroyed
            || this.locked
        )
            return false

        this.validate(viewport)

        return Boolean(await this.backend.setViewport(viewport))
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.locks.destroy()
        this.backend.destroy()
    }
}
