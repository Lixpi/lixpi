'use strict'

// Workspace canvas view. Builds the floating toolbar chrome and canvas mount
// points, wires the framework-agnostic `createWorkspaceCanvas` renderer, and
// mirrors the store-driven derivations imperatively. Renderer: TypeScript `html`
// DOM, no framework runtime.

import { type Viewport } from '@xyflow/system'
import {
    LoadingStatus,
    MAX_UPLOAD_FILE_SIZE,
    type CanvasState,
    type DocumentCanvasNode,
    type DocumentMediaCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type AudioCanvasNode,
    type OperationStatusCanvasNode,
    type MediaKind,
} from '@lixpi/constants'

import { html } from '$src/utils/domTemplates.ts'
import { createWorkspaceCanvas } from '$src/infographics/workspace/WorkspaceCanvas.ts'
import {
    getStashedViewportStorageKey,
    encodeStashedViewport,
    parseStashedViewport,
    shouldApplyStashedViewport,
} from '$src/components/workspaceViewportStash.ts'
import { rebaseCanvasMembershipState } from '$src/infographics/workspace/canvasMembershipStateRebase.ts'
import AssetService from '$src/services/asset-service.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { assetDocumentsStore, type AssetDocumentSnapshot } from '$src/stores/assetDocumentsStore.ts'
import { routerStore } from '$src/stores/routerStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { createNewFileIcon, imageIcon, mediaFoloderIcon } from '@lixpi/ui-kit/svg'
import '$src/infographics/workspace/workspace-canvas.scss'
import '$src/infographics/workspace/media-library-panel.scss'

type PersistCanvasStateOptions = {
    persistViewport?: boolean
    viewportOverride?: Viewport
}

type AssetAttachResponse = {
    error?: unknown
    assetId?: unknown
    nodeIds?: unknown
}

type AssetDetachResponse = {
    error?: unknown
    success?: unknown
}

type WorkspaceDocument = {
    documentId: string
    assetId: string
    workspaceId: string
    title: string
    content: object | undefined
    proseMirrorVersion: number
    revision: number
    organizationId: string
}

type WorkspaceAiChatThread = {
    threadId: string
    assetId: string
    workspaceId: string
    title: string
    content: object | undefined
    proseMirrorVersion: number
    status: string
    revision: number
    organizationId: string
    createdAt: number
    updatedAt: number
}

export type WorkspaceCanvasViewInstance = {
    el: HTMLElement
    destroy: () => void
}

