import {
    Application,
    Container,
    Graphics,
    Sprite,
    Text,
    Texture,
} from 'pixi.js'

import { settings } from '$src/settings.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { Easing } from '$src/utils/animations/easing.ts'
import { FreeformGradientRenderer } from '$src/utils/animations/gradients/freeformGradient.ts'
import { scaleCanvasChromeForZoom } from '$src/infographics/utils/zoomScaling.ts'
import { getVisibleWorldRect, type PixiRendererHealth, type WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import {
    getContextRegionCloudBleed,
    getContextRegionCloudBounds,
    getContextRegionCloudStyle,
    getContextRegionCloudTitleRect,
    hitTestContextRegionCloud,
    type ContextRegionCloudDatum,
    type ContextRegionCloudHit,
    type ContextRegionCloudPoint,
    type ContextRegionCloudStyle,
} from '$src/infographics/workspace/rendering/contextRegionClouds.ts'

type PixiContextRegionEntry = {
    container: Container
    backdrop: Sprite
    activeThoughtCircleFromOverlay: Sprite
    activeThoughtCircleOverlay: Sprite
    chrome: Graphics
    titleText: Text
    datum: ContextRegionCloudDatum
    styleKey: string
    geometryKey: string
    pulseStartedAt: number | null
    activeThoughtCircleStartedAt: number | null
}

type ContextRegionViewport = { x: number; y: number; zoom: number }

export type PixiContextRegionLayer = {
    sync: (regions: ContextRegionCloudDatum[]) => void
    setViewport: (viewport: ContextRegionViewport) => void
    setNodeLiveTransform: (
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ) => void
    hitTest: (worldPoint: ContextRegionCloudPoint) => ContextRegionCloudHit
    pulseRegion: (nodeId: string) => void
    getHealth: () => PixiRendererHealth
    destroy: () => void
}

type PixiContextRegionLayerOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    onHealthChange?: (health: PixiRendererHealth) => void
}

type RgbColor = { r: number; g: number; b: number }

type WatercolorTextureSize = { width: number; height: number }

const VISIBILITY_MARGIN = 1600
const CONTEXT_REGION_TEXTURE_VERSION = 4
const contextRegionCloudTheme = settings.contextRegion.cloud
const CO2_CLOUD_VIEWBOX_SIZE = 512
const CO2_CLOUD_MAIN_PATH = 'm482.856 229.936c12.391-15.534 19.801-35.216 19.801-56.63 0-50.198-40.694-90.892-90.892-90.892-5.966 0-11.796.581-17.441 1.679-25.94-49.959-78.143-84.093-138.324-84.093s-112.384 34.134-138.324 84.093c-5.645-1.097-11.475-1.679-17.441-1.679-50.198 0-90.892 40.694-90.892 90.892 0 21.415 7.41 41.096 19.801 56.63-18.325 25.172-29.144 56.158-29.144 89.676 0 84.244 68.293 152.538 152.537 152.538 5.374 0 10.683-.282 15.914-.824 21.017 24.873 52.435 40.674 87.549 40.674s66.532-15.801 87.549-40.674c5.231.542 10.539.824 15.914.824 84.244 0 152.537-68.294 152.537-152.538 0-33.518-10.819-64.504-29.144-89.676z'
const CO2_CLOUD_CIRCLES = [
    { x: 74.302, y: 30.905, radius: 30.905 },
]
function makeRandom(seed: number): () => number {
    let value = seed >>> 0
    return () => {
        value += 0x6D2B79F5
        let next = value
        next = Math.imul(next ^ next >>> 15, next | 1)
        next ^= next + Math.imul(next ^ next >>> 7, next | 61)
        return ((next ^ next >>> 14) >>> 0) / 4294967296
    }
}

function clamp(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value))
}

function lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const amount = clamp((value - edge0) / (edge1 - edge0 || 1))
    return amount * amount * (3 - 2 * amount)
}

function hexToRgb(hex: string): RgbColor {
    const normalized = hex.replace('#', '')
    const value = parseInt(normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized, 16)
    return { r: value >> 16 & 255, g: value >> 8 & 255, b: value & 255 }
}

function mixRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
    const clamped = clamp(amount)
    return {
        r: lerp(from.r, to.r, clamped),
        g: lerp(from.g, to.g, clamped),
        b: lerp(from.b, to.b, clamped),
    }
}

function setPixel(data: Uint8ClampedArray, index: number, color: RgbColor, alpha: number): void {
    data[index] = Math.round(clamp(color.r, 0, 255))
    data[index + 1] = Math.round(clamp(color.g, 0, 255))
    data[index + 2] = Math.round(clamp(color.b, 0, 255))
    data[index + 3] = Math.round(clamp(alpha) * 255)
}

