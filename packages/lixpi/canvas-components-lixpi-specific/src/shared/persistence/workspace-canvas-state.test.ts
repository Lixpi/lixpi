import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    createDefaultCanvasState,
    normalizeWorkspaceCanvasState,
    workspaceCanvasLoadPatch,
    workspaceCanvasStatePatch,
} from './workspace-canvas-state.ts'

describe('workspace canvas state policy', () => {
    it('creates independent empty scenes for load and reset', () => {
        const first = createDefaultCanvasState()
        const second = workspaceCanvasLoadPatch()
        first.viewport.x = 200
        expect(second.data.canvasState.viewport.x).toBe(0)
        expect(second.meta.requiresSave).toBe(false)
        expect(second.data.canvasStateUpdatedAt).toBe(0)
    })

    it('normalizes missing scene fields without discarding supplied product state', () => {
        const viewport = { x: 1, y: 2, zoom: 0.5 }
        const normalized = normalizeWorkspaceCanvasState({ viewport, lastActiveConversationAssetId: 'conversation' })
        expect(normalized).toEqual({ viewport, nodes: [], edges: [], lastActiveConversationAssetId: 'conversation' })
        expect(normalized.viewport).not.toBe(viewport)
        expect(normalizeWorkspaceCanvasState(null)).toEqual(createDefaultCanvasState())
    })

    it('marks local changes dirty and authoritative adoption clean', () => {
        const state = createDefaultCanvasState()
        expect(workspaceCanvasStatePatch(state, 'local-intent')).toEqual({ data: { canvasState: state }, meta: { requiresSave: true } })
        expect(workspaceCanvasStatePatch(state, 'authoritative')).toEqual({ data: { canvasState: state }, meta: { requiresSave: false } })
    })
})
