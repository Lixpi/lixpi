/**
 * ShiftingGradientRenderer - Animated freeform gradient background
 *
 * Inspired by animated freeform gradient wallpapers found in modern messaging apps.
 * - Renders to 60x80 bitmap, scaled up with bilinear interpolation
 * - 4 color points with inverse distance weighting (distance^4 falloff)
 * - Swirl distortion effect for organic feel
 * - 8 phase positions, animation triggered on message send
 *
 * @see documentation/features/SHIFTING-GRADIENT.md for full technical details
 */

// Dreamy sky pastel colors inspired by desert sunset palette.
// Ultra-light versions for a soft, airy sky look.
// Note: which corner each color dominates depends on the current phase/positions.
const GRADIENT_COLORS = {
    color1: { r: 0xff, g: 0xf5, b: 0xfa }, // #FFF5FA - whisper pink
    color2: { r: 0xf5, g: 0xef, b: 0xf9 }, // #F5EFF9 - whisper lavender
    color3: { r: 0xe6, g: 0xe9, b: 0xf6 }, // #E6E9F6 - whisper periwinkle
    color4: { r: 0xf3, g: 0xe4, b: 0xf2 }, // #F3E4F2 - whisper orchid
}

// 8 phase positions for the 4 color points
const PHASE_POSITIONS: Array<{ x: number; y: number }> = [
    { x: 0.8, y: 0.1 },
    { x: 0.6, y: 0.2 },
    { x: 0.35, y: 0.25 },
    { x: 0.25, y: 0.6 },
    { x: 0.2, y: 0.9 },
    { x: 0.4, y: 0.8 },
    { x: 0.65, y: 0.75 },
    { x: 0.75, y: 0.4 },
]

// Bitmap dimensions for the small offscreen canvas
const BITMAP_WIDTH = 60
const BITMAP_HEIGHT = 80

// Animation parameters
const ANIMATION_DURATION_MS = 500
const SWIRL_FACTOR = 0.35

type Color = { r: number; g: number; b: number }
type Position = { x: number; y: number }

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

class ShiftingGradientRenderer {
    private static instance: ShiftingGradientRenderer | null = null

    private offscreenCanvas: OffscreenCanvas | HTMLCanvasElement
    private offscreenCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    private imageData: ImageData
    private subscribedCanvases: Map<HTMLCanvasElement, SubscribedCanvas> = new Map()

    private colors: Color[]
    private currentPhase: number = 0
    private animationProgress: number = 1 // 0 = animating, 1 = idle
    private animationStartTime: number = 0
    private animationFrameId: number | null = null
    private isAnimating: boolean = false

    private pattern: { image: HTMLImageElement; options: Required<PatternOptions> } | null = null

    // Start/end phases for interpolation
    private phaseFrom: number = 0
    private phaseTo: number = 0

    private constructor() {
        this.colors = [
            GRADIENT_COLORS.color1,
            GRADIENT_COLORS.color2,
            GRADIENT_COLORS.color3,
            GRADIENT_COLORS.color4,
        ]

        // Initialize phase interpolation state
        this.phaseTo = this.currentPhase
        this.phaseFrom = (this.phaseTo + 1) % 8

        // Create offscreen canvas for rendering
        if (typeof OffscreenCanvas !== 'undefined') {
            this.offscreenCanvas = new OffscreenCanvas(BITMAP_WIDTH, BITMAP_HEIGHT)
            this.offscreenCtx = this.offscreenCanvas.getContext('2d')!
        } else {
            // Fallback for older browsers
            this.offscreenCanvas = document.createElement('canvas')
            this.offscreenCanvas.width = BITMAP_WIDTH
            this.offscreenCanvas.height = BITMAP_HEIGHT
            this.offscreenCtx = this.offscreenCanvas.getContext('2d')!
        }

        this.imageData = this.offscreenCtx.createImageData(BITMAP_WIDTH, BITMAP_HEIGHT)

        // Initial render
        this.renderGradient()
    }

    static getInstance(): ShiftingGradientRenderer {
        if (!ShiftingGradientRenderer.instance) {
            ShiftingGradientRenderer.instance = new ShiftingGradientRenderer()
        }
        return ShiftingGradientRenderer.instance
    }

    /**
     * Subscribe a canvas element to receive gradient updates
     */
    subscribe(canvas: HTMLCanvasElement): void {
        if (this.subscribedCanvases.has(canvas)) return

        const ctx = canvas.getContext('2d', { willReadFrequently: false })
        if (!ctx) {
            console.error('Failed to get 2D context for canvas')
            return
        }

        // Enable image smoothing for bilinear filtering when scaling up
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'

        this.subscribedCanvases.set(canvas, {
            canvas,
            ctx,
            visible: true
        })

        // Immediately draw current state to new canvas
        this.drawToCanvas(canvas, ctx)

        // Start animation loop if not already running
        if (!this.isAnimating && this.subscribedCanvases.size === 1) {
            this.startAnimationLoop()
        }
    }

