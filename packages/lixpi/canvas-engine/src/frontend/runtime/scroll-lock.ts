import {
    type Dispose,
} from '../../shared/index.ts'

// Structural canvas layers must not scroll independently of the viewport.
// Descendant editors and panel bodies retain their own scroll positions.
export class CanvasScrollLock {
    private readonly layers: HTMLElement[]

    constructor(layers: readonly (HTMLElement | null | undefined)[]) {
        this.layers = [...new Set(layers.filter((layer): layer is HTMLElement => Boolean(layer)))]
        for (const layer of this.layers) layer.addEventListener('scroll', this.resetScroll)
    }

    private resetScroll = (event: Event): void => {
        const layer = event.currentTarget as HTMLElement
        if (layer.scrollLeft !== 0) layer.scrollLeft = 0
        if (layer.scrollTop !== 0) layer.scrollTop = 0
    }

    destroy = (): void => {
        for (const layer of this.layers) layer.removeEventListener('scroll', this.resetScroll)
        this.layers.length = 0
    }
}

export function lockCanvasScrollLayers(layers: readonly (HTMLElement | null | undefined)[]): Dispose {
    return new CanvasScrollLock(layers).destroy
}
