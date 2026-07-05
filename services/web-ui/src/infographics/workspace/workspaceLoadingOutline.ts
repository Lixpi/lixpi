import { Application, Container } from 'pixi.js'

import { getAdaptiveBoundedZoomScalingOptions, scaleCanvasChromeWorldSizeForZoom } from '@lixpi/canvas-engine'
import {
    getRoundedOutlinePerimeter,
    PixiTravelingOutlineRenderer,
    type PixiTravelingOutlineDatum,
    type PixiTravelingOutlineStyle,
} from '@lixpi/canvas-engine/frontend/rendering'
import { html } from '$src/utils/domTemplates.ts'
import { settings } from '$src/settings.ts'

export type WorkspaceLoadingOutlineConfig = {
    paneEl: HTMLDivElement
    onRetry?: () => void
}

export type WorkspaceLoadingOutlineInstance = {
    setVisible: (visible: boolean) => void
    setErrorMessage: (message: string | null) => void
    destroy: () => void
}

const WORKSPACE_LOADING_OUTLINE_ID = 'workspace-loading-outline'

class WorkspaceLoadingOutline implements WorkspaceLoadingOutlineInstance {
    private readonly paneEl: HTMLDivElement
    private readonly hostEl: HTMLDivElement
    private readonly errorEl: HTMLDivElement
    private readonly errorMessageEl: HTMLDivElement
    private readonly app = new Application()
    private readonly outlineLayer = new Container({ label: 'workspace-loading-outline-layer' })
    private readonly resizeObserver: ResizeObserver
    private outlineRenderer: PixiTravelingOutlineRenderer | null = null
    private renderRaf: number | null = null
    private visible = false
    private ready = false
    private destroyed = false

    constructor(private readonly config: WorkspaceLoadingOutlineConfig) {
        this.paneEl = config.paneEl
        this.hostEl = html`<div className="workspace-loading-outline" aria-hidden="true"></div>` as HTMLDivElement
        this.errorEl = html`
            <div className="workspace-loading-error" role="status">
                <div className="workspace-loading-error-title">Workspace failed to load</div>
                <div className="workspace-loading-error-message"></div>
                <button
                    type="button"
                    className="workspace-loading-error-retry"
                    onclick=${this.handleRetryClick}
                >Retry</button>
            </div>
        ` as HTMLDivElement
        const messageEl = this.errorEl.querySelector<HTMLDivElement>('.workspace-loading-error-message')
        if (!messageEl) throw new Error('Workspace loading error message element missing.')
        this.errorMessageEl = messageEl
        this.hostEl.appendChild(this.errorEl)
        this.paneEl.appendChild(this.hostEl)

        this.resizeObserver = new ResizeObserver(() => {
            if (this.visible) this.syncOutline()
        })
        this.resizeObserver.observe(this.hostEl)

        void this.initialize()
    }

    setVisible = (visible: boolean): void => {
        if (this.visible === visible) return
        this.visible = visible
        if (visible) this.setErrorMessage(null)
        this.renderState()
        this.syncOutline()
    }

    setErrorMessage = (message: string | null): void => {
        const normalizedMessage = message?.trim() || ''
        this.errorMessageEl.textContent = normalizedMessage
        this.renderState()
        this.syncOutline()
    }

    destroy = (): void => {
        this.destroyed = true
        if (this.renderRaf !== null) {
            cancelAnimationFrame(this.renderRaf)
            this.renderRaf = null
        }
        this.resizeObserver.disconnect()
        this.outlineRenderer?.destroy()
        this.outlineRenderer = null
        this.hostEl.remove()
        if (this.ready) this.app.destroy(true, { children: true, texture: true, textureSource: true })
    }

    private async initialize(): Promise<void> {
        try {
            await this.app.init({
                preference: 'webgpu',
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
                resizeTo: this.hostEl,
                autoStart: false,
                sharedTicker: false,
                webgpu: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
                webgl: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
            })
            this.app.ticker.stop()

            if (this.destroyed) {
                this.app.destroy(true, { children: true, texture: true, textureSource: true })
                return
            }

            this.app.stage.addChild(this.outlineLayer)
            this.outlineRenderer = new PixiTravelingOutlineRenderer({
                container: this.outlineLayer,
                style: this.getOutlineStyle(),
                getStrokeScale: this.getStrokeScale,
                onFrame: this.scheduleRender,
            })
            this.hostEl.appendChild(this.app.canvas)
            this.ready = true
            this.syncOutline()
        } catch (error) {
            if (!this.destroyed) console.error('Failed to initialize workspace loading outline:', error)
        }
    }

    private syncOutline(): void {
        if (!this.ready || !this.outlineRenderer || this.destroyed) return
        if (!this.visible || this.hasErrorMessage()) {
            this.outlineRenderer.sync([])
            return
        }

        this.outlineRenderer.sync([this.getOutlineDatum()])
    }

    private renderState(): void {
        const hasError = this.hasErrorMessage()
        this.hostEl.ariaHidden = hasError ? 'false' : 'true'
        this.hostEl.classList.toggle('is-visible', this.visible || hasError)
        this.hostEl.classList.toggle('is-loading', this.visible && !hasError)
        this.hostEl.classList.toggle('is-error', hasError)
    }

    private hasErrorMessage(): boolean {
        return Boolean(this.errorMessageEl.textContent?.trim())
    }

