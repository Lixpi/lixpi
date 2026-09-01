// ShiftingGradientRenderer - Animated freeform gradient background
//
// Inspired by animated freeform gradient wallpapers found in modern messaging apps.
// - Renders to 60x80 bitmap, scaled up with bilinear interpolation
// - 4 color points with inverse distance weighting (distance^4 falloff)
// - Swirl distortion effect for organic feel
// - 8 phase positions, animation triggered on message send
//
// See documentation/canvas/VISUAL-EFFECTS.md for full technical details

import { Easing } from '../animation/index.ts'
import {
    FreeformGradientRenderer,
    type FreeformGradientColor,
    type FreeformGradientHexColorSet,
    type FreeformGradientPoint,
} from './freeformGradient.ts'

export type ShiftingGradientColorSet = FreeformGradientHexColorSet

export type ShiftingGradientBackgroundOptions = {
    colors?: ShiftingGradientColorSet
    renderer?: ShiftingGradientRenderer
}

type PatternOptions = {
    url: string
    alpha?: number
    blendMode?: GlobalCompositeOperation
    tintColor?: string
    scale?: number
}

type SubscribedCanvas = {
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    visible: boolean
}

const BITMAP_WIDTH = FreeformGradientRenderer.bitmapSize.width
const BITMAP_HEIGHT = FreeformGradientRenderer.bitmapSize.height
const ANIMATION_DURATION_MS = 500
export const DEFAULT_SHIFTING_GRADIENT_COLORS: ShiftingGradientColorSet = ['#FFF5FA', '#F5EFF9', '#E6E9F6', '#F3E4F2']

