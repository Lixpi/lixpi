export type FreeformGradientColor = { r: number; g: number; b: number }

export type FreeformGradientPoint = { x: number; y: number }

export type FreeformGradientBitmapSize = { width: number; height: number }

type FreeformGradientCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type FreeformGradientHexColorSet = [string, string, string, string]

export class FreeformGradientRenderer {
    static readonly bitmapSize: FreeformGradientBitmapSize = { width: 60, height: 80 }
    static readonly initialPhase = 4
    static readonly phasePositions: ReadonlyArray<FreeformGradientPoint> = [
        { x: 0.8, y: 0.1 },
        { x: 0.6, y: 0.2 },
        { x: 0.35, y: 0.25 },
        { x: 0.25, y: 0.6 },
        { x: 0.2, y: 0.9 },
        { x: 0.4, y: 0.8 },
        { x: 0.65, y: 0.75 },
        { x: 0.75, y: 0.4 },
    ]

    private static readonly swirlFactor = 0.35

    private static clamp(value: number, min = 0, max = 1): number {
        return Math.max(min, Math.min(max, value))
    }

    static hexToColor(hex: string): FreeformGradientColor {
        const value = hex.replace('#', '')
        return {
            r: parseInt(value.slice(0, 2), 16),
            g: parseInt(value.slice(2, 4), 16),
            b: parseInt(value.slice(4, 6), 16),
        }
    }

    static parseHexColors(colors: FreeformGradientHexColorSet): FreeformGradientColor[] {
        return colors.map((color) => FreeformGradientRenderer.hexToColor(color))
    }

    static getPhasePositions(
        phase: number,
        pointCount = 4,
        phasePositions: ReadonlyArray<FreeformGradientPoint> = FreeformGradientRenderer.phasePositions,
    ): FreeformGradientPoint[] {
        const positions: FreeformGradientPoint[] = []
        for (let i = 0; i < pointCount; i++) {
            positions.push(phasePositions[(phase + i * 2) % phasePositions.length])
        }
        return positions
    }

    static getPreviousPhase(
        phase: number,
        phasePositions: ReadonlyArray<FreeformGradientPoint> = FreeformGradientRenderer.phasePositions,
    ): number {
        return (phase - 1 + phasePositions.length) % phasePositions.length
    }

    static sampleColor(
        directPixelX: number,
        directPixelY: number,
        colors: ReadonlyArray<FreeformGradientColor>,
        positions: ReadonlyArray<FreeformGradientPoint>,
    ): FreeformGradientColor {
        const centerDistanceX = directPixelX - 0.5
        const centerDistanceY = directPixelY - 0.5
        const centerDistance = Math.sqrt(centerDistanceX * centerDistanceX + centerDistanceY * centerDistanceY)
        const swirlFactor = FreeformGradientRenderer.swirlFactor * centerDistance
        const theta = swirlFactor * swirlFactor * 0.8 * 8.0
        const sinTheta = Math.sin(theta)
        const cosTheta = Math.cos(theta)
        const pixelX = FreeformGradientRenderer.clamp(0.5 + centerDistanceX * cosTheta - centerDistanceY * sinTheta)
        const pixelY = FreeformGradientRenderer.clamp(0.5 + centerDistanceX * sinTheta + centerDistanceY * cosTheta)
        let r = 0
        let g = 0
        let b = 0
        let distanceSum = 0

        for (let i = 0; i < colors.length; i++) {
            const position = positions[i]
            if (!position) continue

            const dx = pixelX - position.x
            const dy = pixelY - position.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            let weight = Math.max(0, 0.9 - dist)
            weight = weight * weight * weight * weight
            distanceSum += weight
            r += weight * colors[i].r
            g += weight * colors[i].g
            b += weight * colors[i].b
        }

        if (distanceSum === 0) return colors[0] ?? { r: 0, g: 0, b: 0 }
        return { r: r / distanceSum, g: g / distanceSum, b: b / distanceSum }
    }

    static paintImageData(
        imageData: ImageData,
        colors: ReadonlyArray<FreeformGradientColor>,
        positions: ReadonlyArray<FreeformGradientPoint>,
    ): void {
        const { width, height, data } = imageData

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = FreeformGradientRenderer.sampleColor(x / width, y / height, colors, positions)
                const index = (y * width + x) * 4
                data[index] = Math.round(FreeformGradientRenderer.clamp(color.r, 0, 255))
                data[index + 1] = Math.round(FreeformGradientRenderer.clamp(color.g, 0, 255))
                data[index + 2] = Math.round(FreeformGradientRenderer.clamp(color.b, 0, 255))
                data[index + 3] = 255
            }
        }
    }

    static drawBitmap(
        ctx: FreeformGradientCanvasContext,
        size: FreeformGradientBitmapSize,
        colors: ReadonlyArray<FreeformGradientColor>,
        positions: ReadonlyArray<FreeformGradientPoint>,
    ): ImageData {
        const imageData = ctx.createImageData(size.width, size.height)
        FreeformGradientRenderer.paintImageData(imageData, colors, positions)
        ctx.putImageData(imageData, 0, 0)
        return imageData
    }
}
