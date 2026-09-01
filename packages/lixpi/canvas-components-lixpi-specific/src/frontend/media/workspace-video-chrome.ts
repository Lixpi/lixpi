import { select } from 'd3-selection'
import type { VideoCanvasNode } from '@lixpi/constants'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import { videoControlIcons } from '@lixpi/ui-kit/svg'
import {
    applyVideoControlsHostStyleProperties,
    createVideoControls,
    type VideoControlsInstance,
    type VideoControlsSettings,
} from '@lixpi/ui-kit/components/video-controls'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getResizeCursor,
    getResizeHandleScaledSizes,
    scaleCanvasChromeToScreenForZoom,
    scaleCanvasChromeWorldSizeForZoom,
    type BoundedZoomScalingOptions,
    type CanvasEngineRect,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'
import type {
    WorkspaceNodeShellsOptions,
    WorkspaceResizeCorner,
} from '../nodes/workspace-node-shells.ts'

export type WorkspaceVideoControlsSettings = VideoControlsSettings & {
    canvas: {
        horizontalInset: number
        compactHorizontalInset: number
        compactWidthThreshold: number
        bottomInset: number
        zoomScaling: BoundedZoomScalingOptions
    }
}

export type WorkspaceVideoChromeOptions = Pick<WorkspaceNodeShellsOptions, 'document' | 'getResizeSettings' | 'startResize' | 'togglePlayback'> & {
    settings: WorkspaceVideoControlsSettings
    getVideo: (nodeId: string) => HTMLVideoElement | null | undefined
    getBounds: (node: VideoCanvasNode) => CanvasEngineRect
    getViewport: () => CanvasViewport
    startDrag: (event: MouseEvent, nodeId: string) => void
}

type ControlsLayout = { insetX: number; top: number; width: number; height: number; logicalWidth: number; responsiveWidth: number }

function safeZoom(viewport: CanvasViewport): number {
    return Number.isFinite(viewport.zoom) ? Math.max(viewport.zoom, 0.01) : 1
}

// Canvas positioning and surface gestures wrap UI-kit's shared video controls.
// The native video stays visible so browser playback and fullscreen keep working.
export class WorkspaceVideoChrome {
    readonly element: HTMLDivElement
    private readonly entries = new Map<string, VideoChromeEntry>()
    private destroyed = false

    constructor(private readonly options: WorkspaceVideoChromeOptions) {
        const html = createDocumentHtml(options.document)
        this.element = html`<div className="workspace-media-chrome-viewport"></div>` as HTMLDivElement
    }

    sync(nodes: readonly VideoCanvasNode[]): void {
        if (this.destroyed) return
        const retained = new Set<string>()
        for (const node of nodes) {
            const video = this.options.getVideo(node.nodeId)
            if (!video || (!video.currentSrc && !video.src)) continue
            retained.add(node.nodeId)
            let entry = this.entries.get(node.nodeId)
            if (!entry || entry.video !== video) {
                entry?.destroy()
                this.entries.delete(node.nodeId)
                entry = new VideoChromeEntry(node.nodeId, video, this.options)
                this.entries.set(node.nodeId, entry)
                this.element.appendChild(entry.element)
            }
            entry.update(this.options.getBounds(node), this.options.getViewport())
        }
        for (const [nodeId, entry] of this.entries) {
            if (retained.has(nodeId)) continue
            entry.destroy()
            this.entries.delete(nodeId)
        }
    }

    update(nodeId: string, bounds: CanvasEngineRect, viewport: CanvasViewport): void {
        this.entries.get(nodeId)?.update(bounds, viewport)
    }

    outsideOffsetScreen(nodeId: string, viewport: CanvasViewport): number {
        if (!this.entries.has(nodeId)) return 0
        const { settings } = this.options
        const scaling = getAdaptiveBoundedZoomScalingOptions(settings.canvas.zoomScaling)
        const zoom = safeZoom(viewport)
        return scaleCanvasChromeToScreenForZoom(settings.canvas.bottomInset, zoom, scaling)
            + scaleCanvasChromeToScreenForZoom(settings.height, zoom, scaling)
    }

    clear(): void {
        const entries = [...this.entries.values()]
        this.entries.clear()
        const cleanup = new Lifetime()
        for (const entry of entries) cleanup.own(() => entry.destroy())
        cleanup.destroy()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        try {
            this.clear()
        } finally {
            this.element.remove()
        }
    }
}

class VideoChromeEntry {
    readonly element: HTMLElement
    private readonly lifetime = new Lifetime()
    private readonly surface: HTMLElement
    private readonly host: HTMLElement
    private readonly svg: SVGSVGElement
    private readonly controls: VideoControlsInstance

