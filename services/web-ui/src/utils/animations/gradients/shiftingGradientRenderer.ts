// ShiftingGradientRenderer - Animated freeform gradient background
//
// Inspired by animated freeform gradient wallpapers found in modern messaging apps.
// - Renders to 60x80 bitmap, scaled up with bilinear interpolation
// - 4 color points with inverse distance weighting (distance^4 falloff)
// - Swirl distortion effect for organic feel
// - 8 phase positions, animation triggered on message send
//
// See documentation/features/GRADIENTS.md for full technical details

import { Easing } from '$src/utils/animations/easing.ts'
import { html } from '$src/utils/domTemplates.ts'
import {
    FreeformGradientRenderer,
    type FreeformGradientColor,
    type FreeformGradientHexColorSet,
    type FreeformGradientPoint,
} from '$src/utils/animations/gradients/freeformGradient.ts'
import { settings } from '$src/settings.ts'

export type ShiftingGradientColorSet = FreeformGradientHexColorSet

type ShiftingGradientBackgroundOptions = {
    colors?: ShiftingGradientColorSet
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

export class ShiftingGradientRenderer {
    private static instances: Map<string, ShiftingGradientRenderer> = new Map()

    private instanceKey: string
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

    private constructor(colors: ShiftingGradientColorSet, instanceKey: string) {
        this.instanceKey = instanceKey
        this.colors = FreeformGradientRenderer.parseHexColors(colors)
        this.phaseTo = this.currentPhase
        this.phaseFrom = (this.phaseTo + 1) % FreeformGradientRenderer.phasePositions.length

        const { canvas, ctx } = ShiftingGradientRenderer.createOffscreenGradientCanvas()
        this.offscreenCanvas = canvas
        this.offscreenCtx = ctx
        this.imageData = this.offscreenCtx.createImageData(BITMAP_WIDTH, BITMAP_HEIGHT)
        this.renderGradient()
    }

    static getInstance(colors: ShiftingGradientColorSet = settings.gradient.shiftingColors): ShiftingGradientRenderer {
        const instanceKey = ShiftingGradientRenderer.getColorSetKey(colors)
        let renderer = ShiftingGradientRenderer.instances.get(instanceKey)

        if (!renderer) {
            renderer = new ShiftingGradientRenderer(colors, instanceKey)
            ShiftingGradientRenderer.instances.set(instanceKey, renderer)
        }

        return renderer
    }

    private static getColorSetKey(colors: ShiftingGradientColorSet): string {
        return colors.join('|')
    }

    private static createOffscreenGradientCanvas(): {
        canvas: OffscreenCanvas | HTMLCanvasElement
        ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    } {
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(BITMAP_WIDTH, BITMAP_HEIGHT)
            return { canvas, ctx: canvas.getContext('2d')! }
        }

        const canvas = html`<canvas width=${BITMAP_WIDTH} height=${BITMAP_HEIGHT}></canvas>` as HTMLCanvasElement
        return { canvas, ctx: canvas.getContext('2d')! }
    }

    subscribe(canvas: HTMLCanvasElement): void {
        if (this.subscribedCanvases.has(canvas)) return

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
            0, 0, BITMAP_WIDTH, BITMAP_HEIGHT,
            0, 0, canvas.width, canvas.height
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
                const tintCanvas = html`<canvas width=${tileW} height=${tileH}></canvas>` as HTMLCanvasElement
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

        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('Failed to load pattern image'))
            img.src = resolved.url
        })

        this.pattern = { image: img, options: resolved }
    }

    destroy(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        }
        this.isAnimating = false
        this.subscribedCanvases.clear()
        ShiftingGradientRenderer.instances.delete(this.instanceKey)
    }
}

export function createShiftingGradientBackground(container: HTMLElement, options: ShiftingGradientBackgroundOptions = {}): {
    canvas: HTMLCanvasElement
    destroy: () => void
    triggerAnimation: () => void
} {
    const canvasStyle = {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: '0',
        pointerEvents: 'none',
        borderRadius: 'inherit',
    }
    const canvas = html`<canvas className="shifting-gradient-canvas" style=${canvasStyle}></canvas>` as HTMLCanvasElement

    const updateCanvasSize = () => {
        const rect = container.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const nextWidth = Math.max(1, Math.floor(rect.width * dpr))
        const nextHeight = Math.max(1, Math.floor(rect.height * dpr))

        if (canvas.width === nextWidth && canvas.height === nextHeight) return false

        canvas.width = nextWidth
        canvas.height = nextHeight
        return true
    }

    updateCanvasSize()
    container.insertBefore(canvas, container.firstChild)

    const renderer = getShiftingGradientRenderer(options.colors)
    renderer.subscribe(canvas)

    try {
        const style = getComputedStyle(container)
        const patternUrlRaw = style.getPropertyValue('--gradient-pattern-url').trim()
        if (patternUrlRaw) {
            const match = patternUrlRaw.match(/^url\((['"]?)(.*?)\1\)$/)
            const patternUrl = match ? match[2] : patternUrlRaw
            const alphaRaw = style.getPropertyValue('--gradient-pattern-alpha').trim()
            const tint = style.getPropertyValue('--gradient-pattern-tint').trim() || undefined
            const scaleRaw = style.getPropertyValue('--gradient-pattern-scale').trim()
            const alpha = alphaRaw ? Number.parseFloat(alphaRaw) : undefined
            const scale = scaleRaw ? Number.parseFloat(scaleRaw) : undefined
            void (async () => {
                try {
                    await renderer.setPattern({
                        url: patternUrl,
                        alpha: Number.isFinite(alpha) ? alpha : undefined,
                        tintColor: tint,
                        scale: Number.isFinite(scale) ? scale : undefined,
                    })
                } catch (error) {
                    console.warn('[ShiftingGradientRenderer] Failed to load pattern:', error)
                }
            })()
        }
    } catch {
        // CSS pattern variables are optional.
    }

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) renderer.setVisibility(canvas, entry.isIntersecting)
        },
        { threshold: 0 }
    )
    observer.observe(canvas)

    const resizeObserver = new ResizeObserver(() => {
        if (updateCanvasSize()) renderer.redrawCanvas(canvas)
    })
    resizeObserver.observe(container)

    return {
        canvas,
        destroy: () => {
            observer.disconnect()
            resizeObserver.disconnect()
            renderer.unsubscribe(canvas)
            canvas.remove()
        },
        triggerAnimation: () => {
            renderer.nextPhase()
        },
    }
}

export function getShiftingGradientRenderer(colors?: ShiftingGradientColorSet): ShiftingGradientRenderer {
    return ShiftingGradientRenderer.getInstance(colors)
}
