# Workspace Feature

A workspace is the primary container where users organize and edit their documents. Think of it as an infinite canvas where document cards float, can be arranged freely, resized, and edited in place.

## Core Concepts

**Workspace** — A named container owned by a user. Has a canvas state (viewport position, zoom level, and node positions) plus references to documents.

**Canvas Node** — A positioned rectangle on the canvas representing a document. Stores position, dimensions, and a reference ID pointing to the actual document.

**Document** — The actual content (ProseMirror JSON). Lives separately from its canvas representation so the same document could theoretically appear in multiple workspaces.

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

```typescript
type CanvasNode = {
    nodeId: string
    type: 'document'
    referenceId: string    // Points to Document.documentId
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}
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
        PM[ProseMirrorEditor]
    end

    subgraph DOM
        VP[.workspace-viewport]
        NODES[.workspace-document-node]
        ED[.document-node-editor]
    end

    CS --> RN
    DOCS --> RN
    RN --> CDN
    CDN --> PM
    CDN --> NODES
    NODES --> VP
    PM --> ED
```

## Persistence Strategy

Canvas state changes are debounced (1 second) before persisting. This prevents hammering the backend during continuous pan/zoom operations.

Document content changes are handled by `DocumentService.updateDocument()` which has its own debouncing logic.

Position and dimension changes after drag/resize are persisted immediately via `onCanvasStateChange`.

## Future Considerations

- **Multi-user collaboration** — Real-time sync of canvas state and document content
- **Node types beyond documents** — Images, embeds, connectors between nodes
- **Workspace templates** — Pre-arranged layouts for common use cases
- **Tags on workspaces** — Already stubbed in `WorkspaceService.addTagToWorkspace()`