export const createWorkspaceCanvasView = (): WorkspaceCanvasViewInstance => {
    let renderer: ReturnType<typeof createWorkspaceCanvas> | null = null

    // Store-derived values, recomputed imperatively whenever a source store changes.
    let workspaceId = ''
    let loadedWorkspaceId: string | null = null
    let isRouteWorkspaceLoaded = false
    let canvasState: CanvasState | null = null
    let isRightSidePanelOpen = false
    let documents: WorkspaceDocument[] = []
    let aiChatThreads: WorkspaceAiChatThread[] = []
    let assetDocuments = new Map<string, AssetDocumentSnapshot>()

    // Local UI state.
    let viewport: Viewport = { x: 0, y: 0, zoom: 1 }
    let imageSubmenuOpen = false
    let imageSubmenuMode: 'menu' | 'url' = 'menu'
    let imageUrlValue = ''

    let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let transientCanvasMutationInProgress = false
    let pendingViewportSave: Viewport | null = null
    let lastPersistedViewport: Viewport | null = null
    const assetService = new AssetService()
    const DEFAULT_DOCUMENT_NODE_DIMENSIONS = { width: 400, height: 350 }
    const rightSidePanelSettings = settings.rightSidePanel
    const modelMenuHoverBackgroundStyle = `--ai-prompt-model-menu-trigger-active-background: ${settings.aiPromptInput.modelMenu.styles.triggerActiveBackground}`
    const rightSidePanelStyle = [
        `--workspace-right-side-panel-width: min(${rightSidePanelSettings.defaultDimensions.width}px, calc(100vw - ${rightSidePanelSettings.dimensions.maxPaneMargin}px))`,
        '--side-panel-backdrop-width: var(--workspace-right-side-panel-width)',
        `--workspace-right-side-panel-content-inset: ${rightSidePanelSettings.layout.contentInset}px`,
        `--workspace-right-sidebar-content-font-size: ${rightSidePanelSettings.typography.contentFontSize}px`,
        `--workspace-right-sidebar-tag-pill-font-size: ${rightSidePanelSettings.typography.tagPillFontSize}px`,
        `--workspace-right-sidebar-tag-pill-font-weight: ${rightSidePanelSettings.typography.tagPillFontWeight}`,
        `--side-panel-backdrop-fill: ${rightSidePanelSettings.styles.backdropFill}`,
        `--side-panel-backdrop-fill-opaque: ${rightSidePanelSettings.styles.backdropFillOpaque}`,
        `--side-panel-toggle-color: ${rightSidePanelSettings.styles.toggleColor}`,
        `--side-panel-toggle-hover-color: ${rightSidePanelSettings.styles.toggleHoverColor}`,
    ].join('; ')

    // DOM refs (equivalent to Svelte `bind:this`). `paneEl` is the outer pane and
    // `viewportEl` the inner viewport, matching what `createWorkspaceCanvas` expects.
    const viewportEl = html`<div className="workspace-viewport"></div>` as HTMLDivElement
    const paneEl = html`<div className="workspace-pane"></div>` as HTMLDivElement
    paneEl.append(viewportEl)
    const mediaModeSwitchMountEl = html`<div className="workspace-canvas-media-mode-panel"></div>` as HTMLDivElement
    const modelMenuControlMountEl = html`<div className="workspace-canvas-model-menu-panel"></div>` as HTMLDivElement
    const imageWrapperEl = html`<div className="workspace-floating-toolbar-image-wrapper"></div>` as HTMLDivElement
    const zoomIndicatorEl = html`<span className="workspace-zoom-indicator"></span>` as HTMLSpanElement
    const fileInputEl = html`
        <input
            type="file"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.ppt,.pptx,.odt,.rtf,.txt,.md"
            style="display: none"
        />
    ` as HTMLInputElement

    function getImageInsertionDimensions(aspectRatio: number): { width: number; height: number } {
        const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
        const width = settings.mediaNode.image.defaultInsertionWidth
        return { width, height: width / safeAspectRatio }
    }

    function getCanvasMembershipResponseError(response: unknown): string | null {
        if (!response || typeof response !== 'object') return 'INVALID_CANVAS_MEMBERSHIP_RESPONSE'
        const error = (response as { error?: unknown }).error
        if (error === undefined) return null
        return typeof error === 'string' && error ? error : 'INVALID_CANVAS_MEMBERSHIP_RESPONSE'
    }

    function assertAssetAttached(response: unknown, assetId: string, nodeId: string): void {
        const responseError = getCanvasMembershipResponseError(response)
        if (responseError) throw new Error(responseError)

        const attached = response as AssetAttachResponse
        if (attached.assetId !== assetId
            || !Array.isArray(attached.nodeIds)
            || !attached.nodeIds.includes(nodeId)) {
            throw new Error('INVALID_ASSET_ATTACH_RESPONSE')
        }
    }

    function assertAssetDetached(response: unknown): void {
        const responseError = getCanvasMembershipResponseError(response)
        if (responseError) throw new Error(responseError)
        if ((response as AssetDetachResponse).success !== true) {
            throw new Error('INVALID_ASSET_DETACH_RESPONSE')
        }
    }

    function getNextCanvasMembershipRevision(expectedCanvasStateUpdatedAt: number): number {
        return Math.max(Date.now(), expectedCanvasStateUpdatedAt + 1)
    }

    async function runCanvasMembershipMutation<Result>(
        targetWorkspaceId: string,
        mutation: () => Promise<Result>,
    ): Promise<Result> {
        const workspaceService = servicesStore.getData('workspaceService')
        if (!workspaceService || typeof workspaceService.runCanvasMembershipMutation !== 'function') {
            throw new Error('CANVAS_WRITE_COORDINATOR_UNAVAILABLE')
        }
        return await workspaceService.runCanvasMembershipMutation({
            workspaceId: targetWorkspaceId,
            mutation,
        })
    }

    function commitCanvasMembershipState(nextCanvasState: CanvasState, canvasStateUpdatedAt: number): void {
        workspaceStore.updateCanvasState(nextCanvasState)
        workspaceStore.setDataValues({ canvasStateUpdatedAt, updatedAt: canvasStateUpdatedAt })
    }

    function rebaseRequestedCanvasMembershipState(
        requestedState: CanvasState,
        operation: 'attach' | 'detach',
        removedNodeIds: readonly string[] = [],
    ): CanvasState {
        return rebaseCanvasMembershipState({
            requestedState,
            currentState: renderer?.getCanvasState(),
            operation,
            removedNodeIds,
        })
    }

    function cloneViewport(viewportValue: Viewport | null | undefined): Viewport | null {
        if (!viewportValue) return null
        if (!Number.isFinite(viewportValue.x) || !Number.isFinite(viewportValue.y) || !Number.isFinite(viewportValue.zoom)) return null
        return {
            x: viewportValue.x,
            y: viewportValue.y,
            zoom: viewportValue.zoom
        }
    }

    function viewportsMatch(a: Viewport | null | undefined, b: Viewport | null | undefined): boolean {
        if (!a || !b) return false
        return Math.abs(a.x - b.x) < 0.001 &&
            Math.abs(a.y - b.y) < 0.001 &&
            Math.abs(a.zoom - b.zoom) < 0.0001
    }

    function getCanvasStateViewport(newCanvasState: CanvasState, options: PersistCanvasStateOptions): Viewport {
        return cloneViewport(options.viewportOverride)
            ?? cloneViewport(newCanvasState.viewport)
            ?? cloneViewport(renderer?.getViewport?.())
            ?? cloneViewport(viewport)
            ?? { x: 0, y: 0, zoom: 1 }
    }

    function getCanvasStateForViewportSave(savedViewport: Viewport): CanvasState | null {
        const liveCanvasState = renderer?.getCanvasState?.() ?? canvasState
        if (!liveCanvasState) return null

        return {
            ...liveCanvasState,
            viewport: savedViewport
        }
    }

    function persistCanvasState(newCanvasState: CanvasState, options: PersistCanvasStateOptions = {}) {
        if (!workspaceId || loadedWorkspaceId !== workspaceId) return

        const stateViewport = getCanvasStateViewport(newCanvasState, options)
        const stateToPersist = {
            ...newCanvasState,
            viewport: stateViewport,
        }

        workspaceStore.updateCanvasState(stateToPersist)
        if (transientCanvasMutationInProgress) return
        if (workspaceId) {
            servicesStore.getData('workspaceService').updateCanvasState({
                workspaceId,
                canvasState: stateToPersist,
                persistViewport: options.persistViewport === true
            })
        }
    }

    function persistViewportState(savedViewport: Viewport): boolean {
        const viewportToPersist = cloneViewport(savedViewport)
        if (!viewportToPersist) return false
        if (viewportsMatch(viewportToPersist, lastPersistedViewport)) return true

        const stateToPersist = getCanvasStateForViewportSave(viewportToPersist)
        if (!stateToPersist) return false

        persistCanvasState(stateToPersist, {
            persistViewport: true,
            viewportOverride: viewportToPersist
        })
        lastPersistedViewport = viewportToPersist
        return true
    }

    function stashPendingViewportForUnload(): void {
        if (!workspaceId || !pendingViewportSave) return
        if (viewportsMatch(pendingViewportSave, lastPersistedViewport)) return
        // A hard reload can kill the page before the debounced network save
        // lands, so stash the viewport locally as well as flushing it.
        try {
            localStorage.setItem(
                getStashedViewportStorageKey(workspaceId),
                encodeStashedViewport(pendingViewportSave),
            )
        } catch {
            // Storage unavailable; the network flush below is still attempted.
        }
        persistViewportState(pendingViewportSave)
    }

    function restoreStashedViewport(targetWorkspaceId: string): void {
        const storageKey = getStashedViewportStorageKey(targetWorkspaceId)
        let raw: string | null = null
        try {
            raw = localStorage.getItem(storageKey)
            if (raw) localStorage.removeItem(storageKey)
        } catch {
            return
        }

        const stashedViewport = parseStashedViewport(raw)
        if (!stashedViewport) return
        if (!shouldApplyStashedViewport(stashedViewport, canvasState?.viewport)) return

        viewport = stashedViewport
        updateZoomIndicator()
        renderer?.setViewport(stashedViewport)
        persistViewportState(stashedViewport)
    }

    function handleViewportChange(newViewport: Viewport) {
        const nextViewport = cloneViewport(newViewport)
        if (!nextViewport) return

        viewport = nextViewport
        updateZoomIndicator()
        pendingViewportSave = nextViewport

        const shouldPersistLeading = saveDebounceTimer === null
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
        if (shouldPersistLeading) persistViewportState(nextViewport)

        const scheduledViewport = nextViewport
        const scheduledWorkspaceId = workspaceId
        saveDebounceTimer = setTimeout(() => {
            saveDebounceTimer = null
            if (
                viewport.x !== scheduledViewport.x ||
                viewport.y !== scheduledViewport.y ||
                viewport.zoom !== scheduledViewport.zoom
            ) return

            if (scheduledWorkspaceId && loadedWorkspaceId === scheduledWorkspaceId && workspaceId === scheduledWorkspaceId && canvasState) {
                if (persistViewportState(scheduledViewport)) pendingViewportSave = null
            }
        }, 1000)
    }

    async function handleCreateDocument() {
        const targetWorkspaceId = workspaceId
        if (!targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) {
            console.error('No workspaceId available!')
            return
        }

        try {
            const organizationId = workspaceStore.getData('organizationId')
            const doc = await assetService.create({
                organizationId,
                workspaceId: targetWorkspaceId,
                title: 'New Document',
                primaryCategory: 'document',
            })

            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            if (doc) {
                const dimensions = { ...DEFAULT_DOCUMENT_NODE_DIMENSIONS }
                const documentNode: Omit<DocumentCanvasNode, 'position'> = {
                    nodeId: `node-${crypto.randomUUID()}`,
                    type: 'document',
                    assetId: doc.assetId,
                    dimensions,
                }
                await runCanvasMembershipMutation(targetWorkspaceId, async () => {
                    if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) {
                        throw new Error('WORKSPACE_CHANGED_DURING_CANVAS_MUTATION')
                    }
                    const nextCanvasState = renderer?.insertNodeAtViewportCenter(documentNode, {}, false)
                    const expectedCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
                    if (!nextCanvasState || typeof expectedCanvasStateUpdatedAt !== 'number') {
                        throw new Error('CANVAS_REVISION_REQUIRED')
                    }
                    const canvasStateUpdatedAt = getNextCanvasMembershipRevision(expectedCanvasStateUpdatedAt)
                    const response = await assetService.attach({
                        assetId: doc.assetId,
                        workspaceId: targetWorkspaceId,
                        nodeId: documentNode.nodeId,
                        workspaceMutation: {
                            expectedCanvasStateUpdatedAt,
                            canvasStateUpdatedAt,
                            canvasState: nextCanvasState,
                        },
                    })
                    assertAssetAttached(response, doc.assetId, documentNode.nodeId)
                    renderer?.commitTransientCanvasState(nextCanvasState)
                    commitCanvasMembershipState(nextCanvasState, canvasStateUpdatedAt)
                })
            }
        } catch (error) {
            console.error('Error creating document:', error)
        }
    }

    const API_BASE_URL = import.meta.env.VITE_API_URL || ''

    function toggleImageSubmenu() {
        imageSubmenuOpen = !imageSubmenuOpen
        imageSubmenuMode = 'menu'
        imageUrlValue = ''
        renderImageSubmenu()
    }

    function closeImageSubmenu() {
        imageSubmenuOpen = false
        imageSubmenuMode = 'menu'
        imageUrlValue = ''
        renderImageSubmenu()
    }

    function handleUploadFromDevice() {
        fileInputEl?.click()
    }

    function handleFileInputChange(e: Event) {
        const input = e.target as HTMLInputElement
        if (input.files && input.files.length > 0) {
            closeImageSubmenu()
            uploadAndAddFile(input.files[0])
            input.value = ''
        }
    }

    type IngestResult = {
        status: 'processing'
        assetId: string
        kind: MediaKind
        originalUrl: string
    }

    function getUploadPlaceholderNodeId(): string {
        const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        return `upload-${randomId}`
    }

    function insertUploadPlaceholder(fileName: string): string | null {
        const nodeId = getUploadPlaceholderNodeId()
        const now = Date.now()
        const placeholderNode: Omit<OperationStatusCanvasNode, 'position'> = {
            nodeId,
            type: 'operationStatus',
            operation: 'upload',
            title: fileName,
            status: 'in-progress',
            message: 'Creating a supported copy before adding it to the canvas.',
            dimensions: { width: 360, height: 84 },
            createdAt: now,
            updatedAt: now,
        }
        transientCanvasMutationInProgress = true
        renderer?.insertNodeAtViewportCenter(placeholderNode)
        transientCanvasMutationInProgress = false
        return renderer ? nodeId : null
    }

    function markUploadPlaceholderFailed(placeholderNodeId: string | null, message: string) {
        if (!placeholderNodeId) return
        renderer?.markUploadPlaceholderFailed(placeholderNodeId, message)
    }

    function getRemotePlaceholderName(url: string): string {
        try {
            return new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'Remote file'
        } catch {
            return 'Remote file'
        }
    }

    async function handleImageUrlInsert() {
        const url = imageUrlValue.trim()
        const targetWorkspaceId = workspaceId
        if (!url || !targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

        let placeholderNodeId: string | null = null
        try {
            const token = await AuthService.getTokenSilently()
            if (!token) return

            placeholderNodeId = insertUploadPlaceholder(getRemotePlaceholderName(url))
            const response = await fetch(`${API_BASE_URL}/api/assets/workspaces/${targetWorkspaceId}/import-url`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            })

            const data = await response.json()
            if (!response.ok) {
                markUploadPlaceholderFailed(placeholderNodeId, data?.error || 'File URL import failed')
                return
            }
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            closeImageSubmenu()
            await addAssetToCanvas(data, targetWorkspaceId, placeholderNodeId)
        } catch (error) {
            console.error('File URL import failed:', error)
            markUploadPlaceholderFailed(placeholderNodeId, 'File URL import failed')
        }
    }

    // Generalized device upload — accepts ANY file. The client no longer
    // pre-rejects by MIME (the server sniffs the bytes); it only enforces the
    // size ceiling and surfaces the server's specific rejection inline.
    async function uploadAndAddFile(file: File) {
        const targetWorkspaceId = workspaceId
        if (!targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

        let placeholderNodeId: string | null = null
        // Show the failure on the canvas placeholder, never in the picker menu.
        if (file.size > MAX_UPLOAD_FILE_SIZE) {
            placeholderNodeId = insertUploadPlaceholder(file.name)
            markUploadPlaceholderFailed(placeholderNodeId, 'File is too large.')
            return
        }

        try {
            const token = await AuthService.getTokenSilently()
            if (!token) return

            placeholderNodeId = insertUploadPlaceholder(file.name)
            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch(`${API_BASE_URL}/api/assets/workspaces/${targetWorkspaceId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            })

            const data = await response.json()
            if (!response.ok) {
                markUploadPlaceholderFailed(placeholderNodeId, data?.error || 'Upload failed')
                return
            }
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            await addAssetToCanvas(data, targetWorkspaceId, placeholderNodeId)
        } catch (error) {
            console.error('File upload failed:', error)
            markUploadPlaceholderFailed(placeholderNodeId, 'Upload failed')
        }
    }

    async function addAssetToCanvas(result: IngestResult, targetWorkspaceId: string, placeholderNodeId: string | null = null) {
        if (!targetWorkspaceId || workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return
        const asset = await assetService.refresh(result.assetId)
        if ('error' in asset) throw new Error(asset.error)
        const nodeId = `node-${crypto.randomUUID()}`
        const type = result.kind === 'document' ? 'mediaDocument' : result.kind
        const dimensions = result.kind === 'audio'
            ? { width: 360, height: 96 }
            : getImageInsertionDimensions(result.kind === 'document' ? 0.7727 : 1)
        const node = { nodeId, type, assetId: result.assetId, dimensions } as Omit<
            ImageCanvasNode | VideoCanvasNode | AudioCanvasNode | DocumentMediaCanvasNode,
            'position'
        >
        await runCanvasMembershipMutation(targetWorkspaceId, async () => {
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) {
                throw new Error('WORKSPACE_CHANGED_DURING_CANVAS_MUTATION')
            }
            const replacedState = placeholderNodeId ? renderer?.replaceUploadPlaceholder(placeholderNodeId, node, false) : null
            const nextCanvasState = replacedState ?? renderer?.insertNodeAtViewportCenter(node, {}, false)
            const expectedCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
            if (!nextCanvasState || typeof expectedCanvasStateUpdatedAt !== 'number') {
                throw new Error('CANVAS_REVISION_REQUIRED')
            }
            const canvasStateUpdatedAt = getNextCanvasMembershipRevision(expectedCanvasStateUpdatedAt)
            const response = await assetService.attach({
                assetId: result.assetId,
                workspaceId: targetWorkspaceId,
                nodeId,
                workspaceMutation: {
                    expectedCanvasStateUpdatedAt,
                    canvasStateUpdatedAt,
                    canvasState: nextCanvasState,
                },
            })
            assertAssetAttached(response, result.assetId, nodeId)
            renderer?.commitTransientCanvasNodeInsertion(nextCanvasState, nodeId, placeholderNodeId ?? undefined)
            commitCanvasMembershipState(nextCanvasState, canvasStateUpdatedAt)
        })
    }

    function handleToggleMediaLibrary() {
        renderer?.toggleMediaLibrary?.()
    }

    // Recompute the store-derived values that the Svelte `$derived` runes used to track.
    function recompute(): void {
        workspaceId = routerStore.getData('currentRoute').routeParams.workspaceId as string
        loadedWorkspaceId = workspaceStore.getData('workspaceId')
        isRouteWorkspaceLoaded = Boolean(workspaceId && loadedWorkspaceId === workspaceId)
        canvasState = isRouteWorkspaceLoaded && workspaceStore.getMeta('loadingStatus') === LoadingStatus.success
            ? workspaceStore.getData('canvasState')
            : null
        isRightSidePanelOpen = Boolean(isRouteWorkspaceLoaded && (canvasState?.aiChatPanel?.isOpen ?? canvasState?.lastActiveConversationAssetId))

        const assets = isRouteWorkspaceLoaded ? assetsStore.getAll() : []
        documents = assets
            .filter((asset) => Boolean(asset?.documents?.content))
            .map((asset) => ({
                documentId: asset.assetId,
                assetId: asset.assetId,
                workspaceId,
                title: asset.title,
                content: assetDocuments.get(`${asset.assetId}#content`)?.doc,
                proseMirrorVersion: asset.documents.content?.version ?? 0,
                revision: asset.revision,
                organizationId: asset.organizationId,
            }))
        aiChatThreads = assets
            .filter((asset) => Boolean(asset?.documents?.conversation))
            .map((asset) => ({
                threadId: asset.assetId,
                assetId: asset.assetId,
                workspaceId,
                title: asset.title,
                content: assetDocuments.get(`${asset.assetId}#conversation`)?.doc,
                proseMirrorVersion: asset.documents.conversation?.version ?? 0,
                status: asset.states.conversation === 'none' ? 'idle' : asset.states.conversation,
                revision: asset.revision,
                organizationId: asset.organizationId,
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
            }))
    }

    function updateZoomIndicator(): void {
        zoomIndicatorEl.textContent = `${Math.round(viewport.zoom * 100)}%`
    }

    function updateRightSidePanelClass(): void {
        rootEl.classList.toggle('workspace-canvas-right-side-panel-open', isRightSidePanelOpen)
    }

    // Equivalent to the Svelte `$effect` that clicked outside the image submenu.
    let removeImageSubmenuOutsideClick: (() => void) | null = null
    function updateImageSubmenuOutsideClick(): void {
        if (imageSubmenuOpen && !removeImageSubmenuOutsideClick) {
            function handleClickOutside(e: MouseEvent) {
                const target = e.target as Node
                if (!document.contains(target)) return
                if (imageWrapperEl && !imageWrapperEl.contains(target)) {
                    closeImageSubmenu()
                }
            }
            const timer = setTimeout(() => document.addEventListener('click', handleClickOutside), 0)
            removeImageSubmenuOutsideClick = () => {
                clearTimeout(timer)
                document.removeEventListener('click', handleClickOutside)
            }
        } else if (!imageSubmenuOpen && removeImageSubmenuOutsideClick) {
            removeImageSubmenuOutsideClick()
            removeImageSubmenuOutsideClick = null
        }
    }

    function renderImageSubmenu(): void {
        imageButton.classList.toggle('active', imageSubmenuOpen)

        const existing = imageWrapperEl.querySelector('.workspace-image-submenu')
        existing?.remove()

        if (!imageSubmenuOpen) {
            updateImageSubmenuOutsideClick()
            return
        }

        let submenu: HTMLElement
        if (imageSubmenuMode === 'menu') {
            submenu = html`
                <div className="workspace-image-submenu">
                    <button className="workspace-image-submenu-option" onclick=${handleUploadFromDevice}>Upload from Device</button>
                    <button className="workspace-image-submenu-option" onclick=${() => { imageSubmenuMode = 'url'; renderImageSubmenu() }}>Paste Image URL</button>
                </div>
            ` as HTMLElement
        } else {
            const urlInput = html`
                <input
                    type="url"
                    className="workspace-image-submenu-url-input"
                    placeholder="https://example.com/image.jpg"
                    onkeydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') handleImageUrlInsert() }}
                    oninput=${(e: Event) => { imageUrlValue = (e.target as HTMLInputElement).value }}
                />
            ` as HTMLInputElement
            urlInput.value = imageUrlValue
            submenu = html`
                <div className="workspace-image-submenu">
                    <div className="workspace-image-submenu-url-form">
                        ${urlInput}
                        <div className="workspace-image-submenu-url-actions">
                            <button className="workspace-image-submenu-url-back" onclick=${() => { imageSubmenuMode = 'menu'; renderImageSubmenu() }}>Back</button>
                            <button className="workspace-image-submenu-url-insert" onclick=${handleImageUrlInsert}>Add</button>
                        </div>
                    </div>
                </div>
            ` as HTMLElement
        }
        imageWrapperEl.append(submenu)
        updateImageSubmenuOutsideClick()
    }

    // Equivalent to the Svelte `$effect` guarding workspace synchronization.
    let syncedWorkspaceId: string | null = null
    let stopWorkspaceSynchronization: (() => void) | void = undefined
    function updateWorkspaceSynchronization(): void {
        const shouldSync = Boolean(workspaceId && loadedWorkspaceId === workspaceId)
        if (shouldSync && syncedWorkspaceId !== workspaceId) {
            if (typeof stopWorkspaceSynchronization === 'function') stopWorkspaceSynchronization()
            syncedWorkspaceId = workspaceId
            stopWorkspaceSynchronization = assetService.startWorkspaceSynchronization(workspaceId)
        } else if (!shouldSync && syncedWorkspaceId !== null) {
            if (typeof stopWorkspaceSynchronization === 'function') stopWorkspaceSynchronization()
            stopWorkspaceSynchronization = undefined
            syncedWorkspaceId = null
        }
    }

    // Equivalent to the Svelte `$effect` that re-rendered the canvas on data change.
    function runRenderEffect(): void {
        if (renderer) {
            renderer.render(canvasState, documents, aiChatThreads, workspaceId)
            const liveViewport = renderer.getViewport()
            viewport = liveViewport
            updateZoomIndicator()
            if (!pendingViewportSave && viewportsMatch(liveViewport, canvasState?.viewport)) {
                lastPersistedViewport = liveViewport
            }
        } else if (canvasState?.viewport) {
            const loadedViewport = cloneViewport(canvasState.viewport)
            if (loadedViewport) {
                viewport = loadedViewport
                updateZoomIndicator()
                if (!pendingViewportSave) lastPersistedViewport = loadedViewport
            }
        }
    }

    // Equivalent to the Svelte `$effect` that restored a stashed viewport once per workspace.
    let stashRestoredWorkspaceId: string | null = null
    function runStashRestoreEffect(): void {
        if (!workspaceId || loadedWorkspaceId !== workspaceId || !canvasState) return
        if (stashRestoredWorkspaceId === workspaceId) return
        stashRestoredWorkspaceId = workspaceId
        restoreStashedViewport(workspaceId)
    }

    function reconcile(): void {
        updateRightSidePanelClass()
        updateWorkspaceSynchronization()
        runRenderEffect()
        runStashRestoreEffect()
    }

    // Chrome markup (equivalent to the Svelte template).
    const imageButton = html`
        <button
            className="workspace-floating-toolbar-button"
            aria-label="Add Image"
            data-help-tooltip="aria-label"
            onclick=${toggleImageSubmenu}
            innerHTML=${imageIcon}
        ></button>
    ` as HTMLButtonElement
    imageWrapperEl.append(imageButton)

    const rootEl = html`
        <div className="workspace-canvas" style=${rightSidePanelStyle}>
            <div className="workspace-canvas-left-control-rail">
                <div className="workspace-canvas-action-panel workspace-canvas-action-panel-left">
                    <button
                        className="workspace-floating-toolbar-button"
                        aria-label="New Document"
                        data-help-tooltip="aria-label"
                        onclick=${handleCreateDocument}
                        innerHTML=${createNewFileIcon}
                    ></button>
                    ${imageWrapperEl}
                </div>
                <div className="workspace-canvas-action-panel workspace-canvas-media-library-panel workspace-canvas-action-panel-single">
                    <button
                        className="workspace-floating-toolbar-button"
                        aria-label="Media Library"
                        data-help-tooltip="aria-label"
                        onclick=${handleToggleMediaLibrary}
                        innerHTML=${mediaFoloderIcon}
                    ></button>
                </div>
            </div>

            <div className="workspace-canvas-action-panel workspace-canvas-right-control-rail">
                <div
                    className="workspace-canvas-model-menu-hover-background"
                    aria-hidden="true"
                    style=${modelMenuHoverBackgroundStyle}
                ></div>
                ${mediaModeSwitchMountEl}
                ${modelMenuControlMountEl}
            </div>

            ${fileInputEl}
            ${zoomIndicatorEl}
            ${paneEl}
        </div>
    ` as HTMLElement

    fileInputEl.addEventListener('change', handleFileInputChange)

    // Initial derivation + mount (equivalent to `onMount`).
    recompute()
    updateZoomIndicator()
    updateRightSidePanelClass()
    window.addEventListener('pagehide', stashPendingViewportForUnload)

    const loadedViewport = cloneViewport(canvasState?.viewport)
    if (loadedViewport) {
        viewport = loadedViewport
        lastPersistedViewport = loadedViewport
        updateZoomIndicator()
    }

    renderer = createWorkspaceCanvas({
        paneEl,
        viewportEl,
        mediaModeSwitchMountEl,
        modelMenuControlMountEl,
        workspaceId,
        canvasState,
        documents,
        aiChatThreads,
        onViewportChange: handleViewportChange,
        onCanvasStateChange: persistCanvasState,
        onAuthoritativeCanvasStateChange: ({ canvasState: nextCanvasState, layoutRevision }) => {
            servicesStore.getData('workspaceService').adoptAuthoritativeCanvasState({
                workspaceId,
                canvasState: nextCanvasState,
                canvasStateUpdatedAt: layoutRevision,
            })
        },
        onDocumentContentChange: () => {},
        onAiChatThreadContentChange: () => {},
        onAssetDetach: async ({ assetId, nodeId, removedNodeIds, canvasState: requestedCanvasState }) => {
            return await runCanvasMembershipMutation(workspaceId, async () => {
                const nextCanvasState = rebaseRequestedCanvasMembershipState(
                    requestedCanvasState,
                    'detach',
                    removedNodeIds,
                )
                const expectedCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
                if (typeof expectedCanvasStateUpdatedAt !== 'number') throw new Error('CANVAS_REVISION_REQUIRED')
                const canvasStateUpdatedAt = getNextCanvasMembershipRevision(expectedCanvasStateUpdatedAt)
                const response = await assetService.detach({
                    assetId,
                    workspaceId,
                    nodeId,
                    workspaceMutation: {
                        expectedCanvasStateUpdatedAt,
                        canvasStateUpdatedAt,
                        canvasState: nextCanvasState,
                    },
                })
                assertAssetDetached(response)
                commitCanvasMembershipState(nextCanvasState, canvasStateUpdatedAt)
                return nextCanvasState
            })
        },
        onAssetAttach: async ({ assetId, nodeId, canvasState: requestedCanvasState }) => {
            return await runCanvasMembershipMutation(workspaceId, async () => {
                const nextCanvasState = rebaseRequestedCanvasMembershipState(requestedCanvasState, 'attach')
                const expectedCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
                if (typeof expectedCanvasStateUpdatedAt !== 'number') throw new Error('CANVAS_REVISION_REQUIRED')
                const canvasStateUpdatedAt = getNextCanvasMembershipRevision(expectedCanvasStateUpdatedAt)
                const response = await assetService.attach({
                    assetId,
                    workspaceId,
                    nodeId,
                    workspaceMutation: {
                        expectedCanvasStateUpdatedAt,
                        canvasStateUpdatedAt,
                        canvasState: nextCanvasState,
                    },
                })
                assertAssetAttached(response, assetId, nodeId)
                commitCanvasMembershipState(nextCanvasState, canvasStateUpdatedAt)
                return nextCanvasState
            })
        },
    })

    reconcile()

    // Store subscriptions replace the Svelte reactive graph. `listen` fires only on
    // change; the initial state was already read by the `recompute()` above.
    const handleStoreChange = () => {
        recompute()
        reconcile()
    }
    const unsubscribers = [
        routerStore.subscribe(() => handleStoreChange()),
        workspaceStore.subscribe(() => handleStoreChange()),
        assetsStore.subscribe(() => handleStoreChange()),
        assetDocumentsStore.subscribe((docs) => {
            assetDocuments = docs
            handleStoreChange()
        }),
    ]

    const destroy = (): void => {
        for (const unsubscribe of unsubscribers) unsubscribe()
        removeImageSubmenuOutsideClick?.()
        if (typeof stopWorkspaceSynchronization === 'function') stopWorkspaceSynchronization()
        window.removeEventListener('pagehide', stashPendingViewportForUnload)
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer)
            saveDebounceTimer = null
        }
        if (pendingViewportSave && !viewportsMatch(pendingViewportSave, lastPersistedViewport)) {
            persistViewportState(pendingViewportSave)
        }
        pendingViewportSave = null
        renderer?.destroy()
        rootEl.remove()
    }

    return { el: rootEl, destroy }
}
