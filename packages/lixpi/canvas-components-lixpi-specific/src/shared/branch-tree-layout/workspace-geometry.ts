import type {
    CanvasNode,
    WorkspaceCollisionSettings,
    WorkspaceCollisionFlowSettings,
    WorkspaceCollisionNodeTypeSettings,
} from '@lixpi/constants'
import {
    computeViewportCenterInsertionPosition,
    resolveCollisions,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'
import {
    GeneratedMediaRebalancePipeline,
    type CanvasGeometry,
    type Point,
    type Rect,
} from './generated-media-rebalance.ts'
import {
    applyBranchLineageNodeGap,
    normalizeBranchLineageNodeGap,
} from './branch-lineage-spacing.ts'
import { getGeneratedOutputChromeCollisionInsets } from './media-fitting.ts'
import {
    getGeneratedMediaPreFrameLayoutRect,
    getGeneratedMediaPreFrameSize,
} from '../canvas-node/generated-media-node.ts'

export type CollisionBox = {
    id: string
    x: number
    y: number
    width: number
    height: number
    margin?: number
    overlapThreshold?: number
}
export type CollisionEntry = { node: CanvasNode; offset: Point }
export type CollisionPlan = {
    nodeBoxes: CollisionBox[]
    entries: Map<string, CollisionEntry>
    shouldResolvePair: (a: CollisionBox, b: CollisionBox) => boolean
    iterations: number
}

export type WorkspaceGeometrySettings = {
    workspaceCollision: WorkspaceCollisionSettings
    mediaNode: { inProgressOutlineAnimation: { preFrameCircleScale: number } }
    mediaBranchLineage: {
        generatedMediaSize: number
        nodeGap: number
        mediaToMediaGap: number
        branchOriginToFirstMediaGap: number
        rootToFirstMediaGap: number
        branchRowGap: number
        branchFanoutExtraGap: number
    }
}

export type WorkspaceGeometryPorts = {
    workspaceId: string
    settings: WorkspaceGeometrySettings
    getViewport: () => CanvasViewport
    getPaneSize: () => { width: number; height: number }
    getWorldPosition: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Point
    getWorldRect: (node: CanvasNode, nodesById: Map<string, CanvasNode>) => Rect
    getLiveDimensions: (nodeId: string) => CanvasGeometry['dimensions'] | undefined
    isPending: (nodeId: string) => boolean
}

export class WorkspaceGeometry {
    constructor(private readonly ports: WorkspaceGeometryPorts) {}

    toParentRelativePosition(
        worldPosition: { x: number; y: number },
        parentId: string,
        nodesById: Map<string, CanvasNode>,
    ): { x: number; y: number } {
        const parentNode = nodesById.get(parentId)
        if (!parentNode) return worldPosition
        const parentPosition = this.ports.getWorldPosition(parentNode, nodesById)
        return {
            x: worldPosition.x - parentPosition.x,
            y: worldPosition.y - parentPosition.y,
        }
    }

    getGeneratedMediaInsertionSize(): number {
        return this.ports.settings.mediaBranchLineage.generatedMediaSize
    }

    getCanvasVisibleAreaForApiProjection(): { width: number; height: number } | undefined {
        const { width, height } = this.ports.getPaneSize()
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
        return { width, height }
    }

    getCenteredInsertionPosition(dimensions: { width: number; height: number }): { x: number; y: number } {
        return computeViewportCenterInsertionPosition(dimensions, this.ports.getViewport(), this.ports.getPaneSize())
    }

    getFreshBranchRootMarkerPosition(
        dimensions: { width: number; height: number },
    ): { x: number; y: number } {
        const viewport = this.ports.getViewport()
        const paneSize = this.ports.getPaneSize()
        const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
        const viewportEdgeGap = normalizeBranchLineageNodeGap(this.ports.settings.mediaBranchLineage.nodeGap) / zoom
        const visibleLeft = (0 - viewport.x) / zoom
        const visibleTop = (0 - viewport.y) / zoom
        const visibleHeight = paneSize.height / zoom
        const minY = visibleTop + viewportEdgeGap
        const maxY = visibleTop + visibleHeight - dimensions.height - viewportEdgeGap
        const centeredY = visibleTop + (visibleHeight - dimensions.height) / 2
        return {
            x: visibleLeft + viewportEdgeGap,
            y: Math.max(minY, Math.min(maxY, centeredY)),
        }
    }

    getResolvedNodePositionFromCollisionBox(node: CanvasNode, box: { x: number; y: number }, entries: Map<string, CollisionEntry>): { x: number; y: number } {
        const entry = entries.get(node.nodeId)
        if (!entry) return box
        return {
            x: box.x + entry.offset.x,
            y: box.y + entry.offset.y,
        }
    }

    getMediaChromeCollisionInsets(node: CanvasNode): { top: number; bottom: number } {
        if (node.type !== 'image' && node.type !== 'video' && node.type !== 'capabilityArtifact') {
            return { top: 0, bottom: 0 }
        }
        return getGeneratedOutputChromeCollisionInsets(node.type)
    }

    getCanvasNodeCollisionRect(
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ): Rect {
        const dimensions = (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine')
            ? this.ports.getLiveDimensions(node.nodeId) ?? node.dimensions
            : node.dimensions
        const pendingCircleGeometry = this.getPendingGeneratedMediaBeforeFrameCircleGeometry(
            node.nodeId,
            worldPosition,
            dimensions,
        )
        let collisionRect: Rect
        if (pendingCircleGeometry) {
            collisionRect = getGeneratedMediaPreFrameLayoutRect(
                worldPosition,
                dimensions,
                this.ports.settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale,
            )
        } else {
            const chromeInsets = this.getMediaChromeCollisionInsets(node)
            collisionRect = {
                x: worldPosition.x,
                y: worldPosition.y - chromeInsets.top,
                width: dimensions.width,
                height: chromeInsets.top + dimensions.height + chromeInsets.bottom,
            }
        }
        return collisionRect
    }

    getCanvasNodeConnectorAnchorRect(
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ): Rect {
        const dimensions = (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine')
            ? this.ports.getLiveDimensions(node.nodeId) ?? node.dimensions
            : node.dimensions
        const pendingCircleGeometry = this.getPendingGeneratedMediaBeforeFrameCircleGeometry(
            node.nodeId,
            worldPosition,
            dimensions,
        )
        if (pendingCircleGeometry) {
            return {
                x: pendingCircleGeometry.position.x,
                y: pendingCircleGeometry.position.y,
                width: pendingCircleGeometry.dimensions.width,
                height: pendingCircleGeometry.dimensions.height,
            }
        }
        const mediaRect = {
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height,
        }
        return mediaRect
    }

    getBranchLineageCollisionSettings(
        nodeSettings: WorkspaceCollisionNodeTypeSettings,
    ): WorkspaceCollisionNodeTypeSettings {
        return applyBranchLineageNodeGap(nodeSettings, normalizeBranchLineageNodeGap(this.ports.settings.mediaBranchLineage.nodeGap))
    }

    getCanvasNodeCollisionSettings(
        node: CanvasNode,
        collisionSettings: WorkspaceCollisionFlowSettings,
    ): WorkspaceCollisionNodeTypeSettings {
        switch (node.type) {
            case 'image':
                return collisionSettings.nodeTypes.image
            case 'video':
                return collisionSettings.nodeTypes.video
            case 'branchOrigin':
                return this.getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchOrigin)
            case 'branchFork':
                return this.getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchFork)
            case 'branchLine':
                return this.getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchLine)
            case 'document':
            default:
                return collisionSettings.nodeTypes.document
        }
    }

    getWorkspaceCollisionFlowIterations(collisionSettings: WorkspaceCollisionFlowSettings): number {
        return Math.max(
            ...Object.values(collisionSettings.nodeTypes)
                .map((nodeSettings: WorkspaceCollisionNodeTypeSettings) => nodeSettings.iterations),
        )
    }

    createCollisionPlan(
        nodes: CanvasNode[],
        topLevelOnly = false,
        collisionSettings: WorkspaceCollisionFlowSettings = this.ports.settings.workspaceCollision.dragRelease,
    ): CollisionPlan {
        const collisionNodes = topLevelOnly
            ? nodes.filter((node: CanvasNode) => !node.parentId)
            : nodes
        const nodesById = new Map(nodes.map(node => [node.nodeId, node]))
        const entries = new Map<string, CollisionEntry>()
        let iterations = 0

        const nodeBoxes = collisionNodes.map((node: CanvasNode) => {
            const worldPosition = this.ports.getWorldPosition(node, nodesById)
            const collisionRect = this.getCanvasNodeCollisionRect(node, worldPosition)
            const nodeCollisionSettings = this.getCanvasNodeCollisionSettings(node, collisionSettings)
            iterations = Math.max(iterations, nodeCollisionSettings.iterations)
            entries.set(node.nodeId, {
                node,
                offset: {
                    x: worldPosition.x - collisionRect.x,
                    y: worldPosition.y - collisionRect.y,
                },
            })
            return {
                id: node.nodeId,
                x: collisionRect.x,
                y: collisionRect.y,
                width: collisionRect.width,
                height: collisionRect.height,
                margin: nodeCollisionSettings.margin,
                overlapThreshold: nodeCollisionSettings.overlapThreshold,
            }
        })

        const shouldResolvePair = (): boolean => true

        return { nodeBoxes, entries, shouldResolvePair, iterations }
    }

    resolveTopLevelNodeCollisions(nodes: CanvasNode[]): CanvasNode[] {
        const collisionSettings = this.ports.settings.workspaceCollision.insertion
        const collisionPlan = this.createCollisionPlan(nodes, true, collisionSettings)
        const collisionResult = resolveCollisions(collisionPlan.nodeBoxes, {
            iterations: collisionPlan.iterations,
            margin: 0,
            shouldResolvePair: collisionPlan.shouldResolvePair,
        })

        if (!collisionResult.hasChanges) return nodes

        return nodes.map((node: CanvasNode) => {
            if (node.parentId) return node
            const movedPosition = collisionResult.nodes.get(node.nodeId)
            return movedPosition ? { ...node, position: this.getResolvedNodePositionFromCollisionBox(node, movedPosition, collisionPlan.entries) } : node
        })
    }

    createGeneratedMediaRebalancePipeline(): GeneratedMediaRebalancePipeline {
        const collisionSettings = this.ports.settings.workspaceCollision.branchTree
        return new GeneratedMediaRebalancePipeline({
            workspaceId: this.ports.workspaceId,
            mediaSize: this.getGeneratedMediaInsertionSize(),
            pendingMediaPreFrameScale: this.ports.settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale,
            depthGap: this.ports.settings.mediaBranchLineage.mediaToMediaGap,
            branchOriginDepthGap: this.ports.settings.mediaBranchLineage.branchOriginToFirstMediaGap,
            rootMarkerDepthGap: this.ports.settings.mediaBranchLineage.rootToFirstMediaGap,
            siblingGap: this.ports.settings.mediaBranchLineage.branchRowGap,
            branchFanoutExtraGap: this.ports.settings.mediaBranchLineage.branchFanoutExtraGap,
            branchOriginMarkerStackGap: normalizeBranchLineageNodeGap(this.ports.settings.mediaBranchLineage.nodeGap),
            collisionIterations: this.getWorkspaceCollisionFlowIterations(collisionSettings),
            collisionMargin: 0,
            getNodeWorldPosition: (node, nodesById) => this.ports.getWorldPosition(node, nodesById),
            getNodeWorldRect: (node, nodesById) => this.ports.getWorldRect(node, nodesById),
            getNodeCollisionRect: (node, position) => this.getCanvasNodeCollisionRect(node, position),
            getNodeConnectorAnchorRect: (node, position) => this.getCanvasNodeConnectorAnchorRect(node, position),
            getNodeCollisionMargin: (node: CanvasNode) => this.getCanvasNodeCollisionSettings(node, collisionSettings).margin,
            getNodeCollisionOverlapThreshold: (node: CanvasNode) => this.getCanvasNodeCollisionSettings(node, collisionSettings).overlapThreshold,
            isPendingGeneratedMediaBeforeFrame: (node: CanvasNode) => this.ports.isPending(node.nodeId),
        })
    }

    getPendingGeneratedMediaBeforeFrameCircleGeometry(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): CanvasGeometry | null {
        if (!this.ports.isPending(nodeId)) return null
        const inset = this.getPendingGeneratedMediaBeforeFrameCircleInset(dimensions)
        return {
            position: {
                x: position.x + inset.x,
                y: position.y + inset.y,
            },
            dimensions: { width: inset.size, height: inset.size },
        }
    }

    getPendingGeneratedMediaBeforeFrameCircleInset(dimensions: { width: number; height: number }): { x: number; y: number; size: number } {
        const configuredScale = Number(this.ports.settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale)
        const size = getGeneratedMediaPreFrameSize(dimensions, configuredScale)
        return {
            x: (dimensions.width - size) / 2,
            y: (dimensions.height - size) / 2,
            size,
        }
    }
}
