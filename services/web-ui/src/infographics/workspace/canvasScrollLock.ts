// The canvas side panels and their editors live inside the canvas's
// structural layers. Browser focus handling and ProseMirror scrollIntoView
// scroll those layers even with overflow hidden, visually shifting the whole
// canvas without the pan/zoom engine knowing. Locking pins every structural
// layer's scroll offsets to zero; intended scrollers (thread history, panel
// bodies) are descendants and stay untouched.

export function lockCanvasScrollLayers(layers: Array<HTMLElement | null | undefined>): () => void {
    const lockedLayers = layers.filter((layer): layer is HTMLElement => Boolean(layer))
    const cleanups = lockedLayers.map((layer) => {
        const resetScroll = () => {
            if (layer.scrollLeft !== 0) layer.scrollLeft = 0
            if (layer.scrollTop !== 0) layer.scrollTop = 0
        }
        layer.addEventListener('scroll', resetScroll)
        return () => layer.removeEventListener('scroll', resetScroll)
    })
    return () => {
        for (const cleanup of cleanups) cleanup()
    }
}
