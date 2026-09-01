import type { CanvasState } from '@lixpi/constants'

export function createDefaultCanvasState(): CanvasState {
    return { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }
}

export function normalizeWorkspaceCanvasState(canvasState?: Partial<CanvasState> | null): CanvasState {
    return {
        ...canvasState,
        viewport: { x: 0, y: 0, zoom: 1, ...canvasState?.viewport },
        nodes: canvasState?.nodes ?? [],
        edges: canvasState?.edges ?? [],
    }
}

export function workspaceCanvasStatePatch(canvasState: CanvasState, origin: 'local-intent' | 'authoritative') {
    return {
        data: { canvasState },
        meta: { requiresSave: origin === 'local-intent' },
    }
}

export function workspaceCanvasLoadPatch() {
    return {
        data: { canvasState: createDefaultCanvasState(), canvasStateUpdatedAt: 0 },
        meta: { requiresSave: false },
    }
}
