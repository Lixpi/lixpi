import {
    XYPanZoom,
    infiniteExtent,
    PanOnScrollMode,
    type PanZoomInstance,
    type Viewport,
    type Transform,
} from '@xyflow/system'
import {
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type ImageCanvasNode,
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.js'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasImageLifecycleTracker } from './canvasImageLifecycle.ts'

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

type DocumentEditorEntry = {
    editor: any
    aiService: AiInteractionService | null
    containerEl: HTMLElement
}

type WorkspaceCanvasCallbacks = {
    onViewportChange?: (viewport: Viewport) => void
    onCanvasStateChange?: (state: CanvasState) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; prevRevision?: number; content: any }) => void
    onDocumentTitleChange?: (params: { documentId: string; title: string }) => void
}

type WorkspaceCanvasOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    canvasState: CanvasState | null
    documents: Document[]
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
    const { paneEl, viewportEl, onViewportChange, onCanvasStateChange, onDocumentContentChange, onDocumentTitleChange } = options

    let currentCanvasState: CanvasState | null = options.canvasState
    let currentDocuments: Document[] = options.documents
    let panZoom: PanZoomInstance | null = null
    let selectedNodeId: string | null = null
    let resizingNodeId: string | null = null
    let draggingNodeId: string | null = null
    const documentEditors: Map<string, DocumentEditorEntry> = new Map()

    // Image lifecycle tracker - handles deletion of orphaned images
    const canvasImageLifecycle = createCanvasImageLifecycleTracker()
    canvasImageLifecycle.initializeFromCanvasState(currentCanvasState)

    const panZoomConfig = {
        ...defaultPanZoomConfig((transform) => {
            const vp: Viewport = { x: transform[0], y: transform[1], zoom: transform[2] }
            if (viewportEl) {
                viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
                // Set CSS custom property for zoom (used for any CSS fallbacks)
                viewportEl.style.setProperty('--zoom-scale', String(vp.zoom))
                // Update handle sizes/positions to remain constant in screen space
                updateResizeHandles(vp.zoom)
            }
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

    function commitCanvasState(nextState: CanvasState) {
        // Track image changes and delete orphaned images from storage
        canvasImageLifecycle.trackCanvasState(nextState)
        currentCanvasState = nextState
        onCanvasStateChange?.(nextState)
    }

    // Handle sizing/positioning of resize handles so they appear constant in screen pixels
    function applyHandleSizing(handle: HTMLElement, corner: ResizeCorner, zoom: number) {
        const baseSize = 24 // px
        const baseOffset = 6 // px (distance from corner)

        // Compute CSS px values that will, after viewport scaling, result in base visual px
        const sizePx = Math.max(10, baseSize / Math.max(zoom, 0.01))
        const offsetPx = baseOffset / Math.max(zoom, 0.01)

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
        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-dragging')
            draggingNodeId = null

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
        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-resizing')
            handle.classList.remove('is-dragging')
            resizingNodeId = null

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
        const nodeEl = document.createElement('div')
        nodeEl.className = 'workspace-document-node'
        nodeEl.dataset.nodeId = node.nodeId
        nodeEl.dataset.documentId = node.referenceId
        nodeEl.style.position = 'absolute'
        nodeEl.style.left = `${node.position.x}px`
        nodeEl.style.top = `${node.position.y}px`
        nodeEl.style.width = `${node.dimensions.width}px`
        nodeEl.style.height = `${node.dimensions.height}px`

        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation()
            selectNode(node.nodeId)
        })

        const corners: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
        for (const corner of corners) {
            const handle = createResizeHandle(node.nodeId, corner)
            nodeEl.appendChild(handle)
        }

        const dragOverlay = document.createElement('div')
        dragOverlay.className = 'document-drag-overlay nopan'
        dragOverlay.addEventListener('mousedown', (e) => handleDragStart(e, node.nodeId))
        nodeEl.appendChild(dragOverlay)

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
                    onAiChatSubmit: ({ messages, aiModel, threadId }: any) => {
                        const aiService = documentEditors.get(node.referenceId)?.aiService
                        if (aiService) {
                            aiService.sendChatMessage({ messages, aiModel, threadId })
                        }
                    },
                    onAiChatStop: ({ threadId }: any) => {
                        const aiService = documentEditors.get(node.referenceId)?.aiService
                        if (aiService) {
                            aiService.stopChatMessage({ threadId })
                        }
                    }
                })

                const aiService = new AiInteractionService(node.referenceId)

                documentEditors.set(node.referenceId, {
                    editor,
                    aiService,
                    containerEl: nodeEl
                })
            } catch (error) {
                console.error('Failed to create ProseMirror editor:', error)
                editorContainer.innerHTML = '<div class="editor-error">Failed to load editor</div>'
            }
        } else {
            editorContainer.innerHTML = '<div class="editor-placeholder">Loading document...</div>'
        }

        return nodeEl
    }

    function createImageNode(node: ImageCanvasNode): HTMLElement {
        const nodeEl = document.createElement('div')
        nodeEl.className = 'workspace-image-node'
        nodeEl.dataset.nodeId = node.nodeId
        nodeEl.dataset.fileId = node.fileId
        nodeEl.style.position = 'absolute'
        nodeEl.style.left = `${node.position.x}px`
        nodeEl.style.top = `${node.position.y}px`
        nodeEl.style.width = `${node.dimensions.width}px`
        nodeEl.style.height = `${node.dimensions.height}px`

        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation()
            selectNode(node.nodeId)
        })

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

        // Add resize handles
        const corners: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
        for (const corner of corners) {
            const handle = createResizeHandle(node.nodeId, corner)
            nodeEl.appendChild(handle)
        }

        // Add drag overlay for the entire image
        const dragOverlay = document.createElement('div')
        dragOverlay.className = 'image-drag-overlay nopan'
        dragOverlay.addEventListener('mousedown', (e) => handleDragStart(e, node.nodeId))
        nodeEl.appendChild(dragOverlay)

        return nodeEl
    }

    function getNodeStructureKey(canvasState: CanvasState | null): string {
        if (!canvasState) return ''
        // Create a key based on node IDs and types - position/dimension changes don't affect this
        return canvasState.nodes.map(n => `${n.nodeId}:${n.type}`).join(',')
    }

    let lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

    function renderNodes() {
        if (!viewportEl || !currentCanvasState) return

        viewportEl.innerHTML = ''

        for (const [, { editor, aiService }] of documentEditors) {
            if (editor?.destroy) editor.destroy()
            if (aiService?.disconnect) aiService.disconnect()
        }
        documentEditors.clear()

        const documentMap = new Map<string, Document>(currentDocuments.map((d) => [d.documentId, d]))

        for (const node of currentCanvasState.nodes) {
            let nodeEl: HTMLElement

            if (node.type === 'document') {
                const docNode = node as DocumentCanvasNode
                const doc = documentMap.get(docNode.referenceId)
                nodeEl = createDocumentNode(docNode, doc)
            } else if (node.type === 'image') {
                nodeEl = createImageNode(node as ImageCanvasNode)
            } else {
                // Unknown node type, skip
                console.warn(`Unknown canvas node type: ${(node as CanvasNode).type}`)
                continue
            }

            viewportEl.appendChild(nodeEl)
        }

        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    }

    function getDocumentsKey(docs: Document[]): string {
        // Track document IDs and their loaded state
        return docs.map(d => `${d.documentId}:${d.content ? 'loaded' : 'pending'}`).join(',')
    }

    let lastDocumentsKey = getDocumentsKey(currentDocuments)

    function shouldRerender(newCanvasState: CanvasState | null, newDocuments: Document[]): boolean {
        const newNodeKey = getNodeStructureKey(newCanvasState)
        const newDocsKey = getDocumentsKey(newDocuments)
        return newNodeKey !== lastNodeStructureKey || newDocsKey !== lastDocumentsKey
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
        }
    })

    initializePanZoom()
    renderNodes()

    return {
        render(newCanvasState: CanvasState | null, newDocuments: Document[]) {
            // Only do a full re-render if node structure or documents changed
            // Position/dimension updates are handled directly in DOM during drag/resize
            const needsRerender = shouldRerender(newCanvasState, newDocuments)

            // Check if viewport actually changed (not just nodes)
            const oldViewport = currentCanvasState?.viewport
            const newViewport = newCanvasState?.viewport
            const viewportChanged = !oldViewport || !newViewport ||
                oldViewport.x !== newViewport.x ||
                oldViewport.y !== newViewport.y ||
                oldViewport.zoom !== newViewport.zoom

            currentCanvasState = newCanvasState
            currentDocuments = newDocuments

            if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
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
            if (panZoom) {
                panZoom.destroy()
            }
            for (const [, { editor, aiService }] of documentEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
            }
            documentEditors.clear()
            canvasImageLifecycle.destroy()
        }
    }
}
