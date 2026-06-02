<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import {
        type Viewport
    } from '@xyflow/system'
    import {
        MAX_IMAGE_FILE_SIZE,
        type CanvasState,
        type DocumentCanvasNode,
        type ImageCanvasNode
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
    import { createNewFileIcon, imageIcon, aiChatPanelCollapseIcon, aiChatIcon, mediaLibraryIconFilled } from '$src/svgIcons/index.ts'
    import '$src/infographics/workspace/workspace-canvas.scss'
    import '$src/infographics/workspace/media-library-panel.scss'

    let paneEl: HTMLDivElement
    let viewportEl: HTMLDivElement
    let renderer: ReturnType<typeof createWorkspaceCanvas> | null = null

    function handleToggleMediaLibrary() {
        renderer?.toggleMediaLibrary?.()
    }

    function handleToggleAiChatPanel() {
        renderer?.toggleAiChatPanel?.()
    }

    let workspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId as string)
    let canvasState = $derived($workspaceStore.data.canvasState)
    let isAiChatPanelOpen = $derived(Boolean(canvasState?.aiChatPanel?.isOpen ?? canvasState?.lastActiveAiChatThreadId))
    let documents = $derived($documentsStore.data)
    let aiChatThreads = $derived(Array.from($aiChatThreadsStore.data.values()))

    let viewport: Viewport = $state({ x: 0, y: 0, zoom: 1 })
    let imageSubmenuOpen = $state(false)
    let imageSubmenuMode: 'menu' | 'url' = $state('menu')
    let imageUrlValue = $state('')
    let imageWrapperEl: HTMLDivElement
    let fileInputEl: HTMLInputElement
    let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
    const documentService = new DocumentService()
    const aiChatThreadService = new AiChatThreadService()
    const DEFAULT_DOCUMENT_NODE_DIMENSIONS = { width: 400, height: 350 }

    function getImageInsertionDimensions(aspectRatio: number): { width: number; height: number } {
        const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
        const width = settings.imageNode.defaultInsertionWidth
        return { width, height: width / safeAspectRatio }
    }

    function persistCanvasState(newCanvasState: CanvasState) {
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
        saveDebounceTimer = setTimeout(() => {
            if (
                viewport.x !== scheduledViewport.x ||
                viewport.y !== scheduledViewport.y ||
                viewport.zoom !== scheduledViewport.zoom
            ) return

            if (workspaceId && canvasState) {
                const newCanvasState: CanvasState = {
                    ...canvasState,
                    viewport: scheduledViewport
                }
                persistCanvasState(newCanvasState)
            }
        }, 1000)
    }

    async function handleCreateDocument() {
        if (!workspaceId) {
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
                workspaceId,
                title: 'New Document',
                content: initialContent
            })

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
    }

    function handleUploadFromDevice() {
        fileInputEl?.click()
    }

    function handleFileInputChange(e: Event) {
        const input = e.target as HTMLInputElement
        if (input.files && input.files.length > 0) {
            closeImageSubmenu()
            uploadAndAddImage(input.files[0])
            input.value = ''
        }
    }

    async function handleImageUrlInsert() {
        const url = imageUrlValue.trim()
        if (!url || !workspaceId) return

        try {
            const token = await AuthService.getTokenSilently()
            if (!token) return

            const response = await fetch(`${API_BASE_URL}/api/images/${workspaceId}/import-url`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            })
            if (!response.ok) throw new Error('Image URL import failed')

            const data = await response.json()
            const imageUrl = `${API_BASE_URL}${data.url}?token=${encodeURIComponent(token)}`
            closeImageSubmenu()
            addImageToCanvas({ fileId: data.fileId, src: imageUrl })
        } catch (error) {
            console.error('Image URL import failed:', error)
        }
    }

    async function uploadAndAddImage(file: File) {
        if (!file.type.startsWith('image/')) return
        if (file.size > MAX_IMAGE_FILE_SIZE) return
        if (!workspaceId) return

        try {
            const token = await AuthService.getTokenSilently()
            if (!token) return

            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch(`${API_BASE_URL}/api/images/${workspaceId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            })

            if (!response.ok) throw new Error('Upload failed')

            const data = await response.json()
            const imageUrl = `${API_BASE_URL}${data.url}?token=${encodeURIComponent(token)}`

            addImageToCanvas({ fileId: data.fileId, src: imageUrl })
        } catch (error) {
            console.error('Image upload failed:', error)
        }
    }

    function addImageToCanvas({ fileId, src }: { fileId: string, src: string }) {
        if (!workspaceId) return

        const img = new Image()
        img.onload = () => {
            const aspectRatio = img.naturalWidth > 0 && img.naturalHeight > 0
                ? img.naturalWidth / img.naturalHeight
                : 1
            const dimensions = getImageInsertionDimensions(aspectRatio)

            const imageNode: Omit<ImageCanvasNode, 'position'> = {
                nodeId: `node-${fileId}`,
                type: 'image',
                fileId,
                workspaceId,
                src,
                aspectRatio,
                dimensions,
            }

            renderer?.insertNodeAtViewportCenter(imageNode)
        }

        img.onerror = () => {
            console.error('Failed to load image for dimension calculation')
            const dimensions = getImageInsertionDimensions(1)
            const imageNode: Omit<ImageCanvasNode, 'position'> = {
                nodeId: `node-${fileId}`,
                type: 'image',
                fileId,
                workspaceId,
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
                if (!workspaceId) return
                documentService.updateDocument({
                    workspaceId,
                    documentId,
                    title: title ?? '',
                    prevRevision: prevRevision || 1,
                    content
                })
            },
            onDocumentTitleChange: ({ documentId, title }) => {
                documentsStore.updateDocument(documentId, { title })
                if (!workspaceId) return
                documentService.updateDocument({
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
        renderer?.destroy()
    })
</script>

<div
    class="workspace-canvas"
    class:workspace-canvas-chat-panel-open={isAiChatPanelOpen}
>
    <div class="workspace-floating-toolbar">
        <button class="workspace-floating-toolbar-button" onclick={handleCreateDocument}>
            {@html createNewFileIcon}
            <span class="workspace-floating-toolbar-tooltip">New Document</span>
        </button>
        <div class="workspace-floating-toolbar-image-wrapper" bind:this={imageWrapperEl}>
            <button
                class="workspace-floating-toolbar-button"
                class:active={imageSubmenuOpen}
                onclick={toggleImageSubmenu}
            >
                {@html imageIcon}
                {#if !imageSubmenuOpen}
                    <span class="workspace-floating-toolbar-tooltip">Add Image</span>
                {/if}
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
        <input
            type="file"
            accept="image/*"
            style="display: none"
            bind:this={fileInputEl}
            onchange={handleFileInputChange}
        />
        <div class="workspace-floating-toolbar-divider"></div>
    </div>
    <button
        class="workspace-ai-chat-launcher"
        onclick={handleToggleAiChatPanel}
        aria-label={isAiChatPanelOpen ? 'Collapse AI Chat' : 'Open AI Chat'}
    >
        {#if isAiChatPanelOpen}
            {@html aiChatPanelCollapseIcon}
        {:else}
            {@html aiChatIcon}
        {/if}
    </button>
    <button class="workspace-media-library-launcher" onclick={handleToggleMediaLibrary} aria-label="Media Library">
        {@html mediaLibraryIconFilled}
        <span class="workspace-media-library-launcher-tooltip">Media Library</span>
    </button>
    <span class="workspace-zoom-indicator">{Math.round(viewport.zoom * 100)}%</span>
    <div class="workspace-pane" bind:this={paneEl}>
        <div class="workspace-viewport" bind:this={viewportEl}></div>
    </div>
</div>