function rgba(hex: string, alpha: number): string {
    const { r, g, b } = hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

function getTemplateSize(): WatercolorTextureSize {
    return contextRegionCloudTheme.textureSize
}

function drawGradientEllipse(
    ctx: CanvasRenderingContext2D,
    params: {
        x: number
        y: number
        rx: number
        ry: number
        rotation?: number
        stops: Array<{ offset: number; color: string }>
    }
): void {
    ctx.save()
    ctx.translate(params.x, params.y)
    ctx.rotate(params.rotation ?? 0)
    ctx.scale(params.rx, params.ry)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    for (const stop of params.stops) gradient.addColorStop(stop.offset, stop.color)
    ctx.fillStyle = gradient
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
}

function createWatercolorCanvas(size: WatercolorTextureSize): HTMLCanvasElement {
    return html`<canvas width=${size.width} height=${size.height}></canvas>` as HTMLCanvasElement
}

function isSvgPathCommand(token: string): boolean {
    return /^[a-z]$/i.test(token)
}

function drawSvgPath(ctx: CanvasRenderingContext2D, path: string): void {
    const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []
    let index = 0
    let command = ''
    let x = 0
    let y = 0
    let startX = 0
    let startY = 0
    let lastControlX = 0
    let lastControlY = 0
    let lastCommand = ''

    function hasNumber(): boolean {
        return index < tokens.length && !isSvgPathCommand(tokens[index])
    }

    function readNumber(): number {
        const token = tokens[index]
        index += 1
        return Number(token)
    }

    while (index < tokens.length) {
        if (isSvgPathCommand(tokens[index])) {
            command = tokens[index]
            index += 1
        }

        const lowerCommand = command.toLowerCase()
        const relative = command === lowerCommand

        if (lowerCommand === 'm') {
            const nextX = readNumber()
            const nextY = readNumber()
            x = relative ? x + nextX : nextX
            y = relative ? y + nextY : nextY
            startX = x
            startY = y
            ctx.moveTo(x, y)
            while (hasNumber()) {
                const lineX = readNumber()
                const lineY = readNumber()
                x = relative ? x + lineX : lineX
                y = relative ? y + lineY : lineY
                ctx.lineTo(x, y)
            }
            lastCommand = lowerCommand
            command = relative ? 'l' : 'L'
            continue
        }

        if (lowerCommand === 'c') {
            while (hasNumber()) {
                const controlX1 = readNumber()
                const controlY1 = readNumber()
                const controlX2 = readNumber()
                const controlY2 = readNumber()
                const endX = readNumber()
                const endY = readNumber()
                const absoluteControlX1 = relative ? x + controlX1 : controlX1
                const absoluteControlY1 = relative ? y + controlY1 : controlY1
                const absoluteControlX2 = relative ? x + controlX2 : controlX2
                const absoluteControlY2 = relative ? y + controlY2 : controlY2
                const absoluteEndX = relative ? x + endX : endX
                const absoluteEndY = relative ? y + endY : endY
                ctx.bezierCurveTo(absoluteControlX1, absoluteControlY1, absoluteControlX2, absoluteControlY2, absoluteEndX, absoluteEndY)
                lastControlX = absoluteControlX2
                lastControlY = absoluteControlY2
                x = absoluteEndX
                y = absoluteEndY
            }
            lastCommand = lowerCommand
            continue
        }

        if (lowerCommand === 's') {
            while (hasNumber()) {
                const controlX1 = lastCommand === 'c' || lastCommand === 's' ? x * 2 - lastControlX : x
                const controlY1 = lastCommand === 'c' || lastCommand === 's' ? y * 2 - lastControlY : y
                const controlX2 = readNumber()
                const controlY2 = readNumber()
                const endX = readNumber()
                const endY = readNumber()
                const absoluteControlX2 = relative ? x + controlX2 : controlX2
                const absoluteControlY2 = relative ? y + controlY2 : controlY2
                const absoluteEndX = relative ? x + endX : endX
                const absoluteEndY = relative ? y + endY : endY
                ctx.bezierCurveTo(controlX1, controlY1, absoluteControlX2, absoluteControlY2, absoluteEndX, absoluteEndY)
                lastControlX = absoluteControlX2
                lastControlY = absoluteControlY2
                x = absoluteEndX
                y = absoluteEndY
            }
            lastCommand = lowerCommand
            continue
        }

        if (lowerCommand === 'z') {
            ctx.closePath()
            x = startX
            y = startY
            lastControlX = x
            lastControlY = y
            lastCommand = lowerCommand
            command = ''
            continue
        }

        break
    }
}

function withCo2CloudShape(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize, paint: () => void): void {
    const scale = Math.min(size.width, size.height) / CO2_CLOUD_VIEWBOX_SIZE
    const x = (size.width - CO2_CLOUD_VIEWBOX_SIZE * scale) / 2
    const y = (size.height - CO2_CLOUD_VIEWBOX_SIZE * scale) / 2
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)
    paint()
    ctx.restore()
}

function fillCo2CloudShape(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize, fillStyle: string): void {
    withCo2CloudShape(ctx, size, () => {
        ctx.fillStyle = fillStyle

        ctx.beginPath()
        drawSvgPath(ctx, CO2_CLOUD_MAIN_PATH)
        ctx.fill()

        for (const circle of CO2_CLOUD_CIRCLES) {
            ctx.beginPath()
            ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2)
            ctx.fill()
        }
    })
}

function fillCo2MainCloudShape(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize, fillStyle: string, shapeScale = 1): void {
    withCo2CloudShape(ctx, size, () => {
        ctx.save()
        ctx.translate(CO2_CLOUD_VIEWBOX_SIZE / 2, CO2_CLOUD_VIEWBOX_SIZE / 2)
        ctx.scale(shapeScale, shapeScale)
        ctx.translate(-CO2_CLOUD_VIEWBOX_SIZE / 2, -CO2_CLOUD_VIEWBOX_SIZE / 2)
        ctx.beginPath()
        drawSvgPath(ctx, CO2_CLOUD_MAIN_PATH)
        ctx.fillStyle = fillStyle
        ctx.fill()
        ctx.restore()
    })
}

