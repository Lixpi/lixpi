import {
    XYPanZoom,
    infiniteExtent,
    PanOnScrollMode,
    type PanZoomInstance,
    type Viewport,
    type Transform,
} from '@xyflow/system'
import { v4 as uuidv4 } from 'uuid'
import {
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type ImageCanvasNode,
    type AiChatThreadCanvasNode,
    type AiChatThread,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.js'
import { setAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/index.ts'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasImageLifecycleTracker } from '$src/infographics/workspace/canvasImageLifecycle.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { getResizeHandleScaledSizes } from '$src/infographics/utils/zoomScaling.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { createShiftingGradientBackground } from '$src/utils/shiftingGradientRenderer.ts'

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const RESIZE_CORNERS: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

type DocumentEditorEntry = {
    editor: any
    aiService: AiInteractionService | null
    containerEl: HTMLElement
}

type AiChatThreadEditorEntry = {
    editor: any
    aiService: AiInteractionService
    containerEl: HTMLElement
    gradientCleanup?: () => void
    triggerGradientAnimation?: () => void
}

type WorkspaceCanvasCallbacks = {
    onViewportChange?: (viewport: Viewport) => void
    onCanvasStateChange?: (state: CanvasState) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; prevRevision?: number; content: any }) => void
    onDocumentTitleChange?: (params: { documentId: string; title: string }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
}

type WorkspaceCanvasOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    workspaceId: string
    canvasState: CanvasState | null
    documents: Document[]
    aiChatThreads: AiChatThread[]
    panZoomConfig?: Partial<ReturnType<typeof defaultPanZoomConfig>>
} & WorkspaceCanvasCallbacks

function defaultPanZoomConfig(onTransformChange: (transform: Transform) => void) {
    return {
        noWheelClassName: 'nowheel',
        noPanClassName: 'nopan',
        preventScrolling: true,
        panOnScroll: true,
        panOnDrag: true,
        panOnScrollMode: PanOnScrollMode.Free,
        panOnScrollSpeed: 1,
        zoomOnPinch: true,
        zoomOnScroll: false,
        zoomOnDoubleClick: true,
        zoomActivationKeyPressed: false,
        userSelectionActive: false,
        connectionInProgress: false,
        paneClickDistance: 0,
        selectionOnDrag: false,
        lib: 'xy',
        onTransformChange
    }
}

