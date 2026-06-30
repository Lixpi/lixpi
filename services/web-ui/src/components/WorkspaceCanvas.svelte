<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import {
        type Viewport
    } from '@xyflow/system'
    import {
        MAX_UPLOAD_FILE_SIZE,
        type CanvasState,
        type DocumentCanvasNode,
        type DocumentMediaCanvasNode,
        type ImageCanvasNode,
        type VideoCanvasNode,
        type AudioCanvasNode,
        type MediaKind
    } from '@lixpi/constants'

    import { createWorkspaceCanvas } from '$src/infographics/workspace/WorkspaceCanvas.ts'
    import DocumentService from '$src/services/document-service.ts'
    import AiChatThreadService from '$src/services/ai-chat-thread-service.ts'
    import { workspaceStore } from '$src/stores/workspaceStore.ts'
    import { documentsStore } from '$src/stores/documentsStore.ts'
    import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
    import { routerStore } from '$src/stores/routerStore.ts'
    import { servicesStore } from '$src/stores/servicesStore.ts'
    import AuthService from '$src/services/auth-service.ts'
    import { settings } from '$src/settings.ts'
    import { createNewFileIcon, imageIcon, mediaFoloderIcon } from '$src/svgIcons/index.ts'
    import '$src/components/sidePanel/side-panel.scss'
    import '$src/infographics/workspace/workspace-canvas.scss'
    import '$src/infographics/workspace/media-library-panel.scss'

    type PendingDocumentUpdate = {
        workspaceId: string
        documentId: string
        title?: string
        prevRevision?: number
        content?: any
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
    let canvasState = $derived(isRouteWorkspaceLoaded ? $workspaceStore.data.canvasState : null)
    let isRightSidePanelOpen = $derived(Boolean(isRouteWorkspaceLoaded && (canvasState?.aiChatPanel?.isOpen ?? canvasState?.lastActiveAiChatThreadId)))
    let documents = $derived(isRouteWorkspaceLoaded ? $documentsStore.data.filter((document: any) => document.workspaceId === workspaceId) : [])
    let aiChatThreads = $derived(isRouteWorkspaceLoaded ? Array.from($aiChatThreadsStore.data.values()).filter((thread: any) => thread.workspaceId === workspaceId) : [])

    let viewport: Viewport = $state({ x: 0, y: 0, zoom: 1 })
    let imageSubmenuOpen = $state(false)
    let imageSubmenuMode: 'menu' | 'url' = $state('menu')
    let imageUrlValue = $state('')
    let uploadError = $state('')
    let imageWrapperEl: HTMLDivElement
    let fileInputEl: HTMLInputElement
    let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
    const documentSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const pendingDocumentUpdates = new Map<string, PendingDocumentUpdate>()
    const DOCUMENT_SAVE_DEBOUNCE_MS = 5000
    const documentService = new DocumentService()
    const aiChatThreadService = new AiChatThreadService()
    const DEFAULT_DOCUMENT_NODE_DIMENSIONS = { width: 400, height: 350 }
    const rightSidePanelSettings = settings.rightSidePanel
    const rightSidePanelStyle = [
        `--workspace-right-side-panel-width: min(${rightSidePanelSettings.defaultDimensions.width}px, calc(100vw - ${rightSidePanelSettings.dimensions.maxPaneMargin}px))`,
        '--side-panel-backdrop-width: var(--workspace-right-side-panel-width)',
        `--workspace-right-side-panel-content-inset: ${rightSidePanelSettings.layout.contentInset}px`,
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

    function persistCanvasState(newCanvasState: CanvasState) {
        if (!workspaceId || loadedWorkspaceId !== workspaceId) return

        const stateToPersist = {
            ...newCanvasState,
            viewport,
        }

        workspaceStore.updateCanvasState(stateToPersist)
        if (workspaceId) {
            servicesStore.getData('workspaceService').updateCanvasState({
                workspaceId,
                canvasState: stateToPersist
            })
        }
    }

    function handleViewportChange(newViewport: Viewport) {
        viewport = newViewport

        if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
        const scheduledViewport = newViewport
        const scheduledWorkspaceId = workspaceId
        saveDebounceTimer = setTimeout(() => {
            if (
                viewport.x !== scheduledViewport.x ||
                viewport.y !== scheduledViewport.y ||
                viewport.zoom !== scheduledViewport.zoom
            ) return

            if (scheduledWorkspaceId && loadedWorkspaceId === scheduledWorkspaceId && workspaceId === scheduledWorkspaceId && canvasState) {
                const newCanvasState: CanvasState = {
                    ...canvasState,
                    viewport: scheduledViewport
                }
                persistCanvasState(newCanvasState)
            }
        }, 1000)
    }

    function scheduleDocumentUpdate(update: PendingDocumentUpdate): void {
        const { workspaceId: targetWorkspaceId, documentId } = update
        const pendingUpdate = {
            ...pendingDocumentUpdates.get(documentId),
            workspaceId: targetWorkspaceId,
            documentId,
            ...(update.title !== undefined ? { title: update.title } : {}),
            ...(update.prevRevision !== undefined ? { prevRevision: update.prevRevision } : {}),
            ...(update.content !== undefined ? { content: update.content } : {}),
        }
        pendingDocumentUpdates.set(documentId, pendingUpdate)

        const existingTimer = documentSaveTimers.get(documentId)
        if (existingTimer) clearTimeout(existingTimer)

        const timer = setTimeout(() => {
            documentSaveTimers.delete(documentId)
            const pending = pendingDocumentUpdates.get(documentId)
            pendingDocumentUpdates.delete(documentId)
            if (!pending) return
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return
            documentService.updateDocument(pending)
        }, DOCUMENT_SAVE_DEBOUNCE_MS)
        documentSaveTimers.set(documentId, timer)
    }

    async function handleCreateDocument() {
        const targetWorkspaceId = workspaceId
        if (!targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) {
            console.error('No workspaceId available!')
            return
        }

        try {
            // Create document with valid ProseMirror content structure
            // Schema requires: documentTitle block+
            const initialContent = {
                type: 'doc',
                content: [
                    {
                        type: 'documentTitle',
                        content: [{ type: 'text', text: 'New Document' }]
                    },
                    {
                        type: 'paragraph'
                    }
                ]
            }

            const doc = await servicesStore.getData('documentService').createDocument({
                workspaceId: targetWorkspaceId,
                title: 'New Document',
                content: initialContent
            })

            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            if (doc) {
                const dimensions = { ...DEFAULT_DOCUMENT_NODE_DIMENSIONS }
                const documentNode: Omit<DocumentCanvasNode, 'position'> = {
                    nodeId: `node-${doc.documentId}`,
                    type: 'document',
                    referenceId: doc.documentId,
                    dimensions,
                }

                renderer?.insertNodeAtViewportCenter(documentNode)
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
        uploadError = ''
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

    // Shape the unified upload/import endpoint returns. `kind` selects the canvas
    // node; the rest are per-kind hints. Type/policy decisions are server-side.
    type IngestResult = {
        fileId: string
        kind: MediaKind
        url: string
        aspectRatio?: number
        durationSeconds?: number
        hasAudio?: boolean
        posterFileId?: string
        posterUrl?: string
        pageCount?: number
    }

    function tokenizeUrl(url: string, token: string): string {
        return `${API_BASE_URL}${url}?token=${encodeURIComponent(token)}`
    }

    async function handleImageUrlInsert() {
        const url = imageUrlValue.trim()
        const targetWorkspaceId = workspaceId
        if (!url || !targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

        uploadError = ''
        try {
            const token = await AuthService.getTokenSilently()
            if (!token) return

            const response = await fetch(`${API_BASE_URL}/api/files/${targetWorkspaceId}/import-url`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            })

            const data = await response.json()
            if (!response.ok) {
                uploadError = data?.error || 'File URL import failed'
                return
            }
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            closeImageSubmenu()
            addFileToCanvas(data, token, targetWorkspaceId)
        } catch (error) {
            console.error('File URL import failed:', error)
            uploadError = 'File URL import failed'
        }
    }

    // Generalized device upload — accepts ANY file. The client no longer
    // pre-rejects by MIME (the server sniffs the bytes); it only enforces the
    // size ceiling and surfaces the server's specific rejection inline.
    async function uploadAndAddFile(file: File) {
        if (file.size > MAX_UPLOAD_FILE_SIZE) {
            uploadError = 'File is too large.'
            return
        }
        const targetWorkspaceId = workspaceId
        if (!targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

        uploadError = ''
        try {
            const token = await AuthService.getTokenSilently()
            if (!token) return

            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch(`${API_BASE_URL}/api/files/${targetWorkspaceId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            })

            const data = await response.json()
            if (!response.ok) {
                uploadError = data?.error || 'Upload failed'
                return
            }
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            addFileToCanvas(data, token, targetWorkspaceId)
        } catch (error) {
            console.error('File upload failed:', error)
            uploadError = 'Upload failed'
        }
    }

    // Dispatch an ingested file onto the canvas as the typed node its `kind`
    // selects. Uploads stay client-placed at the viewport center (they have no
    // server-side lineage to position against).
    function addFileToCanvas(result: IngestResult, token: string, targetWorkspaceId: string) {
        if (!targetWorkspaceId || workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

        const { fileId, kind } = result
        const src = tokenizeUrl(result.url, token)
        const posterSrc = result.posterUrl ? tokenizeUrl(result.posterUrl, token) : undefined

        if (kind === 'image') {
            addImageToCanvas({ fileId, src, targetWorkspaceId })
            return
        }

        if (kind === 'video') {
            const aspectRatio = result.aspectRatio && result.aspectRatio > 0 ? result.aspectRatio : 1
            const videoNode: Omit<VideoCanvasNode, 'position'> = {
                nodeId: `node-${fileId}`,
                type: 'video',
                fileId,
                posterFileId: result.posterFileId ?? '',
                workspaceId: targetWorkspaceId,
                src,
                posterSrc: posterSrc ?? '',
                aspectRatio,
                durationSeconds: result.durationSeconds ?? 0,
                hasAudio: result.hasAudio ?? true,
                dimensions: getImageInsertionDimensions(aspectRatio),
            }
            renderer?.insertNodeAtViewportCenter(videoNode)
            return
        }

        if (kind === 'audio') {
            // Audio has no aspect; use a compact fixed strip.
            const audioNode: Omit<AudioCanvasNode, 'position'> = {
                nodeId: `node-${fileId}`,
                type: 'audio',
                fileId,
                workspaceId: targetWorkspaceId,
                src,
                durationSeconds: result.durationSeconds ?? 0,
                hasAudio: true,
                dimensions: { width: 360, height: 96 },
            }
            renderer?.insertNodeAtViewportCenter(audioNode)
            return
        }

        // document (PDF / converted office doc / text)
        const aspectRatio = result.aspectRatio && result.aspectRatio > 0 ? result.aspectRatio : 0.7727 // ~A4 portrait
        const documentNode: Omit<DocumentMediaCanvasNode, 'position'> = {
            nodeId: `node-${fileId}`,
            type: 'mediaDocument',
            fileId,
            workspaceId: targetWorkspaceId,
            src,
            posterFileId: result.posterFileId,
            posterSrc,
            pageCount: result.pageCount,
            aspectRatio,
            dimensions: getImageInsertionDimensions(aspectRatio),
        }
        renderer?.insertNodeAtViewportCenter(documentNode)
    }

    function addImageToCanvas({ fileId, src, targetWorkspaceId }: { fileId: string, src: string, targetWorkspaceId: string }) {
        if (!targetWorkspaceId || workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

        const img = new Image()
        img.onload = () => {
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            const aspectRatio = img.naturalWidth > 0 && img.naturalHeight > 0
                ? img.naturalWidth / img.naturalHeight
                : 1
            const dimensions = getImageInsertionDimensions(aspectRatio)

            const imageNode: Omit<ImageCanvasNode, 'position'> = {
                nodeId: `node-${fileId}`,
                type: 'image',
                fileId,
                workspaceId: targetWorkspaceId,
                src,
                aspectRatio,
                dimensions,
            }

            renderer?.insertNodeAtViewportCenter(imageNode)
        }

        img.onerror = () => {
            if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return

            console.error('Failed to load image for dimension calculation')
            const dimensions = getImageInsertionDimensions(1)
            const imageNode: Omit<ImageCanvasNode, 'position'> = {
                nodeId: `node-${fileId}`,
                type: 'image',
                fileId,
                workspaceId: targetWorkspaceId,
                src,
                aspectRatio: 1,
                dimensions,
            }

            renderer?.insertNodeAtViewportCenter(imageNode)
        }

        img.src = src
    }

    onMount(() => {
        if (!paneEl || !viewportEl) return

        renderer = createWorkspaceCanvas({
            paneEl,
            viewportEl,
            workspaceId,
            canvasState,
            documents,
            aiChatThreads,
            onViewportChange: handleViewportChange,
            onCanvasStateChange: persistCanvasState,
            onDocumentContentChange: ({ documentId, title, prevRevision, content }) => {
                if (!workspaceId || loadedWorkspaceId !== workspaceId) return
                scheduleDocumentUpdate({
                    workspaceId,
                    documentId,
                    prevRevision: prevRevision || 1,
                    content
                })
            },
            onDocumentTitleChange: ({ documentId, title }) => {
                if (!workspaceId || loadedWorkspaceId !== workspaceId) return
                documentsStore.updateDocument(documentId, { title })
                scheduleDocumentUpdate({
                    workspaceId,
                    documentId,
                    title
                })
            },
            onAiChatThreadContentChange: ({ workspaceId: wsId, threadId, content }) => {
                aiChatThreadService.updateAiChatThread({
                    workspaceId: wsId,
                    threadId,
                    content
                })
            }
        })

        if (canvasState?.viewport) {
            viewport = canvasState.viewport
        }
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
        if (renderer) {
            renderer.render(canvasState, documents, aiChatThreads, workspaceId)
        }
    })

    onDestroy(() => {
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
        for (const timer of documentSaveTimers.values()) clearTimeout(timer)
        documentSaveTimers.clear()
        pendingDocumentUpdates.clear()
        renderer?.destroy()
    })
</script>

<div
    class="workspace-canvas"
    class:workspace-canvas-right-side-panel-open={isRightSidePanelOpen}
    style={rightSidePanelStyle}
>
    <!-- Left action panel — flanks the composer. Two icons render it as an oval. -->
    <div class="workspace-canvas-action-panel workspace-canvas-action-panel-left">
        <button class="workspace-floating-toolbar-button" onclick={handleCreateDocument} aria-label="New Document">
            {@html createNewFileIcon}
            <span class="workspace-floating-toolbar-tooltip">New Document</span>
        </button>
        <div class="workspace-floating-toolbar-image-wrapper" bind:this={imageWrapperEl}>
            <button
                class="workspace-floating-toolbar-button"
                class:active={imageSubmenuOpen}
                onclick={toggleImageSubmenu}
                aria-label="Add Image"
            >
                {@html imageIcon}
                {#if !imageSubmenuOpen}
                    <span class="workspace-floating-toolbar-tooltip">Add Image</span>
                {/if}
            </button>
            {#if imageSubmenuOpen}
                <div class="workspace-image-submenu">
                    {#if uploadError}
                        <div class="workspace-image-submenu-error" role="alert">{uploadError}</div>
                    {/if}
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

    <!-- Right action panel — a single icon renders it as a circle. -->
    <div class="workspace-canvas-action-panel workspace-canvas-action-panel-right workspace-canvas-action-panel-single">
        <button class="workspace-floating-toolbar-button" onclick={handleToggleMediaLibrary} aria-label="Media Library">
            {@html mediaFoloderIcon}
            <span class="workspace-floating-toolbar-tooltip">Media Library</span>
        </button>
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
