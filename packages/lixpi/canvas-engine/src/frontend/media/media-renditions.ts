import {
    type CanvasEngineSize,
} from '../../shared/index.ts'
import {
    type MediaDescriptor,
    type MediaRendition,
} from './types.ts'

export function renditionSize(rendition: MediaRendition): CanvasEngineSize {
    return { width: rendition.width ?? Infinity, height: rendition.height ?? Infinity }
}

export function selectImageRendition(media: MediaDescriptor, visiblePixels: CanvasEngineSize): MediaRendition {
    if (![visiblePixels.width, visiblePixels.height].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Visible image dimensions must be finite and positive')
    const candidates = media.renditions.filter(rendition => rendition.mimeType.startsWith('image/'))
    if (candidates.length === 0) throw new Error(`Media ${media.key} has no image rendition`)
    for (const candidate of candidates) {
        if ([candidate.width, candidate.height].some(value => value !== undefined && (!Number.isFinite(value) || value <= 0))) throw new RangeError('Rendition dimensions must be positive')
    }
    const sorted = [...candidates].sort((first, second) => {
        const a = renditionSize(first)
        const b = renditionSize(second)
        return a.width * a.height - b.width * b.height
    })
    return sorted.find(rendition => {
        const size = renditionSize(rendition)
        return size.width >= visiblePixels.width && size.height >= visiblePixels.height
    }) ?? sorted.at(-1)!
}

export function mipmappedImageBytes(size: CanvasEngineSize): number {
    if (![size.width, size.height].every(value => Number.isInteger(value) && value > 0)) throw new RangeError('Image dimensions must be positive integers')
    let width = size.width
    let height = size.height
    let pixels = width * height
    while (width > 1 || height > 1) {
        width = Math.max(1, Math.floor(width / 2))
        height = Math.max(1, Math.floor(height / 2))
        pixels += width * height
    }
    return pixels * 4
}
