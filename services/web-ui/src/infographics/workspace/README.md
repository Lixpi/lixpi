# Workspace Canvas

This module renders the main workspace view—a zoomable, pannable canvas where documents, images, and AI chat threads appear as draggable, resizable cards.

## What It Does

When you open a workspace, you see a canvas. On that canvas are nodes (documents, images, or AI chat threads). You can:

- **Pan** the canvas by clicking and dragging empty space (or two-finger scroll on trackpad)
- **Zoom** with pinch gestures or Ctrl+scroll
- **Drag** nodes by grabbing the overlay (top bar for documents/threads, anywhere for images)
- **Resize** nodes from any corner (images preserve aspect ratio)
- **Edit** document content directly—ProseMirror editors are embedded in document cards
- **Chat with AI** in AI chat thread nodes—each thread maintains its own conversation context
- **Add images** via the toolbar button which opens an upload modal
- **Add AI Chats** via the toolbar button which creates a new AI chat thread

All of this happens without the Svelte component knowing the details. It just passes DOM refs and gets callbacks when things change.

## Node Types

### Document Nodes
- Contain embedded ProseMirror editors with `documentType: 'document'`
- Have a drag overlay at the top (20px)
- Free resize (no aspect ratio constraint)
- Support block-level content (paragraphs, headings, lists, etc.)

### Image Nodes
- Display uploaded images from workspace storage
- Have a full-area drag overlay
- Resize preserves aspect ratio (stored when image is uploaded)
- Automatically deleted from storage when removed from canvas

### AI Chat Thread Nodes
- Contain embedded ProseMirror editors with `documentType: 'aiChatThread'`
- Have a drag overlay at the top (20px)
- Free resize (no aspect ratio constraint)
- Each thread has its own `AiInteractionService` instance for AI messaging
- Support streaming AI responses with real-time token parsing
- Content is persisted separately from documents in the AI-Chat-Threads table

## Architecture

```mermaid
flowchart TB
    subgraph Svelte["Svelte Layer"]
        WC[WorkspaceCanvas.svelte]
        WS[workspaceStore]
        DS[documentsStore]
        TS[aiChatThreadsStore]
    end

    subgraph Core["Framework-Agnostic Core"]
        CC[createWorkspaceCanvas]
        PZ[XYPanZoom instance]
        DN[Document Nodes]
        IN[Image Nodes]
        TN[AI Chat Thread Nodes]
        PM[ProseMirror Editors]
        AIS[AiInteractionService]
        IL[Canvas Image Lifecycle]
    end

    subgraph Backend["Backend Services"]
        NS[NATS Service]
        API[Workspace API]
        LLMAPI[llm-api Python]
        OBJ[NATS Object Store]
    end

    WC -->|"paneEl, viewportEl"| CC
    WC -->|"canvasState, documents, threads"| CC
    CC -->|"onCanvasStateChange"| WC
    WC -->|"persistCanvasState"| WS
    WS -->|"updateCanvasState"| NS
    NS --> API

    CC --> PZ
    CC --> DN
    CC --> IN
    CC --> TN
    DN --> PM
    TN --> PM
    TN --> AIS
    AIS -->|"streaming"| LLMAPI
    CC --> IL
    IL -->|"deleteImage"| NS
    NS -->|"DELETE_IMAGE"| OBJ
```

## How It Works

### Initialization

1. Svelte mounts and binds `paneEl` and `viewportEl` refs
2. `createWorkspaceCanvas()` is called with these refs plus initial data
3. XYPanZoom attaches to the pane for viewport control
4. Document nodes are created as DOM elements and appended to viewport

### Viewport Transform

The viewport element uses CSS transforms for pan/zoom:

```
transform: translate(${x}px, ${y}px) scale(${zoom})
```

XYPanZoom fires `onTransformChange` on every pan/zoom. We update the CSS and notify Svelte via `onViewportChange`. The Svelte layer debounces and persists to backend.

### Document Nodes

Each canvas node becomes a `div.workspace-document-node` with:

```
┌─────────────────────────────────────────┐
│ .document-drag-overlay (20px, cursor:move)
├─────────────────────────────────────────┤
│                                         │
│  .document-node-editor                  │
│  (ProseMirror lives here)               │
│                                         │
└─────────────────────────────────────────┘
  ↖ resize     resize ↗
  handle       handle

  ↙ resize     resize ↘
  handle       handle
```