    /**
     * Unsubscribe a canvas element from gradient updates
     */
    unsubscribe(canvas: HTMLCanvasElement): void {
        this.subscribedCanvases.delete(canvas)

        // Stop animation loop if no subscribers
        if (this.subscribedCanvases.size === 0 && this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
            this.isAnimating = false
        }
    }

    /**
     * Set visibility of a subscribed canvas (for IntersectionObserver)
     */
    setVisibility(canvas: HTMLCanvasElement, visible: boolean): void {
        const entry = this.subscribedCanvases.get(canvas)
        if (entry) {
            entry.visible = visible
        }
    }

    /**
     * Trigger transition to next phase (called on message send)
     */
    nextPhase(): void {
        // Decrement phase and interpolate between phases
        const next = (this.currentPhase - 1 + 8) % 8
        this.phaseTo = next
        this.phaseFrom = (this.phaseTo + 1) % 8
        this.currentPhase = this.phaseTo
        this.animationProgress = 0
        this.animationStartTime = performance.now()
    }

    private cubicBezierAtTime(x1: number, y1: number, x2: number, y2: number, t: number): number {
        const cx = 3 * x1
        const bx = 3 * (x2 - x1) - cx
        const ax = 1 - cx - bx
        const cy = 3 * y1
        const by = 3 * (y2 - y1) - cy
        const ay = 1 - cy - by

        const sampleCurveX = (u: number) => ((ax * u + bx) * u + cx) * u
        const sampleCurveY = (u: number) => ((ay * u + by) * u + cy) * u
        const sampleCurveDerivativeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx

        let u = t
        for (let i = 0; i < 8; i++) {
            const x = sampleCurveX(u) - t
            const d = sampleCurveDerivativeX(u)
            if (Math.abs(x) < 1e-6) break
            if (Math.abs(d) < 1e-6) break
            u = u - x / d
        }
        u = Math.max(0, Math.min(1, u))
        return sampleCurveY(u)
    }

    private easingInterpolator(t: number): number {
        return this.cubicBezierAtTime(0.33, 0.0, 0.0, 1.0, t)
    }

    private startAnimationLoop(): void {
        if (this.isAnimating) return
        this.isAnimating = true

        const animate = () => {
            if (!this.isAnimating) return

            // Update animation progress if animating between phases
            if (this.animationProgress < 1) {
                const elapsed = performance.now() - this.animationStartTime
                const rawProgress = Math.min(elapsed / ANIMATION_DURATION_MS, 1)
                this.animationProgress = this.easingInterpolator(rawProgress)

                // Render with interpolated positions
                this.renderGradient()
            }

            // Copy to all visible subscribed canvases
            this.updateSubscribedCanvases()

            this.animationFrameId = requestAnimationFrame(animate)
        }

        animate()
    }

    private getInterpolatedPositions(): Position[] {
        // Gather positions for a given phase
        const gather = (phase: number): Position[] => {
            const result: Position[] = []
            for (let i = 0; i < 4; i++) {
                let pos = phase + i * 2
                while (pos >= 8) pos -= 8
                const p = PHASE_POSITIONS[pos]
                result.push({ x: p.x, y: p.y })
            }
            return result
        }

        const previous = gather(this.phaseFrom)
        const current = gather(this.currentPhase)

        const p = this.animationProgress
        return previous.map((start, i) => ({
            x: start.x + (current[i].x - start.x) * p,
            y: start.y + (current[i].y - start.y) * p,
        }))
    }

    /**
     * Render the gradient to the offscreen canvas
     */
    private renderGradient(): void {
        const positions = this.getInterpolatedPositions()
        const data = this.imageData.data

        for (let y = 0; y < BITMAP_HEIGHT; y++) {
            for (let x = 0; x < BITMAP_WIDTH; x++) {
                let pixelX: number
                let pixelY: number

                const directPixelX = x / BITMAP_WIDTH
                const directPixelY = y / BITMAP_HEIGHT

                // Apply swirl distortion
                const centerDistanceX = directPixelX - 0.5
                const centerDistanceY = directPixelY - 0.5
                const centerDistance = Math.sqrt(centerDistanceX * centerDistanceX + centerDistanceY * centerDistanceY)

                const swirlFactor = SWIRL_FACTOR * centerDistance
                const theta = swirlFactor * swirlFactor * 0.8 * 8.0
                const sinTheta = Math.sin(theta)
                const cosTheta = Math.cos(theta)

                // Apply swirl transformation + clamp
                pixelX = Math.max(0, Math.min(1, 0.5 + centerDistanceX * cosTheta - centerDistanceY * sinTheta))
                pixelY = Math.max(0, Math.min(1, 0.5 + centerDistanceX * sinTheta + centerDistanceY * cosTheta))

                // Calculate color using inverse distance weighting with distance^4 falloff
                let r = 0, g = 0, b = 0, distanceSum = 0

                for (let i = 0; i < 4; i++) {
                    const colorPos = positions[i]
                    const dx = pixelX - colorPos.x
                    const dy = pixelY - colorPos.y
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    // Distance falloff: max(0, 0.9 - dist)^4
                    let weight = Math.max(0, 0.9 - dist)
                    weight = weight * weight * weight * weight // distance^4

                    distanceSum += weight
                    r += weight * this.colors[i].r
                    g += weight * this.colors[i].g
                    b += weight * this.colors[i].b
                }

                // Normalize by total weight
                if (distanceSum > 0) {
                    r /= distanceSum
                    g /= distanceSum
                    b /= distanceSum
                }

                // Write to image data
                const idx = (y * BITMAP_WIDTH + x) * 4
                data[idx] = Math.round(r)
                data[idx + 1] = Math.round(g)
                data[idx + 2] = Math.round(b)
                data[idx + 3] = 255 // Alpha
            }
        }

        // Put image data to offscreen canvas
        this.offscreenCtx.putImageData(this.imageData, 0, 0)
    }

