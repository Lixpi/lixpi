# Workspace Feature

A workspace is the primary container where users organize and edit their documents, images, videos, and AI context. Think of it as an infinite canvas where cards float, can be arranged freely, resized, and edited in place.

> **Renderer architecture note.** The workspace canvas uses the `services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts` stack for DOM interactions and PIXI v8 for high-volume visual layers. The media layer renders image pixels, video posters/placeholders, and workspace connector pixels through `services/web-ui/src/infographics/workspace/pixiMediaLayer.ts`, and delegates generated-image progress painting to the reusable PIXI `services/web-ui/src/utils/animations/gradients/pixiTravelingOutlineRenderer.ts`; document nodes, AI chat thread nodes, prompt inputs, bubble menus, resize/drag/selection chrome, and handles stay in the DOM implementation. Canvas image nodes have no DOM `<img>` pixel surface: stored images, generated partials, and their animated in-progress outline are visible only through PIXI. Completed videos are the exception to pure PIXI pixels: a visible DOM `<video>` element owns playback and shared SVG controls above the PIXI poster. Workspace connector hit testing and bubble-menu anchoring use cached PIXI path data.
>
> For the rendering pipeline, LoD strategy, texture cache, decode pool, edge diffing, and the list of remaining performance issues, see [CANVAS-ENGINE.md](CANVAS-ENGINE.md). For collision resolution, placement cleanup, and drag-release collision rules, see [CANVAS-COLLISION-RESOLUTION.md](CANVAS-COLLISION-RESOLUTION.md).

## Core Concepts

**Workspace** — A named container owned by a user. Has a canvas state (viewport position, zoom level, and node positions) plus references to documents, AI chat threads, and uploaded files.

**Canvas Node** — A positioned item on the canvas. It can be a document node, an image node, a video node, or an AI chat thread node. Stores position, dimensions, and type-specific data.

**Document** — The actual text content (ProseMirror JSON). Lives separately from its canvas representation so the same document could theoretically appear in multiple workspaces. Documents use `documentType: 'document'` and contain block-level content (paragraphs, headings, lists, etc.).

**AI Chat Thread** — A persisted AI conversation session stored in the AI-Chat-Threads DynamoDB table. A thread is standalone; its ProseMirror history is rendered in an AI Chat panel tab and streamed through its own `AiInteractionService`.

**AI Chat Panel** — A workspace-owned right-side surface that can be opened without selecting a region or creating a chat session. It persists visibility, tabs, active tab, width, prompt drafts, and standalone context settings. A standalone `AiChatThread` is created only when the first prompt is submitted.

**Image** — An uploaded, imported, generated, or restored image file stored in NATS Object Store. Canvas nodes reference workspace-owned image objects and delete them when removed from the canvas. A user can explicitly save a separate Media Library copy that is not deleted with the source node.

**Video** — A generated or restored MP4 stored in NATS Object Store with a poster and optional representative still. The canvas renders a PIXI poster behind a browser-composited `<video>` surface so playback, scrubbing, PiP, and fullscreen do not depend on a PIXI video texture loop.

**Viewport** — The current view: x/y offset and zoom level. Persisted so users return to where they left off. While a workspace is open, the live viewport inside `WorkspaceCanvas.ts` is the rendering source of truth; Svelte/store persistence is an acknowledgement path. A delayed store render must not replay an older viewport-only state over the current transform.