function createCanvasElement(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

export class ShiftingGradientRenderer {
    private destroyed = false
    private patternRevision = 0
    private cancelPatternLoad: (() => void) | null = null
    private offscreenCanvas: OffscreenCanvas | HTMLCanvasElement
    private offscreenCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    private imageData: ImageData
    private subscribedCanvases: Map<HTMLCanvasElement, SubscribedCanvas> = new Map()
    private colors: FreeformGradientColor[]
    private currentPhase: number = FreeformGradientRenderer.initialPhase
    private animationProgress: number = 1
    private animationStartTime: number = 0
    private animationFrameId: number | null = null
    private isAnimating: boolean = false
    private pattern: { image: HTMLImageElement; options: Required<PatternOptions> } | null = null
    private phaseFrom: number = FreeformGradientRenderer.initialPhase
    private phaseTo: number = FreeformGradientRenderer.initialPhase

    constructor(colors: ShiftingGradientColorSet = DEFAULT_SHIFTING_GRADIENT_COLORS) {
        this.colors = FreeformGradientRenderer.parseHexColors(colors)
        this.phaseTo = this.currentPhase
        this.phaseFrom = (this.phaseTo + 1) % FreeformGradientRenderer.phasePositions.length

        const { canvas, ctx } = ShiftingGradientRenderer.createOffscreenGradientCanvas()
        this.offscreenCanvas = canvas
        this.offscreenCtx = ctx
        this.imageData = this.offscreenCtx.createImageData(BITMAP_WIDTH, BITMAP_HEIGHT)
        this.renderGradient()
    }

    private static createOffscreenGradientCanvas(): {
        canvas: OffscreenCanvas | HTMLCanvasElement
        ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    } {
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(BITMAP_WIDTH, BITMAP_HEIGHT)
            return { canvas, ctx: canvas.getContext('2d')! }
        }

        const canvas = createCanvasElement(BITMAP_WIDTH, BITMAP_HEIGHT)
        return { canvas, ctx: canvas.getContext('2d')! }
    }

    subscribe(canvas: HTMLCanvasElement): void {
        if (this.destroyed || this.subscribedCanvases.has(canvas)) return

        const ctx = canvas.getContext('2d', { willReadFrequently: false })
        if (!ctx) {
            console.error('Failed to get 2D context for canvas')
            return
        }

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'

        this.subscribedCanvases.set(canvas, {
            canvas,
            ctx,
            visible: true,
        })

        this.drawToCanvas(canvas, ctx)

        if (!this.isAnimating && this.subscribedCanvases.size === 1) {
            this.startAnimationLoop()
        }
    }

    unsubscribe(canvas: HTMLCanvasElement): void {
        this.subscribedCanvases.delete(canvas)

        if (this.subscribedCanvases.size === 0 && this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
            this.isAnimating = false
        }
    }

    setVisibility(canvas: HTMLCanvasElement, visible: boolean): void {
        const entry = this.subscribedCanvases.get(canvas)
        if (entry) entry.visible = visible
    }

    redrawCanvas(canvas: HTMLCanvasElement): void {
        const entry = this.subscribedCanvases.get(canvas)
        if (!entry || !entry.visible) return

        entry.ctx.imageSmoothingEnabled = true
        entry.ctx.imageSmoothingQuality = 'high'
        this.drawToCanvas(canvas, entry.ctx)
    }

    nextPhase(): void {
        if (this.destroyed) return
        this.phaseTo = FreeformGradientRenderer.getPreviousPhase(this.currentPhase)
        this.phaseFrom = (this.phaseTo + 1) % FreeformGradientRenderer.phasePositions.length
        this.currentPhase = this.phaseTo
        this.animationProgress = 0
        this.animationStartTime = performance.now()
    }

    private easingInterpolator(progress: number): number {
        return Easing.shiftingGradientTransition(progress)
    }

    private startAnimationLoop(): void {
        if (this.isAnimating) return
        this.isAnimating = true

        const animate = () => {
            if (!this.isAnimating) return

            if (this.animationProgress < 1) {
                const elapsed = performance.now() - this.animationStartTime
                const rawProgress = Math.min(elapsed / ANIMATION_DURATION_MS, 1)
                this.animationProgress = this.easingInterpolator(rawProgress)
                this.renderGradient()
            }

            this.updateSubscribedCanvases()
            this.animationFrameId = requestAnimationFrame(animate)
        }

        animate()
    }

    private getInterpolatedPositions(): FreeformGradientPoint[] {
        const previous = FreeformGradientRenderer.getPhasePositions(this.phaseFrom)
        const current = FreeformGradientRenderer.getPhasePositions(this.currentPhase)

        return previous.map((start, index) => ({
            x: start.x + (current[index].x - start.x) * this.animationProgress,
            y: start.y + (current[index].y - start.y) * this.animationProgress,
        }))
    }

    private renderGradient(): void {
        FreeformGradientRenderer.paintImageData(this.imageData, this.colors, this.getInterpolatedPositions())
        this.offscreenCtx.putImageData(this.imageData, 0, 0)
    }

    private updateSubscribedCanvases(): void {
        for (const [canvas, entry] of this.subscribedCanvases) {
            if (entry.visible) this.drawToCanvas(canvas, entry.ctx)
        }
    }

    private drawToCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
        ctx.drawImage(
            this.offscreenCanvas as CanvasImageSource,
            0,
            0,
            BITMAP_WIDTH,
            BITMAP_HEIGHT,
            0,
            0,
            canvas.width,
            canvas.height,
        )

        if (this.pattern) this.drawPatternOverlay(ctx, canvas.width, canvas.height)
    }

    private drawPatternOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.pattern) return

        const { image, options } = this.pattern
        if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return

        ctx.save()

        try {
            ctx.globalCompositeOperation = options.blendMode
        } catch {
            ctx.globalCompositeOperation = 'overlay'
        }
        ctx.globalAlpha = options.alpha

        const tileW = image.naturalWidth
        const tileH = image.naturalHeight
        if (tileW > 0 && tileH > 0) {
            let tileSource: CanvasImageSource = image
            if (options.tintColor) {
                const tintCanvas = createCanvasElement(tileW, tileH)
                const tintCtx = tintCanvas.getContext('2d')
                if (tintCtx) {
                    tintCtx.clearRect(0, 0, tileW, tileH)
                    tintCtx.drawImage(image, 0, 0)
                    tintCtx.globalCompositeOperation = 'source-in'
                    tintCtx.fillStyle = options.tintColor
                    tintCtx.fillRect(0, 0, tileW, tileH)
                    tileSource = tintCanvas
                }
            }

            const scale = Math.max(0.1, options.scale)
            const stepW = tileW * scale
            const stepH = tileH * scale

            for (let y = 0; y < height; y += stepH) {
                for (let x = 0; x < width; x += stepW) {
                    ctx.drawImage(tileSource, x, y, stepW, stepH)
                }
            }
        }

        ctx.restore()
    }

    async setPattern(options: PatternOptions | null): Promise<void> {
        const revision = ++this.patternRevision
        this.cancelPatternLoad?.()
        this.cancelPatternLoad = null
        if (this.destroyed) return
        if (!options) {
            this.pattern = null
            return
        }

        const resolved: Required<PatternOptions> = {
            url: options.url,
            alpha: options.alpha ?? 0.22,
            blendMode: options.blendMode ?? 'soft-light',
            tintColor: options.tintColor ?? 'rgba(18, 62, 112, 0.85)',
            scale: options.scale ?? 1,
        }
        const img = new Image()
        img.decoding = 'async'
        img.crossOrigin = 'anonymous'

        const loaded = await new Promise<boolean>((resolve, reject) => {
            const clear = () => {
                img.onload = null
                img.onerror = null
                if (revision === this.patternRevision) this.cancelPatternLoad = null
            }
            this.cancelPatternLoad = () => {
                clear()
                img.src = ''
                resolve(false)
            }
            img.onload = () => {
                clear()
                resolve(true)
            }
            img.onerror = () => {
                clear()
                reject(new Error('Failed to load pattern image'))
            }
            img.src = resolved.url
        })
        if (loaded && !this.destroyed && revision === this.patternRevision) {
            this.pattern = { image: img, options: resolved }
        }
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.patternRevision++
        this.cancelPatternLoad?.()
        this.cancelPatternLoad = null
        this.pattern = null
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        }
        this.isAnimating = false
        this.subscribedCanvases.clear()
    }
}

