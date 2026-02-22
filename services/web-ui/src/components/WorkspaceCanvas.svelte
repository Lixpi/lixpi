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
    import {
        ImageUploadModal,
        type ImageUploadResult
    } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/ImageUploadModal.ts'

    import '$src/infographics/workspace/workspace-canvas.scss'

    let paneEl: HTMLDivElement
    let viewportEl: HTMLDivElement
    let renderer: ReturnType<typeof createWorkspaceCanvas> | null = null

    let workspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId as string)
    let canvasState = $derived($workspaceStore.data.canvasState)
    let documents = $derived($documentsStore.data)
    let aiChatThreads = $derived(Array.from($aiChatThreadsStore.data.values()))

    let viewport: Viewport = $state({ x: 0, y: 0, zoom: 1 })
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

    function handleAddImage() {
        if (!workspaceId) {
            console.error('No workspaceId available!')
            return
        }

        const modal = new ImageUploadModal({
            onComplete: (result: ImageUploadResult) => {
                if (result.success && result.src && result.fileId) {
                    // Load the image to get natural dimensions for aspect ratio
                    const img = new Image()
                    img.onload = () => {
                        const aspectRatio = img.naturalWidth / img.naturalHeight

                        // Calculate initial dimensions (max 400px width, preserve aspect ratio)
                        const maxWidth = 400
                        const width = Math.min(maxWidth, img.naturalWidth)
                        const height = width / aspectRatio

                        const existingNodes = canvasState?.nodes || []
                        const newX = 50 + (existingNodes.length % 3) * 450
                        const newY = 50 + Math.floor(existingNodes.length / 3) * 400

                        const imageNode: ImageCanvasNode = {
                            nodeId: `node-${result.fileId}`,
                            type: 'image',
                            fileId: result.fileId,
                            workspaceId: workspaceId,
                            src: result.src,
                            aspectRatio,
                            position: { x: newX, y: newY },
                            dimensions: { width, height }
                        }

                        const newCanvasState: CanvasState = {
                            viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                            edges: canvasState?.edges ?? [],
                            nodes: [...existingNodes, imageNode]
                        }

                        persistCanvasState(newCanvasState)
                    }

                    img.onerror = () => {
                        console.error('Failed to load image for dimension calculation')
                        // Fallback: add with default dimensions
                        const existingNodes = canvasState?.nodes || []
                        const newX = 50 + (existingNodes.length % 3) * 450
                        const newY = 50 + Math.floor(existingNodes.length / 3) * 400

                        const imageNode: ImageCanvasNode = {
                            nodeId: `node-${result.fileId}`,
                            type: 'image',
                            fileId: result.fileId!,
                            workspaceId: workspaceId,
                            src: result.src!,
                            aspectRatio: 1, // Default to square if we can't determine
                            position: { x: newX, y: newY },
                            dimensions: { width: 300, height: 300 }
                        }

                        const newCanvasState: CanvasState = {
                            viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                            edges: canvasState?.edges ?? [],
                            nodes: [...existingNodes, imageNode]
                        }

                        persistCanvasState(newCanvasState)
                    }

                    img.src = result.src
                }
            },
            onCancel: () => {
                // Modal was cancelled, nothing to do
            }
        })

        modal.show()
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
    <div class="workspace-toolbar">
        <button class="create-document-btn" onclick={handleCreateDocument}>
            + New Document
        </button>
        <button class="add-image-btn" onclick={handleAddImage}>
            + Add Image
        </button>
        <button class="add-ai-chat-btn" onclick={handleAddAiChatThread}>
            + AI Chat
        </button>
        <span class="zoom-indicator">{Math.round(viewport.zoom * 100)}%</span>
    </div>
    <div class="workspace-pane" bind:this={paneEl}>
        <div class="workspace-viewport" bind:this={viewportEl}></div>
    </div>
</div>