## System Architecture

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph Client["Browser"]
        subgraph Svelte["Svelte Components"]
            Sidebar[Sidebar.svelte]
            WCS[WorkspaceCanvas.svelte]
        end

        subgraph Stores["Svelte Stores"]
            WSS[workspacesStore]
            WS[workspaceStore]
            DS[documentsStore]
            TS[aiChatThreadsStore]
        end

        subgraph Infographics["Framework-Agnostic Layer"]
            WC[WorkspaceCanvas.ts]
            WCM[WorkspaceConnectionManager]
            XY[XYPanZoom]
            PER[PIXI Edge Renderer]
        end

        subgraph Services["Frontend Services"]
            WSvc[WorkspaceService]
            DSvc[DocumentService]
            TSvc[AiChatThreadService]
            AIS[AiInteractionService]
            NATS[NATS Client]
        end
    end

    subgraph Backend["Backend"]
        API[API Service]
        LLM[API LLM module<br/>in-process LangGraph]
        DB[(DynamoDB)]
    end

    Sidebar --> WSS
    Sidebar --> WSvc
    WCS --> WS
    WCS --> DS
    WCS --> TS
    WCS --> WC
    WC --> XY
    WC --> WCM
    WCM --> PER

    WCS --> WSvc
    WCS --> DSvc
    WCS --> TSvc
    WC --> AIS
    WSvc --> NATS
    DSvc --> NATS
    TSvc --> NATS
    AIS --> NATS
    NATS --> API
    NATS --> LLM
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
    edges: WorkspaceEdge[]  // Connections between nodes
    aiChatPanel?: {
        isOpen: boolean
        isSessionHistoryOpen: boolean
        tabs: Array<{ tabId: string; type: 'thread' | 'extraction'; refId: string; title: string }>
        activeTabId?: string
        contextMode: 'followSelection' | 'pinnedContext'
        includeUpstreamContext: boolean
        contextNodeIds: string[]
        width?: number
        drafts?: Record<string, { content?: object }>
    }
    featureExtractionRuns?: Record<string, CanvasFeatureExtractionState>
}
```

### WorkspaceEdge

Edges represent visual connections between canvas nodes, used for showing context flows and dependencies.

```typescript
type WorkspaceEdge = {
    edgeId: string
    sourceNodeId: string
    targetNodeId: string
    sourceHandle?: string  // e.g., 'right'
    targetHandle?: string  // e.g., 'left'
    sourceT?: number       // Position along source side (0=top, 1=bottom, 0.5=center). Default: 0.5
    targetT?: number       // Position along target side (0=top, 1=bottom, 0.5=center). Default: 0.5
    sourceMessageId?: string  // Links edge to a specific aiResponseMessage (by its id attr) within the source AI chat thread
}
```

The `sourceT` and `targetT` properties allow edges to attach at any vertical position along a node's side, not just the center. When a user creates a connection by dragging, the `t` values are computed from the pointer position where they started and dropped.

The `sourceMessageId` property enables precise per-response-message tracking for AI-generated images. When an AI chat thread generates an image, the resulting canvas image node is connected back to the thread via an edge whose `sourceMessageId` identifies the specific `aiResponseMessage` that produced it. This allows context extraction to associate images with their originating conversation turns.

### Connection Routing

The `WorkspaceConnectionManager` handles the visual rendering logic for edges.

- **Routing Style**: Configured via the `CONNECTION_STYLE` constant. Defaults to `'orthogonal'` (circuit-board style) but can be switched to `'horizontal-bezier'` (smooth curves).
- **Auto-Alignment**: If a source node is vertically aligned with its target, the connection automatically snaps to a perfectly straight horizontal line by adjusting the `targetT` value.
- **Message-Level Anchoring**: When an edge has a `sourceMessageId` (connecting a specific AI response to an image), the renderer dynamically calculates `sourceT` to anchor the arrow exactly to the message bubble in the DOM. It also intelligently adjusts `targetT` to ensure the arrow points in a straight line to the target image height, preventing the "diving arrow" effect.
- **Corner Snapping**: If nodes are not aligned, the connector snaps to the nearest top/bottom corner (t=0.05 or t=0.95) to minimize diagonal visual clutter.
- **Drag Visualization**: While dragging, connections use a smooth bezier curve to distinguish them from committed orthogonal edges.
- **Proximity Connect**: Dragging a node (Document/Image) near an AI Chat Thread automatically suggests a connection with a dashed "ghost" line. Dropping the node creates the link. The proximity threshold is 1200px, and it prevents duplicate connections.

### AI Generated Content Layout

When an AI thread generates images, the workspace manages their placement automatically to maintain a clean layout:

- **Positioning**: First outputs are placed to the right of the source thread root using the spacing configured in `settings.imageBranchLineage`. Image-to-image continuations use the latest image in the branch as the anchor.
- **Scale**: Generated image nodes use the configured canvas-unit size regardless of the current zoom level.
- **Stacking and alignment**: Multiple first-generation outputs stack next to the source region using the configured branch-lineage spacing. Image-to-image continuations stay vertically aligned with the previous image in the branch lineage.
- **Race Condition Handling**: The layout engine tracks synchronous "partial" image states to ensure that simultaneous updates (e.g., partial stream + final completion) do not cause images to overlap or skip positional slots.
- **Generated-image provenance chrome**: AI-generated image nodes render provider badges and an info button in a dedicated DOM overlay above the PIXI media canvas. The info panel opens at the exact image-node width, expands to its full content height without cropping long prompts or metadata, and uses the image node's `generatedBy.responseMessageId` to reconstruct the originating user prompt and AI response from the chat thread. It reuses the same chat message shells and `ImageGenerationTrace` detail renderer used by the AI chat history.

### CanvasNode

Canvas nodes use a discriminated union based on the `type` field:

```typescript
type CanvasNodeType = 'document' | 'image' | 'aiChatThread'

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

