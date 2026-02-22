const INITIAL_Z_INDEX = 10

export function createNodeLayerManager() {
    let topZIndex = INITIAL_Z_INDEX

    return {
        bringToFront(el: HTMLElement) {
            topZIndex++
            el.style.zIndex = String(topZIndex)
        },

        currentTopIndex(): number {
            return topZIndex
        }
    }
}

export type NodeLayerManager = ReturnType<typeof createNodeLayerManager>