function fillCo2ThoughtCircles(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize, fillStyle: string, circleScale = 1): void {
    withCo2CloudShape(ctx, size, () => {
        ctx.fillStyle = fillStyle
        for (const circle of CO2_CLOUD_CIRCLES) {
            ctx.beginPath()
            ctx.arc(circle.x, circle.y, circle.radius * circleScale, 0, Math.PI * 2)
            ctx.fill()
        }
    })
}

function addExactCo2CloudBorder(ctx: CanvasRenderingContext2D, style: ContextRegionCloudStyle, size: WatercolorTextureSize): void {
    const ringCanvas = createWatercolorCanvas(size)
    const ringCtx = ringCanvas.getContext('2d')
    if (!ringCtx) return

    fillCo2MainCloudShape(ringCtx, size, rgba(style.palette.edge, contextRegionCloudTheme.borderMainAlpha))
    fillCo2ThoughtCircles(ringCtx, size, rgba(style.palette.edge, contextRegionCloudTheme.borderThoughtCircleAlpha))

    ringCtx.globalCompositeOperation = 'destination-out'
    fillCo2MainCloudShape(ringCtx, size, 'rgba(0, 0, 0, 1)', 0.965)
    fillCo2ThoughtCircles(ringCtx, size, 'rgba(0, 0, 0, 1)', 0.78)
    ringCtx.globalCompositeOperation = 'source-over'

    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    ctx.drawImage(ringCanvas, 0, 0)
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
}

function addRegionGradientPreviewOverlays(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize): void {
    const { width, height } = size
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'

    drawGradientEllipse(ctx, {
        x: width * 0.50,
        y: height * 0.55,
        rx: width * 0.45,
        ry: height * 0.35,
        stops: [
            { offset: 0, color: 'rgba(255, 255, 255, 0.10)' },
            { offset: 0.58, color: 'rgba(255, 255, 255, 0.04)' },
            { offset: 1, color: 'rgba(255, 255, 255, 0)' },
        ],
    })
    drawGradientEllipse(ctx, {
        x: width * 0.50,
        y: height * 0.58,
        rx: width * 0.37,
        ry: height * 0.31,
        stops: [
            { offset: 0, color: 'rgba(86, 118, 109, 0.065)' },
            { offset: 0.42, color: 'rgba(128, 158, 149, 0.038)' },
            { offset: 0.72, color: 'rgba(232, 246, 242, 0.010)' },
            { offset: 1, color: 'rgba(255, 255, 255, 0)' },
        ],
    })

    const topGradient = ctx.createRadialGradient(width * 0.5, -height * 0.08, 0, width * 0.5, -height * 0.08, width * 0.52)
    topGradient.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
    topGradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.075)')
    topGradient.addColorStop(0.72, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = topGradient
    ctx.fillRect(0, 0, width, height)

    const bottomGradient = ctx.createRadialGradient(width * 0.5, height * 1.06, 0, width * 0.5, height * 1.06, width * 0.52)
    bottomGradient.addColorStop(0, 'rgba(255, 255, 255, 0.14)')
    bottomGradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.060)')
    bottomGradient.addColorStop(0.76, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = bottomGradient
    ctx.fillRect(0, 0, width, height)

    const sideGradient = ctx.createLinearGradient(0, 0, width, 0)
    sideGradient.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
    sideGradient.addColorStop(0.15, 'rgba(255, 255, 255, 0.030)')
    sideGradient.addColorStop(0.84, 'rgba(255, 255, 255, 0)')
    sideGradient.addColorStop(1, 'rgba(255, 255, 255, 0.15)')
    ctx.fillStyle = sideGradient
    ctx.fillRect(0, 0, width, height)

    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
}

function hashGrid(x: number, y: number, seed: number): number {
    let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 224682251)
    value = Math.imul(value ^ value >>> 13, 1274126177)
    return ((value ^ value >>> 16) >>> 0) / 4294967295
}

function valueNoise(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = x0 + 1
    const y1 = y0 + 1
    const tx = smoothstep(0, 1, x - x0)
    const ty = smoothstep(0, 1, y - y0)
    const top = lerp(hashGrid(x0, y0, seed), hashGrid(x1, y0, seed), tx)
    const bottom = lerp(hashGrid(x0, y1, seed), hashGrid(x1, y1, seed), tx)
    return lerp(top, bottom, ty)
}

function fractalNoise(x: number, y: number, seed: number, octaves: number): number {
    let value = 0
    let amplitude = 0.5
    let frequency = 1
    let total = 0
    for (let i = 0; i < octaves; i++) {
        value += valueNoise(x * frequency, y * frequency, seed + i * 1973) * amplitude
        total += amplitude
        amplitude *= 0.5
        frequency *= 2
    }
    return total === 0 ? 0 : value / total
}

function drawWatercolorMask(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize): void {
    ctx.clearRect(0, 0, size.width, size.height)
    fillCo2CloudShape(ctx, size, 'rgba(0, 0, 0, 1)')
    ctx.filter = 'none'
}

function applyCo2CloudMask(ctx: CanvasRenderingContext2D, size: WatercolorTextureSize): void {
    const maskCanvas = createWatercolorCanvas(size)
    const maskCtx = maskCanvas.getContext('2d')
    if (!maskCtx) return

    drawWatercolorMask(maskCtx, size)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(maskCanvas, 0, 0)
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
}

function getMaskAlpha(maskData: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
    const sampleX = Math.max(0, Math.min(width - 1, x))
    const sampleY = Math.max(0, Math.min(height - 1, y))
    return maskData[(sampleY * width + sampleX) * 4 + 3] / 255
}

