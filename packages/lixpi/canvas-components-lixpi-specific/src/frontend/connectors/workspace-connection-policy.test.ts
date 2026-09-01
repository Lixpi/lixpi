// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import type { EngineNode } from '@lixpi/canvas-engine/shared'
import {
    createWorkspaceConnectionPolicy,
    type WorkspaceConnectionNodeData,
} from './workspace-connection-manager.ts'

function projected(type: CanvasNode['type'], nodeId: string): EngineNode<WorkspaceConnectionNodeData> {
    const node = { type, nodeId, position: { x: 10, y: 20 }, dimensions: { width: 100, height: 80 } } as CanvasNode
    return { nodeId, type, position: { x: 510, y: 620 }, dimensions: { width: 200, height: 160 }, ports: [], data: { node } }
}

describe('workspace controller connection policy', () => {
    it('interprets node roles through opaque data and keeps source-message metadata on the edge', () => {
        const policy = createWorkspaceConnectionPolicy()
        expect(policy.isCentered(projected('image', 'image'))).toBe(true)
        expect(policy.isCentered(projected('document', 'document'))).toBe(false)
        expect(policy.targetMarker!(projected('branchLine', 'line'), true)).toBe('none')
        expect(policy.defaultTargetHandle!(projected('capabilityArtifact', 'artifact'))).toBe('left')
        const root = document.createElement('div'), message = document.createElement('div')
        message.dataset.messageId = 'message'
        root.appendChild(message)
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 400))
        vi.spyOn(message, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 190, 300, 20))
        const wire: WorkspaceEdge = { edgeId: 'edge', sourceNodeId: 'a', targetNodeId: 'b', sourceMessageId: 'message' }
        expect(policy.sourceAnchorT!({ edgeId: wire.edgeId, sourceNodeId: 'a', targetNodeId: 'b', data: wire }, root)).toBe(0.25)
    })

    it('positions branch model circles from live engine geometry rather than persisted coordinates', () => {
        const policy = createWorkspaceConnectionPolicy()
        const marker = projected('branchOrigin', 'marker')
        const media = projected('image', 'image')
        media.data.node = { ...media.data.node, generatedBy: { branchOriginNodeId: 'marker', mediaModelId: 'test:image' } } as CanvasNode
        const first = policy.additionalGeometry!(marker, [marker, media])
        const moved = { ...marker, position: { x: marker.position.x + 75, y: marker.position.y + 25 } }
        const second = policy.additionalGeometry!(moved, [moved, media])
        expect(first).toHaveLength(1)
        expect(second[0]!.x - first[0]!.x).toBe(75)
        expect(second[0]!.y - first[0]!.y).toBe(25)
        expect(marker.data.node.position).toEqual({ x: 10, y: 20 })
    })
})
