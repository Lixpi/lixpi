import {
    CanvasController,
    Lifetime,
    NodeRegistry,
    type CanvasConnectionOptions,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    validateScene,
    type CanvasViewport,
    type BoundedZoomScalingOptions,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    type ConnectorMarker,
} from '@lixpi/canvas-engine/frontend/connectors'
import { html } from '@lixpi/ui-primitives/dom'
import { createCanvasConnectorSettings } from '../connectors/connector-settings.ts'
import {
    bindCanvasTheme,
    canvasThemeConnectorSettings,
    type CanvasThemeSource,
} from '../theme/canvas-theme.ts'
import {
    LoadingOverlay,
    type LoadingOverlayOptions,
} from '../loading/loading-overlay.ts'

export {
    createFixedDiagramNodeGeometry,
    DiagramNodeSurface,
    type DiagramNodeAppearance,
    type DiagramNodePaint,
    type DiagramNodeSurfaceOptions,
} from './diagram-node-surface.ts'
export {
    createDiagramNodeRegistration,
    createDiagramNodeAppearance,
    DiagramNodeView,
    type DiagramNodeLabelAppearance,
    type DiagramNodeContent,
    type DiagramNodeViewOptions,
    type DiagramNodeRegistrationOptions,
} from './diagram-node-view.ts'

export type DiagramSize = {
    width: number
    height: number
}

export type DiagramCanvasAppearance = {
    background?: string
    textColor?: string
    mutedColor?: string
    accentColor?: string
    lineColor?: string
    lineFocusColor?: string
}

export type DiagramConnectionMarker = ConnectorMarker & {
    bodyLengthFraction: number
}

export type DiagramCanvasConfig = {
    ariaLabel: string
    sceneKey: string
    className?: string
    theme?: CanvasThemeSource
    registerNodes: (
        registry: NodeRegistry,
        theme?: CanvasThemeSource,
    ) => void
    connectionSettings?: CanvasConnectionOptions['settings'] | false
    connectionPolicy?: CanvasConnectionOptions['policy']
    connectionMarker?: DiagramConnectionMarker
    appearance?: DiagramCanvasAppearance | (() => DiagramCanvasAppearance)
    fitPadding?: number
    maxFitZoom?: number
    minFitZoom?: number
    fitAlignment?: 'center' | 'start'
    hint?: false | {
        armed: string
        disarmed: string
    }
    loadingOverlay?: Omit<LoadingOverlayOptions, 'root' | 'onError'>
    onNodeClick?: (nodeId: string) => void
    onError: (error: unknown) => void
}

export type DiagramLayout = {
    size: DiagramSize
    fitKey: string
}

export type DiagramCanvasInstance = {
    readonly el: HTMLDivElement
    mount: () => void
    setScene: <NodeData>(
        scene: SceneSnapshot<NodeData>,
        layout: DiagramLayout,
    ) => void
    setLoading: (loading: boolean) => void
    setError: (message: string | null) => void
    refit: () => void
    refresh: () => void
    destroy: () => void
}

const DEFAULT_HINT = {
    armed: 'Scroll or pinch to move and zoom · Esc to release',
    disarmed: 'Drag to move · click to use trackpad scrolling here',
}
const CLICK_TOLERANCE = 5
const NO_WHEEL_CLASS = 'nowheel'

// Native engine input owns pan, zoom, pointer capture and touch policy. This
// owner adds only diagram click reporting and the page-scroll arming policy.
class DiagramPointerControls {
    private readonly hint: HTMLDivElement | null
    private press: {
        pointerId: number
        x: number
        y: number
    } | null = null

    constructor(
        private readonly root: HTMLElement,
        private readonly canvas: CanvasController,
        private readonly options: DiagramCanvasConfig,
        onViewportChange: (viewport: CanvasViewport) => void,
    ) {
        this.hint = options.hint === false ? null : html`
            <div
                className="diagram-canvas-hint"
                aria-hidden="true"
            ></div>
        ` as HTMLDivElement

        canvas.installViewport({
            config: {
                panOnDrag: true,
                panOnScroll: true,
                zoomOnScroll: false,
                zoomOnPinch: true,
                zoomOnDoubleClick: true,
                preventScrolling: true,
                noWheelClassName: NO_WHEEL_CLASS,
            },
            onTransformChange: ([x, y, zoom]) => {
                const viewport = {
                    x,
                    y,
                    zoom,
                }
                canvas.setViewport(viewport)
                onViewportChange(viewport)
            },
            onDraggingChange: dragging => root.classList.toggle('diagram-canvas-dragging', dragging),
        })

        if (this.hint)
            root.after(this.hint)

        root.addEventListener('pointerdown', this.pointerDown)
        root.addEventListener('pointerup', this.pointerUp)
        root.addEventListener('pointercancel', this.pointerCancel)
        root.addEventListener('pointerleave', this.disarm)
        root.ownerDocument.addEventListener('keydown', this.keyDown)
        this.disarm()
    }

