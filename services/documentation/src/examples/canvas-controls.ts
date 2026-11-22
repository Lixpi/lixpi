import { LoadingOverlay } from '@lixpi/canvas-components/loading'
import {
    type CanvasScrollCapture,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasGraphLayoutOptions,
} from '@lixpi/canvas-engine/shared'
import {
    type ExampleFrame,
} from './example-frame.ts'
import { loadingOutline } from './loading-outline.ts'

// The presentation surface shared by CanvasController and LixpiWorkspaceCanvas.
export type ExampleCanvas = {
    readonly locked: boolean
    setLocked(locked: boolean): void
    readonly autoFit: boolean
    setAutoFit(enabled: boolean): void
    readonly scrollCapture: CanvasScrollCapture
    setScrollCapture(mode: CanvasScrollCapture): void
    fitToContent(): boolean
}

export type ExampleCanvasLayout = {
    readonly layout: CanvasGraphLayoutOptions | false
    setLayout(layout: CanvasGraphLayoutOptions | false): void
}

export type ExampleCanvasControlsOptions = {
    // The element the loading overlay covers. Defaults to the example stage.
    loadingRoot?: HTMLElement
    // Supplying a layout adds the Auto layout switch.
    layout?: {
        canvas: ExampleCanvasLayout
        options: CanvasGraphLayoutOptions
    }
}

type LoadingState = 'ready' | 'loading' | 'error'

const scrollModes: Record<CanvasScrollCapture, string> = {
    always: 'Canvas scrolls',
    'on-activate': 'Click to activate',
}

// Adds the canvas presentation controls every example canvas shares to the
// sidebar's Canvas section.
export class ExampleCanvasControls {
    private overlay: LoadingOverlay | null = null
    private releaseTheme: (() => void) | null = null
    private state: LoadingState = 'ready'

    constructor(
        private readonly frame: ExampleFrame,
        private readonly canvas: ExampleCanvas,
        private readonly options: ExampleCanvasControlsOptions = {},
    ) {
        const parameters = frame.canvasParameters
        frame.toggle(
            'Lock canvas',
            canvas.locked,
            locked => {
                canvas.setLocked(locked)
                frame.report(
                    locked
                        ? 'Content is locked. Drag pans, pinch zooms, and nodes and connectors cannot be moved, connected, selected or deleted.'
                        : 'Content is editable again.',
                )
            },
            parameters,
        )
        frame.toggle(
            'Auto fit',
            canvas.autoFit,
            enabled => canvas.setAutoFit(enabled),
            parameters,
        )

        if (options.layout) {
            const layout = options.layout
            frame.toggle(
                'Auto layout',
                Boolean(layout.canvas.layout),
                enabled => layout.canvas.setLayout(enabled ? layout.options : false),
                parameters,
            )
        }

        frame.select(
            'Page scrolling',
            canvas.scrollCapture,
            scrollModes,
            mode => canvas.setScrollCapture(mode === 'on-activate' ? 'on-activate' : 'always'),
            parameters,
        )
        frame.select(
            'Loading state',
            this.state,
            {
                ready: 'Ready',
                loading: 'Loading',
                error: 'Error',
            },
            state => this.setState(state === 'loading'
                || state === 'error'
                ? state
                : 'ready'),
            parameters,
        )
        frame.button(
            'Fit content',
            () => {
                if (!canvas.fitToContent())
                    frame.report('Nothing to fit yet: the canvas has no content or no visible area, or a gesture is holding the viewport.')
            },
            frame.canvasControls,
        )
    }

    private setState(state: LoadingState): void {
        this.state = state

        if (
            state === 'ready'
            && !this.overlay
        )
            return

        const overlay = this.overlay ?? this.createOverlay()
        overlay.setVisible(state !== 'ready')
        overlay.setErrorMessage(state === 'error' ? 'The canvas content could not be loaded. Choose Retry.' : null)
    }

    private createOverlay(): LoadingOverlay {
        const overlay = new LoadingOverlay({
            root: this.options.loadingRoot ?? this.frame.stage,
            outline: loadingOutline(this.frame.theme.value),
            errorTitle: 'Canvas unavailable',
            retryLabel: 'Retry',
            onRetry: () => this.setState('ready'),
            onError: this.frame.error,
        })
        this.overlay = overlay
        this.releaseTheme = this.frame.onThemeChange(theme => overlay.setAppearance({ outline: loadingOutline(theme) }))

        return overlay
    }

    destroy(): void {
        this.releaseTheme?.()
        this.releaseTheme = null
        this.overlay?.destroy()
        this.overlay = null
    }
}