function getMaskEdgeStrength(maskData: Uint8ClampedArray, width: number, height: number, x: number, y: number, alpha: number): number {
    const sampleRadius = Math.max(4, Math.round(Math.min(width, height) * 0.010))
    const horizontal = Math.abs(getMaskAlpha(maskData, width, height, x - sampleRadius, y) - getMaskAlpha(maskData, width, height, x + sampleRadius, y))
    const vertical = Math.abs(getMaskAlpha(maskData, width, height, x, y - sampleRadius) - getMaskAlpha(maskData, width, height, x, y + sampleRadius))
    const diagonalA = Math.abs(getMaskAlpha(maskData, width, height, x - sampleRadius, y - sampleRadius) - getMaskAlpha(maskData, width, height, x + sampleRadius, y + sampleRadius))
    const diagonalB = Math.abs(getMaskAlpha(maskData, width, height, x + sampleRadius, y - sampleRadius) - getMaskAlpha(maskData, width, height, x - sampleRadius, y + sampleRadius))
    const gradient = clamp((horizontal + vertical + diagonalA + diagonalB) * 0.95)
    const alphaBand = smoothstep(0.08, 0.48, alpha) * (1 - smoothstep(0.58, 0.90, alpha))
    return clamp(alphaBand * 0.72 + gradient * 0.74)
}

function paintWatercolorPixels(ctx: CanvasRenderingContext2D, style: ContextRegionCloudStyle, size: WatercolorTextureSize, maskData: Uint8ClampedArray): void {
    const { width, height } = size
    const imageData = ctx.createImageData(width, height)
    const pool = hexToRgb(style.palette.pool)
    const bloom = hexToRgb(style.palette.bloom)
    const edge = hexToRgb(style.palette.edge)
    const gradientBaseColor = hexToRgb(contextRegionCloudTheme.gradientBaseColor)
    const gradientColors = contextRegionCloudTheme.gradientColors.map(hexToRgb)
    const gradientPositions = contextRegionCloudTheme.gradientPositions
    const maskAlphaThreshold = contextRegionCloudTheme.maskAlphaThreshold
    const seed = style.seed
    const minSize = Math.min(width, height)

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4
            const rawAlpha = maskData[index + 3] / 255
            if (rawAlpha < maskAlphaThreshold) continue

            const normalizedX = x / minSize
            const normalizedY = y / minSize
            const shapeAlpha = smoothstep(maskAlphaThreshold, 0.72, rawAlpha)
            const edgeStrength = getMaskEdgeStrength(maskData, width, height, x, y, rawAlpha)
            const paperNoise = fractalNoise(normalizedX * 28, normalizedY * 28, seed + 11, 3)
            const washNoise = fractalNoise(normalizedX * 7.5, normalizedY * 7.5, seed + 101, 4)
            const pigmentNoise = fractalNoise(normalizedX * 17, normalizedY * 17, seed + 503, 3)
            const fiberNoise = valueNoise(normalizedX * 118, normalizedY * 64, seed + 907)
            const arcNoise = fractalNoise(normalizedX * 4.5, normalizedY * 4.5, seed + 1301, 3)
            const interior = shapeAlpha * (1 - edgeStrength * 0.45)
            const poolWeight = clamp(edgeStrength * 0.10 + smoothstep(0.62, 0.92, pigmentNoise) * 0.18)
            const bloomWeight = clamp(interior * smoothstep(0.55, 0.94, washNoise) * 0.50)
            const paperLift = (paperNoise - 0.5) * 0.18 + (fiberNoise - 0.5) * 0.065
            const previewGradientColor = FreeformGradientRenderer.sampleColor(x / width, y / height, gradientColors, gradientPositions)
            const baseGradientColor = mixRgb(gradientBaseColor, previewGradientColor, 0.86)
            let color = mixRgb(baseGradientColor, pool, poolWeight * 0.22)
            color = mixRgb(color, edge, edgeStrength * 0.045)
            color = mixRgb(color, bloom, bloomWeight * 0.18 + Math.max(0, paperLift) * 0.08)
            color = mixRgb(color, previewGradientColor, 0.46 + paperNoise * 0.16)

            const granulation = 0.88 + paperNoise * 0.18 + fiberNoise * 0.07
            const alpha = clamp(shapeAlpha * (0.50 + interior * 0.20) * granulation + edgeStrength * 0.030)
            setPixel(imageData.data, index, color, alpha)
        }
    }

    ctx.putImageData(imageData, 0, 0)
}

function addCo2CloudPaintPools(ctx: CanvasRenderingContext2D, style: ContextRegionCloudStyle, size: WatercolorTextureSize, random: () => number): void {
    const { width, height } = size
    const minSize = Math.min(width, height)
    ctx.globalCompositeOperation = 'source-atop'

    ctx.filter = `blur(${Math.max(2, minSize * 0.004)}px)`
    for (let i = 0; i < 22; i++) {
        const angle = random() * Math.PI * 2
        const radiusX = style.aspect === 'wide' ? 0.30 : style.aspect === 'tall' ? 0.22 : 0.27
        const radiusY = style.aspect === 'wide' ? 0.21 : style.aspect === 'tall' ? 0.30 : 0.27
        const color = random() > 0.62 ? style.palette.bloom : random() > 0.45 ? style.palette.pool : style.palette.edge
        const alpha = color === style.palette.edge ? 0.028 + random() * 0.030 : 0.035 + random() * 0.045
        drawGradientEllipse(ctx, {
            x: (0.5 + Math.cos(angle) * radiusX * random() + (random() - 0.5) * 0.12) * width,
            y: (0.5 + Math.sin(angle) * radiusY * random() + (random() - 0.5) * 0.12) * height,
            rx: (0.030 + random() * 0.095) * width,
            ry: (0.028 + random() * 0.082) * height,
            rotation: angle + (random() - 0.5) * 1.2,
            stops: [
                { offset: 0, color: rgba(color, alpha) },
                { offset: 0.62, color: rgba(color, alpha * 0.42) },
                { offset: 1, color: rgba(color, 0) },
            ],
        })
    }

    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
}

