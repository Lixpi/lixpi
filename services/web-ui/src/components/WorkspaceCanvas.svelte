<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { v4 as uuidv4 } from 'uuid'
    import {
        type Viewport
    } from '@xyflow/system'
    import {
        type CanvasState,
        type ImageCanvasNode,
        type AiChatThreadCanvasNode
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
    import { createNewFileIcon, imageIcon, aiChatBubbleIcon } from '$src/svgIcons/index.ts'
    import '$src/infographics/workspace/workspace-canvas.scss'

    let paneEl: HTMLDivElement
    let viewportEl: HTMLDivElement
    let renderer: ReturnType<typeof createWorkspaceCanvas> | null = null

    let workspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId as string)
    let canvasState = $derived($workspaceStore.data.canvasState)
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

    function persistCanvasState(newCanvasState: CanvasState) {
        workspaceStore.updateCanvasState(newCanvasState)
        if (workspaceId) {
            servicesStore.getData('workspaceService').updateCanvasState({
                workspaceId,
                canvasState: newCanvasState
            })
        }
    }

    function handleViewportChange(newViewport: Viewport) {
        viewport = newViewport

        if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
        saveDebounceTimer = setTimeout(() => {
            if (workspaceId && canvasState) {
                const newCanvasState: CanvasState = {
                    ...canvasState,
                    viewport: newViewport
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
                const existingNodes = canvasState?.nodes || []
                const newX = 50 + (existingNodes.length % 3) * 450
                const newY = 50 + Math.floor(existingNodes.length / 3) * 400

                const newCanvasState: CanvasState = {
                    viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    edges: canvasState?.edges ?? [],
                    nodes: [
                        ...existingNodes,
                        {
                            nodeId: `node-${doc.documentId}`,
                            type: 'document',
                            referenceId: doc.documentId,
                            position: { x: newX, y: newY },
                            dimensions: { width: 400, height: 350 }
                        }
                    ]
                }

                persistCanvasState(newCanvasState)
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

    function handleImageUrlInsert() {
        const url = imageUrlValue.trim()
        if (!url) return
        closeImageSubmenu()
        addImageToCanvas({ src: url })
    }

    async function uploadAndAddImage(file: File) {
        if (!file.type.startsWith('image/')) return
        if (file.size > 1024 * 1024 * 1024) return
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

    function addImageToCanvas({ fileId, src }: { fileId?: string, src: string }) {
        if (!workspaceId) return

        const img = new Image()
        img.onload = () => {
            const aspectRatio = img.naturalWidth / img.naturalHeight
            const maxWidth = 400
            const width = Math.min(maxWidth, img.naturalWidth)
            const height = width / aspectRatio

            const existingNodes = canvasState?.nodes || []
            const newX = 50 + (existingNodes.length % 3) * 450
            const newY = 50 + Math.floor(existingNodes.length / 3) * 400
            const nodeUniqueId = fileId || uuidv4()

            const imageNode: ImageCanvasNode = {
                nodeId: `node-${nodeUniqueId}`,
                type: 'image',
                fileId: nodeUniqueId,
                workspaceId,
                src,
                aspectRatio,
                position: { x: newX, y: newY },
                dimensions: { width, height }
            }

            persistCanvasState({
                viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: canvasState?.edges ?? [],
                nodes: [...existingNodes, imageNode]
            })
        }

        img.onerror = () => {
            console.error('Failed to load image for dimension calculation')
            const existingNodes = canvasState?.nodes || []
            const newX = 50 + (existingNodes.length % 3) * 450
            const newY = 50 + Math.floor(existingNodes.length / 3) * 400
            const nodeUniqueId = fileId || uuidv4()

            const imageNode: ImageCanvasNode = {
                nodeId: `node-${nodeUniqueId}`,
                type: 'image',
                fileId: nodeUniqueId,
                workspaceId,
                src,
                aspectRatio: 1,
                position: { x: newX, y: newY },
                dimensions: { width: 300, height: 300 }
            }

            persistCanvasState({
                viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: canvasState?.edges ?? [],
                nodes: [...existingNodes, imageNode]
            })
        }

        img.src = src
    }

    async function handleAddAiChatThread() {
        if (!workspaceId) {
            console.error('No workspaceId available!')
            return
        }

        try {
            // Generate threadId on frontend to ensure content and DB record match
            const threadId = uuidv4()

            // Create empty AI chat thread content with the generated threadId
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
                const existingNodes = canvasState?.nodes || []
                const newX = 50 + (existingNodes.length % 3) * 450
                const newY = 50 + Math.floor(existingNodes.length / 3) * 400

                const threadNode: AiChatThreadCanvasNode = {
                    nodeId: `node-${thread.threadId}`,
                    type: 'aiChatThread',
                    referenceId: thread.threadId,
                    position: { x: newX, y: newY },
                    dimensions: { width: 400, height: 500 }
                }

                const newCanvasState: CanvasState = {
                    viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    edges: canvasState?.edges ?? [],
                    nodes: [...existingNodes, threadNode]
                }

                persistCanvasState(newCanvasState)
            }
        } catch (error) {
            console.error('Error creating AI chat thread:', error)
        }
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
            renderer.render(canvasState, documents, aiChatThreads)
        }
    })

    onDestroy(() => {
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
        renderer?.destroy()
    })
</script>

<div class="workspace-canvas">
    <div class="workspace-floating-toolbar">
        <button class="workspace-floating-toolbar__button" onclick={handleCreateDocument}>
            {@html createNewFileIcon}
            <span class="workspace-floating-toolbar__tooltip">New Document</span>
        </button>
        <div class="workspace-floating-toolbar__image-wrapper" bind:this={imageWrapperEl}>
            <button
                class="workspace-floating-toolbar__button"
                class:active={imageSubmenuOpen}
                onclick={toggleImageSubmenu}
            >
                {@html imageIcon}
                {#if !imageSubmenuOpen}
                    <span class="workspace-floating-toolbar__tooltip">Add Image</span>
                {/if}
            </button>
            {#if imageSubmenuOpen}
                <div class="workspace-image-submenu">
                    {#if imageSubmenuMode === 'menu'}
                        <button class="workspace-image-submenu__option" onclick={handleUploadFromDevice}>
                            Upload from Device
                        </button>
                        <button class="workspace-image-submenu__option" onclick={() => { imageSubmenuMode = 'url' }}>
                            Paste Image URL
                        </button>
                    {:else}
                        <div class="workspace-image-submenu__url-form">
                            <input
                                type="url"
                                class="workspace-image-submenu__url-input"
                                placeholder="https://example.com/image.jpg"
                                bind:value={imageUrlValue}
                                onkeydown={(e) => { if (e.key === 'Enter') handleImageUrlInsert() }}
                            />
                            <div class="workspace-image-submenu__url-actions">
                                <button class="workspace-image-submenu__url-back" onclick={() => { imageSubmenuMode = 'menu' }}>
                                    Back
                                </button>
                                <button class="workspace-image-submenu__url-insert" onclick={handleImageUrlInsert}>
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
        <div class="workspace-floating-toolbar__divider"></div>
        <button class="workspace-floating-toolbar__button" onclick={handleAddAiChatThread}>
            {@html aiChatBubbleIcon}
            <span class="workspace-floating-toolbar__tooltip">AI Chat</span>
        </button>
    </div>
    <span class="workspace-zoom-indicator">{Math.round(viewport.zoom * 100)}%</span>
    <div class="workspace-pane" bind:this={paneEl}>
        <div class="workspace-viewport" bind:this={viewportEl}></div>
    </div>
</div>
