// Workspace canvas renderer using vanilla JS with @xyflow/system and d3.js
// Based on the infographics connector system

import { createConnectorRenderer } from './connectors/index.ts'
import type { ConnectorRenderer, NodeConfig, EdgeConfig } from './connectors/types.ts'
import type { CanvasState, CanvasNode, WorkspaceMeta } from '@lixpi/constants'
import { html } from '../utils/domTemplates.ts'

export type WorkspaceDocument = {
    documentId: string
    title: string
}

export type WorkspaceRendererConfig = {
    container: HTMLElement
    width: number
    height: number
    onDocumentClick?: (documentId: string) => void
    onDocumentDoubleClick?: (documentId: string) => void
    onCanvasStateChange?: (canvasState: CanvasState) => void
}

export type WorkspaceRenderer = {
    render: (canvasState: CanvasState, documents: WorkspaceDocument[]) => void
    destroy: () => void
    updateViewport: (viewport: { x: number; y: number; zoom: number }) => void
}

export function createWorkspaceRenderer(config: WorkspaceRendererConfig): WorkspaceRenderer {
    const { container, width, height, onDocumentClick, onDocumentDoubleClick, onCanvasStateChange } = config

    // Create the underlying connector renderer
    const renderer = createConnectorRenderer({
        container,
        width,
        height,
        instanceId: 'workspace-canvas'
    })

    // Convert CanvasNode to NodeConfig for rendering
    function canvasNodeToNodeConfig(canvasNode: CanvasNode, document?: WorkspaceDocument): NodeConfig {
        const documentCard = html`
            <div class="document-card" data-document-id="${canvasNode.referenceId}">
                <div class="document-header">
                    <span class="document-title">${document?.title || 'Untitled'}</span>
                </div>
                <div class="document-preview">
                </div>
            </div>
        `

        return {
            id: canvasNode.nodeId,
            shape: 'foreignObject',
            x: canvasNode.position.x,
            y: canvasNode.position.y,
            width: canvasNode.dimensions.width,
            height: canvasNode.dimensions.height,
            className: 'workspace-document-node',
            content: {
                type: 'html',
                html: documentCard.outerHTML
            }
        }
    }

    // Set up event handlers
    function setupEventHandlers() {
        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement
            const documentCard = target.closest('.document-card') as HTMLElement
            if (documentCard && onDocumentClick) {
                const documentId = documentCard.dataset.documentId
                if (documentId) {
                    onDocumentClick(documentId)
                }
            }
        })

        container.addEventListener('dblclick', (e) => {
            const target = e.target as HTMLElement
            const documentCard = target.closest('.document-card') as HTMLElement
            if (documentCard && onDocumentDoubleClick) {
                const documentId = documentCard.dataset.documentId
                if (documentId) {
                    onDocumentDoubleClick(documentId)
                }
            }
        })
    }

    setupEventHandlers()

    return {
        render(canvasState: CanvasState, documents: WorkspaceDocument[]) {
            console.log('WorkspaceRenderer.render called with:', { canvasState, documents })

            // Create a map of documents for quick lookup
            const documentMap = new Map(documents.map(d => [d.documentId, d]))

            // Clear existing nodes first
            renderer.clear()

            // Convert canvas nodes to node configs and add them
            canvasState.nodes.forEach(canvasNode => {
                const document = documentMap.get(canvasNode.referenceId)
                const nodeConfig = canvasNodeToNodeConfig(canvasNode, document)
                console.log('Adding node:', nodeConfig)
                renderer.addNode(nodeConfig)
            })

            // Render all nodes (no edges for now)
            renderer.render()
            console.log('WorkspaceRenderer.render complete')
        },

        updateViewport(viewport: { x: number; y: number; zoom: number }) {
            // Apply viewport transformation to the SVG
            // This will be handled by applying a transform to the root SVG group
            const svg = container.querySelector('svg')
            if (svg) {
                const g = svg.querySelector('g')
                if (g) {
                    g.setAttribute('transform', `translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`)
                }
            }
        },

        destroy() {
            renderer.destroy()
        }
    }
}