function addWatercolorCutbacks(ctx: CanvasRenderingContext2D, style: ContextRegionCloudStyle, size: WatercolorTextureSize, random: () => number): void {
    const { width, height } = size
    const minSize = Math.min(width, height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.filter = `blur(${Math.max(2, minSize * 0.004)}px)`
    for (let i = 0; i < 38; i++) {
        const angle = random() * Math.PI * 2
        const radiusX = style.aspect === 'wide' ? 0.25 + random() * 0.10 : style.aspect === 'tall' ? 0.19 + random() * 0.09 : 0.23 + random() * 0.10
        const radiusY = style.aspect === 'wide' ? 0.19 + random() * 0.09 : style.aspect === 'tall' ? 0.25 + random() * 0.10 : 0.23 + random() * 0.10
        const alpha = 0.014 + random() * 0.030
        drawGradientEllipse(ctx, {
            x: (0.5 + Math.cos(angle) * radiusX + (random() - 0.5) * 0.10) * width,
            y: (0.5 + Math.sin(angle) * radiusY + (random() - 0.5) * 0.10) * height,
            rx: (0.012 + random() * 0.045) * width,
            ry: (0.016 + random() * 0.052) * height,
            rotation: angle + (random() - 0.5) * 1.4,
            stops: [
                { offset: 0, color: `rgba(255, 255, 255, ${alpha})` },
                { offset: 0.56, color: `rgba(255, 255, 255, ${alpha * 0.46})` },
                { offset: 1, color: 'rgba(255, 255, 255, 0)' },
            ],
        })
    }
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
}

function addWatercolorPigmentSpeckles(ctx: CanvasRenderingContext2D, style: ContextRegionCloudStyle, size: WatercolorTextureSize, random: () => number): void {
    const { width, height } = size
    const speckleCount = Math.round(width * height / 820)
    ctx.globalCompositeOperation = 'source-atop'
    for (let i = 0; i < speckleCount; i++) {
        const color = random() > 0.56 ? style.palette.edge : random() > 0.42 ? style.palette.pool : style.palette.bloom
        const alpha = 0.010 + random() * 0.042
        const dotSize = 0.35 + random() * random() * 2.4
        ctx.fillStyle = rgba(color, alpha)
        ctx.fillRect(random() * width, random() * height, dotSize, dotSize)
    }
    ctx.globalCompositeOperation = 'source-over'
}

function getActiveThoughtCircleGradientPositions(phase: number): Array<{ x: number; y: number }> {
    return FreeformGradientRenderer.getPhasePositions(phase)
}

function createActiveThoughtCircleTexture(gradientPositions: Array<{ x: number; y: number }>): Texture {
    const size = getTemplateSize()
    const canvas = createWatercolorCanvas(size)
    const ctx = canvas.getContext('2d')
    if (!ctx) return Texture.from(canvas)

    const bitmapWidth = FreeformGradientRenderer.bitmapSize.width
    const bitmapHeight = FreeformGradientRenderer.bitmapSize.height
    const gradientCanvas = createWatercolorCanvas({ width: bitmapWidth, height: bitmapHeight })
    const gradientCtx = gradientCanvas.getContext('2d')
    if (!gradientCtx) return Texture.from(canvas)

    const gradientColors = contextRegionCloudTheme.activeThoughtCircleGradientColors.map(hexToRgb)
    FreeformGradientRenderer.drawBitmap(
        gradientCtx,
        { width: bitmapWidth, height: bitmapHeight },
        gradientColors,
        gradientPositions
    )

    withCo2CloudShape(ctx, size, () => {
        for (const circle of CO2_CLOUD_CIRCLES) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2)
            ctx.clip()
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(
                gradientCanvas,
                0,
                0,
                bitmapWidth,
                bitmapHeight,
                circle.x - circle.radius,
                circle.y - circle.radius,
                circle.radius * 2,
                circle.radius * 2
            )
            ctx.restore()
        }
    })

    return Texture.from(canvas)
}

function createWatercolorTexture(style: ContextRegionCloudStyle): Texture {
    const size = getTemplateSize()
    const { width, height } = size
    const canvas = createWatercolorCanvas(size)
    const ctx = canvas.getContext('2d')
    if (!ctx) return Texture.WHITE

    const random = makeRandom(style.seed)
    const maskCanvas = createWatercolorCanvas(size)
    const maskCtx = maskCanvas.getContext('2d')
    if (!maskCtx) return Texture.WHITE

    ctx.clearRect(0, 0, width, height)
    drawWatercolorMask(maskCtx, size)
    const maskData = maskCtx.getImageData(0, 0, width, height).data
    paintWatercolorPixels(ctx, style, size, maskData)
    addRegionGradientPreviewOverlays(ctx, size)
    addCo2CloudPaintPools(ctx, style, size, random)
    addWatercolorCutbacks(ctx, style, size, random)
    addWatercolorPigmentSpeckles(ctx, style, size, random)
    if (contextRegionCloudTheme.borderEnabled) addExactCo2CloudBorder(ctx, style, size)
    applyCo2CloudMask(ctx, size)

    return Texture.from(canvas)
}

function rectsIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function colorNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16)
}

function getBackdropRect(datum: ContextRegionCloudDatum, style: ContextRegionCloudStyle): { x: number; y: number; size: number } {
    const bleed = getContextRegionCloudBleed(style, datum)
    const size = Math.max(datum.width, datum.height) + bleed * 2
    return {
        x: datum.x + datum.width / 2 - size / 2,
        y: datum.y + datum.height / 2 - size / 2,
        size,
    }
}

function drawTitle(text: Text, datum: ContextRegionCloudDatum, style: ContextRegionCloudStyle, zoom: number): void {
    const rect = getContextRegionCloudTitleRect(datum, zoom)

    text.text = datum.title
    text.style = {
        fill: colorNumber(style.palette.ink),
        fontFamily: contextRegionCloudTheme.titleFontFamily,
        fontSize: scaleCanvasChromeForZoom(contextRegionCloudTheme.titleFontSize, zoom),
        fontWeight: contextRegionCloudTheme.titleFontWeight,
    }
    text.position.set(rect.x, rect.y)
    text.scale.set(1)
    text.alpha = contextRegionCloudTheme.titleAlpha
}

function drawChrome(entry: PixiContextRegionEntry, viewport: ContextRegionViewport): void {
    const { datum, titleText } = entry
    const zoom = Math.max(viewport.zoom, 0.01)

    for (const child of [...entry.container.children]) {
        if (!(child instanceof Graphics)) continue
        entry.container.removeChild(child)
        child.destroy()
    }

    const chrome = new Graphics()
    entry.container.addChildAt(chrome, 1)
    entry.chrome = chrome

    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    drawTitle(titleText, datum, style, zoom)
}

function getGeometryKey(datum: ContextRegionCloudDatum, viewport: ContextRegionViewport): string {
    return [datum.nodeId, datum.x, datum.y, datum.width, datum.height, datum.title, datum.selected, viewport.zoom.toFixed(3)].join(':')
}

