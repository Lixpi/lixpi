import {
    ConnectionManager,
    computeConnectorSpread,
    type ConnectionManagerConfig,
    type ConnectionEdge,
    type ConnectionPolicy,
    type NodeConfig,
} from '@lixpi/canvas-engine/frontend/connectors'
import {
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type CanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { isBranchLineageMarkerNode } from '../../shared/branch-tree-layout/branch-lineage-state.ts'
import {
    getBranchMarkerMediaModelCircleDescriptors,
    getBranchMarkerMediaModelCircleIndexForGeneratedMedia,
    getBranchMarkerMediaModelCircleNodeId,
    getBranchMarkerMediaModelCircleRect,
    isBranchMarkerNodeForMediaModelCircles,
    isGeneratedMediaNodeForMediaModelCircles,
} from '../../shared/branch-tree-layout/marker-media-ports.ts'

export type WorkspaceConnectionManagerConfig = Pick<ConnectionManagerConfig<CanvasNode>, 'paneEl' | 'viewportEl' | 'flowId' | 'getTransform' | 'panBy' | 'onEdgesChange' | 'onError' | 'onSelectedEdgeChange' | 'onConnectorGeometry' | 'settings'>

// The arrow artwork's body spans this fraction between its reference point and tip.
export const workspaceConnectorMarkerBodyLengthFraction = (228.992 - 48) / 256

export type WorkspaceConnectionNodeData = { node: CanvasNode }

function isMidSideAnchorNode(node: CanvasNode | undefined): boolean {
    return node?.type === 'image' || node?.type === 'video' || isBranchLineageMarkerNode(node)
}

export function computeSpreadTValues(edges: WorkspaceEdge[], nodes: CanvasNode[], settings: WorkspaceConnectionManagerConfig['settings']) {
    return computeConnectorSpread(edges, nodes, { isCentered: isMidSideAnchorNode, ...settings.autoAlign })
}

function additionalGeometry(node: CanvasNode, nodes: readonly CanvasNode[]): NodeConfig[] {
    if (!isBranchMarkerNodeForMediaModelCircles(node)) return []
    const descriptors = getBranchMarkerMediaModelCircleDescriptors(node, [...nodes])
    return descriptors.map((_descriptor, index) => {
        const rectangle = getBranchMarkerMediaModelCircleRect(node, index, descriptors.length)
        return { id: getBranchMarkerMediaModelCircleNodeId(node.nodeId, index), shape: 'rect', ...rectangle }
    })
}

function renderedSourceNodeId(edge: ConnectionEdge, nodes: readonly CanvasNode[]): string {
    const source = nodes.find(node => node.nodeId === edge.sourceNodeId)
    const target = nodes.find(node => node.nodeId === edge.targetNodeId)
    if (!isBranchMarkerNodeForMediaModelCircles(source) || !isGeneratedMediaNodeForMediaModelCircles(target)) return edge.sourceNodeId
    const index = getBranchMarkerMediaModelCircleIndexForGeneratedMedia(source, [...nodes], target)
    return index == null ? edge.sourceNodeId : getBranchMarkerMediaModelCircleNodeId(source.nodeId, index)
}

function sourceAnchorT(edge: WorkspaceEdge, nodeElement: HTMLElement | undefined): number | null {
    if (!edge.sourceMessageId || !nodeElement) return null
    const message = nodeElement.querySelector(`[data-message-id="${edge.sourceMessageId}"]`)
    if (!message) return null
    const nodeRect = nodeElement.getBoundingClientRect()
    const messageRect = message.getBoundingClientRect()
    if (nodeRect.height <= 0 || messageRect.height <= 0) return null
    const center = messageRect.top + messageRect.height / 2
    if (center < nodeRect.top || center > nodeRect.bottom) return null
    return Math.max(0, Math.min(1, (center - nodeRect.top) / nodeRect.height))
}

function workspacePolicy(): ConnectionPolicy<CanvasNode> {
    return {
        isCentered: isMidSideAnchorNode,
        isReconnectionCentered: node => node?.type === 'image',
        defaultTargetHandle: node =>
            node?.type === 'image' || node?.type === 'video' || node?.type === 'capabilityArtifact'
                || (node?.type === 'operationStatus' && node.operation === 'media-generation')
                ? 'left'
                : 'right',
        targetMarker: (node, selected) =>
            node?.type === 'branchLine' || node?.type === 'branchFork'
                ? 'none'
                : selected
                ? 'arrowhead-selected'
                : 'arrowhead',
        additionalGeometry,
        renderedSourceNodeId,
        sourceAnchorT,
        isNodeTarget: target => Boolean(target.closest('.workspace-document-node, .workspace-image-node, .workspace-ai-chat-thread-node')),
    }
}

function projectConnectionNode(node: EngineNode): CanvasNode {
    const data = node.data as WorkspaceConnectionNodeData
    return { ...data.node, position: node.position, dimensions: node.dimensions, parentId: node.parentId }
}

// Apply the same product policy to the controller's opaque node and edge data.
// Geometry comes from the engine's live world-space projection, not stale data.
export function createWorkspaceConnectionPolicy(): ConnectionPolicy<EngineNode> {
    const policy = workspacePolicy()
    const projectOptional = (node: EngineNode | undefined) => node ? projectConnectionNode(node) : undefined
    return {
        isCentered: node => policy.isCentered(projectOptional(node)),
        isReconnectionCentered: node => policy.isReconnectionCentered!(projectOptional(node)),
        defaultTargetHandle: node => policy.defaultTargetHandle!(projectOptional(node)),
        targetMarker: (node, selected) => policy.targetMarker!(projectOptional(node), selected),
        additionalGeometry: (node, nodes) => additionalGeometry(projectConnectionNode(node), nodes.map(projectConnectionNode)),
        renderedSourceNodeId: (edge, nodes) => renderedSourceNodeId(edge, nodes.map(projectConnectionNode)),
        sourceAnchorT: (edge, element) => sourceAnchorT({ ...edge.data as WorkspaceEdge | undefined, ...edge }, element),
        isNodeTarget: policy.isNodeTarget,
    }
}

export class WorkspaceConnectionManager extends ConnectionManager<CanvasNode> {
    constructor(config: WorkspaceConnectionManagerConfig) {
        super({
            ...config,
            markerBodyLengthFraction: workspaceConnectorMarkerBodyLengthFraction,
            ...workspacePolicy(),
        })
    }
}