    private pointerDown = (event: PointerEvent): void => {
        if (
            event.button !== 0
            || !event.isPrimary
        )
            return

        const target = event.target

        if (
            target instanceof Element
            && target.closest('button, input, textarea, select, a, [data-diagram-interactive]')
        )
            return

        this.press = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        }
        this.root.classList.remove(NO_WHEEL_CLASS)
        this.root.dataset.armed = 'true'

        if (this.hint)
            this.hint.textContent = (this.options.hint || DEFAULT_HINT).armed
    }

    private pointerUp = (event: PointerEvent): void => {
        const press = this.press

        if (press?.pointerId !== event.pointerId)
            return

        this.press = null

        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE)
            return

        const point = this.canvas.clientToWorld({
            x: event.clientX,
            y: event.clientY,
        })
        const node = this.canvas.scene.scene.nodes.findLast(candidate => {
            const geometry = this.canvas.scene.getNodeGeometry(candidate.nodeId)?.hitBounds

            return geometry
                && point.x >= geometry.x
                && point.x <= geometry.x + geometry.width
                && point.y >= geometry.y
                && point.y <= geometry.y + geometry.height
        })

        if (node)
            this.options.onNodeClick?.(node.nodeId)
    }

    private pointerCancel = (): void => void (this.press = null)

    private disarm = (): void => {
        this.root.classList.add(NO_WHEEL_CLASS)
        this.root.dataset.armed = 'false'

        if (this.hint)
            this.hint.textContent = (this.options.hint || DEFAULT_HINT).disarmed
    }

    setAppearance(appearance: DiagramCanvasAppearance | undefined): void {
        if (this.hint) {
            if (appearance?.mutedColor)
                this.hint.style.color = appearance.mutedColor
            else
                this.hint.style.removeProperty('color')
        }
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape')
            this.disarm()
    }

    destroy(): void {
        this.root.removeEventListener('pointerdown', this.pointerDown)
        this.root.removeEventListener('pointerup', this.pointerUp)
        this.root.removeEventListener('pointercancel', this.pointerCancel)
        this.root.removeEventListener('pointerleave', this.disarm)
        this.root.ownerDocument.removeEventListener('keydown', this.keyDown)
        this.root.classList.remove(NO_WHEEL_CLASS, 'diagram-canvas-dragging')
        delete this.root.dataset.armed
        this.hint?.remove()
        this.press = null
    }
}

export class DiagramCanvas implements DiagramCanvasInstance {
    readonly el: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private readonly error: HTMLDivElement
    private readonly connectionSettings: CanvasConnectionOptions['settings'] | false
    private readonly connectorZoomScaling: BoundedZoomScalingOptions = { minZoom: 0.4 }
    private canvas: CanvasController | null = null
    private loadingOverlay: LoadingOverlay | null = null
    private pointers: DiagramPointerControls | null = null
    private scene: SceneSnapshot | null = null
    private layout: DiagramLayout | null = null
    private fitKey: string | null = null
    private appearanceVersion = 0
    private loading = false
    private errorMessage: string | null = null
    private destroyed = false
    private mounted = false
    private viewport: CanvasViewport = {
        x: 0,
        y: 0,
        zoom: 1,
    }

    constructor(private readonly options: DiagramCanvasConfig) {
        this.connectionSettings = options.connectionSettings ?? (options.theme ? canvasThemeConnectorSettings(options.theme.value) : createCanvasConnectorSettings())
        this.error = html`
            <div
                className="diagram-canvas-error"
                role="status"
                hidden
            ></div>
        ` as HTMLDivElement
        this.el = html`
            <div
                className=${options.className ? `diagram-canvas ${options.className}` : 'diagram-canvas'}
                role="region"
                aria-label=${options.ariaLabel}
            >${this.error}</div>
        ` as HTMLDivElement

        if (options.theme)
            this.lifetime.own(
                bindCanvasTheme(
                    this.el,
                    options.theme,
                    () => this.refresh(),
                ),
            )

        this.refreshAppearance()
    }