    constructor(private readonly nodeId: string, readonly video: HTMLVideoElement, private readonly options: WorkspaceVideoChromeOptions) {
        const html = createDocumentHtml(options.document)
        this.element = html`
            <div className="workspace-video-chrome" data=${{ videoChromeNodeId: nodeId }}>
                <div className="workspace-video-surface"></div>
                <div className="workspace-video-controls-host"></div>
            </div>
        ` as HTMLElement
        this.surface = this.element.querySelector('.workspace-video-surface')!
        this.host = this.element.querySelector('.workspace-video-controls-host')!
        this.lifetime.own(() => this.element.remove())
        const originalParent = video.parentNode
        const originalNextSibling = video.nextSibling
        try {
            this.surface.appendChild(video)
            this.lifetime.own(() => {
                if (video.parentNode !== this.surface) return
                if (originalParent) originalParent.insertBefore(video, originalNextSibling?.parentNode === originalParent ? originalNextSibling : null)
                else video.remove()
            })
            this.listen('mousemove', event => {
                const corner = this.resizeCorner(event)
                this.surface.style.cursor = corner ? getResizeCursor(corner) : ''
            })
            this.listen('mouseleave', () => {
                this.surface.style.cursor = ''
            })
            this.listen('mousedown', event => {
                const corner = this.resizeCorner(event)
                if (corner) options.startResize(event, nodeId, corner)
                else options.startDrag(event, nodeId)
            })
            this.listen('dblclick', event => {
                event.preventDefault()
                event.stopPropagation()
                options.togglePlayback(nodeId)
            })
            applyVideoControlsHostStyleProperties(this.host, options.settings.styles)
            const svg = select(this.host).append('svg').attr('class', 'workspace-video-controls-svg').attr('width', '100%').attr('height', '100%')
            this.svg = svg.node()!
            this.controls = createVideoControls(svg, {
                icons: videoControlIcons,
                settings: options.settings,
                id: nodeId,
                x: 0,
                y: 0,
                width: 1,
                height: options.settings.height,
                responsiveWidth: 1,
                videoEl: video,
                className: 'workspace-video-controls',
            })
            this.lifetime.own(() => this.controls.destroy())
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    private listen(type: keyof HTMLElementEventMap, listener: (event: MouseEvent) => void): void {
        this.surface.addEventListener(type, listener as EventListener)
        this.lifetime.own(() => this.surface.removeEventListener(type, listener as EventListener))
    }

    private layout(bounds: CanvasEngineRect, viewport: CanvasViewport): ControlsLayout {
        const { settings } = this.options
        const zoom = safeZoom(viewport)
        const scaling = getAdaptiveBoundedZoomScalingOptions(settings.canvas.zoomScaling)
        const screenScale = scaleCanvasChromeToScreenForZoom(1, zoom, scaling)
        const baseInset = bounds.width * zoom >= settings.canvas.compactWidthThreshold ? settings.canvas.horizontalInset : settings.canvas.compactHorizontalInset
        const insetX = scaleCanvasChromeWorldSizeForZoom(baseInset, zoom, scaling)
        const width = Math.max(1, bounds.width - insetX * 2)
        return {
            insetX,
            width,
            top: bounds.height + scaleCanvasChromeWorldSizeForZoom(settings.canvas.bottomInset, zoom, scaling),
            height: Math.max(1, settings.height * screenScale / zoom),
            responsiveWidth: Math.max(1, width * zoom),
            logicalWidth: Math.max(1, width * zoom / screenScale),
        }
    }

    update(bounds: CanvasEngineRect, viewport: CanvasViewport): void {
        const layout = this.layout(bounds, viewport)
        applyStyle(this.element, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${layout.top + layout.height}px` })
        applyStyle(this.surface, { width: `${bounds.width}px`, height: `${bounds.height}px` })
        applyStyle(this.host, { left: `${layout.insetX}px`, top: `${layout.top}px`, width: `${layout.width}px`, height: `${layout.height}px` })
        this.svg.setAttribute('viewBox', `0 0 ${layout.logicalWidth} ${this.options.settings.height}`)
        this.controls.resize(0, 0, layout.logicalWidth, layout.responsiveWidth)
    }

    private resizeCorner(event: MouseEvent): WorkspaceResizeCorner | null {
        const rect = this.surface.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
        const settings = this.options.getResizeSettings()
        const zoom = safeZoom(this.options.getViewport())
        const { size, offset } = settings.useZoomCompensatedScaling
            ? getResizeHandleScaledSizes(zoom, { baseSize: settings.size, baseOffset: settings.offset, minSize: settings.minSize, zoomScaling: getAdaptiveBoundedZoomScalingOptions(settings.zoomScaling) })
            : settings
        const hitSize = Math.max(16, (size + Math.max(0, offset)) * zoom)
        if (x <= hitSize && y <= hitSize) return 'top-left'
        if (x >= rect.width - hitSize && y <= hitSize) return 'top-right'
        if (x <= hitSize && y >= rect.height - hitSize) return 'bottom-left'
        if (x >= rect.width - hitSize && y >= rect.height - hitSize) return 'bottom-right'
        return null
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