export function createPixiContextRegionLayer(options: PixiContextRegionLayerOptions): PixiContextRegionLayer {
    const { paneEl, viewportEl, onHealthChange } = options

    const hostStyle = {
        position: 'absolute' as const,
        inset: '0',
        pointerEvents: 'none' as const,
        zIndex: '0',
        overflow: 'hidden',
    }
    const hostEl = html`<div className="workspace-pixi-context-region-layer" style=${hostStyle}></div>` as HTMLDivElement
    paneEl.insertBefore(hostEl, viewportEl)

    const app = new Application()
    const world = new Container({ label: 'workspace-context-region-world' })
    const entries = new Map<string, PixiContextRegionEntry>()
    const textureCache = new Map<string, Texture>()
    let currentRegions: ContextRegionCloudDatum[] = []
    let destroyed = false
    let health: PixiRendererHealth = 'initializing'
    let currentViewport: ContextRegionViewport = { x: 0, y: 0, zoom: 1 }
    let renderRaf: number | null = null
    let pulseRaf: number | null = null
    let activeThoughtCircleRaf: number | null = null
    let activeThoughtCirclePhase = FreeformGradientRenderer.initialPhase

    function setHealth(next: PixiRendererHealth): void {
        if (health === next) return
        health = next
        onHealthChange?.(next)
    }

    function scheduleRender(): void {
        if (destroyed || health !== 'ready' || renderRaf !== null) return
        renderRaf = requestAnimationFrame(() => {
            renderRaf = null
            app.render()
        })
    }

    function getTexture(style: ContextRegionCloudStyle): Texture {
        const borderKey = contextRegionCloudTheme.borderEnabled ? 'border' : 'no-border'
        const textureKey = `${CONTEXT_REGION_TEXTURE_VERSION}:${borderKey}:${style.key}`
        const existing = textureCache.get(textureKey)
        if (existing) return existing
        const texture = createWatercolorTexture(style)
        textureCache.set(textureKey, texture)
        return texture
    }

    function getActiveThoughtCircleTexture(phase = FreeformGradientRenderer.initialPhase): Texture {
        const textureKey = `${CONTEXT_REGION_TEXTURE_VERSION}:active-thought-circle:${phase}:${contextRegionCloudTheme.activeThoughtCircleGradientColors.join('-')}`
        const existing = textureCache.get(textureKey)
        if (existing) return existing
        const texture = createActiveThoughtCircleTexture(getActiveThoughtCircleGradientPositions(phase))
        textureCache.set(textureKey, texture)
        return texture
    }

    function updateWorldTransform(): void {
        world.position.set(currentViewport.x, currentViewport.y)
        world.scale.set(currentViewport.zoom)
    }

    function updateVisibility(): void {
        const visibleRect = getVisibleWorldRect(currentViewport, {
            width: paneEl.clientWidth || paneEl.getBoundingClientRect().width,
            height: paneEl.clientHeight || paneEl.getBoundingClientRect().height,
        }, VISIBILITY_MARGIN)
        const visibleBounds = {
            x: visibleRect.minX,
            y: visibleRect.minY,
            width: visibleRect.maxX - visibleRect.minX,
            height: visibleRect.maxY - visibleRect.minY,
        }

        for (const entry of entries.values()) {
            const bounds = getContextRegionCloudBounds(entry.datum)
            entry.container.renderable = rectsIntersect(bounds, visibleBounds)
        }
    }

    function updateActiveThoughtCircleFrame(): void {
        activeThoughtCircleRaf = null
        const now = performance.now()
        let hasActiveAnimation = false

        for (const entry of entries.values()) {
            if (entry.activeThoughtCircleStartedAt === null) continue
            if (!entry.datum.active) {
                entry.activeThoughtCircleStartedAt = null
                entry.activeThoughtCircleFromOverlay.renderable = false
                continue
            }

            const elapsed = now - entry.activeThoughtCircleStartedAt
            const rawProgress = Math.min(1, elapsed / contextRegionCloudTheme.activeThoughtCircleAnimationDurationMs)
            const progress = Easing.hoverTransition(rawProgress)
            const reveal = smoothstep(0, 0.20, progress)
            const gradientShift = smoothstep(0.08, 0.92, progress)
            const bloomAlpha = Math.sin(progress * Math.PI) * contextRegionCloudTheme.activeThoughtCircleBloomAlphaLift
            const alpha = clamp((contextRegionCloudTheme.activeThoughtCircleAlpha + bloomAlpha) * reveal)

            entry.activeThoughtCircleFromOverlay.alpha = alpha * (1 - gradientShift)
            entry.activeThoughtCircleOverlay.alpha = alpha * gradientShift
            entry.activeThoughtCircleFromOverlay.renderable = entry.activeThoughtCircleFromOverlay.alpha > 0
            entry.activeThoughtCircleOverlay.renderable = true

            if (rawProgress >= 1) {
                entry.activeThoughtCircleStartedAt = null
                entry.activeThoughtCircleFromOverlay.renderable = false
                entry.activeThoughtCircleFromOverlay.alpha = 0
                entry.activeThoughtCircleOverlay.alpha = contextRegionCloudTheme.activeThoughtCircleAlpha
            } else {
                hasActiveAnimation = true
            }
        }

        scheduleRender()
        if (hasActiveAnimation && !destroyed) {
            activeThoughtCircleRaf = requestAnimationFrame(updateActiveThoughtCircleFrame)
        }
    }

    function animateActiveThoughtCircle(entry: PixiContextRegionEntry): void {
        const fromPhase = activeThoughtCirclePhase
        const toPhase = FreeformGradientRenderer.getPreviousPhase(fromPhase)
        activeThoughtCirclePhase = toPhase
        entry.activeThoughtCircleFromOverlay.texture = getActiveThoughtCircleTexture(fromPhase)
        entry.activeThoughtCircleOverlay.texture = getActiveThoughtCircleTexture(toPhase)
        entry.activeThoughtCircleFromOverlay.alpha = 0
        entry.activeThoughtCircleOverlay.alpha = 0
        entry.activeThoughtCircleFromOverlay.renderable = true
        entry.activeThoughtCircleOverlay.renderable = true
        entry.activeThoughtCircleStartedAt = performance.now()
        if (activeThoughtCircleRaf === null) {
            activeThoughtCircleRaf = requestAnimationFrame(updateActiveThoughtCircleFrame)
        }
    }

    function syncEntry(datum: ContextRegionCloudDatum): void {
        const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
        let entry = entries.get(datum.nodeId)
        const wasActive = entry?.datum.active ?? false
        if (!entry) {
            const container = new Container({ label: `workspace-context-region-${datum.nodeId}` })
            const backdrop = new Sprite(getTexture(style))
            const activeThoughtCircleFromOverlay = new Sprite(getActiveThoughtCircleTexture())
            const activeThoughtCircleOverlay = new Sprite(getActiveThoughtCircleTexture())
            const chrome = new Graphics()
            const titleText = new Text({ text: datum.title })
            container.addChild(backdrop)
            container.addChild(chrome)
            container.addChild(activeThoughtCircleFromOverlay)
            container.addChild(activeThoughtCircleOverlay)
            container.addChild(titleText)
            world.addChild(container)
            entry = {
                container,
                backdrop,
                activeThoughtCircleFromOverlay,
                activeThoughtCircleOverlay,
                chrome,
                titleText,
                datum,
                styleKey: style.key,
                geometryKey: '',
                pulseStartedAt: null,
                activeThoughtCircleStartedAt: null,
            }
            entries.set(datum.nodeId, entry)
        }

        if (entry.styleKey !== style.key) {
            entry.backdrop.texture = getTexture(style)
            entry.styleKey = style.key
        }

        entry.datum = datum
        const backdropRect = getBackdropRect(datum, style)
        entry.backdrop.position.set(backdropRect.x, backdropRect.y)
        entry.backdrop.width = backdropRect.size
        entry.backdrop.height = backdropRect.size
        entry.backdrop.alpha = datum.selected ? contextRegionCloudTheme.selectedAlpha : contextRegionCloudTheme.idleAlpha
        entry.activeThoughtCircleOverlay.position.set(backdropRect.x, backdropRect.y)
        entry.activeThoughtCircleOverlay.width = backdropRect.size
        entry.activeThoughtCircleOverlay.height = backdropRect.size
        entry.activeThoughtCircleFromOverlay.position.set(backdropRect.x, backdropRect.y)
        entry.activeThoughtCircleFromOverlay.width = backdropRect.size
        entry.activeThoughtCircleFromOverlay.height = backdropRect.size
        if (!datum.active) {
            entry.activeThoughtCircleStartedAt = null
            entry.activeThoughtCircleFromOverlay.renderable = false
            entry.activeThoughtCircleOverlay.renderable = false
        } else if (!wasActive) {
            animateActiveThoughtCircle(entry)
        } else if (entry.activeThoughtCircleStartedAt === null) {
            entry.activeThoughtCircleFromOverlay.renderable = false
            entry.activeThoughtCircleOverlay.alpha = contextRegionCloudTheme.activeThoughtCircleAlpha
            entry.activeThoughtCircleOverlay.renderable = true
        }

        const geometryKey = getGeometryKey(datum, currentViewport)
        if (entry.geometryKey !== geometryKey) {
            entry.geometryKey = geometryKey
            drawChrome(entry, currentViewport)
        }
    }

    function sync(regions: ContextRegionCloudDatum[]): void {
        currentRegions = regions
        const activeIds = new Set(regions.map((region) => region.nodeId))
        for (const [nodeId, entry] of entries) {
            if (activeIds.has(nodeId)) continue
            entry.container.destroy({ children: true })
            entries.delete(nodeId)
        }

        for (const region of regions) {
            syncEntry(region)
        }
        updateVisibility()
        scheduleRender()
    }

    function setViewport(viewport: ContextRegionViewport): void {
        currentViewport = viewport
        updateWorldTransform()
        for (const entry of entries.values()) {
            entry.geometryKey = ''
            drawChrome(entry, currentViewport)
            entry.geometryKey = getGeometryKey(entry.datum, currentViewport)
        }
        updateVisibility()
        scheduleRender()
    }

    function setNodeLiveTransform(nodeId: string, worldPosition: WorldPosition, dimensions: { width: number; height: number }): void {
        const entry = entries.get(nodeId)
        if (!entry) return
        const liveDatum = {
            ...entry.datum,
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height,
        }
        currentRegions = currentRegions.map((region) => region.nodeId === nodeId ? liveDatum : region)
        syncEntry(liveDatum)
        updateVisibility()
        scheduleRender()
    }

    function hitTest(worldPoint: ContextRegionCloudPoint): ContextRegionCloudHit {
        for (let i = currentRegions.length - 1; i >= 0; i--) {
            const entry = entries.get(currentRegions[i].nodeId)
            const datum = entry?.datum ?? currentRegions[i]
            const hit = hitTestContextRegionCloud(datum, worldPoint, currentViewport.zoom)
            if (hit.kind !== 'none') return hit
        }
        return { kind: 'none' }
    }

    function updatePulseFrame(): void {
        pulseRaf = null
        const now = performance.now()
        let hasActivePulse = false
        for (const entry of entries.values()) {
            if (entry.pulseStartedAt === null) continue
            const elapsed = now - entry.pulseStartedAt
            const progress = Math.min(1, elapsed / contextRegionCloudTheme.pulseDurationMs)
            const lift = Math.sin(progress * Math.PI)
            const style = getContextRegionCloudStyle(entry.datum.nodeId, entry.datum.width, entry.datum.height)
            const backdropRect = getBackdropRect(entry.datum, style)
            const baseAlpha = entry.datum.selected ? contextRegionCloudTheme.selectedAlpha : contextRegionCloudTheme.idleAlpha
            entry.backdrop.alpha = baseAlpha + lift * contextRegionCloudTheme.pulseAlphaLift
            entry.backdrop.position.set(backdropRect.x, backdropRect.y - lift * contextRegionCloudTheme.pulseLiftPx)
            entry.activeThoughtCircleFromOverlay.position.set(backdropRect.x, backdropRect.y - lift * contextRegionCloudTheme.pulseLiftPx)
            entry.activeThoughtCircleOverlay.position.set(backdropRect.x, backdropRect.y - lift * contextRegionCloudTheme.pulseLiftPx)
            if (progress >= 1) {
                entry.pulseStartedAt = null
                entry.backdrop.alpha = baseAlpha
                entry.backdrop.position.set(backdropRect.x, backdropRect.y)
                entry.activeThoughtCircleFromOverlay.position.set(backdropRect.x, backdropRect.y)
                entry.activeThoughtCircleOverlay.position.set(backdropRect.x, backdropRect.y)
            } else {
                hasActivePulse = true
            }
        }
        scheduleRender()
        if (hasActivePulse && !destroyed) pulseRaf = requestAnimationFrame(updatePulseFrame)
    }

    function pulseRegion(nodeId: string): void {
        const entry = entries.get(nodeId)
        if (!entry) return
        entry.pulseStartedAt = performance.now()
        if (pulseRaf === null) pulseRaf = requestAnimationFrame(updatePulseFrame)
    }

    void (async () => {
        try {
            await app.init({
                preference: 'webgpu',
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
                resizeTo: paneEl,
                autoStart: false,
                sharedTicker: false,
                webgpu: { antialias: true },
                webgl: { antialias: true },
            })
            if (destroyed) {
                app.destroy(true)
                return
            }
            app.stage.addChild(world)
            app.ticker.stop()
            hostEl.appendChild(app.canvas)
            applyStyle(app.canvas, { width: '100%', height: '100%', display: 'block' })
            updateWorldTransform()
            sync(currentRegions)
            setHealth('ready')
            scheduleRender()
        } catch (error) {
            console.error('Failed to initialize PIXI context region layer:', error)
            throw error
        }
    })()

    return {
        sync,
        setViewport,
        setNodeLiveTransform,
        hitTest,
        pulseRegion,
        getHealth: () => health,
        destroy() {
            destroyed = true
            if (renderRaf !== null) cancelAnimationFrame(renderRaf)
            if (pulseRaf !== null) cancelAnimationFrame(pulseRaf)
            if (activeThoughtCircleRaf !== null) cancelAnimationFrame(activeThoughtCircleRaf)
            for (const texture of textureCache.values()) texture.destroy(true)
            textureCache.clear()
            entries.clear()
            app.destroy(true)
            hostEl.remove()
        },
    }
}