### Image Nodes

Image nodes have a simpler structure:

```
┌─────────────────────────────────────────┐
│                                         │
│  .image-node-content                    │
│  (contains img element)                 │
│                                         │
│  .image-drag-overlay                    │
│  (covers entire image for dragging)     │
│                                         │
└─────────────────────────────────────────┘
  ↖ resize     resize ↗
  handle       handle

  ↙ resize     resize ↘
  handle       handle
```

Image resize always preserves aspect ratio using the `aspectRatio` value stored when the image was uploaded.

On image load the client verifies the image's natural aspect ratio and will auto-correct the node's dimensions if a mismatch is detected (this helps self-heal nodes created by older clients). When a correction is necessary the client persists the corrected `dimensions` and updated `aspectRatio` via the normal canvas state persistence flow (`onCanvasStateChange` / `commitCanvasState`).

Resizing uses a stable diagonal-based calculation to preserve aspect ratio smoothly during diagonal drags and avoid axis-switching jumps that can cause jitter during resize. Resize handles are dynamically sized and positioned (computed from the current viewport zoom) so they remain a uniform screen-pixel size and precisely aligned to the image corners regardless of canvas zoom or image scale.

### Image Lifecycle

When an image node is removed from the canvas, the `canvasImageLifecycle` tracker detects the change and triggers deletion from NATS Object Store via the `WORKSPACE_SUBJECTS.IMAGE_SUBJECTS.DELETE_IMAGE` NATS subject.

### Drag and Resize

Both drag and resize temporarily disable XYPanZoom's panning to prevent conflicts:

```typescript
panZoom.update({
    ...panZoomConfig,
    panOnDrag: false,
    userSelectionActive: true,
    connectionInProgress: true
})
```

After mouse-up, we re-enable panning and commit the new position/dimensions via `onCanvasStateChange`.

Note: viewport transforms are only re-applied when the saved viewport actually changes. This prevents temporary zoom/pan flashes when unrelated canvas updates (for example, image onload corrections) occur.

Rendering note: full re-renders are triggered when node structure or document load state changes; position/dimension updates are handled directly in the DOM during drag/resize to avoid unnecessary work.

### ProseMirror Integration

Each document node instantiates a `ProseMirrorEditor`. The editor container has `.nopan` so clicking inside doesn't pan the canvas. Content changes fire `onDocumentContentChange` which the Svelte layer forwards to `DocumentService`.

## State Flow

```mermaid
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant Svelte as WorkspaceCanvas.svelte
    participant Store as workspaceStore
    participant Service as WorkspaceService
    participant Backend as NATS/API

    User->>Canvas: Drag document
    Canvas->>Canvas: Update DOM position
    User->>Canvas: Release mouse
    Canvas->>Svelte: onCanvasStateChange(newState)
    Svelte->>Store: updateCanvasState(newState)
    Svelte->>Service: updateCanvasState()
    Service->>Backend: NATS request
```

## Files

| File | Purpose |
|------|---------|
| `WorkspaceCanvas.ts` | Core logic: pan/zoom setup, node creation, drag/resize handlers |
| `workspace-canvas.scss` | All styles for canvas, nodes, handles, editors |
| `canvasImageLifecycle.ts` | Tracks image nodes and deletes orphaned images from storage |

## CSS Classes

| Class | Purpose |
|-------|---------|
| `.workspace-canvas` | Root container |
| `.workspace-pane` | Pan/zoom target |
| `.workspace-viewport` | Transformed container for nodes |
| `.workspace-document-node` | Individual document card |
| `.workspace-image-node` | Individual image card |
| `.workspace-ai-chat-thread-node` | Individual AI chat thread card |
| `.document-drag-overlay` | Top bar for dragging documents |
| `.ai-chat-thread-drag-overlay` | Top bar for dragging AI chat threads |
| `.image-drag-overlay` | Full-area overlay for dragging images |
| `.document-node-editor` | ProseMirror container for documents |
| `.ai-chat-thread-node-editor` | ProseMirror container for AI chat threads |
| `.image-node-content` | Image container |
| `.image-node-img` | The actual img element |
| `.document-resize-handle` | Corner resize controls (shared by all node types) |
| `.nopan` | Prevents panning when interacting |
| `.is-dragging` / `.is-resizing` | State classes during interaction |
