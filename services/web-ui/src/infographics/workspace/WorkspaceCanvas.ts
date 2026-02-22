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
import { imageResizeCornerIcon, aiChatThreadRailBoundaryCircle } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasImageLifecycleTracker } from '$src/infographics/workspace/canvasImageLifecycle.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { getResizeHandleScaledSizes } from '$src/infographics/utils/zoomScaling.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import { computeImagePositionNextToThread, computeImagePositionOverlappingThread, countExistingImagesForThread, OVERLAP_PADDING_X, OVERLAP_GAP_Y, OVERLAP_WIDTH_RATIO } from '$src/infographics/workspace/imagePositioning.ts'
import { createNodeLayerManager } from '$src/infographics/workspace/nodeLayering.ts'
import { createAnchoredImageManager } from '$src/infographics/workspace/anchoredImageManager.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { createShiftingGradientBackground } from '$src/utils/shiftingGradientRenderer.ts'
import { webUiSettings } from '$src/webUiSettings.ts'
import { webUiThemeSettings } from '$src/webUiThemeSettings.ts'
import { BubbleMenu, type BubbleMenuPositionRequest } from '$src/components/bubbleMenu/index.ts'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT } from '$src/infographics/workspace/canvasBubbleMenuItems.ts'
import { downloadImage } from '$src/utils/downloadImage.ts'
import { AiPromptInputController } from '$src/services/ai-prompt-input-controller.ts'
import { createGenericAiModelDropdown, createGenericSubmitButton, createGenericImageSizeDropdown } from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'

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
    let anchoredRealignRaf: number | null = null
    let autoGrowRaf: number | null = null
    let selectedNodeId: string | null = null
    let selectedEdgeId: string | null = null
    let resizingNodeId: string | null = null
    let draggingNodeId: string | null = null
    const pendingAnchoredRealignThreadNodeIds: Set<string> = new Set()
    const pendingAutoGrowThreadNodeIds: Set<string> = new Set()
    const nodeLayerManager = createNodeLayerManager()
    const documentEditors: Map<string, DocumentEditorEntry> = new Map()
    const threadEditors: Map<string, AiChatThreadEditorEntry> = new Map()

    // Visibility tracking for lazy loading
    const visibleNodeIds: Set<string> = new Set()
    const loadedNodeIds: Set<string> = new Set()
    let paneRect: DOMRect | null = null

    // Image lifecycle tracker - handles deletion of orphaned images
    const canvasImageLifecycle = createCanvasImageLifecycleTracker()
    canvasImageLifecycle.initializeFromCanvasState(currentCanvasState)

    // Anchored image manager - tracks images overlapping their AI chat thread nodes
    const anchoredImageManager = createAnchoredImageManager()

    // Canvas bubble menu for image nodes (delete, create variant)
    let canvasBubbleMenu: BubbleMenu | null = null
    let canvasBubbleMenuItems: ReturnType<typeof buildCanvasBubbleMenuItems> | null = null

    function initCanvasBubbleMenu() {
        canvasBubbleMenuItems = buildCanvasBubbleMenuItems({
            onDeleteNode: (nodeId) => {
                if (!currentCanvasState) return

                // Clean up anchored image state when deleting an anchored image
                const removedAnchor = anchoredImageManager.removeAnchor(nodeId)

                // Clean up anchored images when deleting a thread that owns them
                const threadAnchors = anchoredImageManager.getAnchorsForThread(nodeId)
                for (const anchor of threadAnchors) {
                    anchoredImageManager.removeAnchor(anchor.imageNodeId)
                    const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement
                    if (imgEl) imgEl.classList.remove('workspace-image-node--anchored')
                }

                let updatedNodes = currentCanvasState.nodes.filter((n: CanvasNode) => n.nodeId !== nodeId)
                const updatedEdges = currentCanvasState.edges.filter(
                    (e: WorkspaceEdge) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
                )

                // Shrink thread height when deleting an anchored image
                if (removedAnchor) {
                    // Find the deleted image node to calculate shrink amount
                    const deletedImgNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
                    if (deletedImgNode) {
                        updatedNodes = updatedNodes.map((n: CanvasNode) => {
                            if (n.nodeId !== removedAnchor.threadNodeId) return n
                            // Recalculate: find max image bottom among remaining anchored images
                            const remainingAnchors = anchoredImageManager.getAnchorsForThread(n.nodeId)
                            let requiredHeight = 200 // minimum
                            for (const a of remainingAnchors) {
                                const imgN = updatedNodes.find((nn: CanvasNode) => nn.nodeId === a.imageNodeId)
                                if (imgN) {
                                    const imgBottom = (imgN.position.y + imgN.dimensions.height + OVERLAP_GAP_Y) - n.position.y
                                    requiredHeight = Math.max(requiredHeight, imgBottom)
                                }
                            }
                            const newHeight = Math.max(requiredHeight, 200)
                            const threadEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                            if (threadEl) threadEl.style.height = `${newHeight}px`
                            return { ...n, dimensions: { ...n.dimensions, height: newHeight } }
                        })
                    }
                }

                selectNode(null)
                commitCanvasState({ ...currentCanvasState, nodes: updatedNodes, edges: updatedEdges })
            },
            onDownloadImage: (nodeId) => {
                const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                const imgEl = nodeEl?.querySelector('img') as HTMLImageElement | null
                if (imgEl?.src) {
                    downloadImage(imgEl.src, { getAuthToken: () => AuthService.getTokenSilently() })
                }
            },
            onAskAi: async (nodeId) => {
                const imageNode = currentCanvasState?.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
                if (!imageNode || imageNode.type !== 'image') return

                const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                if (!aiChatThreadService) return

                try {
                    const threadId = uuidv4()

                    const initialContent = {
                        type: 'doc',
                        content: [
                            {
                                type: 'documentTitle',
                                content: [{ type: 'text', text: 'New AI Chat' }]
                            },
                            {
                                type: 'aiChatThread',
                                attrs: { threadId },
                                content: []
                            }
                        ]
                    }

                    const thread = await aiChatThreadService.createAiChatThread({
                        workspaceId,
                        threadId,
                        content: initialContent,
                        aiModel: 'anthropic:claude-sonnet-4-20250514'
                    })

                    if (thread) {
                        const newX = imageNode.position.x + imageNode.dimensions.width + 50
                        const newY = imageNode.position.y

                        const threadNode: AiChatThreadCanvasNode = {
                            nodeId: `node-${thread.threadId}`,
                            type: 'aiChatThread',
                            referenceId: thread.threadId,
                            position: { x: newX, y: newY },
                            dimensions: { width: 400, height: 500 }
                        }

                        const newEdge: WorkspaceEdge = {
                            edgeId: `edge-${imageNode.nodeId}-${threadNode.nodeId}`,
                            sourceNodeId: imageNode.nodeId,
                            targetNodeId: threadNode.nodeId,
                            sourceHandle: 'right',
                            targetHandle: 'left'
                        }

                        const existingNodes = currentCanvasState?.nodes || []
                        const newCanvasState: CanvasState = {
                            viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                            edges: [...(currentCanvasState?.edges ?? []), newEdge],
                            nodes: [...existingNodes, threadNode]
                        }

                        onCanvasStateChange?.(newCanvasState)
                    }
                } catch (error) {
                    console.error('Failed to create AI chat thread from image:', error)
                }
            },
            onTriggerConnection: (nodeId) => {
                if (!connectionManager) return

                connectionManager.startConnectionFromMenu(nodeId)
            },
            onHide: () => {
                canvasBubbleMenu?.forceHide()
            },
        })

        canvasBubbleMenu = new BubbleMenu({
            parentEl: paneEl,
            items: canvasBubbleMenuItems.items,
        })
    }

    function showCanvasBubbleMenuForNode(nodeId: string) {
        if (!canvasBubbleMenu || !canvasBubbleMenuItems || !currentCanvasState) return

        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        if (!node || node.type !== 'image') {
            canvasBubbleMenu.hide()
            return
        }

        canvasBubbleMenuItems.setActiveNodeId(nodeId)

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
        if (!nodeEl) return

        const imgEl = nodeEl.querySelector('img') as HTMLImageElement
        const targetEl = imgEl || nodeEl
        const targetRect = targetEl.getBoundingClientRect()

        const position: BubbleMenuPositionRequest = { targetRect, placement: 'below' }
        canvasBubbleMenu.show(CANVAS_IMAGE_CONTEXT, position)
    }

    function hideCanvasBubbleMenu() {
        canvasBubbleMenuItems?.setActiveNodeId(null)
        canvasBubbleMenu?.hide()
    }

    function repositionCanvasBubbleMenu() {
        if (!canvasBubbleMenu?.isVisible || !selectedNodeId) return

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${selectedNodeId}"]`) as HTMLElement
        if (!nodeEl) return

        const imgEl = nodeEl.querySelector('img') as HTMLImageElement
        const targetEl = imgEl || nodeEl
        const targetRect = targetEl.getBoundingClientRect()

        canvasBubbleMenu.reposition({ targetRect, placement: 'below' })
    }

    // ========== FLOATING AI PROMPT INPUT ==========

    // Single floating input for non-thread nodes (selection-based show/hide)
    let floatingInputEl: HTMLDivElement | null = null
    let floatingInputEditor: any = null
    let floatingInputGradient: { destroy: () => void; triggerAnimation: () => void } | null = null

    // Per-thread floating inputs: always visible below each aiChatThread node
    type ThreadFloatingInputEntry = {
        nodeId: string
        threadId: string
        el: HTMLDivElement
        editor: any
        gradient: { destroy: () => void; triggerAnimation: () => void } | null
    }
    const threadFloatingInputs: Map<string, ThreadFloatingInputEntry> = new Map()

    // Vertical rail elements — one per AI chat thread, spanning thread + floating input
    const RAIL_OFFSET = webUiThemeSettings.aiChatThreadRailOffset
    const RAIL_GRAB_WIDTH = webUiSettings.aiChatThreadRailDragGrabWidth
    const threadRails: Map<string, HTMLElement> = new Map()

    const promptInputController = new AiPromptInputController({
        workspaceId,
        getCanvasState: () => currentCanvasState,
        persistCanvasState: (state: CanvasState) => {
            commitCanvasState(state)
        },
        createAiChatThread: async (params) => {
            const aiChatThreadService = servicesStore.getData('aiChatThreadService')
            if (!aiChatThreadService) return null
            return aiChatThreadService.createAiChatThread(params)
        },
        onAiSubmit: (threadId, payload) => {
            const entry = threadEditors.get(threadId)
            if (!entry) return

            // Trigger gradient animation on the target thread
            entry.triggerGradientAnimation?.()

            // The actual AI request is triggered by USE_AI_CHAT_META dispatch
            // which the controller already handles via injectMessageAndSubmit
        },
        onAiStop: (threadId) => {
            const entry = threadEditors.get(threadId)
            if (!entry) return
            entry.aiService.stopChatMessage()
        },
    })

    // ---- Single floating input (for non-thread nodes) ----

    function createFloatingInput(): void {
        if (floatingInputEl) return

        floatingInputEl = document.createElement('div')
        floatingInputEl.className = 'ai-prompt-input-floating nopan'
        floatingInputEl.style.position = 'absolute'
        floatingInputEl.style.display = 'none'
        floatingInputEl.style.zIndex = '9999'
        floatingInputEl.style.width = '400px'

        // Add gradient background (controlled by settings flag)
        if (webUiSettings.useShiftingGradientBackgroundOnAiUserInputNode) {
            floatingInputGradient = createShiftingGradientBackground(floatingInputEl)
        }

        const editorContainer = document.createElement('div')
        editorContainer.className = 'floating-input-editor nopan'
        floatingInputEl.appendChild(editorContainer)

        const controlFactories = {
            createModelDropdown: createGenericAiModelDropdown,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createSubmitButton: createGenericSubmitButton,
        }

        floatingInputEditor = new ProseMirrorEditor({
            editorMountElement: editorContainer,
            content: document.createElement('div'),
            initialVal: {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            onEditorChange: () => {},
            onProjectTitleChange: () => {},
            onPromptSubmit: (data: any) => {
                promptInputController.submitMessage({
                    contentJSON: data.contentJSON,
                    aiModel: data.aiModel,
                    imageOptions: data.imageOptions,
                })
            },
            onPromptStop: () => {
                promptInputController.stopStreaming()
            },
            isPromptReceiving: () => promptInputController.isReceiving(),
            promptControlFactories: controlFactories,
        })

        viewportEl.appendChild(floatingInputEl)
    }

    function showFloatingInput(nodeId: string): void {
        if (!floatingInputEl) createFloatingInput()
        if (!floatingInputEl || !currentCanvasState) return

        const targetCanvasNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        if (!targetCanvasNode) return

        const refId = (targetCanvasNode as any).referenceId || nodeId
        promptInputController.setTarget({
            nodeId,
            type: targetCanvasNode.type,
            referenceId: refId,
        })

        positionFloatingInput(targetCanvasNode)
        floatingInputEl.style.display = 'block'
    }

    function hideFloatingInput(): void {
        if (floatingInputEl) {
            floatingInputEl.style.display = 'none'
        }
        promptInputController.setTarget(null)
    }

    function positionFloatingInput(targetNode: CanvasNode): void {
        if (!floatingInputEl) return

        const inputX = targetNode.position.x
        const inputY = targetNode.position.y + (targetNode.dimensions?.height ?? 400) + 16

        floatingInputEl.style.left = `${inputX}px`
        floatingInputEl.style.top = `${inputY}px`
        floatingInputEl.style.width = `${targetNode.dimensions?.width ?? 400}px`
    }

    // ---- Per-thread floating inputs (always visible for aiChatThread nodes) ----

    function createThreadFloatingInput(node: AiChatThreadCanvasNode): void {
        if (threadFloatingInputs.has(node.nodeId)) return

        const el = document.createElement('div')
        el.className = 'ai-prompt-input-floating ai-prompt-input-thread-persistent nopan'
        el.style.position = 'absolute'
        el.style.display = 'block'
        el.style.zIndex = '9999'
        el.dataset.threadNodeId = node.nodeId

        const gradient = webUiSettings.useShiftingGradientBackgroundOnAiUserInputNode
            ? createShiftingGradientBackground(el)
            : null

        const editorContainer = document.createElement('div')
        editorContainer.className = 'floating-input-editor nopan'
        el.appendChild(editorContainer)

        const controlFactories = {
            createModelDropdown: createGenericAiModelDropdown,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createSubmitButton: createGenericSubmitButton,
        }

        const threadId = node.referenceId
        const nodeId = node.nodeId

        const editor = new ProseMirrorEditor({
            editorMountElement: editorContainer,
            content: document.createElement('div'),
            initialVal: {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            onEditorChange: () => {},
            onProjectTitleChange: () => {},
            onPromptSubmit: (data: any) => {
                promptInputController.setTarget({
                    nodeId,
                    type: 'aiChatThread',
                    referenceId: threadId,
                })
                promptInputController.submitMessage({
                    contentJSON: data.contentJSON,
                    aiModel: data.aiModel,
                    imageOptions: data.imageOptions,
                })
            },
            onPromptStop: () => {
                promptInputController.setTarget({
                    nodeId,
                    type: 'aiChatThread',
                    referenceId: threadId,
                })
                promptInputController.stopStreaming()
            },
            isPromptReceiving: () => promptInputController.isReceiving(threadId),
            promptControlFactories: controlFactories,
        })

        positionElementBelowNode(el, node)

        // Add bottom resize handles to the floating input (they control the thread node's height)
        el.appendChild(createResizeHandle(nodeId, 'bottom-left'))
        el.appendChild(createResizeHandle(nodeId, 'bottom-right'))

        viewportEl.appendChild(el)

        threadFloatingInputs.set(nodeId, {
            nodeId,
            threadId,
            el,
            editor,
            gradient,
        })
    }

    // Returns the vertical offset from a thread node's top to where the floating
    // input should be placed. Hidden (empty) threads contribute 0 height.
    function getThreadTopOffset(nodeId: string, threadHeight: number): number {
        return hiddenEmptyThreadNodeIds.has(nodeId) ? 0 : threadHeight + 16
    }

    function positionElementBelowNode(el: HTMLElement, node: CanvasNode): void {
        el.style.left = `${node.position.x}px`
        el.style.top = `${node.position.y + getThreadTopOffset(node.nodeId, node.dimensions?.height ?? 400)}px`
        el.style.width = `${node.dimensions?.width ?? 400}px`
    }

    function repositionAllThreadFloatingInputs(): void {
        if (!currentCanvasState) return
        for (const [nodeId, entry] of threadFloatingInputs) {
            const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
            if (node) {
                positionElementBelowNode(entry.el, node)
                repositionThreadRail(nodeId, node)
            }
        }
    }

    function createThreadRail(node: AiChatThreadCanvasNode): void {
        if (threadRails.has(node.nodeId)) return

        const rail = document.createElement('div')
        rail.className = 'workspace-thread-rail nopan'
        rail.style.position = 'absolute'
        rail.style.width = `${RAIL_GRAB_WIDTH}px`
        rail.style.zIndex = '9990'
        rail.style.setProperty('--rail-gradient', webUiThemeSettings.aiChatThreadRailGradient)
        rail.style.setProperty('--rail-width', webUiThemeSettings.aiChatThreadRailWidth)
        rail.dataset.threadNodeId = node.nodeId

        const line = document.createElement('div')
        line.className = 'workspace-thread-rail__line'

        const bottomCircle = document.createElement('div')
        bottomCircle.className = 'workspace-thread-rail__boundary-circle'
        bottomCircle.innerHTML = aiChatThreadRailBoundaryCircle
        const circlePaths = bottomCircle.querySelectorAll('path')
        const [outerColor, ringColor, innerColor] = webUiThemeSettings.aiChatThreadRailBoundaryCircleColors
        if (circlePaths[0]) circlePaths[0].setAttribute('fill', outerColor)
        if (circlePaths[1]) circlePaths[1].setAttribute('fill', ringColor)
        if (circlePaths[2]) circlePaths[2].setAttribute('fill', innerColor)
        line.appendChild(bottomCircle)

        rail.appendChild(line)

        rail.addEventListener('mousedown', (e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDragStart(e, node.nodeId)
        })

        repositionThreadRail(node.nodeId, node, rail)

        viewportEl.appendChild(rail)
        threadRails.set(node.nodeId, rail)
    }

    function repositionThreadRail(nodeId: string, node: CanvasNode, railEl?: HTMLElement): void {
        const rail = railEl ?? threadRails.get(nodeId)
        if (!rail) return

        const isHidden = hiddenEmptyThreadNodeIds.has(nodeId)
        const threadHeight = isHidden ? 0 : (node.dimensions?.height ?? 400)
        const gap = isHidden ? 0 : 16
        const floatingEntry = threadFloatingInputs.get(nodeId)
        const floatingHeight = floatingEntry ? floatingEntry.el.offsetHeight : 0
        const totalHeight = threadHeight + gap + floatingHeight

        rail.style.left = `${node.position.x - RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`
        rail.style.top = `${node.position.y}px`
        rail.style.height = `${totalHeight}px`
        rail.style.setProperty('--rail-thread-height', `${threadHeight}px`)

        const boundaryCircle = rail.querySelector('.workspace-thread-rail__boundary-circle') as HTMLElement | null
        if (boundaryCircle) {
            boundaryCircle.style.display = isHidden ? 'none' : ''
        }

        connectionManager?.setRailHeight(nodeId, totalHeight)
    }

    function destroyAllThreadRails(): void {
        for (const [, rail] of threadRails) {
            rail.remove()
        }
        threadRails.clear()
        connectionManager?.clearRailHeights()
    }

    function realignAnchoredImagesForThread(threadNodeId: string): void {
        if (!currentCanvasState) return
        if (webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) return
        if (draggingNodeId === threadNodeId || resizingNodeId === threadNodeId) return

        const threadNode = currentCanvasState.nodes.find(
            (n: CanvasNode): n is AiChatThreadCanvasNode => n.type === 'aiChatThread' && n.nodeId === threadNodeId
        )
        if (!threadNode) return

        const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${threadNode.nodeId}"]`) as HTMLElement | null
        if (!threadNodeEl) return

        const anchors = anchoredImageManager.getAnchorsForThread(threadNode.nodeId)
        if (anchors.length === 0) return

        const anchorByImageId = new Map(anchors.map((anchor) => [anchor.imageNodeId, anchor]))
        let hasChanges = false

        const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.type !== 'image') return node

            const anchor = anchorByImageId.get(node.nodeId)
            if (!anchor) return node

            if (draggingNodeId === node.nodeId || resizingNodeId === node.nodeId) {
                return node
            }

            const { x, y, constrainedWidth } = computeImagePositionOverlappingThread(
                threadNode,
                anchor.responseMessageId || '',
                threadNodeEl
            )

            // Recalculate height preserving aspect ratio
            const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
            const imgElement = imgNodeEl?.querySelector('img') as HTMLImageElement | null
            const ar = imgElement?.naturalWidth && imgElement?.naturalHeight
                ? imgElement.naturalWidth / imgElement.naturalHeight : 1
            const newHeight = constrainedWidth / ar

            const posChanged = Math.abs(node.position.x - x) > 0.5 || Math.abs(node.position.y - y) > 0.5
            const sizeChanged = Math.abs(node.dimensions.width - constrainedWidth) > 0.5
            if (!posChanged && !sizeChanged) return node

            hasChanges = true

            if (imgNodeEl) {
                imgNodeEl.style.left = `${x}px`
                imgNodeEl.style.top = `${y}px`
                imgNodeEl.style.width = `${constrainedWidth}px`
                imgNodeEl.style.height = `${newHeight}px`
                imgNodeEl.classList.add('workspace-image-node--anchored')
                nodeLayerManager.bringToFront(imgNodeEl)
            }

            return {
                ...node,
                position: { x, y },
                dimensions: { width: constrainedWidth, height: newHeight },
            }
        })

        if (!hasChanges) {
            applyAnchoredImageSpacing(threadNodeId)
            return
        }

        // Update currentCanvasState with new image positions BEFORE spacing,
        // so applyAnchoredImageSpacing can grow the thread height and the
        // single commit below persists everything (positions + height).
        currentCanvasState = { ...currentCanvasState, nodes: updatedNodes }
        applyAnchoredImageSpacing(threadNodeId)

        commitCanvasStatePreservingEditors(currentCanvasState)

        scheduleEdgesRender()
        repositionCanvasBubbleMenu()
    }
    // are pushed below the overlapping anchored image.
    function applyAnchoredImageSpacing(threadNodeId: string): void {
        if (!currentCanvasState) return
        if (webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) return

        const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${threadNodeId}"]`) as HTMLElement | null
        if (!threadNodeEl) return

        const anchors = anchoredImageManager.getAnchorsForThread(threadNodeId)

        // Clear all previous spacers first
        const allMessageEls = threadNodeEl.querySelectorAll('[data-message-id]') as NodeListOf<HTMLElement>
        for (const el of allMessageEls) {
            el.style.marginBottom = ''
        }

        if (anchors.length === 0) return

        // Use DOM positions (always up-to-date, even during live resize)
        const threadTop = parseFloat(threadNodeEl.style.top) || 0
        const threadRect = threadNodeEl.getBoundingClientRect()
        const zoom = threadRect.width / threadNodeEl.offsetWidth || 1

        for (const anchor of anchors) {
            const responseMessageId = anchor.responseMessageId
            if (!responseMessageId) continue

            const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement | null
            if (!imgEl) continue

            const msgEl = threadNodeEl.querySelector(`[data-message-id="${responseMessageId}"]`) as HTMLElement | null
            if (!msgEl) continue

            // Image bottom in canvas coordinates (style.top + offsetHeight are unzoomed)
            const imgTop = parseFloat(imgEl.style.top) || 0
            const imgHeight = imgEl.offsetHeight
            const imageBottom = imgTop + imgHeight

            // Message bottom in canvas coordinates
            const msgRect = msgEl.getBoundingClientRect()
            const msgBottomRelative = (msgRect.bottom - threadRect.top) / zoom
            const msgBottom = threadTop + msgBottomRelative

            // If image extends below message, add margin to push next content down
            const overhang = imageBottom - msgBottom + OVERLAP_GAP_Y
            console.log('🔶 [SPACING]', { responseMessageId, imgTop, imgHeight, imageBottom, threadTop, zoom, msgBottomRelative, msgBottom, overhang, willApply: overhang > 0 })
            if (overhang > 0) {
                msgEl.style.marginBottom = `${overhang}px`
            }
        }

        // After setting margins, grow thread if content is clipped by overflow:hidden.
        // Temporarily remove the fixed height to measure the natural content height.
        const currentHeight = threadNodeEl.offsetHeight
        const savedHeight = threadNodeEl.style.height
        threadNodeEl.style.height = 'auto'
        const naturalHeight = threadNodeEl.offsetHeight
        threadNodeEl.style.height = savedHeight

        if (naturalHeight > currentHeight) {
            threadNodeEl.style.height = `${naturalHeight}px`

            // Update in-memory canvas state so callers that commit afterwards
            // will persist the grown height in a single commit.
            const nodeIdx = currentCanvasState.nodes.findIndex((n: CanvasNode) => n.nodeId === threadNodeId)
            if (nodeIdx >= 0) {
                const updatedNode = {
                    ...currentCanvasState.nodes[nodeIdx],
                    dimensions: { ...currentCanvasState.nodes[nodeIdx].dimensions, height: naturalHeight }
                }
                currentCanvasState = {
                    ...currentCanvasState,
                    nodes: currentCanvasState.nodes.map((n: CanvasNode, i: number) => i === nodeIdx ? updatedNode : n)
                }
            }

            repositionAllThreadFloatingInputs()
        }
    }

    function scheduleAnchoredImagesRealign(threadNodeId: string): void {
        if (webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) return

        pendingAnchoredRealignThreadNodeIds.add(threadNodeId)
        if (anchoredRealignRaf !== null) return

        anchoredRealignRaf = requestAnimationFrame(() => {
            anchoredRealignRaf = null

            const nodeIds = Array.from(pendingAnchoredRealignThreadNodeIds)
            pendingAnchoredRealignThreadNodeIds.clear()

            for (const nodeId of nodeIds) {
                realignAnchoredImagesForThread(nodeId)
            }
        })
    }

    const AI_CHAT_THREAD_MIN_HEIGHT = 150

    function threadContentHasMessages(content: any): boolean {
        if (!content || typeof content !== 'object') return false
        const nodes = content.content
        if (!Array.isArray(nodes)) return false
        for (const node of nodes) {
            if (node.type === 'aiChatThread') {
                const children = node.content
                if (Array.isArray(children) && children.length > 0) return true
            }
        }
        return false
    }

    // Tracks thread nodes that are hidden because they have no messages yet
    const hiddenEmptyThreadNodeIds: Set<string> = new Set()

    function hideThreadNode(nodeEl: HTMLElement, nodeId: string): void {
        nodeEl.dataset.threadEmpty = 'true'
        hiddenEmptyThreadNodeIds.add(nodeId)
    }

    function showThreadNode(nodeEl: HTMLElement, nodeId: string): void {
        delete nodeEl.dataset.threadEmpty
        hiddenEmptyThreadNodeIds.delete(nodeId)
    }

    function updateThreadNodeVisibility(nodeId: string, threadNodeEl: HTMLElement): void {
        const hasMessages = threadNodeEl.querySelector('.ai-user-message-wrapper, .ai-response-message-wrapper') !== null
        const wasHidden = hiddenEmptyThreadNodeIds.has(nodeId)

        if (hasMessages && wasHidden) {
            showThreadNode(threadNodeEl, nodeId)
            repositionAllThreadFloatingInputs()
            scheduleThreadAutoGrow(nodeId)
        } else if (!hasMessages && !wasHidden) {
            hideThreadNode(threadNodeEl, nodeId)
            repositionAllThreadFloatingInputs()
        }
    }

    function autoGrowThreadNode(threadNodeId: string): void {
        if (!currentCanvasState) return
        if (hiddenEmptyThreadNodeIds.has(threadNodeId)) return

        const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${threadNodeId}"]`) as HTMLElement | null
        if (!threadNodeEl) return

        // Measure the natural height the thread needs by temporarily removing
        // the fixed height constraint. The flex column container will size to
        // fit its children (the editor shrinks to its content via flex:1).
        // Reading offsetHeight forces a synchronous reflow but no repaint.
        const currentHeight = threadNodeEl.offsetHeight
        const savedHeight = threadNodeEl.style.height
        threadNodeEl.style.height = 'auto'
        const naturalHeight = Math.max(threadNodeEl.offsetHeight, AI_CHAT_THREAD_MIN_HEIGHT)
        threadNodeEl.style.height = savedHeight

        if (naturalHeight === currentHeight) return

        threadNodeEl.style.height = `${naturalHeight}px`

        const nodeIdx = currentCanvasState.nodes.findIndex((n: CanvasNode) => n.nodeId === threadNodeId)
        if (nodeIdx >= 0) {
            const updatedNode = {
                ...currentCanvasState.nodes[nodeIdx],
                dimensions: { ...currentCanvasState.nodes[nodeIdx].dimensions, height: naturalHeight }
            }
            currentCanvasState = {
                ...currentCanvasState,
                nodes: currentCanvasState.nodes.map((n: CanvasNode, i: number) => i === nodeIdx ? updatedNode : n)
            }
        }

        commitCanvasStatePreservingEditors(currentCanvasState)
        repositionAllThreadFloatingInputs()
        scheduleEdgesRender()
    }

    function scheduleThreadAutoGrow(threadNodeId: string): void {
        pendingAutoGrowThreadNodeIds.add(threadNodeId)
        if (autoGrowRaf !== null) return

        autoGrowRaf = requestAnimationFrame(() => {
            autoGrowRaf = null

            const nodeIds = Array.from(pendingAutoGrowThreadNodeIds)
            pendingAutoGrowThreadNodeIds.clear()

            for (const nodeId of nodeIds) {
                autoGrowThreadNode(nodeId)
            }
        })
    }

    function destroyAllThreadFloatingInputs(): void {
        for (const [, entry] of threadFloatingInputs) {
            entry.editor?.destroy?.()
            entry.gradient?.destroy()
            entry.el.remove()
        }
        threadFloatingInputs.clear()
    }

    // Set up callbacks for AI-generated images
    // Tracks in-progress partial images per thread (threadId → canvas node info)
    const partialImageTracker = new Map<string, { nodeId: string; fileId: string }>()

    function findSourceThreadNode(threadId: string): AiChatThreadCanvasNode | undefined {
        return currentCanvasState?.nodes.find(
            (n: CanvasNode): n is AiChatThreadCanvasNode => n.type === 'aiChatThread' && n.referenceId === threadId
        )
    }

    function buildImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {
        if (imageUrl.startsWith('data:')) return imageUrl
        if (imageUrl.startsWith('/api/')) return `${apiBaseUrl}${imageUrl}${token ? `?token=${token}` : ''}`
        if (imageUrl.startsWith('http')) return imageUrl
        return `data:image/png;base64,${imageUrl}`
    }

    // Append an image node to the DOM directly without a full renderNodes() cycle.
    // This preserves active editors and their streaming state.
    function appendImageNodeToDOM(imageNode: ImageCanvasNode): void {
        const nodeEl = createImageNode(imageNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(imageNode.nodeId, nodeEl as HTMLDivElement)
    }

    // Persist canvas state without triggering a full re-render.
    // Updates internal state + persists via callback, then immediately updates the
    // structure key so the Svelte $effect's render() call sees no structural change
    // and skips renderNodes(). The caller manages DOM updates manually.
    function commitCanvasStatePreservingEditors(nextState: CanvasState): void {
        commitCanvasState(nextState)
        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    }

    setAiGeneratedImageCallbacks({
        onAddToCanvas: async (data) => {
            const { imageUrl, fileId, responseId, revisedPrompt, aiModel } = data

            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()

            const existingNodes = currentCanvasState?.nodes || []
            // Try to find the specific source thread (best effort — legacy path doesn't have threadId)
            let sourceThreadNode: CanvasNode | undefined
            for (const n of existingNodes) {
                if (n.type === 'aiChatThread') {
                    sourceThreadNode = n
                    break
                }
            }

            const newX = sourceThreadNode
                ? sourceThreadNode.position.x + sourceThreadNode.dimensions.width + 50
                : 50 + (existingNodes.length % 3) * 450
            const newY = sourceThreadNode
                ? sourceThreadNode.position.y
                : 50 + Math.floor(existingNodes.length / 3) * 400

            const width = 400
            const height = 400

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
                    aiChatThreadId: sourceThreadNode?.type === 'aiChatThread' ? (sourceThreadNode as AiChatThreadCanvasNode).referenceId : '',
                    responseId,
                    aiModel: aiModel as any,
                    revisedPrompt,
                    responseMessageId: responseMessageId || '',
                }
            }

            const newCanvasState: CanvasState = {
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: currentCanvasState?.edges ?? [],
                nodes: [...existingNodes, imageNode]
            }

            if (sourceThreadNode) {
                const newEdge: WorkspaceEdge = {
                    edgeId: `edge-${sourceThreadNode.nodeId}-${imageNode.nodeId}`,
                    sourceNodeId: sourceThreadNode.nodeId,
                    targetNodeId: imageNode.nodeId,
                    sourceHandle: 'right',
                    targetHandle: 'left'
                }
                newCanvasState.edges = [...(newCanvasState.edges || []), newEdge]
            }

            onCanvasStateChange?.(newCanvasState)
        },

        onImagePartialToCanvas: async (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId } = data
            console.log('🖼️ [CANVAS] onImagePartialToCanvas', { threadId, fileId, hasExisting: partialImageTracker.has(threadId) })

            // Check tracker SYNCHRONOUSLY before any await to prevent race with onImageCompleteToCanvas
            const existing = partialImageTracker.get(threadId)

            if (existing) {
                // Subsequent partial — update DOM directly, no canvas state change
                const token = await AuthService.getTokenSilently()
                const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                const imgEl = viewportEl?.querySelector(`[data-node-id="${existing.nodeId}"] img.image-node-img`) as HTMLImageElement | null
                if (imgEl) {
                    imgEl.src = buildImageSrc(imageUrl, API_BASE_URL, token)
                }
                partialImageTracker.set(threadId, { ...existing, fileId: fileId || existing.fileId })
                return
            }

            // First partial for this thread — register in tracker IMMEDIATELY before await
            const sourceThread = findSourceThreadNode(threadId)
            if (!sourceThread) return

            const nodeId = `node-${fileId || uuidv4()}`
            partialImageTracker.set(threadId, { nodeId, fileId: fileId || '' })

            const token = await AuthService.getTokenSilently()
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const imageSrc = buildImageSrc(imageUrl, API_BASE_URL, token)

            const useAnchored = !webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem

            let imageWidth: number
            let imageHeight: number
            let position: { x: number; y: number }

            if (useAnchored) {
                // Anchored mode: position overlapping the thread (no responseMessageId during partial)
                const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement | null
                const { x, y, constrainedWidth } = computeImagePositionOverlappingThread(
                    sourceThread, '', threadNodeEl
                )
                imageWidth = constrainedWidth
                imageHeight = constrainedWidth // 1:1 aspect ratio for partials
                position = { x, y }
            } else {
                imageWidth = 400
                imageHeight = 400
                const existingCount = countExistingImagesForThread(currentCanvasState?.nodes || [], threadId)
                position = computeImagePositionNextToThread(sourceThread, existingCount, imageWidth, imageHeight)
            }

            const imageNode: ImageCanvasNode = {
                nodeId,
                type: 'image',
                fileId: fileId || '',
                workspaceId: imgWorkspaceId || workspaceId,
                src: imageSrc,
                aspectRatio: 1,
                position,
                dimensions: { width: imageWidth, height: imageHeight },
                generatedBy: {
                    aiChatThreadId: threadId,
                    responseId: '',
                    aiModel: '' as any,
                    revisedPrompt: '',
                    responseMessageId: '',
                }
            }

            const existingNodes = currentCanvasState?.nodes || []
            const existingEdges = currentCanvasState?.edges || []

            const newEdges = [...existingEdges]
            if (!useAnchored) {
                newEdges.push({
                    edgeId: `edge-${sourceThread.nodeId}-${nodeId}`,
                    sourceNodeId: sourceThread.nodeId,
                    targetNodeId: nodeId,
                    sourceHandle: 'right',
                    targetHandle: 'left'
                })
            }

            if (useAnchored) {
                // Grow thread height only if image bottom extends past current thread bottom
                const imageBottom = position.y + imageHeight + OVERLAP_GAP_Y
                const threadBottom = sourceThread.position.y + sourceThread.dimensions.height
                const additionalHeight = Math.max(0, imageBottom - threadBottom)
                const threadEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement
                const updatedNodes = additionalHeight > 0
                    ? existingNodes.map((n: CanvasNode) => {
                        if (n.nodeId !== sourceThread.nodeId) return n
                        return { ...n, dimensions: { ...n.dimensions, height: n.dimensions.height + additionalHeight } }
                    })
                    : existingNodes

                if (additionalHeight > 0 && threadEl) {
                    threadEl.style.height = `${sourceThread.dimensions.height + additionalHeight}px`
                }

                const newCanvasState: CanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: [...updatedNodes, imageNode],
                    edges: newEdges,
                }
                commitCanvasStatePreservingEditors(newCanvasState)
                appendImageNodeToDOM(imageNode)

                // Mark image as anchored (no responseMessageId yet — will be set on complete)
                anchoredImageManager.anchorImage({
                    imageNodeId: nodeId,
                    threadNodeId: sourceThread.nodeId,
                    threadReferenceId: sourceThread.referenceId,
                    responseMessageId: '',
                    imageHeight: imageHeight,
                })

                // Apply anchored CSS class
                const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
                if (imgNodeEl) {
                    imgNodeEl.classList.add('workspace-image-node--anchored')
                    nodeLayerManager.bringToFront(imgNodeEl)
                }

                // Reposition thread floating input after height change
                repositionAllThreadFloatingInputs()
                applyAnchoredImageSpacing(sourceThread.nodeId)
            } else {
                const newCanvasState: CanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: [...existingNodes, imageNode],
                    edges: newEdges,
                }
                commitCanvasStatePreservingEditors(newCanvasState)
                appendImageNodeToDOM(imageNode)
            }
        },

        onImageCompleteToCanvas: async (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, responseId, revisedPrompt, aiModel, responseMessageId } = data
            console.log('🖼️ [CANVAS] onImageCompleteToCanvas', { threadId, fileId, responseMessageId, hasPartial: partialImageTracker.has(threadId) })

            // Read tracker SYNCHRONOUSLY before any await
            const partial = partialImageTracker.get(threadId)

            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()
            const imageSrc = buildImageSrc(imageUrl, API_BASE_URL, token)

            const useAnchored = !webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem

            if (partial) {
                // Upgrade existing partial canvas node to complete
                const nodes = (currentCanvasState?.nodes || []).map((n: CanvasNode) => {
                    if (n.nodeId !== partial.nodeId) return n
                    const imgNode = n as ImageCanvasNode
                    return {
                        ...imgNode,
                        fileId: fileId || imgNode.fileId,
                        workspaceId: imgWorkspaceId || imgNode.workspaceId,
                        src: imageSrc,
                        generatedBy: {
                            aiChatThreadId: threadId,
                            responseId,
                            aiModel: aiModel as any,
                            revisedPrompt,
                            responseMessageId: responseMessageId || '',
                        },
                    } satisfies ImageCanvasNode
                })

                let edges = currentCanvasState?.edges || []
                if (!useAnchored) {
                    // Standard mode: set the edge's sourceMessageId to link to the specific AI response
                    edges = edges.map((e: WorkspaceEdge) => {
                        if (e.targetNodeId !== partial.nodeId) return e
                        return { ...e, sourceMessageId: responseMessageId || undefined }
                    })
                }

                partialImageTracker.delete(threadId)

                const collisionExclusions = useAnchored ? anchoredImageManager.getExclusionPairsForCollisions() : undefined
                const nodeBoxes = nodes.map((n: CanvasNode) => ({
                    id: n.nodeId,
                    x: n.position.x,
                    y: n.position.y,
                    width: n.dimensions.width,
                    height: n.dimensions.height,
                }))
                const collisionResult = resolveCollisions(nodeBoxes, { excludePairs: collisionExclusions })

                const resolvedNodes = collisionResult.hasChanges
                    ? nodes.map((n: CanvasNode) => {
                        const resolved = collisionResult.nodes.get(n.nodeId)
                        if (!resolved) return n
                        return { ...n, position: { x: resolved.x, y: resolved.y } }
                    })
                    : nodes

                commitCanvasState({
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges,
                })

                // Update the existing DOM image src directly
                const imgEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"] img.image-node-img`) as HTMLImageElement | null
                if (imgEl) imgEl.src = imageSrc

                if (useAnchored && responseMessageId) {
                    // Update anchored entry with the real responseMessageId and
                    // realign against the finalized response message layout.
                    const existingAnchor = anchoredImageManager.getAnchor(partial.nodeId)
                    if (existingAnchor) {
                        anchoredImageManager.removeAnchor(partial.nodeId)
                    }

                    const sourceThread = findSourceThreadNode(threadId)
                    if (sourceThread) {
                        const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement | null
                        const imageNode = resolvedNodes.find((n: CanvasNode) => n.nodeId === partial.nodeId) as ImageCanvasNode | undefined
                        const imgHeight = imageNode?.dimensions.height ?? 400
                        const { x, y } = computeImagePositionOverlappingThread(
                            sourceThread,
                            responseMessageId,
                            threadNodeEl
                        )

                        const repositionedNodes = resolvedNodes.map((n: CanvasNode) =>
                            n.nodeId === partial.nodeId ? { ...n, position: { x, y } } : n
                        )

                        const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"]`) as HTMLElement | null
                        if (imgNodeEl) {
                            imgNodeEl.style.left = `${x}px`
                            imgNodeEl.style.top = `${y}px`
                            imgNodeEl.classList.add('workspace-image-node--anchored')
                            nodeLayerManager.bringToFront(imgNodeEl)
                        }

                        anchoredImageManager.anchorImage({
                            imageNodeId: partial.nodeId,
                            threadNodeId: sourceThread.nodeId,
                            threadReferenceId: sourceThread.referenceId,
                            responseMessageId,
                            imageHeight: imgHeight,
                        })

                        // Apply spacing before commit so grown height is persisted
                        currentCanvasState = {
                            viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                            nodes: repositionedNodes,
                            edges,
                        }
                        applyAnchoredImageSpacing(sourceThread.nodeId)
                        commitCanvasState(currentCanvasState)
                    }
                }
            } else {
                // No partial existed — IMAGE_COMPLETE without prior IMAGE_PARTIAL.
                // Guard against duplicates: skip if this fileId is already on canvas
                if (fileId && currentCanvasState?.nodes.some((n: CanvasNode) => n.type === 'image' && (n as ImageCanvasNode).fileId === fileId)) {
                    return
                }

                const sourceThread = findSourceThreadNode(threadId)
                if (!sourceThread) return

                const nodeId = `node-${fileId || uuidv4()}`

                let imageWidth: number
                let imageHeight: number
                let position: { x: number; y: number }

                if (useAnchored) {
                    const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement | null
                    const { x, y, constrainedWidth } = computeImagePositionOverlappingThread(
                        sourceThread, responseMessageId || '', threadNodeEl
                    )
                    imageWidth = constrainedWidth
                    imageHeight = constrainedWidth // 1:1 until real aspect ratio from loaded image
                    position = { x, y }
                } else {
                    imageWidth = 400
                    imageHeight = 400
                    const existingCount = countExistingImagesForThread(currentCanvasState?.nodes || [], threadId)
                    position = computeImagePositionNextToThread(sourceThread, existingCount, imageWidth, imageHeight)
                }

                const imageNode: ImageCanvasNode = {
                    nodeId,
                    type: 'image',
                    fileId: fileId || '',
                    workspaceId: imgWorkspaceId || workspaceId,
                    src: imageSrc,
                    aspectRatio: 1,
                    position,
                    dimensions: { width: imageWidth, height: imageHeight },
                    generatedBy: {
                        aiChatThreadId: threadId,
                        responseId,
                        aiModel: aiModel as any,
                        revisedPrompt,
                        responseMessageId: responseMessageId || '',
                    },
                }

                const existingNodes = currentCanvasState?.nodes || []
                const existingEdges = currentCanvasState?.edges || []

                const newEdges = [...existingEdges]
                if (!useAnchored) {
                    newEdges.push({
                        edgeId: `edge-${sourceThread.nodeId}-${nodeId}`,
                        sourceNodeId: sourceThread.nodeId,
                        targetNodeId: nodeId,
                        sourceHandle: 'right',
                        targetHandle: 'left',
                        sourceMessageId: responseMessageId || undefined,
                    })
                }

                let allNodes: CanvasNode[]
                if (useAnchored) {
                    // Grow thread height only if image bottom extends past current thread bottom
                    const imageBottom = position.y + imageHeight + OVERLAP_GAP_Y
                    const threadBottom = sourceThread.position.y + sourceThread.dimensions.height
                    const additionalHeight = Math.max(0, imageBottom - threadBottom)
                    const threadEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement
                    if (additionalHeight > 0 && threadEl) {
                        threadEl.style.height = `${sourceThread.dimensions.height + additionalHeight}px`
                    }
                    allNodes = [
                        ...existingNodes.map((n: CanvasNode) =>
                            n.nodeId === sourceThread.nodeId && additionalHeight > 0
                                ? { ...n, dimensions: { ...n.dimensions, height: n.dimensions.height + additionalHeight } }
                                : n
                        ),
                        imageNode,
                    ]
                } else {
                    allNodes = [...existingNodes, imageNode]
                }

                const collisionExclusions = useAnchored ? anchoredImageManager.getExclusionPairsForCollisions() : undefined
                const nodeBoxes = allNodes.map((n: CanvasNode) => ({
                    id: n.nodeId,
                    x: n.position.x,
                    y: n.position.y,
                    width: n.dimensions.width,
                    height: n.dimensions.height,
                }))
                const collisionResult = resolveCollisions(nodeBoxes, { excludePairs: collisionExclusions })

                const resolvedNodes = collisionResult.hasChanges
                    ? allNodes.map((n: CanvasNode) => {
                        const resolved = collisionResult.nodes.get(n.nodeId)
                        if (!resolved) return n
                        return { ...n, position: { x: resolved.x, y: resolved.y } }
                    })
                    : allNodes

                const resolvedImageNode = collisionResult.hasChanges
                    ? { ...imageNode, position: collisionResult.nodes.get(nodeId) ? { x: collisionResult.nodes.get(nodeId)!.x, y: collisionResult.nodes.get(nodeId)!.y } : imageNode.position }
                    : imageNode

                // Set state but don't commit yet — spacing may grow thread height
                currentCanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges: newEdges,
                }
                appendImageNodeToDOM(resolvedImageNode)

                if (useAnchored) {
                    anchoredImageManager.anchorImage({
                        imageNodeId: nodeId,
                        threadNodeId: sourceThread.nodeId,
                        threadReferenceId: sourceThread.referenceId,
                        responseMessageId: responseMessageId || '',
                        imageHeight: imageHeight,
                    })

                    // Apply anchored class and z-index
                    const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
                    if (imgNodeEl) {
                        imgNodeEl.classList.add('workspace-image-node--anchored')
                        nodeLayerManager.bringToFront(imgNodeEl)
                    }

                    // Apply spacing before commit so grown height is persisted
                    applyAnchoredImageSpacing(sourceThread.nodeId)
                    repositionAllThreadFloatingInputs()
                }

                commitCanvasStatePreservingEditors(currentCanvasState)
            }
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
                                    type: 'aiUserMessage',
                                    attrs: { id: uuidv4(), createdAt: Date.now() },
                                    content: [
                                        {
                                            type: 'paragraph',
                                            content: [{ type: 'text', text: 'Describe how you want to edit this image...' }]
                                        }
                                    ]
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
                            sourceNodeId: sourceImageNode.nodeId,
                            targetNodeId: threadNode.nodeId,
                            sourceHandle: 'right',
                            targetHandle: 'left'
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
            // Reposition bubble menu to follow image during pan/zoom
            repositionCanvasBubbleMenu()
            onViewportChange?.(vp)
        }),
        ...options.panZoomConfig
    }

    function selectNode(nodeId: string | null) {
        if (selectedNodeId) {
            const prevNode = viewportEl?.querySelector(`[data-node-id="${selectedNodeId}"]`)
            prevNode?.classList.remove('is-selected')

            // Deselect the previous rail
            const prevRail = threadRails.get(selectedNodeId)
            if (prevRail) prevRail.classList.remove('is-selected')
        }

        selectedNodeId = nodeId

        if (nodeId) {
            const newNode = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
            newNode?.classList.add('is-selected')
            if (newNode) {
                nodeLayerManager.bringToFront(newNode)

                // Bring anchored images to front along with the selected thread
                const threadAnchors = anchoredImageManager.getAnchorsForThread(nodeId)
                for (const anchor of threadAnchors) {
                    const anchoredEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement
                    if (anchoredEl) nodeLayerManager.bringToFront(anchoredEl)
                }
            }

            // Select the rail for this thread (if any)
            const rail = threadRails.get(nodeId)
            if (rail) rail.classList.add('is-selected')
        }

        if (nodeId) {
            selectedEdgeId = null
            connectionManager?.deselect()
            updateEdgeEndpointHandles()
            showCanvasBubbleMenuForNode(nodeId)

            // aiChatThread nodes have their own always-visible per-thread inputs.
            // Image nodes use the bubble menu "Ask AI" button instead of the floating input.
            // Only show the single floating input for document node types.
            const node = currentCanvasState?.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
            if (node && (node.type === 'aiChatThread' || node.type === 'image')) {
                if (node.type === 'aiChatThread') {
                    // Set controller target to this thread (for keyboard shortcuts etc.)
                    const refId = (node as AiChatThreadCanvasNode).referenceId || nodeId
                    promptInputController.setTarget({ nodeId, type: 'aiChatThread', referenceId: refId })
                }
                // Hide the single floating input
                if (floatingInputEl) {
                    floatingInputEl.style.display = 'none'
                }
            } else {
                showFloatingInput(nodeId)
            }
        } else {
            hideCanvasBubbleMenu()
            hideFloatingInput()
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

        const isAiChatThread = node.type === 'aiChatThread'
        for (const corner of RESIZE_CORNERS) {
            // For aiChatThread nodes, bottom handles go on the floating input instead
            if (isAiChatThread && corner.startsWith('bottom')) continue
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
            railOffset: RAIL_OFFSET,
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

        // Shift left-side anchors by -RAIL_OFFSET for aiChatThread nodes so
        // edge endpoints sit on the rail instead of the node boundary.
        // Use rail height (thread + gap + floating input) for Y computation.
        const sourceRailShift = sourceOnLeft && sourceNode.type === 'aiChatThread' ? RAIL_OFFSET : 0
        const targetRailShift = !targetOnRight && targetNode.type === 'aiChatThread' ? RAIL_OFFSET : 0
        const sourceHeight = sourceNode.type === 'aiChatThread' && connectionManager
            ? connectionManager.getRailHeight(sourceNode.nodeId) ?? sourceNode.dimensions.height
            : sourceNode.dimensions.height
        const targetHeight = targetNode.type === 'aiChatThread' && connectionManager
            ? connectionManager.getRailHeight(targetNode.nodeId) ?? targetNode.dimensions.height
            : targetNode.dimensions.height

        const sourceAnchor = {
            x: sourceNode.position.x + (sourceOnLeft ? 0 : sourceNode.dimensions.width) - sourceRailShift,
            y: sourceNode.position.y + sourceHeight / 2
        }
        const targetAnchor = {
            x: targetNode.position.x + (targetOnRight ? targetNode.dimensions.width : 0) - targetRailShift,
            y: targetNode.position.y + targetHeight / 2
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

        // Prevent dragging anchored images
        if (anchoredImageManager.isAnchored(nodeId)) {
            return
        }

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

        // Anchored image co-movement: when dragging a thread, move its anchored images too
        const anchoredImagesForThread = anchoredImageManager.getAnchorsForThread(nodeId)
        const anchoredImageStartPositions = new Map<string, { x: number; y: number }>()
        for (const anchor of anchoredImagesForThread) {
            const anchoredEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement | null
            if (anchoredEl) {
                anchoredImageStartPositions.set(anchor.imageNodeId, {
                    x: parseFloat(anchoredEl.style.left),
                    y: parseFloat(anchoredEl.style.top),
                })
            }
        }

        // If dragging an anchored image, track whether it gets detached from the thread
        let draggedAnchor = anchoredImageManager.getAnchor(nodeId)
        let detachedDuringDrag = false

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = (moveEvent.clientX - startX) / currentZoom
            const deltaY = (moveEvent.clientY - startY) / currentZoom

            nodeEl.style.left = `${startLeft + deltaX}px`
            nodeEl.style.top = `${startTop + deltaY}px`

            const currentPos = {
                x: parseFloat(nodeEl.style.left),
                y: parseFloat(nodeEl.style.top)
            }
            const currentDims = {
                width: nodeEl.offsetWidth,
                height: nodeEl.offsetHeight
            }

            liveNodeOverrides.set(nodeId, {
                position: currentPos,
                dimensions: currentDims
            })

            connectionManager?.checkProximity(nodeId, currentPos, currentDims)

            // Co-move anchored images when dragging a thread
            for (const [imgId, startPos] of anchoredImageStartPositions) {
                const anchoredEl = viewportEl?.querySelector(`[data-node-id="${imgId}"]`) as HTMLElement | null
                if (anchoredEl) {
                    const newX = startPos.x + deltaX
                    const newY = startPos.y + deltaY
                    anchoredEl.style.left = `${newX}px`
                    anchoredEl.style.top = `${newY}px`
                    liveNodeOverrides.set(imgId, {
                        position: { x: newX, y: newY },
                        dimensions: { width: anchoredEl.offsetWidth, height: anchoredEl.offsetHeight },
                    })
                }
            }

            // Check if dragged anchored image should detach (center leaves thread bounds)
            if (draggedAnchor && !detachedDuringDrag) {
                const imgCenterX = currentPos.x + currentDims.width / 2
                const imgCenterY = currentPos.y + currentDims.height / 2
                const threadNode = currentCanvasState?.nodes.find(
                    (n: CanvasNode) => n.nodeId === draggedAnchor!.threadNodeId
                )
                if (threadNode) {
                    const threadOverride = liveNodeOverrides.get(threadNode.nodeId)
                    const tx = threadOverride?.position?.x ?? threadNode.position.x
                    const ty = threadOverride?.position?.y ?? threadNode.position.y
                    const tw = threadOverride?.dimensions?.width ?? threadNode.dimensions.width
                    const th = threadOverride?.dimensions?.height ?? threadNode.dimensions.height

                    if (imgCenterX < tx || imgCenterX > tx + tw || imgCenterY < ty || imgCenterY > ty + th) {
                        detachedDuringDrag = true
                        nodeEl.classList.remove('workspace-image-node--anchored')
                    }
                }
            }

            scheduleEdgesRender()
            repositionCanvasBubbleMenu()

            // Reposition floating input to follow dragged node
            if (floatingInputEl && floatingInputEl.style.display !== 'none' && nodeId === selectedNodeId) {
                floatingInputEl.style.left = `${currentPos.x}px`
                floatingInputEl.style.top = `${currentPos.y + getThreadTopOffset(nodeId, currentDims.height)}px`
                floatingInputEl.style.width = `${currentDims.width}px`
            }

            // Reposition per-thread floating input if dragging a thread node
            const threadEntry = threadFloatingInputs.get(nodeId)
            if (threadEntry) {
                threadEntry.el.style.left = `${currentPos.x}px`
                threadEntry.el.style.top = `${currentPos.y + getThreadTopOffset(nodeId, currentDims.height)}px`
                threadEntry.el.style.width = `${currentDims.width}px`
            }

            // Reposition the vertical rail alongside the dragged thread
            const dragRail = threadRails.get(nodeId)
            if (dragRail) {
                dragRail.style.left = `${currentPos.x - RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`
                dragRail.style.top = `${currentPos.y}px`
                // Update connection manager rail height during drag
                const totalH = parseFloat(dragRail.style.height || '0')
                if (totalH > 0) connectionManager?.setRailHeight(nodeId, totalH)
            }
        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-dragging')

            // Try to convert any proximity candidate into a real connection
            connectionManager?.commitProximityConnection()

            draggingNodeId = null

            liveNodeOverrides.delete(nodeId)

            // Clean up liveNodeOverrides for co-moved anchored images
            for (const [imgId] of anchoredImageStartPositions) {
                liveNodeOverrides.delete(imgId)
            }

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }

            const newPosition = {
                x: parseFloat(nodeEl.style.left),
                y: parseFloat(nodeEl.style.top)
            }

            // Update dragged node position AND co-moved anchored image positions
            let updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) => {
                if (n.nodeId === nodeId) return { ...n, position: newPosition }
                const startPos = anchoredImageStartPositions.get(n.nodeId)
                if (startPos) {
                    const anchoredEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement | null
                    if (anchoredEl) {
                        return { ...n, position: { x: parseFloat(anchoredEl.style.left), y: parseFloat(anchoredEl.style.top) } }
                    }
                }
                return n
            })

            // Handle detachment of anchored image that was dragged away from its thread
            if (detachedDuringDrag && draggedAnchor) {
                const removed = anchoredImageManager.removeAnchor(nodeId)
                if (removed) {
                    // Recalculate thread height based on remaining anchored images
                    updatedNodes = updatedNodes.map((n: CanvasNode) => {
                        if (n.nodeId !== removed.threadNodeId) return n
                        const remainingAnchors = anchoredImageManager.getAnchorsForThread(n.nodeId)
                        let requiredHeight = 200
                        for (const a of remainingAnchors) {
                            const imgN = updatedNodes.find((nn: CanvasNode) => nn.nodeId === a.imageNodeId)
                            if (imgN) {
                                const imgBottom = (imgN.position.y + imgN.dimensions.height + OVERLAP_GAP_Y) - n.position.y
                                requiredHeight = Math.max(requiredHeight, imgBottom)
                            }
                        }
                        const newHeight = Math.max(requiredHeight, 200)
                        const threadEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                        if (threadEl) threadEl.style.height = `${newHeight}px`
                        return { ...n, dimensions: { ...n.dimensions, height: newHeight } }
                    })
                }
            }

            // Apply collision detection to resolve any overlapping nodes
            const collisionExclusions = anchoredImageManager.getExclusionPairsForCollisions()
            const nodeBoxes = updatedNodes.map((n: CanvasNode) => ({
                id: n.nodeId,
                x: n.position.x,
                y: n.position.y,
                width: n.dimensions.width,
                height: n.dimensions.height
            }))

            const { nodes: movedNodes, hasChanges } = resolveCollisions(nodeBoxes, {
                iterations: 50,
                overlapThreshold: 0.5,
                margin: 20,
                excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined,
            })

            // Apply collision-resolved positions
            if (hasChanges) {
                updatedNodes = updatedNodes.map((n: CanvasNode) => {
                    const newPos = movedNodes.get(n.nodeId)
                    if (newPos) {
                        // Update DOM element position immediately
                        const movedNodeEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                        if (movedNodeEl) {
                            movedNodeEl.style.left = `${newPos.x}px`
                            movedNodeEl.style.top = `${newPos.y}px`
                        }
                        return { ...n, position: newPos }
                    }
                    return n
                })
            }

            commitCanvasState({
                ...currentCanvasState,
                nodes: updatedNodes
            })

            // Final reposition after collision resolution may have moved the node
            repositionCanvasBubbleMenu()
            repositionAllThreadFloatingInputs()
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

        // Anchored image resize constraints
        const resizeAnchor = isImageNode ? anchoredImageManager.getAnchor(nodeId) : undefined
        const resizeAnchorsForThread = !isImageNode ? anchoredImageManager.getAnchorsForThread(nodeId) : []

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

            // Constrain anchored image width to fit within thread bounds
            if (resizeAnchor) {
                const threadNode = currentCanvasState?.nodes.find((n: CanvasNode) => n.nodeId === resizeAnchor.threadNodeId)
                if (threadNode) {
                    const maxWidth = Math.floor(threadNode.dimensions.width * OVERLAP_WIDTH_RATIO)
                    if (newWidth > maxWidth) {
                        newWidth = maxWidth
                        if (aspectRatio) newHeight = newWidth / aspectRatio
                    }
                }
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
                    width: newWidth,
                    height: newHeight
                }
            })
            scheduleEdgesRender()
            repositionCanvasBubbleMenu()

            // Reposition per-thread floating input during resize
            const threadEntry = threadFloatingInputs.get(nodeId)
            if (threadEntry) {
                const pos = { x: parseFloat(nodeEl.style.left), y: parseFloat(nodeEl.style.top) }
                threadEntry.el.style.left = `${pos.x}px`
                threadEntry.el.style.top = `${pos.y + getThreadTopOffset(nodeId, newHeight)}px`
                threadEntry.el.style.width = `${newWidth}px`
            }

            // Reposition the vertical rail during resize
            const resizeRail = threadRails.get(nodeId)
            if (resizeRail) {
                const pos = { x: parseFloat(nodeEl.style.left), y: parseFloat(nodeEl.style.top) }
                const threadH = hiddenEmptyThreadNodeIds.has(nodeId) ? 0 : newHeight
                const floatingH = threadEntry ? threadEntry.el.offsetHeight : 0
                const gap = hiddenEmptyThreadNodeIds.has(nodeId) ? 0 : 16
                const totalH = threadH + gap + floatingH
                resizeRail.style.left = `${pos.x - RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`
                resizeRail.style.top = `${pos.y}px`
                resizeRail.style.height = `${totalH}px`
                resizeRail.style.setProperty('--rail-thread-height', `${threadH}px`)
                connectionManager?.setRailHeight(nodeId, totalH)
            }

            // Real-time anchored image repositioning during thread resize
            if (resizeAnchorsForThread.length > 0) {
                const liveThreadDims = { width: newWidth, height: newHeight }
                const liveThreadPos = { x: parseFloat(nodeEl.style.left), y: parseFloat(nodeEl.style.top) }
                const liveThread = {
                    ...(currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId) as AiChatThreadCanvasNode),
                    position: liveThreadPos,
                    dimensions: liveThreadDims,
                }
                for (const anchor of resizeAnchorsForThread) {
                    const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement | null
                    if (!imgEl) continue

                    const { x: imgX, y: imgY, constrainedWidth: imgW } = computeImagePositionOverlappingThread(
                        liveThread,
                        anchor.responseMessageId || '',
                        nodeEl
                    )
                    const imgElement = imgEl.querySelector('img') as HTMLImageElement | null
                    const ar = imgElement?.naturalWidth && imgElement?.naturalHeight
                        ? imgElement.naturalWidth / imgElement.naturalHeight : 1
                    const imgH = imgW / ar

                    imgEl.style.left = `${imgX}px`
                    imgEl.style.top = `${imgY}px`
                    imgEl.style.width = `${imgW}px`
                    imgEl.style.height = `${imgH}px`
                }
                applyAnchoredImageSpacing(nodeId)
            }
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

            let updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) =>
                n.nodeId === nodeId ? { ...n, dimensions: newDimensions, position: newPosition } : n
            )

            // Update anchored image spacer height after image resize
            if (resizeAnchor) {
                anchoredImageManager.updateImageSize(nodeId, newDimensions.height)
                const heightDelta = newDimensions.height - startHeight
                if (heightDelta !== 0) {
                    updatedNodes = updatedNodes.map((n: CanvasNode) => {
                        if (n.nodeId !== resizeAnchor.threadNodeId) return n
                        const newThreadHeight = Math.max(n.dimensions.height + heightDelta, 200)
                        const threadEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                        if (threadEl) threadEl.style.height = `${newThreadHeight}px`
                        return { ...n, dimensions: { ...n.dimensions, height: newThreadHeight } }
                    })
                }
                // No spacer dispatch needed — images are positioned side-by-side, not below text
            }

            // Adjust anchored images when thread is resized
            if (resizeAnchorsForThread.length > 0) {
                const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                const updatedThread = {
                    ...(currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId) as AiChatThreadCanvasNode),
                    position: newPosition,
                    dimensions: newDimensions,
                }

                for (const anchor of resizeAnchorsForThread) {
                    const imgIdx = updatedNodes.findIndex((n: CanvasNode) => n.nodeId === anchor.imageNodeId)
                    if (imgIdx === -1) continue
                    const imgNode = updatedNodes[imgIdx] as ImageCanvasNode
                    const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement

                    const { x: newImgX, y: newImgY, constrainedWidth: newImgWidth } = computeImagePositionOverlappingThread(
                        updatedThread,
                        anchor.responseMessageId || '',
                        threadNodeEl
                    )

                    const imgElement = imgEl?.querySelector('img') as HTMLImageElement | null
                    const ar = imgElement?.naturalWidth && imgElement?.naturalHeight
                        ? imgElement.naturalWidth / imgElement.naturalHeight : 1
                    const newImgHeight = newImgWidth / ar
                    anchoredImageManager.updateImageSize(anchor.imageNodeId, newImgHeight)

                    if (imgEl) {
                        imgEl.style.left = `${newImgX}px`
                        imgEl.style.top = `${newImgY}px`
                        imgEl.style.width = `${newImgWidth}px`
                        imgEl.style.height = `${newImgHeight}px`
                    }

                    updatedNodes[imgIdx] = {
                        ...imgNode,
                        position: { x: newImgX, y: newImgY },
                        dimensions: { width: newImgWidth, height: newImgHeight },
                    }
                }
                // No spacer dispatch needed — images are side-by-side
            }

            // Apply spacing before commit so the grown height is persisted
            currentCanvasState = { ...currentCanvasState, nodes: updatedNodes }
            applyAnchoredImageSpacing(nodeId)

            commitCanvasState(currentCanvasState)

            // Final reposition at new size
            repositionCanvasBubbleMenu()
            repositionAllThreadFloatingInputs()
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
        console.log('📋 [WORKSPACE] createAiChatThreadNode called:', {
            nodeId: node.nodeId,
            referenceId: node.referenceId,
            hasThread: !!thread,
            hasContent: thread ? thread.content !== undefined : false,
            contentType: thread?.content ? typeof thread.content : 'undefined',
            contentPreview: thread?.content ? JSON.stringify(thread.content).substring(0, 300) : 'no content'
        })

        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-ai-chat-thread-node',
            { threadId: node.referenceId }
        )
        dragOverlay.className = 'document-drag-overlay nopan'

        // Apply theme settings as CSS variables on the thread node
        nodeEl.style.setProperty('--ai-chat-thread-node-box-shadow', webUiThemeSettings.aiChatThreadNodeBoxShadow)
        nodeEl.style.setProperty('--ai-chat-thread-node-border', webUiThemeSettings.aiChatThreadNodeBorder)

        // Hide the document title when the setting is off
        if (!webUiSettings.showHeaderOnAiChatThreadNodes) {
            nodeEl.classList.add('workspace-ai-chat-thread-node--hide-title')
        }

        // Add animated gradient background (controlled by settings flag)
        const gradient = webUiSettings.useShiftingGradientBackgroundOnAiChatThreadNode
            ? createShiftingGradientBackground(nodeEl)
            : null

        const editorContainer = document.createElement('div')
        editorContainer.className = 'ai-chat-thread-node-editor nopan'
        nodeEl.appendChild(editorContainer)

        if (thread && thread.content != null && typeof thread.content === 'object' && Object.keys(thread.content).length > 0) {
            console.log('📋 [WORKSPACE] Creating ProseMirrorEditor with thread content')
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
                    threadId: node.referenceId,
                    onEditorChange: (value: any) => {
                        onAiChatThreadContentChange?.({
                            workspaceId,
                            threadId: node.referenceId,
                            content: value
                        })
                        updateThreadNodeVisibility(node.nodeId, nodeEl)
                        scheduleThreadAutoGrow(node.nodeId)
                        scheduleAnchoredImagesRealign(node.nodeId)
                    },
                    onProjectTitleChange: () => {},
                    onAiChatSubmit: async ({ messages, aiModel, imageOptions }: any) => {
                        // Trigger gradient animation on message send (thread node + floating input)
                        gradient?.triggerAnimation()
                        threadFloatingInputs.get(node.nodeId)?.gradient?.triggerAnimation()

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
                    },
                    onReceivingStateChange: (threadId: string, receiving: boolean) => {
                        promptInputController.setReceiving(threadId, receiving)
                    }
                })

                threadEditors.set(node.referenceId, {
                    editor,
                    aiService,
                    containerEl: nodeEl,
                    gradientCleanup: gradient?.destroy,
                    triggerGradientAnimation: () => {
                        gradient?.triggerAnimation()
                        threadFloatingInputs.get(node.nodeId)?.gradient?.triggerAnimation()
                    },
                })

                // Register with the prompt input controller so it can inject messages
                promptInputController.registerThreadEditor(node.referenceId, {
                    editorView: editor.editorView,
                    triggerGradientAnimation: () => {
                        gradient?.triggerAnimation()
                        threadFloatingInputs.get(node.nodeId)?.gradient?.triggerAnimation()
                    },
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

        // Hide the thread node unless we positively know it has messages.
        // This covers both "not loaded yet" (thread undefined) and "loaded but
        // empty" cases, preventing any visible flash on page load.
        if (!thread || !threadContentHasMessages(thread.content)) {
            hideThreadNode(nodeEl, node.nodeId)
        }

        // Create the always-visible per-thread floating prompt input
        createThreadFloatingInput(node)

        // Create the vertical rail element (drag handle + connection proxy)
        createThreadRail(node)

        // Sync hover state: when thread node is hovered, also show resize handles on floating input
        nodeEl.addEventListener('mouseenter', () => {
            const entry = threadFloatingInputs.get(node.nodeId)
            if (entry) entry.el.classList.add('thread-hovered')
        })
        nodeEl.addEventListener('mouseleave', () => {
            const entry = threadFloatingInputs.get(node.nodeId)
            if (entry) entry.el.classList.remove('thread-hovered')
        })

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

        for (const [threadId, { editor, aiService, gradientCleanup }] of threadEditors) {
            if (editor?.destroy) editor.destroy()
            if (aiService?.disconnect) aiService.disconnect()
            if (gradientCleanup) gradientCleanup()
            promptInputController.unregisterThreadEditor(threadId)
        }
        threadEditors.clear()

        // Clean up per-thread floating inputs (will be recreated for each thread node)
        destroyAllThreadFloatingInputs()

        // Clean up per-thread vertical rails (will be recreated for each thread node)
        destroyAllThreadRails()

        // Clear loaded node tracking on full re-render
        loadedNodeIds.clear()
        hiddenEmptyThreadNodeIds.clear()

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

            // addConnectionHandlesToNode(nodeEl, node.nodeId)
            viewportEl.appendChild(nodeEl)

            // Register after insertion so bounds are measurable
            connectionManager?.registerNodeElement(node.nodeId, nodeEl as HTMLDivElement)
        }

        // Ensure edges render after a full rerender
        connectionManager?.syncNodes(currentCanvasState.nodes)
        connectionManager?.syncEdges(currentCanvasState.edges)
        scheduleEdgesRender()

        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

        // Re-derive anchored image state from `generatedBy` metadata.
        // The anchoredImageManager is in-memory only, so on page refresh
        // it starts empty. We must scan ImageCanvasNodes that carry
        // generatedBy metadata and re-register them as anchored.
        if (!webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) {
            // Build a lookup: threadReferenceId → threadCanvasNode
            const threadNodesByRef = new Map<string, AiChatThreadCanvasNode>()
            for (const n of currentCanvasState.nodes) {
                if (n.type === 'aiChatThread') {
                    threadNodesByRef.set((n as AiChatThreadCanvasNode).referenceId, n as AiChatThreadCanvasNode)
                }
            }

            for (const node of currentCanvasState.nodes) {
                if (node.type !== 'image') continue
                const imgNode = node as ImageCanvasNode
                if (!imgNode.generatedBy) continue

                const threadCanvasNode = threadNodesByRef.get(imgNode.generatedBy.aiChatThreadId)
                if (!threadCanvasNode) continue

                // Already tracked (e.g. re-render during live session) — skip re-registration
                if (anchoredImageManager.isAnchored(imgNode.nodeId)) continue

                // Use responseMessageId persisted in generatedBy metadata.
                // This is the ProseMirror node `id` of the response message that
                // triggered image generation — set during onImageCompleteToCanvas.
                const responseMessageId = imgNode.generatedBy.responseMessageId || ''

                anchoredImageManager.anchorImage({
                    imageNodeId: imgNode.nodeId,
                    threadNodeId: threadCanvasNode.nodeId,
                    threadReferenceId: threadCanvasNode.referenceId,
                    responseMessageId,
                    imageHeight: imgNode.dimensions.height,
                })
            }

            // Now apply CSS classes and bring anchored images to front
            for (const node of currentCanvasState.nodes) {
                if (node.type !== 'image') continue
                if (!anchoredImageManager.isAnchored(node.nodeId)) continue

                const imgEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement
                if (imgEl) {
                    imgEl.classList.add('workspace-image-node--anchored')
                    nodeLayerManager.bringToFront(imgEl)
                }
            }

            // Apply anchored image spacing to push messages below images
            const threadsWithAnchors = new Set<string>()
            for (const node of currentCanvasState.nodes) {
                if (node.type !== 'image') continue
                const anchor = anchoredImageManager.getAnchor(node.nodeId)
                if (anchor) threadsWithAnchors.add(anchor.threadNodeId)
            }
            for (const tid of threadsWithAnchors) {
                applyAnchoredImageSpacing(tid)
            }
        }

        // Auto-size all thread nodes to fit their content after initial render
        for (const node of currentCanvasState.nodes) {
            if (node.type === 'aiChatThread') {
                scheduleThreadAutoGrow(node.nodeId)
            }
        }
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
    initCanvasBubbleMenu()
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
            if (anchoredRealignRaf !== null) {
                cancelAnimationFrame(anchoredRealignRaf)
                anchoredRealignRaf = null
            }
            pendingAnchoredRealignThreadNodeIds.clear()
            if (autoGrowRaf !== null) {
                cancelAnimationFrame(autoGrowRaf)
                autoGrowRaf = null
            }
            pendingAutoGrowThreadNodeIds.clear()
            hiddenEmptyThreadNodeIds.clear()
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
            for (const [threadId, { editor, aiService, gradientCleanup }] of threadEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
                if (gradientCleanup) gradientCleanup()
                promptInputController.unregisterThreadEditor(threadId)
            }
            threadEditors.clear()
            canvasImageLifecycle.destroy()
            canvasBubbleMenu?.destroy()
            canvasBubbleMenu = null

            // Clean up floating input
            if (floatingInputEditor?.destroy) floatingInputEditor.destroy()
            floatingInputGradient?.destroy()
            floatingInputEl?.remove()
            floatingInputEl = null
            floatingInputEditor = null
            floatingInputGradient = null

            // Clean up per-thread floating inputs
            destroyAllThreadFloatingInputs()

            // Clean up per-thread vertical rails
            destroyAllThreadRails()

            promptInputController.destroy()
        }
    }
}
