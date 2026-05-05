const INITIAL_Z_INDEX = 10
const BACKGROUND_Z_INDEX = 1

export function createNodeLayerManager() {
    let topZIndex = INITIAL_Z_INDEX

    return {
        bringToFront(el: HTMLElement) {
            topZIndex++
            el.style.zIndex = String(topZIndex)
        },

        sendToBackground(el: HTMLElement) {
            el.style.zIndex = String(BACKGROUND_Z_INDEX)
        },

        currentTopIndex(): number {
            return topZIndex
        },

        backgroundIndex(): number {
            return BACKGROUND_Z_INDEX
        }
    }
}

export type NodeLayerManager = ReturnType<typeof createNodeLayerManager>
