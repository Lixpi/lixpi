<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { Viewport } from '@xyflow/system'
    import type { CanvasState } from '@lixpi/constants'

    import { createWorkspaceCanvas } from '$src/infographics/workspace/WorkspaceCanvas.ts'
    import DocumentService from '$src/services/document-service.ts'
    import { workspaceStore } from '$src/stores/workspaceStore.ts'
    import { documentsStore } from '$src/stores/documentsStore.ts'
    import { routerStore } from '$src/stores/routerStore.ts'
    import { servicesStore } from '$src/stores/servicesStore.ts'

    import '$src/infographics/workspace/workspace-canvas.scss'

    let paneEl: HTMLDivElement
    let viewportEl: HTMLDivElement
    let renderer: ReturnType<typeof createWorkspaceCanvas> | null = null

    let workspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId as string)
    let canvasState = $derived($workspaceStore.data.canvasState)
    let documents = $derived($documentsStore.data)

    let viewport: Viewport = $state({ x: 0, y: 0, zoom: 1 })
    let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
    const documentService = new DocumentService()

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
            const doc = await servicesStore.getData('documentService').createDocument({
                workspaceId,
                title: 'New Document',
                content: {}
            })

            if (doc) {
                const existingNodes = canvasState?.nodes || []
                const newX = 50 + (existingNodes.length % 3) * 450
                const newY = 50 + Math.floor(existingNodes.length / 3) * 400

                const newCanvasState: CanvasState = {
                    viewport: canvasState?.viewport || { x: 0, y: 0, zoom: 1 },
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

    onMount(() => {
        if (!paneEl || !viewportEl) return

        renderer = createWorkspaceCanvas({
            paneEl,
            viewportEl,
            canvasState,
            documents,
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
            }
        })

        if (canvasState?.viewport) {
            viewport = canvasState.viewport
        }
    })

    $effect(() => {
        if (renderer) {
            renderer.render(canvasState, documents)
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
        <span class="zoom-indicator">{Math.round(viewport.zoom * 100)}%</span>
    </div>
    <div class="workspace-pane" bind:this={paneEl}>
        <div class="workspace-viewport" bind:this={viewportEl}></div>
    </div>
</div>