    // The host inserts el and gives it an explicit height before mounting.
    mount(): void {
        if (
            this.mounted
            || this.destroyed
        )
            return

        this.mounted = true

        try {
            const registry = new NodeRegistry()
            this.options.registerNodes(registry, this.options.theme)
            const canvas = new CanvasController({
                root: this.el,
                scene: {
                    sceneKey: this.options.sceneKey,
                    revision: 'empty',
                    nodes: [],
                    edges: [],
                },
                viewport: this.viewport,
                registry,
                interaction: false,
                connectors: this.connectionSettings ? {
                    settings: this.connectionSettings,
                    renderer: {
                        zoomScaling: this.connectorZoomScaling,
                        ...(this.options.connectionMarker ? { marker: this.options.connectionMarker } : {}),
                    },
                    markerBodyLengthFraction: this.options.connectionMarker?.bodyLengthFraction,
                    policy: {
                        ...(!this.options.connectionMarker ? { targetMarker: () => 'none' as const } : {}),
                        ...this.options.connectionPolicy,
                    },
                } : false,
                onIntent: () => {},
                onError: this.options.onError,
            })
            this.canvas = canvas
            this.lifetime.own(() => canvas.destroy())
            const pointers = new DiagramPointerControls(
                this.el,
                canvas,
                this.options,
                viewport => void (this.viewport = viewport),
            )
            this.pointers = pointers
            this.lifetime.own(() => pointers.destroy())
            this.refreshAppearance()

            if (this.options.loadingOverlay) {
                const overlay = new LoadingOverlay({
                    ...this.options.loadingOverlay,
                    root: this.el,
                    onError: this.options.onError,
                })
                this.loadingOverlay = overlay
                this.lifetime.own(() => overlay.destroy())
                overlay.setVisible(this.loading)
                overlay.setErrorMessage(this.errorMessage)
                this.error.hidden = true
            }

            const resize = new ResizeObserver(() => {
                if (this.canvas === canvas) {
                    canvas.resize()
                    this.refit()
                }
            })
            resize.observe(this.el)
            this.lifetime.own(() => resize.disconnect())
            this.applyScene()
            this.refit()
            void this.watchReadiness(canvas)
        } catch (error) {
            this.destroy()
            this.options.onError(error)
        }
    }

    setScene<NodeData>(
        scene: SceneSnapshot<NodeData>,
        layout: DiagramLayout,
    ): void {
        if (this.destroyed)
            return

        if (
            !Number.isFinite(layout.size.width)
            || !Number.isFinite(layout.size.height)
            || layout.size.width <= 0
            || layout.size.height <= 0
        )
            throw new Error('Diagram layout requires finite positive dimensions')

        validateScene(scene)
        const needsFit = this.fitKey !== layout.fitKey || this.scene?.sceneKey !== scene.sceneKey
        this.canvas?.setScene({
            ...scene,
            revision: `${scene.revision}:${this.appearanceVersion}`,
        })
        this.scene = scene
        this.layout = {
            size: { ...layout.size },
            fitKey: layout.fitKey,
        }
        this.fitKey = layout.fitKey

        if (needsFit)
            this.refit()
    }

    setLoading(loading: boolean): void {
        if (this.destroyed)
            return

        this.loading = loading
        this.el.ariaBusy = String(loading)

        if (loading) {
            this.errorMessage = null
            this.error.textContent = ''
            this.error.hidden = true
        }

        this.loadingOverlay?.setVisible(loading)
    }

    setError(message: string | null): void {
        if (this.destroyed)
            return

        this.errorMessage = message?.trim() || null
        this.error.textContent = this.errorMessage ?? ''
        this.error.hidden = !this.errorMessage || Boolean(this.loadingOverlay)
        this.loadingOverlay?.setErrorMessage(this.errorMessage)
    }

