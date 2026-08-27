<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import {
        type Viewport
    } from '@xyflow/system'
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
        type MediaKind
    } from '@lixpi/constants'

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
    import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
    import { userStore } from '$src/stores/userStore.ts'
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

    let paneEl: HTMLDivElement
    let viewportEl: HTMLDivElement
    let renderer: ReturnType<typeof createWorkspaceCanvas> | null = null

    function handleToggleMediaLibrary() {
        renderer?.toggleMediaLibrary?.()
    }

    let workspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId as string)
    let loadedWorkspaceId = $derived($workspaceStore.data.workspaceId)
    let isRouteWorkspaceLoaded = $derived(Boolean(workspaceId && loadedWorkspaceId === workspaceId))
    let canvasState = $derived(isRouteWorkspaceLoaded && $workspaceStore.meta.loadingStatus === LoadingStatus.success ? $workspaceStore.data.canvasState : null)
    let isRightSidePanelOpen = $derived(Boolean(isRouteWorkspaceLoaded && (canvasState?.aiChatPanel?.isOpen ?? canvasState?.lastActiveConversationAssetId)))
    let documents = $derived(isRouteWorkspaceLoaded ? Array.from($assetsStore.items.values())
        .filter((asset) => Boolean(asset?.documents?.content))
        .map((asset) => ({
            documentId: asset.assetId,
            assetId: asset.assetId,
            workspaceId,
            title: asset.title,
            content: $assetDocumentsStore.get(`${asset.assetId}#content`)?.doc,
            proseMirrorVersion: asset.documents.content?.version ?? 0,
            revision: asset.revision,
            organizationId: asset.organizationId,
        })) : [])
    let aiChatThreads = $derived(isRouteWorkspaceLoaded ? Array.from($assetsStore.items.values())
        .filter((asset) => Boolean(asset?.documents?.conversation))
        .map((asset) => ({
            threadId: asset.assetId,
            assetId: asset.assetId,
            workspaceId,
            title: asset.title,
            content: $assetDocumentsStore.get(`${asset.assetId}#conversation`)?.doc,
            proseMirrorVersion: asset.documents.conversation?.version ?? 0,
            status: asset.states.conversation === 'none' ? 'idle' : asset.states.conversation,
            revision: asset.revision,
            organizationId: asset.organizationId,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
        })) : [])

    let viewport: Viewport = $state({ x: 0, y: 0, zoom: 1 })
    let imageSubmenuOpen = $state(false)
    let imageSubmenuMode: 'menu' | 'url' = $state('menu')
    let imageUrlValue = $state('')
    let imageWrapperEl: HTMLDivElement
    let mediaModeSwitchMountEl: HTMLDivElement
    let modelMenuControlMountEl: HTMLDivElement
    let fileInputEl: HTMLInputElement
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
        renderer?.setViewport(stashedViewport)
        persistViewportState(stashedViewport)
    }

    function handleViewportChange(newViewport: Viewport) {
        const nextViewport = cloneViewport(newViewport)
        if (!nextViewport) return

        viewport = nextViewport
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
    }

    function closeImageSubmenu() {
        imageSubmenuOpen = false
        imageSubmenuMode = 'menu'
        imageUrlValue = ''
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

    onMount(() => {
        if (!paneEl || !viewportEl) return

        window.addEventListener('pagehide', stashPendingViewportForUnload)


        const loadedViewport = cloneViewport(canvasState?.viewport)
        if (loadedViewport) {
            viewport = loadedViewport
            lastPersistedViewport = loadedViewport
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

    })

    $effect(() => {
        if (!imageSubmenuOpen) return

        function handleClickOutside(e: MouseEvent) {
            const target = e.target as Node
            if (!document.contains(target)) return
            if (imageWrapperEl && !imageWrapperEl.contains(target)) {
                closeImageSubmenu()
            }
        }

        setTimeout(() => document.addEventListener('click', handleClickOutside), 0)
        return () => document.removeEventListener('click', handleClickOutside)
    })

    $effect(() => {
        if (!workspaceId || loadedWorkspaceId !== workspaceId) return
        return assetService.startWorkspaceSynchronization(workspaceId)
    })

    $effect(() => {
        if (renderer) {
            renderer.render(canvasState, documents, aiChatThreads, workspaceId)
            const liveViewport = renderer.getViewport()
            viewport = liveViewport
            if (!pendingViewportSave && viewportsMatch(liveViewport, canvasState?.viewport)) {
                lastPersistedViewport = liveViewport
            }
        } else if (canvasState?.viewport) {
            const loadedViewport = cloneViewport(canvasState.viewport)
            if (loadedViewport) {
                viewport = loadedViewport
                if (!pendingViewportSave) lastPersistedViewport = loadedViewport
            }
        }
    })

    let stashRestoredWorkspaceId: string | null = null
    $effect(() => {
        if (!workspaceId || loadedWorkspaceId !== workspaceId || !canvasState) return
        if (stashRestoredWorkspaceId === workspaceId) return
        stashRestoredWorkspaceId = workspaceId
        restoreStashedViewport(workspaceId)
    })

    onDestroy(() => {
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
    })
</script>

<div
    class="workspace-canvas"
    class:workspace-canvas-right-side-panel-open={isRightSidePanelOpen}
    style={rightSidePanelStyle}
>
    <!-- The in-flow rail keeps the Media Library between the composer and upload panel. -->
    <div class="workspace-canvas-left-control-rail">
        <div class="workspace-canvas-action-panel workspace-canvas-action-panel-left">
            <button
                class="workspace-floating-toolbar-button"
                onclick={handleCreateDocument}
                aria-label="New Document"
                data-help-tooltip="aria-label"
            >
                {@html createNewFileIcon}
            </button>
            <div class="workspace-floating-toolbar-image-wrapper" bind:this={imageWrapperEl}>
                <button
                    class="workspace-floating-toolbar-button"
                    class:active={imageSubmenuOpen}
                    onclick={toggleImageSubmenu}
                    aria-label="Add Image"
                    data-help-tooltip="aria-label"
                >
                    {@html imageIcon}
                </button>
                {#if imageSubmenuOpen}
                    <div class="workspace-image-submenu">
                        {#if imageSubmenuMode === 'menu'}
                            <button class="workspace-image-submenu-option" onclick={handleUploadFromDevice}>
                                Upload from Device
                            </button>
                            <button class="workspace-image-submenu-option" onclick={() => { imageSubmenuMode = 'url' }}>
                                Paste Image URL
                            </button>
                        {:else}
                            <div class="workspace-image-submenu-url-form">
                                <input
                                    type="url"
                                    class="workspace-image-submenu-url-input"
                                    placeholder="https://example.com/image.jpg"
                                    bind:value={imageUrlValue}
                                    onkeydown={(e) => { if (e.key === 'Enter') handleImageUrlInsert() }}
                                />
                                <div class="workspace-image-submenu-url-actions">
                                    <button class="workspace-image-submenu-url-back" onclick={() => { imageSubmenuMode = 'menu' }}>
                                        Back
                                    </button>
                                    <button class="workspace-image-submenu-url-insert" onclick={handleImageUrlInsert}>
                                        Add
                                    </button>
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
        <div class="workspace-canvas-action-panel workspace-canvas-media-library-panel workspace-canvas-action-panel-single">
            <button
                class="workspace-floating-toolbar-button"
                onclick={handleToggleMediaLibrary}
                aria-label="Media Library"
                data-help-tooltip="aria-label"
            >
                {@html mediaFoloderIcon}
            </button>
        </div>
    </div>

    <div class="workspace-canvas-action-panel workspace-canvas-right-control-rail">
        <div
            class="workspace-canvas-model-menu-hover-background"
            aria-hidden="true"
            style={modelMenuHoverBackgroundStyle}
        ></div>
        <div class="workspace-canvas-media-mode-panel" bind:this={mediaModeSwitchMountEl}></div>
        <div
            class="workspace-canvas-model-menu-panel"
            bind:this={modelMenuControlMountEl}
        ></div>
    </div>

    <input
        type="file"
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.ppt,.pptx,.odt,.rtf,.txt,.md"
        style="display: none"
        bind:this={fileInputEl}
        onchange={handleFileInputChange}
    />
    <span class="workspace-zoom-indicator">{Math.round(viewport.zoom * 100)}%</span>
    <div class="workspace-pane" bind:this={paneEl}>
        <div class="workspace-viewport" bind:this={viewportEl}></div>
    </div>
</div>