    private handleRetryClick = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        this.config.onRetry?.()
    }

    private getOutlineDatum(): PixiTravelingOutlineDatum {
        const size = getWorkspaceLoadingCircleSize()
        const hostSize = this.getHostSize()
        return {
            id: WORKSPACE_LOADING_OUTLINE_ID,
            x: (hostSize.width - size) / 2,
            y: (hostSize.height - size) / 2,
            width: size,
            height: size,
            radius: size / 2,
            visible: true,
            direction: 'clockwise',
            durationMs: getGeneratedMediaPreFrameCircleDurationMs(size),
            snakeLengthFraction: getGeneratedMediaPreFrameCircleSnakeLengthFraction(size),
        }
    }

    private getHostSize(): { width: number; height: number } {
        const rect = this.hostEl.getBoundingClientRect()
        return {
            width: this.hostEl.clientWidth || this.paneEl.clientWidth || rect.width || window.innerWidth,
            height: this.hostEl.clientHeight || this.paneEl.clientHeight || rect.height || window.innerHeight,
        }
    }

    private getOutlineStyle(): PixiTravelingOutlineStyle {
        const animation = settings.mediaNode.inProgressOutlineAnimation
        const styles = animation.styles
        return {
            radius: animation.radius,
            gap: animation.gap ?? 0,
            snakeHeadWidth: animation.snakeWidth,
            snakeTailWidthFraction: animation.snakeTailWidthFraction ?? 0.18,
            snakeTailThinLengthFraction: animation.snakeTailThinLengthFraction,
            snakeWidthTaperPower: animation.snakeWidthTaperPower,
            snakeLengthFraction: animation.snakeLengthFraction,
            snakeHeadRoundLengthFraction: animation.snakeHeadRoundLengthFraction,
            snakeTailAlpha: styles.snakeTailAlpha,
            snakeColors: styles.snakeColors,
            glassMaterial: styles.glassMaterial,
            durationMs: animation.animationDurationMs,
        }
    }

    private getStrokeScale = (): number => {
        const animation = settings.mediaNode.inProgressOutlineAnimation
        return scaleCanvasChromeWorldSizeForZoom(
            1,
            1,
            getAdaptiveBoundedZoomScalingOptions(animation.zoomScaling ?? { minZoom: 0 })
        )
    }

    private scheduleRender = (): void => {
        if (this.destroyed || !this.ready || this.renderRaf !== null) return
        this.renderRaf = requestAnimationFrame(() => {
            this.renderRaf = null
            if (this.destroyed || !this.ready) return
            this.app.render()
        })
    }
}

function getGeneratedMediaPreFrameCircleSize(): number {
    const generatedMediaSize = settings.mediaBranchLineage.generatedMediaSize
    const configuredScale = Number(settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale)
    const scale = Number.isFinite(configuredScale) && configuredScale > 0
        ? Math.min(1, configuredScale)
        : 1 / 3
    return Math.max(1, generatedMediaSize * scale)
}

function getWorkspaceLoadingCircleSize(): number {
    const configuredScale = Number(settings.workspaceLoadingOutline.diameterScale)
    const scale = Number.isFinite(configuredScale) && configuredScale > 0
        ? configuredScale
        : 1
    return Math.max(1, getGeneratedMediaPreFrameCircleSize() * scale)
}

function getGeneratedMediaNodeRadius(): number {
    const generatedMediaSize = settings.mediaBranchLineage.generatedMediaSize
    const borderRadius = settings.mediaNode.styles.borderRadius
    if (!Number.isFinite(borderRadius) || borderRadius <= 0) return 0
    return Math.min(borderRadius, generatedMediaSize / 2)
}

function getOutlinePathPerimeter(width: number, height: number, radius: number): number {
    const animation = settings.mediaNode.inProgressOutlineAnimation
    const strokeScale = scaleCanvasChromeWorldSizeForZoom(
        1,
        1,
        getAdaptiveBoundedZoomScalingOptions(animation.zoomScaling ?? { minZoom: 0 })
    )
    const headOutset = ((animation.gap ?? 0) + animation.snakeWidth / 2) * strokeScale
    return getRoundedOutlinePerimeter(width + headOutset * 2, height + headOutset * 2, radius + headOutset)
}

function getGeneratedMediaPreFrameCircleDurationMs(circleSize: number): number | undefined {
    const generatedMediaSize = settings.mediaBranchLineage.generatedMediaSize
    const nodePerimeter = getOutlinePathPerimeter(generatedMediaSize, generatedMediaSize, getGeneratedMediaNodeRadius())
    const circlePerimeter = getOutlinePathPerimeter(circleSize, circleSize, circleSize / 2)
    if (nodePerimeter <= 0 || circlePerimeter <= 0) return undefined
    return settings.mediaNode.inProgressOutlineAnimation.animationDurationMs * (circlePerimeter / nodePerimeter)
}

function getGeneratedMediaPreFrameCircleSnakeLengthFraction(circleSize: number): number | undefined {
    const generatedMediaSize = settings.mediaBranchLineage.generatedMediaSize
    const nodePerimeter = getOutlinePathPerimeter(generatedMediaSize, generatedMediaSize, getGeneratedMediaNodeRadius())
    const circlePerimeter = getOutlinePathPerimeter(circleSize, circleSize, circleSize / 2)
    if (nodePerimeter <= 0 || circlePerimeter <= 0) return undefined
    return Math.min(0.98, settings.mediaNode.inProgressOutlineAnimation.snakeLengthFraction * (nodePerimeter / circlePerimeter))
}

export function createWorkspaceLoadingOutline(config: WorkspaceLoadingOutlineConfig): WorkspaceLoadingOutlineInstance {
    return new WorkspaceLoadingOutline(config)
}