    refit(): void {
        if (
            !this.canvas
            || !this.layout
        )
            return

        const width = this.el.clientWidth
        const height = this.el.clientHeight

        if (
            width <= 0
            || height <= 0
        )
            return

        const padding = Math.max(0, this.options.fitPadding ?? 32)
        const maximumZoom = this.options.maxFitZoom ?? 1.2
        const minimumZoom = Math.min(
            maximumZoom,
            Math.max(0, this.options.minFitZoom ?? 0),
        )
        const zoom = Math.max(
            minimumZoom,
            Math.min(
                maximumZoom,
                Math.max(1, width - padding * 2) / this.layout.size.width,
                Math.max(1, height - padding * 2) / this.layout.size.height,
            ),
        )
        const sceneWidth = this.layout.size.width * zoom
        const sceneHeight = this.layout.size.height * zoom
        const alignStart = this.options.fitAlignment === 'start'
        this.viewport = {
            x: alignStart
                && sceneWidth > width - padding * 2
                ? padding
                : (width - sceneWidth) / 2,
            y: alignStart
                && sceneHeight > height - padding * 2
                ? padding
                : (height - sceneHeight) / 2,
            zoom,
        }
        this.canvas.setViewport(this.viewport)
    }

    // A refresh repaints retained views and connections without replacing their drawing resources.
    refresh(): void {
        if (this.destroyed)
            return

        this.appearanceVersion += 1
        this.refreshAppearance()
        this.applyScene()
    }

    private refreshAppearance(): void {
        const theme = this.options.theme?.value
        const themeConnections = theme ? canvasThemeConnectorSettings(theme) : undefined

        if (
            themeConnections
            && this.connectionSettings
            && this.options.connectionSettings === undefined
        ) for (const key of Object.keys(themeConnections) as Array<keyof typeof themeConnections>)
            Reflect.set(
                this.connectionSettings,
                key,
                themeConnections[key],
            )

        if (this.connectionSettings) {
            this.connectorZoomScaling.minZoom = this.connectionSettings.scaling.zoomScaling.minZoom
            this.connectorZoomScaling.lowZoomPower = this.connectionSettings.scaling.zoomScaling.lowZoomPower
            this.connectionSettings.scaling.zoomScaling = this.connectorZoomScaling
        }

        const overrides = typeof this.options.appearance === 'function' ? this.options.appearance() : this.options.appearance
        const appearance: DiagramCanvasAppearance = {
            ...(theme ? {
                background: theme.colors.background,
                textColor: theme.colors.text,
                mutedColor: theme.colors.muted,
                accentColor: theme.colors.accent,
                lineColor: themeConnections?.styles.lineDefaultColor,
                lineFocusColor: themeConnections?.styles.lineFocusColor,
            } : {}),
            ...overrides,
        }

        if (this.connectionSettings) {
            this.connectionSettings.styles.lineDefaultColor = appearance.lineColor ?? this.connectionSettings.styles.lineDefaultColor
            this.connectionSettings.styles.lineFocusColor = appearance.lineFocusColor ?? this.connectionSettings.styles.lineFocusColor
        }

        const properties = {
            '--diagram-canvas-background': appearance.background,
            '--diagram-canvas-text': appearance.textColor,
            '--diagram-canvas-muted': appearance.mutedColor,
            '--diagram-canvas-accent': appearance.accentColor,
            '--connector-line-default-color': appearance.lineColor ?? (this.connectionSettings ? this.connectionSettings.styles.lineDefaultColor : undefined),
            '--connector-line-focus-color': appearance.lineFocusColor ?? (this.connectionSettings ? this.connectionSettings.styles.lineFocusColor : undefined),
        }
        this.pointers?.setAppearance(appearance)

        for (const [property, value] of Object.entries(properties)) {
            if (value)
                this.el.style.setProperty(property, value)
            else
                this.el.style.removeProperty(property)
        }

        if (this.connectionSettings)
            this.canvas?.setConnectionSettings(this.connectionSettings)
    }

    private async watchReadiness(canvas: CanvasController): Promise<void> {
        let ready = false

        try {
            ready = await canvas.ready
        } catch (error) {
            if (!this.destroyed)
                this.options.onError(error)
        }

        if (
            ready
            || this.destroyed
            || this.canvas !== canvas
        )
            return

        this.canvas = null
        this.pointers?.destroy()
        this.pointers = null
    }

    private applyScene(): void {
        if (
            !this.canvas
            || !this.scene
        )
            return

        this.canvas.setScene({
            ...this.scene,
            revision: `${this.scene.revision}:${this.appearanceVersion}`,
        })
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true

        try {
            this.lifetime.destroy()
        } finally {
            this.canvas = null
            this.loadingOverlay = null
            this.pointers = null
            this.scene = null
            this.layout = null
            this.el.remove()
        }
    }
}

export const createDiagramCanvas = (options: DiagramCanvasConfig): DiagramCanvasInstance => new DiagramCanvas(options)