export function createWorkspaceCanvas(options: WorkspaceCanvasOptions) {
    const { paneEl, viewportEl, workspaceId, onViewportChange, onCanvasStateChange, onDocumentContentChange, onDocumentTitleChange, onAiChatThreadContentChange } = options

    let currentCanvasState: CanvasState | null = options.canvasState
    let currentDocuments: Document[] = options.documents
    let currentAiChatThreads: AiChatThread[] = options.aiChatThreads
    let panZoom: PanZoomInstance | null = null
    let lastTransform: Transform = [0, 0, 1]

    let connectionManager: WorkspaceConnectionManager | null = null
    let edgesLayerEl: HTMLDivElement | null = null
    let edgeEndpointHandlesEl: HTMLDivElement | null = null

    const liveNodeOverrides: Map<string, { position?: { x: number; y: number }; dimensions?: { width: number; height: number } }> = new Map()
    let edgesRaf: number | null = null
    let selectedNodeId: string | null = null
    let selectedEdgeId: string | null = null
    let resizingNodeId: string | null = null
    let draggingNodeId: string | null = null
    const documentEditors: Map<string, DocumentEditorEntry> = new Map()
    const threadEditors: Map<string, AiChatThreadEditorEntry> = new Map()

    // Visibility tracking for lazy loading
    const visibleNodeIds: Set<string> = new Set()
    const loadedNodeIds: Set<string> = new Set()
    let paneRect: DOMRect | null = null

    // Image lifecycle tracker - handles deletion of orphaned images
    const canvasImageLifecycle = createCanvasImageLifecycleTracker()
    canvasImageLifecycle.initializeFromCanvasState(currentCanvasState)

    // Set up callbacks for AI-generated images
    setAiGeneratedImageCallbacks({
        onAddToCanvas: async (data) => {
            const { imageUrl, fileId, responseId, revisedPrompt, aiModel } = data

            // Image is already uploaded to storage by llm-api service
            // imageUrl is the API path like /api/images/workspaceId/fileId
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()

            // Find the source AI thread to position the new image next to it
            const existingNodes = currentCanvasState?.nodes || []
            let sourceThreadNode: CanvasNode | undefined
            for (const n of existingNodes) {
                if (n.type === 'aiChatThread') {
                    // This is a simplified approach - in practice we'd track which thread generated the image
                    sourceThreadNode = n
                    break
                }
            }

            // Calculate position to the right of the source thread
            const newX = sourceThreadNode
                ? sourceThreadNode.position.x + sourceThreadNode.dimensions.width + 50
                : 50 + (existingNodes.length % 3) * 450
            const newY = sourceThreadNode
                ? sourceThreadNode.position.y
                : 50 + Math.floor(existingNodes.length / 3) * 400

            // Calculate dimensions based on image aspect ratio (we use 1:1 for generated images by default)
            const width = 400
            const height = 400 // Default to square for DALL-E images

            const imageNode: ImageCanvasNode = {
                nodeId: `node-${fileId}`,
                type: 'image',
                fileId,
                workspaceId,
                src: `${API_BASE_URL}${imageUrl}?token=${token}`,
                aspectRatio: 1,
                position: { x: newX, y: newY },
                dimensions: { width, height },
                generatedBy: {
                    responseId,
                    aiModel,
                    revisedPrompt
                }
            }

            const newCanvasState: CanvasState = {
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: currentCanvasState?.edges ?? [],
                nodes: [...existingNodes, imageNode]
            }

            // Create edge from source thread to image if we found the source
            if (sourceThreadNode) {
                const newEdge: WorkspaceEdge = {
                    edgeId: `edge-${sourceThreadNode.nodeId}-${imageNode.nodeId}`,
                    source: sourceThreadNode.nodeId,
                    target: imageNode.nodeId
                }
                newCanvasState.edges = [...(newCanvasState.edges || []), newEdge]
            }

            onCanvasStateChange?.(newCanvasState)
        },
        onEditInNewThread: async (responseId) => {
            // Create a new AI chat thread specifically for editing this image
            const aiChatThreadService = servicesStore.getData('aiChatThreadService')
            if (!aiChatThreadService) {
                console.error('AI Chat Thread service not available')
                return
            }

            try {
                // Generate threadId on frontend to ensure content and DB record match
                const threadId = uuidv4()

                // Create empty AI chat thread with reference to the source image
                const initialContent = {
                    type: 'doc',
                    content: [
                        {
                            type: 'documentTitle',
                            content: [{ type: 'text', text: 'Edit Image' }]
                        },
                        {
                            type: 'aiChatThread',
                            attrs: {
                                threadId,
                                imageGenerationEnabled: true,
                                // Store the previous response ID for multi-turn editing
                                previousResponseId: responseId
                            },
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Describe how you want to edit this image...' }]
                                }
                            ]
                        }
                    ]
                }

                const thread = await aiChatThreadService.createAiChatThread({
                    workspaceId,
                    threadId,
                    content: initialContent,
                    aiModel: 'openai:gpt-4o' // Default to OpenAI for image editing
                })

                if (thread) {
                    // Find the source image node to position the new thread next to it
                    const existingNodes = currentCanvasState?.nodes || []
                    let sourceImageNode: CanvasNode | undefined
                    for (const n of existingNodes) {
                        if (n.type === 'image' && (n as ImageCanvasNode).generatedBy?.responseId === responseId) {
                            sourceImageNode = n
                            break
                        }
                    }

                    // Calculate position to the right of the source image
                    const newX = sourceImageNode
                        ? sourceImageNode.position.x + sourceImageNode.dimensions.width + 50
                        : 50 + (existingNodes.length % 3) * 450
                    const newY = sourceImageNode
                        ? sourceImageNode.position.y
                        : 50 + Math.floor(existingNodes.length / 3) * 400

                    const threadNode: AiChatThreadCanvasNode = {
                        nodeId: `node-${thread.threadId}`,
                        type: 'aiChatThread',
                        referenceId: thread.threadId,
                        position: { x: newX, y: newY },
                        dimensions: { width: 400, height: 500 }
                    }

                    const newCanvasState: CanvasState = {
                        viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                        edges: currentCanvasState?.edges ?? [],
                        nodes: [...existingNodes, threadNode]
                    }

                    // Create edge from source image to edit thread if we found the source
                    if (sourceImageNode) {
                        const newEdge: WorkspaceEdge = {
                            edgeId: `edge-${sourceImageNode.nodeId}-${threadNode.nodeId}`,
                            source: sourceImageNode.nodeId,
                            target: threadNode.nodeId
                        }
                        newCanvasState.edges = [...(newCanvasState.edges || []), newEdge]
                    }

                    onCanvasStateChange?.(newCanvasState)
                }
            } catch (error) {
                console.error('Failed to create edit thread:', error)
            }
        }
    })

    // Visibility detection for lazy loading
    function isNodeInViewport(node: CanvasNode, viewport: Viewport): boolean {
        if (!paneRect) {
            paneRect = paneEl.getBoundingClientRect()
        }

        const { x, y, zoom } = viewport

        // Transform node coordinates to screen space
        const screenLeft = node.position.x * zoom + x
        const screenTop = node.position.y * zoom + y
        const screenRight = screenLeft + node.dimensions.width * zoom
        const screenBottom = screenTop + node.dimensions.height * zoom

        // Check intersection with pane bounds
        return !(
            screenRight < 0 ||
            screenLeft > paneRect.width ||
            screenBottom < 0 ||
            screenTop > paneRect.height
        )
    }

    function updateVisibleNodes() {
        if (!currentCanvasState) return

        const viewport = panZoom?.getViewport() || { x: 0, y: 0, zoom: 1 }
        paneRect = paneEl.getBoundingClientRect()

        for (const node of currentCanvasState.nodes) {
            const wasVisible = visibleNodeIds.has(node.nodeId)
            const isVisible = isNodeInViewport(node, viewport)

            if (isVisible && !wasVisible) {
                visibleNodeIds.add(node.nodeId)
            } else if (!isVisible && wasVisible) {
                visibleNodeIds.delete(node.nodeId)
            }
        }
    }

    // Track pane bounds on resize for visibility detection
    const resizeObserver = new ResizeObserver(() => {
        paneRect = paneEl.getBoundingClientRect()
        updateVisibleNodes()
    })
    resizeObserver.observe(paneEl)

    const panZoomConfig = {
        ...defaultPanZoomConfig((transform) => {
            lastTransform = transform
            const vp: Viewport = { x: transform[0], y: transform[1], zoom: transform[2] }
            if (viewportEl) {
                viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
                // Set CSS custom property for zoom (used for any CSS fallbacks)
                viewportEl.style.setProperty('--zoom-scale', String(vp.zoom))
                // Update handle sizes/positions to remain constant in screen space
                updateResizeHandles(vp.zoom)
            }
            // Update visibility tracking for lazy loading
            updateVisibleNodes()
            // Ensure edges keep up with autopan + zoom changes
            scheduleEdgesRender()
            onViewportChange?.(vp)
        }),
        ...options.panZoomConfig
    }

    function selectNode(nodeId: string | null) {
        if (selectedNodeId) {
            const prevNode = viewportEl?.querySelector(`[data-node-id="${selectedNodeId}"]`)
            prevNode?.classList.remove('is-selected')
        }

        selectedNodeId = nodeId

        if (nodeId) {
            const newNode = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`)
            newNode?.classList.add('is-selected')
        }

        if (nodeId) {
            selectedEdgeId = null
            connectionManager?.deselect()
            updateEdgeEndpointHandles()
        }
    }

    function createResizeHandle(nodeId: string, corner: ResizeCorner): HTMLElement {
        const handle = document.createElement('div')
        handle.className = `document-resize-handle document-resize-${corner} nopan`
        handle.innerHTML = imageResizeCornerIcon
        handle.dataset.corner = corner
        handle.addEventListener('mousedown', (e) => handleResizeStart(e, nodeId, corner))

        // Initialize sizing/position so newly created handles are correct immediately
        const currentZoom = currentCanvasState?.viewport?.zoom ?? 1
        applyHandleSizing(handle, corner, currentZoom)

        return handle
    }

    function createBaseNodeElement(
        node: CanvasNode,
        extraClasses?: string,
        extraDataAttrs?: Record<string, string>
    ): { nodeEl: HTMLElement; dragOverlay: HTMLElement } {
        const nodeEl = document.createElement('div')
        nodeEl.className = `workspace-document-node${extraClasses ? ` ${extraClasses}` : ''}`
        nodeEl.dataset.nodeId = node.nodeId
        if (extraDataAttrs) {
            for (const [key, value] of Object.entries(extraDataAttrs)) {
                nodeEl.dataset[key] = value
            }
        }
        nodeEl.style.position = 'absolute'
        nodeEl.style.left = `${node.position.x}px`
        nodeEl.style.top = `${node.position.y}px`
        nodeEl.style.width = `${node.dimensions.width}px`
        nodeEl.style.height = `${node.dimensions.height}px`

        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation()
            selectNode(node.nodeId)
        })

        for (const corner of RESIZE_CORNERS) {
            nodeEl.appendChild(createResizeHandle(node.nodeId, corner))
        }

        const dragOverlay = document.createElement('div')
        dragOverlay.className = 'node-drag-overlay nopan'
        dragOverlay.addEventListener('mousedown', (e) => handleDragStart(e, node.nodeId))
        nodeEl.appendChild(dragOverlay)

        return { nodeEl, dragOverlay }
    }

    function commitCanvasState(nextState: CanvasState) {
        // Track image changes and delete orphaned images from storage
        canvasImageLifecycle.trackCanvasState(nextState)
        currentCanvasState = nextState
        onCanvasStateChange?.(nextState)

        connectionManager?.syncEdges(nextState.edges)
        connectionManager?.syncNodes(nextState.nodes)
        scheduleEdgesRender()
    }

    function scheduleEdgesRender() {
        if (!connectionManager || !currentCanvasState) return
        if (edgesRaf !== null) return

        edgesRaf = requestAnimationFrame(() => {
            edgesRaf = null

            if (!connectionManager || !currentCanvasState) return

            const nodesForEdges = currentCanvasState.nodes.map((n: CanvasNode) => {
                const override = liveNodeOverrides.get(n.nodeId)
                if (!override) return n

                return {
                    ...n,
                    position: override.position ?? n.position,
                    dimensions: override.dimensions ?? n.dimensions
                }
            })

            connectionManager.syncNodes(nodesForEdges)
            connectionManager.syncEdges(currentCanvasState.edges)
            connectionManager.render()
            updateEdgeEndpointHandles()
        })
    }

    function ensureEdgesLayer() {
        if (edgesLayerEl && viewportEl.contains(edgesLayerEl)) {
            return
        }

        if (connectionManager) {
            connectionManager.destroy()
            connectionManager = null
        }

        edgesLayerEl = document.createElement('div')
        edgesLayerEl.className = 'workspace-edges-layer'

        edgeEndpointHandlesEl = document.createElement('div')
        edgeEndpointHandlesEl.className = 'workspace-edge-endpoints-layer'

        viewportEl.prepend(edgeEndpointHandlesEl)
        viewportEl.prepend(edgesLayerEl)

        connectionManager = new WorkspaceConnectionManager({
            paneEl,
            viewportEl,
            edgesLayerEl,
            getTransform: () => lastTransform,
            panBy: async ({ x, y }) => {
                if (!panZoom) return false
                const vp = panZoom.getViewport()
                await panZoom.setViewport({ ...vp, x: vp.x + x, y: vp.y + y, zoom: vp.zoom })
                return true
            },
            onEdgesChange: (edges) => {
                if (!currentCanvasState) return
                commitCanvasState({
                    ...currentCanvasState,
                    edges
                })
            },
            onSelectedEdgeChange: (edgeId) => {
                selectedEdgeId = edgeId
                if (edgeId) {
                    selectNode(null)
                }
                updateEdgeEndpointHandles()
            }
        })

        if (currentCanvasState) {
            connectionManager.syncNodes(currentCanvasState.nodes)
            connectionManager.syncEdges(currentCanvasState.edges)
            if (selectedEdgeId) {
                connectionManager.selectEdge(selectedEdgeId)
            }
            scheduleEdgesRender()
        }
    }

    function createConnectionHandle(params: {
        nodeId: string
        handleId: string
        handleType: 'source' | 'target'
        position: 'left' | 'right'
        onPointerDown?: (e: MouseEvent) => void
    }): HTMLDivElement {
        const handle = document.createElement('div')
        handle.className = [
            'workspace-handle',
            'nopan',
            'connectable',
            'connectableend',
            'xy-flow__handle',
            params.handleType,
            params.position,
        ].join(' ')

        handle.dataset.nodeid = params.nodeId
        handle.dataset.handleid = params.handleId
        handle.dataset.handlepos = params.position
        handle.dataset.id = `workspace-${params.nodeId}-${params.handleId}-${params.handleType}`

        if (params.onPointerDown) {
            handle.addEventListener('mousedown', (e) => {
                params.onPointerDown?.(e)
            })
        }

        return handle
    }

    function addConnectionHandlesToNode(nodeEl: HTMLElement, nodeId: string) {
        const left = createConnectionHandle({
            nodeId,
            handleId: 'left',
            handleType: 'target',
            position: 'left',
            onPointerDown: (e) => {
                if (!connectionManager) return
                connectionManager.onHandlePointerDown(e, {
                    nodeId,
                    handleId: 'left',
                    isTarget: true,
                    handleDomNode: left
                })
            }
        })

        const right = createConnectionHandle({
            nodeId,
            handleId: 'right',
            handleType: 'source',
            position: 'right',
            onPointerDown: (e) => {
                if (!connectionManager) return
                connectionManager.onHandlePointerDown(e, {
                    nodeId,
                    handleId: 'right',
                    isTarget: false,
                    handleDomNode: right
                })
            }
        })

        nodeEl.appendChild(left)
        nodeEl.appendChild(right)
    }

    function updateEdgeEndpointHandles() {
        if (!edgeEndpointHandlesEl || !connectionManager || !currentCanvasState) return

        edgeEndpointHandlesEl.replaceChildren()

        if (!selectedEdgeId) return

        const edge = currentCanvasState.edges.find((e: WorkspaceEdge) => e.edgeId === selectedEdgeId)
        if (!edge) return

        const sourceNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === edge.sourceNodeId)
        const targetNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === edge.targetNodeId)
        if (!sourceNode || !targetNode) return

        const sourceOnLeft = (edge.sourceHandle ?? '').startsWith('left')
        const targetOnRight = (edge.targetHandle ?? '').startsWith('right')

        const sourceAnchor = {
            x: sourceNode.position.x + (sourceOnLeft ? 0 : sourceNode.dimensions.width),
            y: sourceNode.position.y + sourceNode.dimensions.height / 2
        }
        const targetAnchor = {
            x: targetNode.position.x + (targetOnRight ? targetNode.dimensions.width : 0),
            y: targetNode.position.y + targetNode.dimensions.height / 2
        }

        const createEndpoint = (params: {
            x: number
            y: number
            updaterType: 'source' | 'target'
        }) => {
            const el = document.createElement('div')
            el.className = [
                'workspace-edge-endpoint',
                'nopan',
                'connectable',
                'connectableend',
                'xy-flow__handle',
                params.updaterType,
            ].join(' ')

            el.style.left = `${params.x}px`
            el.style.top = `${params.y}px`

            el.addEventListener('mousedown', (e) => {
                if (!connectionManager) return

                // Flip isTarget for source updates so strict mode yields "new source" semantics.
                const isTarget = params.updaterType === 'source'

                connectionManager.onHandlePointerDown(e, {
                    nodeId: params.updaterType === 'source' ? edge.sourceNodeId : edge.targetNodeId,
                    handleId: params.updaterType === 'source' ? (edge.sourceHandle ?? 'right') : (edge.targetHandle ?? 'left'),
                    isTarget,
                    handleDomNode: el,
                    edgeUpdaterType: params.updaterType,
                    reconnectingEdgeId: edge.edgeId,
                })
            })

            return el
        }

        edgeEndpointHandlesEl.appendChild(createEndpoint({ x: sourceAnchor.x, y: sourceAnchor.y, updaterType: 'source' }))
        edgeEndpointHandlesEl.appendChild(createEndpoint({ x: targetAnchor.x, y: targetAnchor.y, updaterType: 'target' }))
    }

    // Handle sizing/positioning of resize handles so they appear constant in screen pixels
    function applyHandleSizing(handle: HTMLElement, corner: ResizeCorner, zoom: number) {
        const { size: sizePx, offset: offsetPx } = getResizeHandleScaledSizes(zoom)

        handle.style.width = `${sizePx}px`
        handle.style.height = `${sizePx}px`

        // Reset positional properties first
        handle.style.top = ''
        handle.style.left = ''
        handle.style.right = ''
        handle.style.bottom = ''

        switch (corner) {
            case 'top-left':
                handle.style.top = `${-offsetPx}px`
                handle.style.left = `${-offsetPx}px`
                break
            case 'top-right':
                handle.style.top = `${-offsetPx}px`
                handle.style.right = `${-offsetPx}px`
                break
            case 'bottom-left':
                handle.style.bottom = `${-offsetPx}px`
                handle.style.left = `${-offsetPx}px`
                break
            case 'bottom-right':
                handle.style.bottom = `${-offsetPx}px`
                handle.style.right = `${-offsetPx}px`
                break
        }
    }

    function updateResizeHandles(zoom: number) {
        if (!viewportEl) return
        const handles = viewportEl.querySelectorAll('.document-resize-handle')
        handles.forEach((h) => {
            const el = h as HTMLElement
            const corner = (el.dataset.corner as ResizeCorner) || 'bottom-right'
            applyHandleSizing(el, corner, zoom)
        })
    }

    function handleDragStart(event: MouseEvent, nodeId: string) {
        event.preventDefault()
        event.stopPropagation()

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
        if (!nodeEl || !currentCanvasState) return

        selectNode(nodeId)
        draggingNodeId = nodeId
        nodeEl.classList.add('is-dragging')

        const startX = event.clientX
        const startY = event.clientY
        const startLeft = parseFloat(nodeEl.style.left)
        const startTop = parseFloat(nodeEl.style.top)
        const currentZoom = (panZoom?.getViewport().zoom ?? 1) || 1

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true
            })
        }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = (moveEvent.clientX - startX) / currentZoom
            const deltaY = (moveEvent.clientY - startY) / currentZoom

            nodeEl.style.left = `${startLeft + deltaX}px`
            nodeEl.style.top = `${startTop + deltaY}px`

            liveNodeOverrides.set(nodeId, {
                position: {
                    x: parseFloat(nodeEl.style.left),
                    y: parseFloat(nodeEl.style.top)
                },
                dimensions: {
                    width: nodeEl.offsetWidth,
                    height: nodeEl.offsetHeight
                }
            })
            scheduleEdgesRender()
        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-dragging')
            draggingNodeId = null

            liveNodeOverrides.delete(nodeId)

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }

            const newPosition = {
                x: parseFloat(nodeEl.style.left),
                y: parseFloat(nodeEl.style.top)
            }

            const updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) =>
                n.nodeId === nodeId ? { ...n, position: newPosition } : n
            )

            commitCanvasState({
                ...currentCanvasState,
                nodes: updatedNodes
            })
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function handleResizeStart(event: MouseEvent, nodeId: string, corner: ResizeCorner) {
        event.preventDefault()
        event.stopPropagation()

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
        if (!nodeEl || !currentCanvasState) return

        // Find the node to check if it's an image (for aspect ratio locking)
        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        const isImageNode = node?.type === 'image'

        // For images, get aspect ratio from the actual img element (more reliable than stored data)
        let aspectRatio: number | null = null
        if (isImageNode) {
            const imgEl = nodeEl.querySelector('img') as HTMLImageElement
            if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
                aspectRatio = imgEl.naturalWidth / imgEl.naturalHeight
            }
        }

        resizingNodeId = nodeId
        nodeEl.classList.add('is-resizing')

        const handle = event.currentTarget as HTMLElement
        handle.classList.add('is-dragging')

        const startX = event.clientX
        const startY = event.clientY
        const startWidth = nodeEl.offsetWidth
        const startHeight = nodeEl.offsetHeight
        const startLeft = parseFloat(nodeEl.style.left)
        const startTop = parseFloat(nodeEl.style.top)
        const currentZoom = panZoom?.getViewport().zoom ?? 1

        const isLeft = corner.includes('left')
        const isTop = corner.includes('top')
        const directionX = isLeft ? -1 : 1
        const directionY = isTop ? -1 : 1

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true
            })
        }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = ((moveEvent.clientX - startX) / currentZoom) * directionX
            const deltaY = ((moveEvent.clientY - startY) / currentZoom) * directionY

            let newWidth = startWidth + deltaX
            let newHeight = startHeight + deltaY

            // For image nodes, enforce aspect ratio lock using diagonal distance
            if (isImageNode && aspectRatio) {
                // Use the diagonal distance from start point to determine scale
                // This gives smooth, consistent resizing regardless of mouse direction
                const diagonalDelta = (deltaX + deltaY * aspectRatio) / (1 + aspectRatio)
                newWidth = startWidth + diagonalDelta
                newHeight = newWidth / aspectRatio
            }

            // Apply minimum constraints
            const minWidth = isImageNode ? 50 : 200
            const minHeight = isImageNode && aspectRatio ? minWidth / aspectRatio : 150
            newWidth = Math.max(minWidth, newWidth)
            newHeight = Math.max(minHeight, newHeight)

            // Re-apply aspect ratio after min constraints for images
            if (isImageNode && aspectRatio) {
                newHeight = newWidth / aspectRatio
            }

            nodeEl.style.width = `${newWidth}px`
            nodeEl.style.height = `${newHeight}px`

            if (isLeft) {
                const widthDiff = newWidth - startWidth
                nodeEl.style.left = `${startLeft - widthDiff}px`
            }
            if (isTop) {
                const heightDiff = newHeight - startHeight
                nodeEl.style.top = `${startTop - heightDiff}px`
            }

            liveNodeOverrides.set(nodeId, {
                position: {
                    x: parseFloat(nodeEl.style.left),
                    y: parseFloat(nodeEl.style.top)
                },
                dimensions: {
                    width: nodeEl.offsetWidth,
                    height: nodeEl.offsetHeight
                }
            })
            scheduleEdgesRender()
        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-resizing')
            handle.classList.remove('is-dragging')
            resizingNodeId = null

            liveNodeOverrides.delete(nodeId)

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }

            const newDimensions = {
                width: nodeEl.offsetWidth,
                height: nodeEl.offsetHeight
            }

            const newPosition = {
                x: parseFloat(nodeEl.style.left),
                y: parseFloat(nodeEl.style.top)
            }

            const updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) =>
                n.nodeId === nodeId ? { ...n, dimensions: newDimensions, position: newPosition } : n
            )

            commitCanvasState({
                ...currentCanvasState,
                nodes: updatedNodes
            })
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function createDocumentNode(node: DocumentCanvasNode, doc: Document | undefined): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(node, undefined, { documentId: node.referenceId })
        dragOverlay.className = 'document-drag-overlay nopan'

        const editorContainer = document.createElement('div')
        editorContainer.className = 'document-node-editor nopan'
        nodeEl.appendChild(editorContainer)

        if (doc && doc.content !== undefined) {
            try {
                const editor = new ProseMirrorEditor({
                    editorMountElement: editorContainer,
                    content: document.createElement('div'),
                    initialVal: doc.content,
                    isDisabled: false,
                    documentType: 'document',
                    onEditorChange: (value: any) => {
                        onDocumentContentChange?.({
                            documentId: node.referenceId,
                            title: doc.title,
                            prevRevision: doc.prevRevision || 1,
                            content: value
                        })
                    },
                    onProjectTitleChange: (title: string) => {
                        onDocumentTitleChange?.({ documentId: node.referenceId, title })
                    },
                    onAiChatSubmit: () => {},
                    onAiChatStop: () => {}
                })

                documentEditors.set(node.referenceId, {
                    editor,
                    aiService: null,
                    containerEl: nodeEl
                })
            } catch (error) {
                console.error('Failed to create ProseMirror editor:', error)
                editorContainer.innerHTML = ''
                const errorPlaceholder = createErrorPlaceholder({
                    message: 'Failed to load editor',
                    retryLabel: 'Retry',
                    onRetry: () => {
                        loadedNodeIds.delete(node.nodeId)
                        renderNodes()
                    }
                })
                editorContainer.appendChild(errorPlaceholder.dom)
            }
        } else {
            editorContainer.innerHTML = ''
            editorContainer.appendChild(createLoadingPlaceholder().dom)
        }

        return nodeEl
    }

    function createAiChatThreadNode(node: AiChatThreadCanvasNode, thread: AiChatThread | undefined): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-ai-chat-thread-node',
            { threadId: node.referenceId }
        )
        dragOverlay.className = 'document-drag-overlay nopan'

        // Add animated gradient background
        const gradient = createShiftingGradientBackground(nodeEl)

        const editorContainer = document.createElement('div')
        editorContainer.className = 'ai-chat-thread-node-editor nopan'
        nodeEl.appendChild(editorContainer)

        if (thread && thread.content !== undefined) {
            try {
                // Create AiInteractionService for this thread
                const aiService = new AiInteractionService({
                    workspaceId,
                    aiChatThreadId: node.referenceId
                })

                const editor = new ProseMirrorEditor({
                    editorMountElement: editorContainer,
                    content: document.createElement('div'),
                    initialVal: thread.content,
                    isDisabled: false,
                    documentType: 'aiChatThread',
                    onEditorChange: (value: any) => {
                        onAiChatThreadContentChange?.({
                            workspaceId,
                            threadId: node.referenceId,
                            content: value
                        })
                    },
                    onProjectTitleChange: () => {},
                    onAiChatSubmit: async ({ messages, aiModel, imageOptions }: any) => {
                        // Trigger gradient animation on message send
                        gradient.triggerAnimation()

                        try {
                            // Extract context from connected nodes
                            const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                            const context = await aiChatThreadService.extractConnectedContext(node.nodeId)
                            const contextMessage = aiChatThreadService.buildContextMessage(context)

                            // Prepend context message if there's connected content
                            const messagesWithContext = contextMessage
                                ? [contextMessage, ...messages]
                                : messages

                            aiService.sendChatMessage({
                                messages: messagesWithContext,
                                aiModel,
                                enableImageGeneration: imageOptions?.imageGenerationEnabled,
                                imageSize: imageOptions?.imageGenerationSize,
                                previousResponseId: imageOptions?.previousResponseId
                            })
                        } catch (error) {
                            console.error('Failed to gather context from connected nodes:', error)
                            // Re-throw to let the UI show an error state
                            throw error
                        }
                    },
                    onAiChatStop: () => {
                        aiService.stopChatMessage()
                    }
                })

                threadEditors.set(node.referenceId, {
                    editor,
                    aiService,
                    containerEl: nodeEl,
                    gradientCleanup: gradient.destroy,
                    triggerGradientAnimation: gradient.triggerAnimation
                })

                loadedNodeIds.add(node.nodeId)
            } catch (error) {
                console.error('Failed to create AI chat thread editor:', error)
                editorContainer.innerHTML = ''
                const errorPlaceholder = createErrorPlaceholder({
                    message: 'Failed to load AI chat',
                    retryLabel: 'Retry',
                    onRetry: () => {
                        loadedNodeIds.delete(node.nodeId)
                        renderNodes()
                    }
                })
                editorContainer.appendChild(errorPlaceholder.dom)
            }
        } else {
            // Show loading placeholder until content is loaded
            editorContainer.appendChild(createLoadingPlaceholder().dom)
        }

        return nodeEl
    }

    function createImageNode(node: ImageCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-image-node',
            { fileId: node.fileId }
        )
        dragOverlay.className = 'image-drag-overlay nopan'

        // Create the img element - fills the container
        const imgEl = document.createElement('img')
        imgEl.className = 'image-node-img'
        imgEl.src = node.src
        imgEl.alt = ''
        imgEl.draggable = false

        // Once image loads, fix container dimensions to match actual aspect ratio
        imgEl.onload = () => {
            const naturalAspect = imgEl.naturalWidth / imgEl.naturalHeight
            const storedAspect = node.dimensions.width / node.dimensions.height

            // If aspect ratios don't match, fix and persist
            if (Math.abs(naturalAspect - storedAspect) > 0.01) {
                const correctedHeight = node.dimensions.width / naturalAspect
                nodeEl.style.height = `${correctedHeight}px`

                // Persist the corrected dimensions
                if (currentCanvasState && onCanvasStateChange) {
                    const updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) => {
                        if (n.nodeId === node.nodeId && n.type === 'image') {
                            return {
                                ...n,
                                dimensions: { width: node.dimensions.width, height: correctedHeight },
                                aspectRatio: naturalAspect
                            }
                        }
                        return n
                    })
                    const newState: CanvasState = { ...currentCanvasState, nodes: updatedNodes }
                    currentCanvasState = newState
                    onCanvasStateChange(newState)
                }
            }
        }

        nodeEl.appendChild(imgEl)

        return nodeEl
    }

    function getNodeStructureKey(canvasState: CanvasState | null): string {
        if (!canvasState) return ''
        // Create a key based on node IDs and types - position/dimension changes don't affect this
        return canvasState.nodes.map((n: CanvasNode) => `${n.nodeId}:${n.type}`).join(',')
    }

    let lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

    function renderNodes() {
        if (!viewportEl || !currentCanvasState) return

        viewportEl.innerHTML = ''

        ensureEdgesLayer()

        for (const [, { editor, aiService }] of documentEditors) {
            if (editor?.destroy) editor.destroy()
            if (aiService?.disconnect) aiService.disconnect()
        }
        documentEditors.clear()

        for (const [, { editor, aiService, gradientCleanup }] of threadEditors) {
            if (editor?.destroy) editor.destroy()
            if (aiService?.disconnect) aiService.disconnect()
            if (gradientCleanup) gradientCleanup()
        }
        threadEditors.clear()

        // Clear loaded node tracking on full re-render
        loadedNodeIds.clear()

        const documentMap = new Map<string, Document>(currentDocuments.map((d) => [d.documentId, d]))
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((t) => [t.threadId, t]))

        for (const node of currentCanvasState.nodes) {
            let nodeEl: HTMLElement

            if (node.type === 'document') {
                const docNode = node as DocumentCanvasNode
                const doc = documentMap.get(docNode.referenceId)
                nodeEl = createDocumentNode(docNode, doc)
            } else if (node.type === 'image') {
                nodeEl = createImageNode(node as ImageCanvasNode)
            } else if (node.type === 'aiChatThread') {
                const threadNode = node as AiChatThreadCanvasNode
                const thread = threadMap.get(threadNode.referenceId)
                nodeEl = createAiChatThreadNode(threadNode, thread)
            } else {
                // Unknown node type, skip
                console.warn(`Unknown canvas node type: ${(node as CanvasNode).type}`)
                continue
            }

            addConnectionHandlesToNode(nodeEl, node.nodeId)
            viewportEl.appendChild(nodeEl)

            // Register after insertion so bounds are measurable
            connectionManager?.registerNodeElement(node.nodeId, nodeEl as HTMLDivElement)
        }

        // Ensure edges render after a full rerender
        connectionManager?.syncNodes(currentCanvasState.nodes)
        connectionManager?.syncEdges(currentCanvasState.edges)
        scheduleEdgesRender()

        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    }

    function getDocumentsKey(docs: Document[]): string {
        // Track document IDs and their loaded state
        return docs.map(d => `${d.documentId}:${d.content ? 'loaded' : 'pending'}`).join(',')
    }

    function getAiChatThreadsKey(threads: AiChatThread[]): string {
        // Track thread IDs and their loaded state
        return threads.map(t => `${t.threadId}:${t.content ? 'loaded' : 'pending'}`).join(',')
    }

    let lastDocumentsKey = getDocumentsKey(currentDocuments)
    let lastThreadsKey = getAiChatThreadsKey(currentAiChatThreads)

    function shouldRerender(newCanvasState: CanvasState | null, newDocuments: Document[], newThreads: AiChatThread[]): boolean {
        const newNodeKey = getNodeStructureKey(newCanvasState)
        const newDocsKey = getDocumentsKey(newDocuments)
        const newThreadsKey = getAiChatThreadsKey(newThreads)
        return newNodeKey !== lastNodeStructureKey || newDocsKey !== lastDocumentsKey || newThreadsKey !== lastThreadsKey
    }

    function initializePanZoom() {
        panZoom = XYPanZoom({
            domNode: paneEl,
            viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
            minZoom: 0.1,
            maxZoom: 2,
            translateExtent: infiniteExtent,
            onDraggingChange: (dragging: boolean) => {
                paneEl.classList.toggle('is-dragging', dragging)
            },
            onPanZoom: () => {}
        })

        panZoom.update(panZoomConfig)

        if (currentCanvasState?.viewport) {
            const vp = currentCanvasState.viewport
            viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
            viewportEl.style.setProperty('--zoom-scale', String(vp.zoom))
            // Ensure handles match initial zoom
            updateResizeHandles(vp.zoom)
            panZoom.syncViewport(vp)
        } else {
            // Set default zoom scale
            viewportEl.style.setProperty('--zoom-scale', '1')
            updateResizeHandles(1)
        }
    }

    paneEl.addEventListener('click', (e) => {
        if (e.target === paneEl || e.target === viewportEl) {
            selectNode(null)
            selectedEdgeId = null
            connectionManager?.deselect()
            updateEdgeEndpointHandles()
        }
    })

    const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null
        const isTyping = !!target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            (target as any).isContentEditable
        )

        if (e.key === 'Escape') {
            selectedEdgeId = null
            connectionManager?.deselect()
            selectNode(null)
            updateEdgeEndpointHandles()
            return
        }

        if (isTyping) return

        if ((e.key === 'Backspace' || e.key === 'Delete') && selectedEdgeId) {
            e.preventDefault()
            connectionManager?.deleteSelectedEdge()
        }
    }

    window.addEventListener('keydown', onKeyDown)

    initializePanZoom()
    renderNodes()

    return {
        render(newCanvasState: CanvasState | null, newDocuments: Document[], newAiChatThreads: AiChatThread[] = []) {
            // Only do a full re-render if node structure or documents/threads changed
            // Position/dimension updates are handled directly in DOM during drag/resize
            const needsRerender = shouldRerender(newCanvasState, newDocuments, newAiChatThreads)

            // Check if viewport actually changed (not just nodes)
            const oldViewport = currentCanvasState?.viewport
            const newViewport = newCanvasState?.viewport
            const viewportChanged = !oldViewport || !newViewport ||
                oldViewport.x !== newViewport.x ||
                oldViewport.y !== newViewport.y ||
                oldViewport.zoom !== newViewport.zoom

            currentCanvasState = newCanvasState
            currentDocuments = newDocuments
            currentAiChatThreads = newAiChatThreads

            if (currentCanvasState && connectionManager) {
                connectionManager.syncNodes(currentCanvasState.nodes)
                connectionManager.syncEdges(currentCanvasState.edges)
                scheduleEdgesRender()
            }

            if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
                lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            }

            // Only sync viewport if it actually changed from external source
            // Don't reset viewport just because node dimensions were corrected
            if (viewportChanged && newCanvasState?.viewport) {
                const vp = newCanvasState.viewport
                viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
                panZoom?.syncViewport(vp)
            }
        },
        destroy() {
            resizeObserver.disconnect()
            window.removeEventListener('keydown', onKeyDown)
            if (edgesRaf !== null) {
                cancelAnimationFrame(edgesRaf)
                edgesRaf = null
            }
            connectionManager?.destroy()
            connectionManager = null
            if (panZoom) {
                panZoom.destroy()
            }
            for (const [, { editor, aiService }] of documentEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
            }
            documentEditors.clear()
            for (const [, { editor, aiService, gradientCleanup }] of threadEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
                if (gradientCleanup) gradientCleanup()
            }
            threadEditors.clear()
            canvasImageLifecycle.destroy()
        }
    }
}
