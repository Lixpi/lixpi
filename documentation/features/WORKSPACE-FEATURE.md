# Workspace Feature

A workspace is the primary container where users organize and edit their documents and images. Think of it as an infinite canvas where cards float, can be arranged freely, resized, and edited in place.

## Core Concepts

**Workspace** — A named container owned by a user. Has a canvas state (viewport position, zoom level, and node positions) plus references to documents and uploaded files.

**Canvas Node** — A positioned rectangle on the canvas. Can be either a document node (with ProseMirror editor) or an image node. Stores position, dimensions, and type-specific data.

**Document** — The actual text content (ProseMirror JSON). Lives separately from its canvas representation so the same document could theoretically appear in multiple workspaces.

**Image** — An uploaded image file stored in NATS Object Store. Referenced by canvas nodes and automatically deleted when removed from the canvas.

**Viewport** — The current view: x/y offset and zoom level. Persisted so users return to where they left off.

## System Architecture

```mermaid
flowchart TB
    subgraph Client["Browser"]
        subgraph Svelte["Svelte Components"]
            Sidebar[Sidebar2.svelte]
            WCS[WorkspaceCanvas.svelte]
        end

        subgraph Stores["Svelte Stores"]
            WSS[workspacesStore]
            WS[workspaceStore]
            DS[documentsStore]
        end

        subgraph Infographics["Framework-Agnostic Layer"]
            WC[WorkspaceCanvas.ts]
            XY[XYPanZoom]
        end

        subgraph Services["Frontend Services"]
            WSvc[WorkspaceService]
            DSvc[DocumentService]
            NATS[NATS Client]
        end
    end

    subgraph Backend["Backend"]
        API[API Service]
        DB[(DynamoDB)]
    end

    Sidebar --> WSS
    Sidebar --> WSvc
    WCS --> WS
    WCS --> DS
    WCS --> WC
    WC --> XY

    WCS --> WSvc
    WCS --> DSvc
    WSvc --> NATS
    DSvc --> NATS
    NATS --> API
    API --> DB
```

## Data Model

### Workspace (Backend)

```typescript
type Workspace = {
    workspaceId: string
    name: string
    accessType: 'private' | 'shared'
    files: string[]              // Document IDs
    canvasState: CanvasState
    createdAt: number
    updatedAt: number
}
```

### CanvasState

```typescript
type CanvasState = {
    viewport: {
        x: number      // Pan offset X
        y: number      // Pan offset Y
        zoom: number   // 0.1 to 2.0
    }
    nodes: CanvasNode[]
}
```

### CanvasNode

Canvas nodes use a discriminated union based on the `type` field:

```typescript
type CanvasNodeType = 'document' | 'image'

// Document node - contains a ProseMirror editor
type DocumentCanvasNode = {
    nodeId: string
    type: 'document'
    referenceId: string    // Points to Document.documentId
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

// Image node - displays an uploaded image
type ImageCanvasNode = {
    nodeId: string
    type: 'image'
    fileId: string         // Points to file in NATS Object Store
    workspaceId: string    // For deletion context
    src: string            // Full URL for rendering
    aspectRatio: number    // Used for aspect-ratio-locked resize
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

type CanvasNode = DocumentCanvasNode | ImageCanvasNode
```

## User Flows

### Opening a Workspace

```mermaid
sequenceDiagram
    participant User
    participant Sidebar
    participant Router
    participant WSvc as WorkspaceService
    participant DSvc as DocumentService
    participant Canvas

    User->>Sidebar: Click workspace
    Sidebar->>Router: navigateTo(/workspace/:id)
    Router->>WSvc: getWorkspace()
    WSvc->>WSvc: Fetch via NATS
    WSvc->>workspaceStore: setDataValues()
    Router->>DSvc: getWorkspaceDocuments()
    DSvc->>documentsStore: setDocuments()
    Canvas->>Canvas: render(canvasState, documents)
```

### Creating a Document

```mermaid
sequenceDiagram
    participant User
    participant Canvas
    participant DSvc as DocumentService
    participant WSvc as WorkspaceService

    User->>Canvas: Click "+ New Document"
    Canvas->>DSvc: createDocument()
    DSvc->>DSvc: NATS request
    DSvc->>documentsStore: addDocuments()
    DSvc-->>Canvas: Return document
    Canvas->>Canvas: Calculate position
    Canvas->>WSvc: updateCanvasState()
    Canvas->>Canvas: Re-render with new node
```

### Adding an Image

```mermaid
sequenceDiagram
    participant User
    participant Svelte as WorkspaceCanvas.svelte
    participant Modal as ImageUploadModal
    participant API as /api/images/:workspaceId
    participant ObjStore as NATS Object Store
    participant WSvc as WorkspaceService

    User->>Svelte: Click "+ Add Image"
    Svelte->>Modal: show()
    User->>Modal: Select/drop image file
    Modal->>API: POST file (multipart)
    API->>ObjStore: putObject(fileId, buffer)
    API-->>Modal: { fileId, url }
    Modal->>Svelte: onComplete({ fileId, src })
    Svelte->>Svelte: Load image to get aspectRatio
    Svelte->>Svelte: Create ImageCanvasNode
    Svelte->>WSvc: updateCanvasState()
    Svelte->>Svelte: Re-render with new image node
```

### Deleting an Image

When an image node is removed from the canvas (either by user action or programmatically):