// AI Chat Thread node - contains an AI conversation
type AiChatThreadCanvasNode = {
    nodeId: string
    type: 'aiChatThread'
    referenceId: string    // Points to AiChatThread.threadId
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

type CanvasNode = DocumentCanvasNode | ImageCanvasNode | AiChatThreadCanvasNode
```

## User Flows

### Opening a Workspace

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Sidebar
    participant Router
    participant WSvc as WorkspaceService
    participant DSvc as DocumentService
    participant Canvas
    participant workspaceStore
    participant documentsStore
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: NAVIGATION
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, documentsStore: PHASE 1 - NAVIGATION — User chooses a workspace
        User->>Sidebar: Click workspace
        Sidebar->>Router: navigateTo(/workspace/:id)
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: DATA FETCH
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, documentsStore: PHASE 2 - DATA FETCH
        activate WSvc
        Router->>WSvc: getWorkspace()
        WSvc->>WSvc: Fetch via NATS
        WSvc-->>workspaceStore: setDataValues()
        deactivate WSvc
        activate DSvc
        Router->>DSvc: getWorkspaceDocuments()
        DSvc-->>documentsStore: setDocuments()
        deactivate DSvc
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: RENDER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, documentsStore: PHASE 3 - RENDER — Render with loaded state
        Canvas->>Canvas: render(canvasState, documents)
    end
```

### Creating a Document

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas
    participant DSvc as DocumentService
    participant WSvc as WorkspaceService
    participant documentsStore
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: REQUEST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, documentsStore: PHASE 1 - REQUEST — User initiates document creation
        User->>Canvas: Click "+ New Document"
        Canvas->>DSvc: createDocument()
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: BACKEND WORK
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, documentsStore: PHASE 2 - BACKEND WORK
        activate DSvc
        DSvc->>DSvc: NATS request
        DSvc-->>documentsStore: addDocuments()
        DSvc-->>Canvas: Return document
        deactivate DSvc
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: RENDER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, documentsStore: PHASE 3 - RENDER
        Canvas->>Canvas: Calculate position
        Canvas->>WSvc: updateCanvasState()
        Canvas->>Canvas: Re-render with new node
    end
```

### Adding an Image

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Svelte as WorkspaceCanvas.svelte
    participant Modal as ImageUploadModal
    participant API as /api/images/:workspaceId
    participant ObjStore as NATS Object Store
    participant WSvc as WorkspaceService
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: UPLOAD
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, WSvc: PHASE 1 - UPLOAD — User picks an image
        User->>Svelte: Click "+ Add Image"
        activate Svelte
        Svelte->>Modal: show()
        deactivate Svelte
        User->>Modal: Select/drop image file
        activate Modal
        Modal->>API: POST file (multipart)
        activate API
        API->>ObjStore: putObject(fileId, buffer)
        API-->>Modal: { fileId, url }
        deactivate API
        deactivate Modal
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: CREATE NODE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, WSvc: PHASE 2 - CREATE NODE
        Modal-->>Svelte: onComplete({ fileId, src })
        activate Svelte
        Svelte->>Svelte: Load image to get aspectRatio
        Svelte->>Svelte: Create ImageCanvasNode
        deactivate Svelte
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: PERSIST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, WSvc: PHASE 3 - PERSIST
        activate Svelte
        Svelte->>WSvc: updateCanvasState()
        activate WSvc
        deactivate WSvc
        Svelte->>Svelte: Re-render with new image node
        deactivate Svelte
    end
```

Note: after an image is uploaded or imported from a public URL, the client loads the persisted workspace object to determine the natural aspect ratio. URL insertion uses `POST /api/images/:workspaceId/import-url`, which validates and stores the fetched image in the workspace Object Store before creating a canvas node; a canvas image node is therefore never backed only by an external URL. On load the client verifies that the stored node dimensions match that ratio; if they do not match it corrects the node dimensions and persists the corrected values so stale nodes self-heal. Image resize uses a diagonal-based algorithm for smooth, aspect-locked resizing and the UI computes resize handle size/offsets dynamically so handles remain visually consistent regardless of canvas zoom.

### Saving Media to the Media Library

Completed image and video nodes expose `Add to Media Library` in their canvas bubble menu. Partially streaming AI-generated images and VEO videos still polling do not expose the action until a stored final object exists. Saving is explicit: it copies image bytes, or video MP4 plus poster bytes, from `workspace-{workspaceId}-files/{fileId}` into a Media Library scope-owned Object Store bucket and writes a generic media metadata record. New saves start in `Workspace` scope; users can view or move items through `Workspace`, `Mine`, `Organization`, and `Public` scopes, or browse `All available`. Saving confirms in place with a transient message on the canvas; it does not open or switch the panel. Re-saving the same source media is deduplicated — the server returns the existing library item instead of writing a second independent copy.

The Media Library panel is implemented by the canvas module rather than a Svelte component. Its independent launcher sits above the existing bottom-right zoom indicator, and both shift left with any active AI chat panel. The open drawer covers that launcher, is flush to the pane's top and bottom, and occupies two-thirds of the remaining workspace width. A segmented `Features` / `Images` / `Videos` control and compact `Scope` selector replace stacked filter rows. `Features` (the default category) uses concise visual browse cards and a separate inspector that exposes full summaries, instructions, tags, samples, palette details, and owner sharing controls; at narrow widths selection becomes a focused detail view with Back. Feature cards clamp only the browsing summary preview; complete stored details remain available in the inspector.

Selecting `Add to canvas` on saved media reads its library object, calls the existing workspace image or video storage path to create fresh workspace-owned object(s), and inserts a fresh `ImageCanvasNode` or `VideoCanvasNode` through the canvas insertion helper. Removing the original canvas media therefore does not remove its explicitly saved Media Library copy. Deleting a workspace removes only Media Library items still scoped to that workspace; media moved to a broader scope is retained separately. Promoted Features are different records: their sample bytes are copied into durable user-owned Feature storage before promotion, and deletion of an origin workspace migrates legacy promoted samples before deleting the workspace bucket.

### Deleting an Image

When an image node is removed from the canvas (either by user action or programmatically):

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant Tracker as canvasImageLifecycle
    participant NATS as NATS Client
    participant API as API Service
    participant ObjStore as NATS Object Store
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: REMOVE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, ObjStore: PHASE 1 - REMOVE — User deletes image from canvas
        User->>Canvas: Remove image node
        activate Canvas
        Canvas->>Canvas: commitCanvasState(newState)
        deactivate Canvas
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: DETECT
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, ObjStore: PHASE 2 - DETECT
        Canvas->>Tracker: trackCanvasState(newState)
        activate Tracker
        Tracker->>Tracker: Compare previous vs current
        Tracker->>Tracker: Detect removed image
        deactivate Tracker
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: DELETE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, ObjStore: PHASE 3 - DELETE
        activate Tracker
        Tracker->>NATS: DELETE_IMAGE request
        NATS->>API: Handle deletion
        activate API
        API->>ObjStore: deleteObject(fileId)
        API->>API: Remove from workspace.files
        deactivate API
        deactivate Tracker
    end
```

### Editing Content

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant ProseMirror
    participant Canvas as WorkspaceCanvas.ts
    participant Svelte as WorkspaceCanvas.svelte
    participant DSvc as DocumentService
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: EDIT
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, DSvc: PHASE 1 - EDIT — User edits content
        User->>ProseMirror: Type content
        activate ProseMirror
        deactivate ProseMirror
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: PROPAGATE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, DSvc: PHASE 2 - PROPAGATE
        ProseMirror->>Canvas: onEditorChange(content)
        activate Canvas
        Canvas->>Svelte: onDocumentContentChange()
        activate Svelte
        Svelte->>DSvc: updateDocument()
        deactivate Svelte
        deactivate Canvas
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: PERSIST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, DSvc: PHASE 3 - PERSIST
        activate DSvc
        DSvc->>DSvc: NATS request (debounced)
        deactivate DSvc
    end
```

### Moving a Document

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant Svelte
    participant Store as workspaceStore
    participant WSvc as WorkspaceService
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: DRAG
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, WSvc: PHASE 1 - DRAG
        User->>Canvas: Mousedown on drag overlay
        activate Canvas
        Canvas->>Canvas: Disable pan, track mouse
        User->>Canvas: Mousemove
        Canvas->>Canvas: Update node position (DOM)
        User->>Canvas: Mouseup
        deactivate Canvas
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: SAVE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, WSvc: PHASE 2 - SAVE
        Canvas->>Svelte: onCanvasStateChange(newNodes)
        activate Svelte
        Svelte->>Store: updateCanvasState()
        Svelte->>WSvc: updateCanvasState()
        activate WSvc
        deactivate WSvc
        deactivate Svelte
    end
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

### aiChatThreadsStore

AI chat threads belonging to the current workspace.

```typescript
{
    meta: { loadingStatus },
    data: Map<string, AiChatThread>  // Keyed by threadId for O(1) lookup
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
| `AI_CHAT_THREAD.CREATE` | Create AI chat thread |
| `AI_CHAT_THREAD.GET` | Get AI chat thread by workspaceId + threadId |
| `AI_CHAT_THREAD.UPDATE` | Update AI chat thread content |
| `AI_CHAT_THREAD.DELETE` | Delete AI chat thread |
| `AI_CHAT_THREAD.GET_BY_WORKSPACE` | Get all AI chat threads in workspace |
| `AI_INTERACTION.CHAT_SEND_MESSAGE` | Send message to AI for processing |
| `AI_INTERACTION.CHAT_STOP_MESSAGE` | Stop active AI streaming |
| `AI_INTERACTION.FEATURE_EXTRACT.LIST_BY_WORKSPACE` | List extraction sessions for Sessions history |
| `AI_INTERACTION.FEATURE_EXTRACT.DELETE` | Delete an extraction session without deleting its saved Feature |
| `WORKSPACE_IMAGE.DELETE_IMAGE` | Delete image from Object Store |
| `WORKSPACE_VIDEO.DELETE_VIDEO` | Delete video from Object Store |
| `WORKSPACE.MEDIA_LIBRARY.CREATE_FROM_IMAGE` | Copy a stored canvas image into the Media Library |
| `WORKSPACE.MEDIA_LIBRARY.CREATE_FROM_VIDEO` | Copy a stored canvas video and poster into the Media Library |
| `WORKSPACE.MEDIA_LIBRARY.LIST_AVAILABLE` | List saved media visible in selected scopes |
| `WORKSPACE.MEDIA_LIBRARY.MATERIALIZE_IMAGE_TO_WORKSPACE` | Copy a saved image into workspace storage for canvas insertion |
| `WORKSPACE.MEDIA_LIBRARY.MATERIALIZE_VIDEO_TO_WORKSPACE` | Copy a saved video and poster into workspace storage for canvas insertion |
| `WORKSPACE.MEDIA_LIBRARY.CHANGE_SCOPE` | Copy a library object to a new scope and update metadata |
| `WORKSPACE.MEDIA_LIBRARY.DELETE` | Delete a saved library item and its stored object(s) |

### Media HTTP Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/images/:workspaceId` | POST | Upload image (multipart/form-data) |
| `/api/images/:workspaceId/import-url` | POST | Fetch a public image URL into workspace Object Store before canvas insertion |
| `/api/images/:workspaceId/:fileId` | GET | Serve image with auth token |
| `/api/videos/:workspaceId` | POST | Upload replacement or user-supplied video, store its MP4, and best-effort extract a poster |
| `/api/videos/:workspaceId/:fileId` | GET | Serve video with auth token and HTTP Range support |
| `/api/media-library/items/:itemId/content` | GET | Serve an ACL-checked saved Media Library image preview or Range-capable video preview |
| `/api/media-library/items/:itemId/poster` | GET | Serve an ACL-checked saved Media Library video poster |
| `/api/workspaces/:workspaceId/export` | GET | Download workspace as ZIP archive (see [WORKSPACE-EXPORT.md](WORKSPACE-EXPORT.md)) |

## Rendering Pipeline

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart LR
    subgraph Input
        CS[canvasState]
        DOCS[documents]
        THREADS[aiChatThreads]
    end

    subgraph WorkspaceCanvas.ts
        RN[renderNodes]
        CDN[createDocumentNode]
        CIN[createImageNode]
        CTN[createAiChatThreadNode]
        PM[ProseMirrorEditor]
        AIS[AiInteractionService]
    end

    subgraph ConnectionManager["WorkspaceConnectionManager"]
        WCM[syncNodes/syncEdges]
        XYH[XYHandle API]
        PXD[PIXI edge datum cache]
    end

    subgraph DOM["DOM (z-index 1)"]
        VP[.workspace-viewport]
        DOCNODES[.workspace-document-node]
        IMGNODES[.workspace-image-node<br/>DOM interaction shell only]
        THREADNODES[.workspace-ai-chat-thread-node]
        HANDLES[.workspace-handle]
        ED[.document-node-editor]
        TED[.ai-chat-thread-node-editor]
    end

    subgraph PIXI["PIXI v8 (z-index 2)"]
        PML[pixiMediaLayer.sync]
        SPR[Image sprites + colorRect placeholders]
        GEN[PixiTravelingOutlineRenderer progress paths]
        PEDG[Pixi edge Graphics — diffed]
        FG[Selection outlines, marquee, group overlay]
    end

    CS --> RN
    CS --> WCM
    CS --> PML
    DOCS --> RN
    THREADS --> RN
    RN --> CDN
    RN --> CIN
    RN --> CTN
    RN --> HANDLES
    CDN --> PM
    CTN --> PM
    CTN --> AIS
    CDN --> DOCNODES
    CIN --> IMGNODES
    CTN --> THREADNODES
    DOCNODES --> VP
    IMGNODES --> VP
    THREADNODES --> VP
    WCM --> XYH
    WCM --> PXD
    WCM --> PEDG
    PXD --> PEDG
    PM --> ED
    PM --> TED
    PML --> SPR
    PML --> GEN
    PML --> FG
```

The DOM viewport hosts every interactive element. PIXI uses the media layer above the DOM viewport to own image pixels, image-node selection outlines, marquee rectangles, group-overlay highlights, and edge stroke geometry. The DOM and PIXI layer are kept aligned by `viewportBridge.applyViewport()`, which is the single call site that updates the DOM CSS transform and PIXI world container in the same tick.

For the texture cache, LoD-tier loader, decode worker pool, eviction strategy, and the list of remaining performance issues (notably: the API does not actually serve resized thumbnails today), see [CANVAS-ENGINE.md](CANVAS-ENGINE.md).

## Persistence Strategy

Canvas state changes are debounced (1 second) before persisting. This prevents hammering the backend during continuous pan/zoom operations.

Document content changes are handled by `DocumentService.updateDocument()` which has its own debouncing logic.

AI chat thread content changes are handled by `AiChatThreadService.updateAiChatThread()` with similar debouncing.

AI Chat panel state is stored inside `canvasState.aiChatPanel`. Opening or closing the panel, expanding or collapsing Sessions, opening or closing tabs, resizing it, changing context controls, and editing prompt drafts persist workspace UI state but do not create a conversation entity. Submitting from an empty panel creates a standalone chat session.

Sessions is collapsed by default and toggled from the history icon in the panel control row. When expanded it lists standalone chats and extraction sessions. Closing a tab only changes panel presentation and the session remains reopenable. Explicit standalone or extraction deletion removes that session and its saved prompt draft. A saved Feature remains independent when its extraction session is deleted.

Position and dimension changes after drag/resize are persisted immediately via `onCanvasStateChange`.

Edge changes are persisted immediately when edges are created, deleted, or reconnected.

## Image Lifecycle Management

Images on the canvas are tracked by `canvasImageLifecycle.ts`. When an image node is removed from the canvas state:

1. The tracker compares previous and current canvas states
2. Detects which fileIds are missing from the current canvas state
3. Calls `deleteImage()` from `imageUtils.ts` to delete from storage
4. The same `deleteImage()` utility is shared with ProseMirror's `imageLifecyclePlugin`

This ensures orphaned workspace-node images don't accumulate in storage. Video nodes use the parallel `WORKSPACE_SUBJECTS.VIDEO_SUBJECTS.DELETE_VIDEO` path. Neither path deletes Media Library items, which are intentionally independent saved copies with their own scope and deletion lifecycle.

## Lazy Content Loading

Canvas nodes store dimensions in `canvasState` but content is fetched only when nodes enter the viewport. This optimizes initial workspace load and memory usage for large workspaces.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph Initialization
        WS[Workspace Load] --> CS[Fetch canvasState]
        CS --> RN[Render Node Placeholders]
        RN --> |dimensions from canvasState| DOM[Position Empty Shells]
    end

    subgraph Viewport Detection
        PZ[Pan/Zoom Event] --> VIS{isNodeInViewport?}
        VIS -->|Yes, not loaded| FETCH[Fetch Content]
        VIS -->|Yes, already loaded| SKIP[Skip]
        VIS -->|No| SKIP
    end

    subgraph Content Loading
        FETCH --> |document| DSVC[DocumentService.getDocument]
        FETCH --> |aiChatThread| ASVC[AiChatThreadService.getAiChatThread]
        DSVC --> STORE[Update Store]
        ASVC --> STORE
        STORE --> EDITOR[Instantiate ProseMirror]
        EDITOR --> REPLACE[Replace Placeholder with Editor]
    end

    subgraph Error Handling
        FETCH --> |error| ERR[Show Error State]
        ERR --> RETRY[Retry Button]
        RETRY --> FETCH
    end
```

### Content Fetching Strategy

- **No debouncing** — Content is fetched immediately when node enters viewport for responsive UX
- **No unloading** — Once loaded, content remains in memory to avoid re-fetch on pan back
- **Parallel fetching** — Multiple nodes entering viewport simultaneously trigger parallel fetch requests
- **ResizeObserver** — Pane bounds are tracked for accurate visibility detection during window resizes

## AI Interaction Routing

AI chat threads use a workspace-scoped routing pattern for streaming responses:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant Editor as AI Chat Thread Editor
    participant AIS as AiInteractionService
    participant NATS as NATS
    participant API as API Gateway
    participant LLM as API LLM module<br/>(in-process LangGraph)
    Note over AIS: Subscribes to<br/>receiveMessage.{workspaceId}.{threadId}
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: REQUEST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over Editor, LLM: PHASE 1 - REQUEST
        Editor->>AIS: sendChatMessage({ messages, aiModel })
        activate AIS
        AIS->>NATS: publish(CHAT_SEND_MESSAGE, {<br/>  workspaceId,<br/>  aiChatThreadId,<br/>  messages,<br/>  aiModel<br/>})
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: VALIDATE & ROUTE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over Editor, LLM: PHASE 2 - VALIDATE & ROUTE
        activate API
        NATS->>API: Route to handler
        API->>API: Validate workspace access
        API->>API: Fetch AI model pricing
        API->>LLM: process(instanceKey, provider, payload)
        deactivate API
        activate LLM
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: STREAM
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over Editor, LLM: PHASE 3 - STREAM
        loop Streaming Response
            LLM->>NATS: publish(receiveMessage.{workspaceId}.{threadId}, chunk)
            NATS->>AIS: Deliver to subscriber
            AIS->>Editor: Insert content via SegmentsReceiver
        end
        deactivate LLM
        deactivate AIS
    end
```

Each open AI chat thread tab has its own `AiInteractionService` instance, enabling concurrent AI streams across multiple threads in the same workspace.

---

## Workspace Edges

Visual connections (edges/arrows) between canvas nodes allow users to show relationships, context flows, and dependencies between workspace entities. Users can drag from a handle on one node to another to create a relationship line.

### Key Features

- **Connection handles** on each node (visible on hover)
- **Drag-to-connect** interaction using `XYHandle.onPointerDown` from `@xyflow/system`
- **Edge rendering** through PIXI edge data produced by `WorkspaceConnectionManager.ts` and drawn by `pixiEdgeRenderer.ts`
- **Edge selection and deletion** (click to select, Delete/Backspace to remove)
- **Persistence** of edges in `CanvasState`

### Architecture

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph "Data Layer"
        CS[CanvasState]
        WE[WorkspaceEdge array]
        CS --> WE
    end

    subgraph "Connection Manager"
        WCM[WorkspaceConnectionManager]
        NL[nodeLookup: Map]
        XYH[XYHandle API]
        WCM --> NL
        WCM --> XYH
    end

    subgraph "Rendering"
        PXD[PIXI edge data]
        PER[pixiEdgeRenderer Graphics]
        HANDLES[Handle DOM Elements]
        PXD --> PER
    end

    subgraph "Canvas"
        WC[WorkspaceCanvas.ts]
        NODES[Node DOM Elements]
        PZ[XYPanZoom]
    end

    WC --> WCM
    WC --> HANDLES
    NODES --> HANDLES
    WCM -->|onConnect| WE
    WE -->|syncEdges| WCM
    WCM -->|setPixiEdges| PXD
    XYH -->|in-progress state| WCM
```

### Connection Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Handle as Source Handle DOM
    participant XYH as XYHandle.onPointerDown
    participant WCM as WorkspaceConnectionManager
    participant PIXI as PIXI Edge Layer
    participant Target as Target Handle DOM
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: START DRAG
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, Target: PHASE 1 - START DRAG
        User->>Handle: pointerdown
        activate Handle
        Handle->>XYH: Call with params
        activate XYH
        XYH->>WCM: updateConnection(inProgress)
        activate WCM
        WCM->>PIXI: Emit temp edge datum
        deactivate Handle
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: MOVE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, Target: PHASE 2 - MOVE
        loop Mouse Move
            User->>XYH: pointermove
            XYH->>XYH: Find closest valid handle
            XYH->>WCM: updateConnection(newPosition)
            WCM->>PIXI: Update temp edge datum
        end
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: COMPLETE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, Target: PHASE 3 - COMPLETE
        User->>Target: pointerup over valid handle
        XYH->>XYH: isValidConnection check
        XYH->>WCM: onConnect({ source, target })
        deactivate XYH
        WCM->>WCM: Add edge to state
        WCM->>PIXI: Emit permanent edge datum
        deactivate WCM
    end
```

### WorkspaceConnectionManager

Lives at `src/infographics/workspace/WorkspaceConnectionManager.ts`. This is the brain of the connection system.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
classDiagram
    class WorkspaceConnectionManager {
        -nodeLookup: Map~string, InternalNodeBase~
        -edges: WorkspaceEdge[]
        -selectedEdgeId: string | null
        -connectionInProgress: ConnectionState | null
        -cachedPixiEdgeData: PixiEdgeRenderDatum[]
        -cachedFlattenedEdgePaths: Map

        +syncNodes(canvasNodes: CanvasNode[])
        +syncEdges(edges: WorkspaceEdge[])
        +onHandlePointerDown(event, handleMeta)
        +recomputePixiEdgesOnly(zoom: number)
        +getEdgeMidpointRect(edgeId: string)
        +selectEdge(edgeId: string)
        +deleteSelectedEdge()
        +render()
        +destroy()
    }

    class HandleMeta {
        nodeId: string
        handleId: string
        isTarget: boolean
        handleDomNode: Element
    }

    class ConnectionState {
        fromNode: string
        fromHandle: string
        toPosition: XYPosition
        isValid: boolean
    }
```

Responsibilities:
- Maintains `nodeLookup` (Map of node ID → internal node representation with handle bounds)
- Tracks in-progress connection state for rendering the temporary line
- Validates connections (no duplicates, no self-loops)
- Delegates to `XYHandle.onPointerDown` for the actual drag interaction
- Builds PIXI edge render data from shared connector path math
- Uses cached flattened PIXI path data for edge hit testing and bubble-menu anchoring
- Manages edge selection state

### Handle DOM Elements

Each workspace node has connection handles at the left (target) and right (source) edges:

```
┌─────────────────────────────────────────┐
│ ○                                     ○ │
│ left                               right│
│ (target)                         (source)│
│                                         │
│         Node Content                    │
│                                         │
└─────────────────────────────────────────┘
```

Handles are:
- Hidden by default, shown on node hover (CSS)
- Marked with `data-nodeid`, `data-handleid`, `data-handlepos` attributes (required by XYHandle)
- Wired with `pointerdown` listener that calls `WorkspaceConnectionManager.onHandlePointerDown`

### Edge Rendering

Edges are rendered as PIXI `Graphics` by `services/web-ui/src/infographics/workspace/rendering/pixiEdgeRenderer.ts`. `WorkspaceConnectionManager.ts` builds edge render data with shared path helpers from `src/infographics/connectors/paths.ts`, then sends it to the PIXI media layer for drawing, hit testing, and bubble-menu anchoring.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart LR
    subgraph "Z-Order (bottom to top)"
        BG[Canvas Background]
        EDGES[PIXI Edge Layer]
        NODES[Node Cards]
        HANDLES[Handle Overlays]
    end

    BG --> EDGES --> NODES --> HANDLES
```

Edge styling:
- Path type: `horizontal-bezier`
- Stroke width: `2px` from the zoom compensation floor upward
- Marker (arrowhead) size: `16px` from the zoom compensation floor upward
- Color: CSS connector custom properties from the workspace pane, using the focus color when selected
- Temporary and proximity edges render dashed

### Edge Selection and Deletion

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
stateDiagram-v2
    [*] --> Unselected
    Unselected --> Selected: Click on edge
    Selected --> Unselected: Click elsewhere
    Selected --> Unselected: Escape key
    Selected --> [*]: Delete/Backspace key
```

When an edge is selected, it is visually highlighted and a bubble menu appears below the edge with a Delete action.

### Edge Persistence

Edge changes follow the same pattern as node changes:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant WCM as WorkspaceConnectionManager
    participant WC as WorkspaceCanvas
    participant Svelte as WorkspaceCanvas.svelte
    participant Store as workspaceStore
    participant WSvc as WorkspaceService
    participant NATS
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: ADD EDGE LOCALLY
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, NATS: PHASE 1 - ADD EDGE LOCALLY
        User->>WCM: Complete connection (onConnect)
        activate WCM
        WCM->>WC: Add edge to local state
        deactivate WCM
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: UPDATE STORES
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, NATS: PHASE 2 - UPDATE STORES
        activate WC
        WC->>Svelte: onCanvasStateChange({ nodes, edges })
        activate Svelte
        Svelte->>Store: updateCanvasState()
        Svelte->>WSvc: updateCanvasState()
        deactivate Svelte
        deactivate WC
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: PERSIST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, NATS: PHASE 3 - PERSIST
        activate WSvc
        WSvc->>NATS: WORKSPACE.UPDATE_CANVAS_STATE
        deactivate WSvc
    end
```

---

## AI Chat Context

Standalone chats use panel-selected context.

- A standalone chat may include the selected eligible canvas items directly. In the `Follow` mode (`followSelection`), later selection changes update the loaded standalone context. In the `Pinned` mode (`pinnedContext`), later selection changes do not alter it.
- `With Sources` (`includeUpstreamContext`) applies in both standalone modes: off submits only the loaded direct items; on also traverses their upstream lineage using the existing graph extraction rules.
- No selected item means no automatically attached standalone context.

### How It Works

1. **Context selection** — A standalone send uses `extractSelectedContext({ nodeIds, includeUpstream })`.
2. **Content Extraction** — Documents and AI threads have their ProseMirror content parsed for text; embedded images are also extracted. Standalone image nodes are fetched and converted to base64. Video nodes contribute a representative still (`frameFileId`, falling back to poster) for normal model context.
3. **Message Building** — `buildContextMessage()` formats the extracted context as a multimodal message with interleaved text, images, and video stills
4. **API Format** — All content uses the OpenAI Responses API format (`input_text`, `input_image` blocks) as the canonical format. The API LLM module converts to provider-specific formats (e.g., Anthropic) as needed

### Multimodal Content Format

```typescript
// Text content block
{ type: 'input_text'; text: string }

// Image content block
{ type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' }
```

### Key Files

| File | Purpose |
|------|---------|
| `services/web-ui/src/services/ai-chat-thread-service.ts` | Context extraction (`extractConnectedContext`, `buildContextMessage`) |
| `services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts` | Integration point (`onAiChatSubmit` calls context extraction) |
| `services/api/src/llm/utils/attachments.ts` | Attachment format conversion for LLM providers |
| `packages/lixpi/constants/ts/types.ts` | Shared multimodal types (`TextContentBlock`, `ImageContentBlock`) |

---

## AI Image Generation

This feature adds the ability to generate images directly from AI chat threads using OpenAI's `gpt-image-1` model via the Responses API. When a user asks the AI to create an image, the generated result appears as a separate canvas image node connected by an edge whose `sourceMessageId` links it to the specific `aiResponseMessage` that produced it. Generated-image size and branch spacing are controlled by `settings.imageBranchLineage`.

In both modes, the revised prompt text is inserted as text inside the AI response message to keep the conversation readable.

Multi-turn editing is supported: users can continue refining an image within the same thread (OpenAI maintains the conversation context via `previous_response_id`), or click "Edit in New Thread" on any generated image to spawn a dedicated editing thread positioned to the right of that image on the canvas.

### How It Works

1. User enables "Image Generation" mode in an AI chat thread's settings
2. User types a prompt like "Create a logo for a coffee shop"
3. The request goes to the API LLM module, which calls OpenAI with the `image_generation` tool
4. As soon as OpenAI fires `response.output_item.added` (before any pixel data), `openai-provider.ts` publishes an early `IMAGE_PARTIAL` with an empty `imageUrl`. This triggers the canvas to create a placeholder image node with a PIXI-rendered traveling progress border
5. OpenAI streams back partial images (up to 3) as the generation progresses. Each partial updates the image progressively while the border remains active
6. On completion, `IMAGE_COMPLETE` removes the animated border, finalizes the canvas node with full metadata, and updates the edge with `sourceMessageId` so the connector points back to the producing AI response.
7. The revised prompt text appears inside the AI response message in the chat thread
8. Multiple generated images stack using the spacing configured in `settings.imageBranchLineage`.

### Data Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Thread as AI Chat Thread
    participant AIS as AiInteractionService
    participant API as API Gateway
    participant LLM as API LLM module<br/>(in-process LangGraph)
    participant OpenAI as OpenAI API
    participant Canvas as WorkspaceCanvas
    participant Storage as Object Store
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: REQUEST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, Storage: PHASE 1 - REQUEST
        User->>Thread: Enable image generation + type prompt
        activate Thread
        Thread->>AIS: sendChatMessage({ enableImageGeneration, imageSize, ... })
        activate AIS
        AIS->>API: CHAT_SEND_MESSAGE
        activate API
        API->>LLM: process(instanceKey, provider, image options)
        activate LLM
        LLM->>OpenAI: responses.create({ tools: [image_generation], ... })
        deactivate Thread
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: EARLY PLACEHOLDER → CANVAS
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, Storage: PHASE 2 - EARLY PLACEHOLDER — Animated border before pixels arrive
        OpenAI->>LLM: response.output_item.added (image_generation_call)
        LLM->>AIS: IMAGE_PARTIAL { imageUrl: "", partialIndex: 0 }
        AIS->>Thread: Plugin routes to canvas callback
        Thread->>Canvas: onImagePartialToCanvas({ imageUrl: "" })
        Canvas->>Canvas: Create ImageCanvasNode (transparent 1×1 PNG) + PIXI traveling progress border
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: STREAM PARTIALS → CANVAS
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, Storage: PHASE 3 - STREAM PARTIALS TO CANVAS
        loop Partial Images (0-3)
            OpenAI->>LLM: image_generation_call.partial_image
            LLM->>AIS: IMAGE_PARTIAL { partialIndex, imageUrl, fileId }
            AIS->>Thread: Plugin routes to canvas callback
            Thread->>Canvas: onImagePartialToCanvas(...)
            Canvas->>Canvas: Update image; keep PIXI progress border active
        end
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 4: COMPLETE → CANVAS + REVISED PROMPT IN CHAT
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, Storage: PHASE 4 - COMPLETE
        OpenAI->>LLM: image_generation_call (completed)
        deactivate LLM
        LLM->>AIS: IMAGE_COMPLETE { responseId, revisedPrompt, imageUrl, fileId }
        deactivate API
        AIS->>Thread: Plugin inserts revised prompt text into response
        Thread->>Canvas: onImageCompleteToCanvas({ ..., responseMessageId })
        Canvas->>Canvas: Finalize ImageCanvasNode + set edge.sourceMessageId
        deactivate AIS
    end
```

### Image Settings

When image generation is enabled, users can pick a size:

| Option | Dimensions | Use Case |
|--------|------------|----------|
| Square | 1024×1024 | Logos, icons, profile pictures |
| Landscape | 1536×1024 | Banners, headers, wide scenes |
| Portrait | 1024×1536 | Posters, phone wallpapers, tall scenes |
| Auto | Model decides | Let the AI pick based on prompt |

Quality is always set to maximum (`high`), input fidelity is `high` (preserves details when editing existing images), and content moderation is set to `low` to avoid unnecessary restrictions. Users don't need to configure these—they're hardcoded for the best possible output.

### Storage & Deduplication

Generated images are stored in NATS Object Store just like uploaded images. To avoid duplicates, the upload endpoint computes a SHA-256 hash of the image content and uses `hash-{sha256}` as the `fileId`. Before writing, it checks if that fileId already exists—if so, it skips the upload and returns the existing URL.

### Multi-Turn Image Editing

Multi-turn image editing uses a **provider-agnostic approach** by leveraging canvas edges with `sourceMessageId` to maintain precise image-to-response associations. When an image is generated:

1. The image appears as an `ImageCanvasNode` on the canvas, connected to the AI chat thread via an edge
2. The edge's `sourceMessageId` links the image to the specific `aiResponseMessage` that produced it
3. When extracting connected context for follow-up messages, `extractConnectedContext()` traverses incoming edges and includes image nodes with their `sourceMessageId` metadata
4. The API LLM module fetches images from NATS Object Store via `nats-obj://` references and converts them to provider-ready attachment blocks before sending to any provider

**Thread-level continuity**: All AI-generated images connected to the thread are automatically included in subsequent requests via the workspace edge system. Saying "make the background blue" works because the previous image is part of the connected context.

**Per-image editing**: Clicking "Edit in New Thread" creates a fresh AI chat thread with an edge connecting the image to the new thread. The connected image becomes part of the new thread's context via the workspace edge system.

### Canvas Integration

When the AI generates an image:

1. An early `IMAGE_PARTIAL` with an empty `imageUrl` creates the `ImageCanvasNode` placeholder on the canvas (transparent 1×1 PNG and PIXI traveling progress border). Subsequent `IMAGE_PARTIAL` events with real image data update the existing node in place.
2. The `partialImageTracker` Map records the pending partial SYNCHRONOUSLY before any async work to prevent race conditions with `IMAGE_COMPLETE`
3. Progressive partial previews update the same canvas image node in real-time; `pixiMediaLayer.ts` renders the changing image pixels and synchronizes its progress bounds into `PixiTravelingOutlineRenderer` until the final image arrives.
4. `IMAGE_COMPLETE` clears the active-generation tracker so PIXI removes the animated border only after the final image is received, then finalizes the canvas node with full `generatedBy` metadata: `{ aiChatThreadId, responseId, aiModel, revisedPrompt }`
5. A `WorkspaceEdge` connects the thread to the image with `sourceMessageId` identifying the specific `aiResponseMessage` (the response node gets a unique `id` when created by `handleStreamStart`)
6. Multiple images from the same thread stack vertically using spacing from `settings.imageBranchLineage`
7. Collision resolution runs after finalization to push apart any overlapping nodes
8. The revised prompt text is inserted as a paragraph inside the AI response message in the editor

**Editor preservation during image generation:** Adding image nodes to the canvas triggers a state persistence round-trip through the Svelte store. Normally this causes `renderNodes()` which destroys all editors. During image generation, `commitCanvasStatePreservingEditors()` is used instead — it updates the internal structure key immediately so the Svelte `$effect`'s `render()` call sees no structural change and skips the destructive `renderNodes()`. The DOM is managed manually via `appendImageNodeToDOM()`. This keeps active streaming editors alive.

When "Edit in New Thread" is clicked on a canvas image node:

1. A new AI chat thread node is created to the right of the source image using `settings.aiChatThread.defaultDimensions` and `settings.aiChatThread.adjacentNodeGap`; collision resolution then pushes conflicting top-level nodes apart
2. An edge connects the image (right) to the new thread (left)
3. The connected image is automatically included in the new thread's context via `extractConnectedContext()`
4. This forms a horizontal chain: `[Original Thread] → [Image] → [Edit Thread]`