    private updateSubscribedCanvases(): void {
        for (const [canvas, entry] of this.subscribedCanvases) {
            if (entry.visible) {
                this.drawToCanvas(canvas, entry.ctx)
            }
        }
    }

    private drawToCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
        // Scale the small offscreen canvas to fill the target canvas
        ctx.drawImage(
            this.offscreenCanvas as CanvasImageSource,
            0, 0, BITMAP_WIDTH, BITMAP_HEIGHT,
            0, 0, canvas.width, canvas.height
        )

        if (this.pattern) {
            this.drawPatternOverlay(ctx, canvas.width, canvas.height)
        }
    }

    private drawPatternOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.pattern) return

        const { image, options } = this.pattern
        if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return

        ctx.save()

        const blend = options.blendMode
        try {
            ctx.globalCompositeOperation = blend
        } catch {
            ctx.globalCompositeOperation = 'overlay'
        }
        ctx.globalAlpha = options.alpha

        // Tile the pattern to cover the whole node.
        const tileW = image.naturalWidth
        const tileH = image.naturalHeight
        if (tileW > 0 && tileH > 0) {
            // Optional tint: render tinted tile via an in-memory canvas.
            let tileSource: CanvasImageSource = image
            if (options.tintColor) {
                const tintCanvas = document.createElement('canvas')
                tintCanvas.width = tileW
                tintCanvas.height = tileH
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

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        }
        this.isAnimating = false
        this.subscribedCanvases.clear()
        ShiftingGradientRenderer.instance = null
    }
}

/**
 * Creates and attaches a shifting gradient background canvas to a container element
 */
export function createShiftingGradientBackground(container: HTMLElement): {
    canvas: HTMLCanvasElement
    destroy: () => void
    triggerAnimation: () => void
} {
    const canvas = document.createElement('canvas')
    canvas.className = 'shifting-gradient-canvas'
    canvas.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
        pointer-events: none;
        border-radius: inherit;
    `

    // Set canvas dimensions based on container size
    const updateCanvasSize = () => {
        const rect = container.getBoundingClientRect()
        // Use device pixel ratio for crisp rendering, but cap at 2x for performance
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.max(1, Math.floor(rect.width * dpr))
        canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }

    updateCanvasSize()
    container.insertBefore(canvas, container.firstChild)

    const renderer = ShiftingGradientRenderer.getInstance()
    renderer.subscribe(canvas)

    // Optional: pattern overlay configured via CSS variables on the container.
    // Example:
    //   .workspace-ai-chat-thread-node {
    //     --gradient-pattern-url: url('/patterns/my-pattern.png');
    //     --gradient-pattern-alpha: 0.22;
    //     --gradient-pattern-tint: rgba(18, 62, 112, 0.85);
    //   }
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
            renderer.setPattern({
                url: patternUrl,
                alpha: Number.isFinite(alpha) ? alpha : undefined,
                tintColor: tint,
                scale: Number.isFinite(scale) ? scale : undefined,
            }).catch((error) => {
                console.warn('[ShiftingGradientRenderer] Failed to load pattern:', error)
            })
        }
    } catch {
        // ignore
    }

    // Set up IntersectionObserver for visibility tracking
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                renderer.setVisibility(canvas, entry.isIntersecting)
            }
        },
        { threshold: 0 }
    )
    observer.observe(canvas)

    // Set up ResizeObserver for canvas size updates
    const resizeObserver = new ResizeObserver(() => {
        updateCanvasSize()
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
        }
    }
}

/**
 * Get the singleton renderer instance for manual control
 */
export function getShiftingGradientRenderer(): ShiftingGradientRenderer {
    return ShiftingGradientRenderer.getInstance()
}