```mermaid
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant Tracker as canvasImageLifecycle
    participant NATS as NATS Client
    participant API as API Service
    participant ObjStore as NATS Object Store

    User->>Canvas: Remove image node
    Canvas->>Canvas: commitCanvasState(newState)
    Canvas->>Tracker: trackCanvasState(newState)
    Tracker->>Tracker: Compare previous vs current
    Tracker->>Tracker: Detect removed image
    Tracker->>NATS: DELETE_IMAGE request
    NATS->>API: Handle deletion
    API->>ObjStore: deleteObject(fileId)
    API->>API: Remove from workspace.files
```

### Editing Content

```mermaid
sequenceDiagram
    participant User
    participant ProseMirror
    participant Canvas as WorkspaceCanvas.ts
    participant Svelte as WorkspaceCanvas.svelte
    participant DSvc as DocumentService

    User->>ProseMirror: Type content
    ProseMirror->>Canvas: onEditorChange(content)
    Canvas->>Svelte: onDocumentContentChange()
    Svelte->>DSvc: updateDocument()
    DSvc->>DSvc: NATS request (debounced)
```

### Moving a Document

```mermaid
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant Svelte
    participant Store as workspaceStore
    participant WSvc as WorkspaceService

    User->>Canvas: Mousedown on drag overlay
    Canvas->>Canvas: Disable pan, track mouse
    User->>Canvas: Mousemove
    Canvas->>Canvas: Update node position (DOM)
    User->>Canvas: Mouseup
    Canvas->>Svelte: onCanvasStateChange(newNodes)
    Svelte->>Store: updateCanvasState()
    Svelte->>WSvc: updateCanvasState()
```

## Frontend Stores

### workspacesStore

Holds the list of workspaces shown in the sidebar. Minimal metadata only (id, name, timestamps).

```typescript
{
    meta: { loadingStatus },
    data: WorkspaceMeta[]
}
```

### workspaceStore

The currently open workspace with full canvas state.

```typescript
{
    meta: { loadingStatus, isInEdit, requiresSave },
    data: {
        workspaceId,
        name,
        canvasState,
        files,
        ...
    }
}
```

### documentsStore

Documents belonging to the current workspace.

```typescript
{
    meta: { loadingStatus },
    data: Document[]
}
```

## Backend API (NATS Subjects)

| Subject | Purpose |
|---------|---------|
| `WORKSPACE.GET_USER_WORKSPACES` | List user's workspaces |
| `WORKSPACE.GET_WORKSPACE` | Get single workspace with canvas state |
| `WORKSPACE.CREATE_WORKSPACE` | Create new workspace |
| `WORKSPACE.UPDATE_WORKSPACE` | Update name |
| `WORKSPACE.UPDATE_CANVAS_STATE` | Persist viewport and node positions |
| `WORKSPACE.DELETE_WORKSPACE` | Delete workspace |
| `WORKSPACE.GET_WORKSPACE_DOCUMENTS` | Get documents in workspace |
| `DOCUMENT.CREATE_DOCUMENT` | Create document |
| `DOCUMENT.UPDATE_DOCUMENT` | Update document content/title |
| `DOCUMENT.DELETE_DOCUMENT` | Delete document |
| `WORKSPACE_IMAGE.DELETE_IMAGE` | Delete image from Object Store |

### Image HTTP Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/images/:workspaceId` | POST | Upload image (multipart/form-data) |
| `/api/images/:workspaceId/:fileId` | GET | Serve image with auth token |

## Rendering Pipeline

```mermaid
flowchart LR
    subgraph Input
        CS[canvasState]
        DOCS[documents]
    end

    subgraph WorkspaceCanvas.ts
        RN[renderNodes]
        CDN[createDocumentNode]
        CIN[createImageNode]
        PM[ProseMirrorEditor]
    end

    subgraph DOM
        VP[.workspace-viewport]
        DOCNODES[.workspace-document-node]
        IMGNODES[.workspace-image-node]
        ED[.document-node-editor]
        IMG[img element]
    end

    CS --> RN
    DOCS --> RN
    RN --> CDN
    RN --> CIN
    CDN --> PM
    CDN --> DOCNODES
    CIN --> IMGNODES
    DOCNODES --> VP
    IMGNODES --> VP
    PM --> ED
    CIN --> IMG
```

## Persistence Strategy

Canvas state changes are debounced (1 second) before persisting. This prevents hammering the backend during continuous pan/zoom operations.

Document content changes are handled by `DocumentService.updateDocument()` which has its own debouncing logic.

Position and dimension changes after drag/resize are persisted immediately via `onCanvasStateChange`.

## Image Lifecycle Management

Images on the canvas are tracked by `canvasImageLifecycle.ts`. When an image node is removed from the canvas state:

1. The tracker compares previous and current canvas states
2. Detects which fileIds are no longer present
3. Calls `deleteImage()` from `imageUtils.ts` to delete from storage
4. The same `deleteImage()` utility is shared with ProseMirror's `imageLifecyclePlugin`

This ensures orphaned images don't accumulate in storage.

## Future Considerations

- **Multi-user collaboration** — Real-time sync of canvas state and document content
- **Additional node types** — Embeds, connectors between nodes, sticky notes
- **Workspace templates** — Pre-arranged layouts for common use cases
- **Tags on workspaces** — Already stubbed in `WorkspaceService.addTagToWorkspace()`
- **Image metadata editing** — Alt text, titles via context menu
