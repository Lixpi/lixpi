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
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.js'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'

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

    const panZoomConfig = {
        ...defaultPanZoomConfig((transform) => {
            const vp: Viewport = { x: transform[0], y: transform[1], zoom: transform[2] }
            if (viewportEl) {
                viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
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
        return handle
    }

    function commitCanvasState(nextState: CanvasState) {
        currentCanvasState = nextState
        onCanvasStateChange?.(nextState)
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

            newWidth = Math.max(200, newWidth)
            newHeight = Math.max(150, newHeight)

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

    function createDocumentNode(node: CanvasNode, doc: Document | undefined): HTMLElement {
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
            const doc = documentMap.get(node.referenceId)
            const nodeEl = createDocumentNode(node, doc)
            viewportEl.appendChild(nodeEl)
        }
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
            panZoom.syncViewport(vp)
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
            currentCanvasState = newCanvasState
            currentDocuments = newDocuments
            renderNodes()
            if (newCanvasState?.viewport) {
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
        }
    }
}