export class ShiftingGradientBackground {
    readonly canvas: HTMLCanvasElement
    private readonly renderer: ShiftingGradientRenderer
    private readonly ownsRenderer: boolean
    private readonly observer: IntersectionObserver
    private readonly resizeObserver: ResizeObserver
    private destroyed = false

    constructor(private readonly container: HTMLElement, options: ShiftingGradientBackgroundOptions = {}) {
        this.canvas = createCanvasElement(1, 1)
        this.canvas.className = 'shifting-gradient-canvas'
        this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;border-radius:inherit'
        this.renderer = options.renderer ?? new ShiftingGradientRenderer(options.colors)
        this.ownsRenderer = !options.renderer
        this.updateCanvasSize()
        container.prepend(this.canvas)
        this.renderer.subscribe(this.canvas)
        void this.loadPattern()

        this.observer = new IntersectionObserver((entries) => {
            if (this.destroyed) return
            for (const entry of entries) this.renderer.setVisibility(this.canvas, entry.isIntersecting)
        }, { threshold: 0 })
        this.observer.observe(this.canvas)

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.destroyed && this.updateCanvasSize()) this.renderer.redrawCanvas(this.canvas)
        })
        this.resizeObserver.observe(container)
    }

    private updateCanvasSize(): boolean {
        const rect = this.container.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.max(1, Math.floor(rect.width * dpr))
        const height = Math.max(1, Math.floor(rect.height * dpr))
        if (this.canvas.width === width && this.canvas.height === height) return false
        this.canvas.width = width
        this.canvas.height = height
        return true
    }

    private async loadPattern(): Promise<void> {
        try {
            const style = getComputedStyle(this.container)
            const rawUrl = style.getPropertyValue('--gradient-pattern-url').trim()
            if (!rawUrl) return
            const match = rawUrl.match(/^url\((['"]?)(.*?)\1\)$/)
            const alpha = Number.parseFloat(style.getPropertyValue('--gradient-pattern-alpha'))
            const scale = Number.parseFloat(style.getPropertyValue('--gradient-pattern-scale'))
            await this.renderer.setPattern({
                url: match ? match[2] : rawUrl,
                alpha: Number.isFinite(alpha) ? alpha : undefined,
                tintColor: style.getPropertyValue('--gradient-pattern-tint').trim() || undefined,
                scale: Number.isFinite(scale) ? scale : undefined,
            })
        } catch (error) {
            if (!this.destroyed) console.warn('[ShiftingGradientRenderer] Failed to load pattern:', error)
        }
    }

    // Callers can pass this callback directly to controls.
    triggerAnimation = (): void => {
        if (!this.destroyed) this.renderer.nextPhase()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.observer.disconnect()
        this.resizeObserver.disconnect()
        this.renderer.unsubscribe(this.canvas)
        if (this.ownsRenderer) this.renderer.destroy()
        this.canvas.remove()
    }
}

export function createShiftingGradientBackground(container: HTMLElement, options: ShiftingGradientBackgroundOptions = {}): ShiftingGradientBackground {
    return new ShiftingGradientBackground(container, options)
}
