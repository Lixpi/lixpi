# Workspace Feature

A workspace is the primary container where users organize and edit their documents and images. Think of it as an infinite canvas where cards float, can be arranged freely, resized, and edited in place.

## Core Concepts

**Workspace** — A named container owned by a user. Has a canvas state (viewport position, zoom level, and node positions) plus references to documents, AI chat threads, and uploaded files.

**Canvas Node** — A positioned rectangle on the canvas. Can be a document node (with ProseMirror editor), an image node, or an AI chat thread node. Stores position, dimensions, and type-specific data.

**Document** — The actual text content (ProseMirror JSON). Lives separately from its canvas representation so the same document could theoretically appear in multiple workspaces. Documents use `documentType: 'document'` and contain block-level content (paragraphs, headings, lists, etc.).

**AI Chat Thread** — An independent AI conversation canvas node with its own persistence and lifecycle. Stored in the AI-Chat-Threads DynamoDB table. Each thread has its own `AiInteractionService` instance for streaming AI responses. Uses `documentType: 'aiChatThread'` for its ProseMirror editor.

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
            TS[aiChatThreadsStore]
        end

        subgraph Infographics["Framework-Agnostic Layer"]
            WC[WorkspaceCanvas.ts]
            WCM[WorkspaceConnectionManager]
            XY[XYPanZoom]
            CR[ConnectorRenderer]
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
        LLMAPI[llm-api Python]
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
    WCM --> CR

    WCS --> WSvc
    WCS --> DSvc
    WCS --> TSvc
    WC --> AIS
    WSvc --> NATS
    DSvc --> NATS
    TSvc --> NATS
    AIS --> NATS
    NATS --> API
    NATS --> LLMAPI
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
}
```

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

Note: after an image is uploaded the client loads it to determine the natural aspect ratio. On load the client verifies that the stored node dimensions match that ratio; if they do not match it corrects the node dimensions and persists the corrected values so stale nodes self-heal. Image resize uses a diagonal-based algorithm for smooth, aspect-locked resizing and the UI computes resize handle size/offsets dynamically so handles remain visually consistent regardless of canvas zoom.
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
    Note: committing canvas state persists corrected dimensions and triggers the image lifecycle tracker which will detect removed fileIds and call `deleteImage` to remove orphaned files from storage.
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
        CR[ConnectorRenderer]
    end

    subgraph DOM
        VP[.workspace-viewport]
        EDGES[.workspace-edges-layer SVG]
        DOCNODES[.workspace-document-node]
        IMGNODES[.workspace-image-node]
        THREADNODES[.workspace-ai-chat-thread-node]
        HANDLES[.workspace-handle]
        ED[.document-node-editor]
        TED[.ai-chat-thread-node-editor]
        IMG[img element]
    end

    CS --> RN
    CS --> WCM
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
    WCM --> CR
    CR --> EDGES
    EDGES --> VP
    PM --> ED
    PM --> TED
    CIN --> IMG
```

## Persistence Strategy

Canvas state changes are debounced (1 second) before persisting. This prevents hammering the backend during continuous pan/zoom operations.

Document content changes are handled by `DocumentService.updateDocument()` which has its own debouncing logic.

AI chat thread content changes are handled by `AiChatThreadService.updateAiChatThread()` with similar debouncing.

Position and dimension changes after drag/resize are persisted immediately via `onCanvasStateChange`.

Edge changes are persisted immediately when edges are created, deleted, or reconnected.

## Image Lifecycle Management

Images on the canvas are tracked by `canvasImageLifecycle.ts`. When an image node is removed from the canvas state:

1. The tracker compares previous and current canvas states
2. Detects which fileIds are no longer present
3. Calls `deleteImage()` from `imageUtils.ts` to delete from storage
4. The same `deleteImage()` utility is shared with ProseMirror's `imageLifecyclePlugin`

This ensures orphaned images don't accumulate in storage.

## Lazy Content Loading

Canvas nodes store dimensions in `canvasState` but content is fetched only when nodes enter the viewport. This optimizes initial workspace load and memory usage for large workspaces.

```mermaid
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
sequenceDiagram
    participant Editor as AI Chat Thread Editor
    participant AIS as AiInteractionService
    participant NATS as NATS
    participant API as API Gateway
    participant LLM as llm-api (Python)

    Note over AIS: Subscribes to<br/>receiveMessage.{workspaceId}.{threadId}

    Editor->>AIS: sendChatMessage({ messages, aiModel })
    AIS->>NATS: publish(CHAT_SEND_MESSAGE, {<br/>  workspaceId,<br/>  aiChatThreadId,<br/>  messages,<br/>  aiModel<br/>})
    NATS->>API: Route to handler
    API->>API: Validate workspace access
    API->>API: Fetch AI model pricing
    API->>NATS: publish(CHAT_PROCESS, {...})
    NATS->>LLM: Route to Python

    loop Streaming Response
        LLM->>NATS: publish(receiveMessage.{workspaceId}.{threadId}, chunk)
        NATS->>AIS: Deliver to subscriber
        AIS->>Editor: Insert content via SegmentsReceiver
    end
```

Each AI chat thread node has its own `AiInteractionService` instance, enabling concurrent AI streams across multiple threads in the same workspace.

---

## Workspace Edges

Visual connections (edges/arrows) between canvas nodes allow users to show relationships, context flows, and dependencies between workspace entities. Users can drag from a handle on one node to another to create a relationship line.

### Key Features

- **Connection handles** on each node (small circles on the sides, visible on hover)
- **Drag-to-connect** interaction using `XYHandle.onPointerDown` from `@xyflow/system`
- **Edge rendering** using ConnectorRenderer from `src/infographics/connectors/`
- **Edge selection and deletion** (click to select, Delete/Backspace to remove)
- **Edge reconnection** (drag an edge endpoint to move it to a different node, or drop in empty space to delete)
- **Persistence** of edges in `CanvasState`

### Architecture

```mermaid
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
        CR[createConnectorRenderer]
        SVG[SVG Edge Layer]
        HANDLES[Handle DOM Elements]
        CR --> SVG
    end

    subgraph "Canvas"
        WC[WorkspaceCanvas.ts]
        NODES[Node DOM Elements]
        PZ[XYPanZoom]
    end

    WC --> WCM
    WC --> CR
    WC --> HANDLES
    NODES --> HANDLES
    WCM -->|onConnect| WE
    WE -->|render| CR
    XYH -->|in-progress line| SVG
```

### Connection Flow

```mermaid
sequenceDiagram
    participant User
    participant Handle as Source Handle DOM
    participant XYH as XYHandle.onPointerDown
    participant WCM as WorkspaceConnectionManager
    participant SVG as Edge SVG Layer
    participant Target as Target Handle DOM

    User->>Handle: pointerdown
    Handle->>XYH: Call with params
    XYH->>WCM: updateConnection(inProgress)
    WCM->>SVG: Render temp line from source

    loop Mouse Move
        User->>XYH: pointermove
        XYH->>XYH: Find closest valid handle
        XYH->>WCM: updateConnection(newPosition)
        WCM->>SVG: Update temp line endpoint
    end

    User->>Target: pointerup over valid handle
    XYH->>XYH: isValidConnection check
    XYH->>WCM: onConnect({ source, target })
    WCM->>WCM: Add edge to state
    WCM->>SVG: Render permanent edge
```

### WorkspaceConnectionManager

Lives at `src/infographics/workspace/WorkspaceConnectionManager.ts`. This is the brain of the connection system.

```mermaid
classDiagram
    class WorkspaceConnectionManager {
        -nodeLookup: Map~string, InternalNodeBase~
        -edges: WorkspaceEdge[]
        -selectedEdgeId: string | null
        -connectionInProgress: ConnectionState | null
        -connectorRenderer: ConnectorRenderer

        +syncNodes(canvasNodes: CanvasNode[])
        +syncEdges(edges: WorkspaceEdge[])
        +onHandlePointerDown(event, handleMeta)
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
- Manages edge selection state

### Handle DOM Elements

Each workspace node has connection handles — small circles at the left (target) and right (source) edges:

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

Edges are rendered as SVG paths using `createConnectorRenderer` from `src/infographics/connectors/`. The edge layer sits below node cards but above the canvas background.

```mermaid
flowchart LR
    subgraph "Z-Order (bottom to top)"
        BG[Canvas Background]
        EDGES[Edge SVG Layer]
        NODES[Node Cards]
        HANDLES[Handle Overlays]
    end

    BG --> EDGES --> NODES --> HANDLES
```

Edge styling:
- Path type: `horizontal-bezier`
- Stroke width: `2px` (3px when selected)
- Marker (arrowhead) size: `12px`
- Color: `rgba(190, 190, 200, 0.95)` (primary color when selected)

### Edge Selection and Deletion

```mermaid
stateDiagram-v2
    [*] --> Unselected
    Unselected --> Selected: Click on edge
    Selected --> Unselected: Click elsewhere
    Selected --> Unselected: Escape key
    Selected --> [*]: Delete/Backspace key
```

When an edge is selected, small draggable circles appear at the source and target endpoints for reconnection.

### Edge Persistence

Edge changes follow the same pattern as node changes:

```mermaid
sequenceDiagram
    participant User
    participant WCM as WorkspaceConnectionManager
    participant WC as WorkspaceCanvas
    participant Svelte as WorkspaceCanvas.svelte
    participant Store as workspaceStore
    participant WSvc as WorkspaceService
    participant NATS

    User->>WCM: Complete connection (onConnect)
    WCM->>WC: Add edge to local state
    WC->>Svelte: onCanvasStateChange({ nodes, edges })
    Svelte->>Store: updateCanvasState()
    Svelte->>WSvc: updateCanvasState()
    WSvc->>NATS: WORKSPACE.UPDATE_CANVAS_STATE
```

---

## AI Chat Context from Connected Nodes

When nodes are connected TO an AI chat thread (incoming edges), the AI chat automatically extracts their content and passes it to the AI model. This includes text from documents, text from other AI chat threads, and images (converted to base64). Context is extracted by walking the edge graph backwards from the AI chat node, collecting all connected content recursively.

### How It Works

1. **Edge Traversal** — When a user sends a message in an AI chat thread, `AiChatThreadService.extractConnectedContext()` finds all nodes connected via incoming edges (recursively)
2. **Content Extraction** — Documents and AI threads have their ProseMirror content parsed for text; embedded images are also extracted. Standalone image nodes are fetched and converted to base64
3. **Message Building** — `buildContextMessage()` formats the extracted context as a multimodal message with interleaved text and images
4. **API Format** — All content uses the OpenAI Responses API format (`input_text`, `input_image` blocks) as the canonical format. The `llm-api` service converts to provider-specific formats (e.g., Anthropic) as needed

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
| `services/llm-api/src/utils/attachments.py` | Attachment format conversion for LLM providers |
| `packages/lixpi/constants/ts/types.ts` | Shared multimodal types (`TextContentBlock`, `ImageContentBlock`) |

---

## AI Image Generation

This feature adds the ability to generate images directly from AI chat threads using OpenAI's `gpt-image-1` model via the Responses API. When a user asks the AI to create an image, the generated result appears inline in the chat conversation. From there, the user can click "Add to Canvas" to place the image as a standalone canvas node with an automatic edge connecting it back to the chat thread that created it.

Multi-turn editing is supported: users can continue refining an image within the same thread (OpenAI maintains the conversation context via `previous_response_id`), or click "Edit in New Thread" on any generated image to spawn a dedicated editing thread positioned to the right of that image on the canvas.

### How It Works

1. User enables "Image Generation" mode in an AI chat thread's settings
2. User types a prompt like "Create a logo for a coffee shop"
3. The request goes to `llm-api` which calls OpenAI with the `image_generation` tool
4. OpenAI streams back partial images (up to 3) as the generation progresses
5. The chat shows a spinner, then replaces it with each partial image as it arrives
6. On completion, the final image appears with action buttons
7. Clicking "Add to Canvas" uploads the image to storage and creates both an `ImageCanvasNode` and an edge from the chat thread to the new image

### Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Thread as AI Chat Thread
    participant AIS as AiInteractionService
    participant API as API Gateway
    participant LLM as llm-api (Python)
    participant OpenAI as OpenAI API
    participant Canvas as WorkspaceCanvas
    participant Storage as Object Store

    User->>Thread: Enable image generation + type prompt
    Thread->>AIS: sendChatMessage({ enableImageGeneration, imageSize, ... })
    AIS->>API: CHAT_SEND_MESSAGE
    API->>LLM: CHAT_PROCESS (with image options)
    LLM->>OpenAI: responses.create({ tools: [image_generation], ... })

    loop Partial Images (0-3)
        OpenAI->>LLM: image_generation_call.partial_image
        LLM->>AIS: IMAGE_PARTIAL { partialIndex, base64 }
        AIS->>Thread: Replace spinner with partial
    end

    OpenAI->>LLM: image_generation_call (completed)
    LLM->>AIS: IMAGE_COMPLETE { responseId, revisedPrompt, base64 }
    AIS->>Thread: Insert aiGeneratedImage node with action buttons

    User->>Thread: Click "Add to Canvas"
    Thread->>Canvas: handleAddGeneratedImageToCanvas(...)
    Canvas->>Storage: POST /api/images/:workspaceId (hash-dedupe)
    Storage-->>Canvas: { fileId, src }
    Canvas->>Canvas: Create ImageCanvasNode + WorkspaceEdge
    Canvas->>Canvas: Persist canvasState
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

Generated images are stored in NATS Object Store just like uploaded images. To avoid duplicates (e.g., if someone clicks "Add to Canvas" twice), the upload endpoint computes a SHA-256 hash of the image content and uses `hash-{sha256}` as the `fileId`. Before writing, it checks if that fileId already exists—if so, it skips the upload and returns the existing URL.

### Multi-Turn Image Editing

OpenAI's Responses API supports iterative refinement through `previous_response_id`. There are two ways to do this:

**Thread-level continuity**: The AI chat thread stores the last `responseId` from any image generation. Subsequent messages in the same thread automatically reference it, so saying "make the background blue" knows which image you're talking about.

**Per-image editing**: Each generated image carries its own `responseId`. Clicking "Edit in New Thread" creates a fresh AI chat thread with that specific `responseId` as its starting point. The new thread appears to the right of the image on the canvas, with an edge connecting them (image → new thread). This lets you branch off and try different directions without polluting the original conversation.

### Canvas Integration

When "Add to Canvas" is clicked:

1. The base64 image is uploaded to storage (with hash-based deduplication)
2. The source AI chat thread node is found on the canvas
3. A new `ImageCanvasNode` is created at position `(threadNode.x + threadNode.width + 50, threadNode.y)`
4. The image node includes `generatedBy` metadata: `{ aiChatThreadId, responseId, aiModel, revisedPrompt }`
5. A `WorkspaceEdge` is created from the thread's right handle to the image's left handle
6. Both the new node and edge are persisted atomically

When "Edit in New Thread" is clicked on a canvas image node:

1. A new AI chat thread is created with `previousResponseId` set to the image's `generatedBy.responseId`
2. The thread is positioned at `(imageNode.x + imageNode.width + 50, imageNode.y)`
3. An edge connects the image (right) to the new thread (left)
4. This forms a horizontal chain: `[Original Thread] → [Image] → [Edit Thread]`

---

## AI Image Generation — Implementation Plan

### Phase 1: Shared Types & Constants

Update the constants package so both TypeScript and Python services understand image generation payloads and stream events.

- [x] **Update `packages/lixpi/constants/ts/types.ts`**
    - [x] Add `ImageGenerationSize` type: `'1024x1024' | '1536x1024' | '1024x1536' | 'auto'`
    - [x] Add `ImageGeneratedByMetadata` type with fields: `aiChatThreadId`, `responseId`, `aiModel`, `revisedPrompt`
    - [x] Extend `ImageCanvasNode` with optional `generatedBy?: ImageGeneratedByMetadata`
    - [x] Add `AiInteractionImageGenerationPayload` extending chat payload with:
        - `enableImageGeneration: boolean`
        - `imageSize: ImageGenerationSize`
        - `previousResponseId?: string` (for multi-turn editing)
    - [x] Extend `TokensUsageEvent` with optional `image` field:
        - `generatedCount: number`
        - `size: string`
        - `purchasedFor: string`
        - `soldToClientFor: string`

- [x] **Update `packages/lixpi/constants/ai-interaction-constants.json`**
    - [x] Add `IMAGE_PARTIAL` to `STREAM_STATUS`
    - [x] Add `IMAGE_COMPLETE` to `STREAM_STATUS`

- [x] **Update `packages/lixpi/constants/python/__init__.py`** (if needed)
    - [x] The JSON reload picks up the new constants automatically

### Phase 2: Backend — OpenAI Provider Changes ✅

Extend the Python LLM service to handle image generation requests and stream partial/complete images back to the client.

- [x] **Update `services/llm-api/src/providers/openai/provider.py`**
    - [x] Check for `enable_image_generation` flag in incoming request
    - [x] When enabled, inject `image_generation` tool with hardcoded settings:
        ```python
        {
            "type": "image_generation",
            "quality": "high",
            "moderation": "low",
            "input_fidelity": "high",
            "partial_images": 3,
            "size": request.get("image_size", "auto")
        }
        ```
    - [x] Handle `previous_response_id` in request — pass it to `client.responses.create()` for multi-turn editing
    - [x] In the streaming loop, detect `response.image_generation_call.partial_image` events:
        - Extract `partial_image_b64` and `partial_image_index`
        - Publish to NATS with status `IMAGE_PARTIAL`
    - [x] Detect `response.image_generation_call` completion (when `result` is present):
        - Extract final `result` (base64), `revised_prompt`
        - Publish to NATS with status `IMAGE_COMPLETE` including `response_id`

- [x] **Update usage calculation in `services/llm-api/src/providers/base.py` or `usage_reporter.py`**
    - [x] Extract image token usage from response
    - [x] Include image-specific fields in the usage report for cost tracking

- [ ] **Add image generation tests**
    - [ ] Test basic image generation request/response flow
    - [ ] Test partial image streaming
    - [ ] Test multi-turn editing with `previous_response_id`
    - [ ] Test usage calculation for image tokens

### Phase 3: Frontend — AI Interaction Service ✅

Update the client-side service that handles NATS subscriptions to understand image stream events.

- [x] **Update `services/web-ui/src/services/ai-interaction-service.ts`**
    - [x] Extend `onChatMessageResponse()` to check for `IMAGE_PARTIAL` status:
        - Forward to `segmentsReceiver` with new segment type `image_partial`
        - Include `partialIndex` and `imageBase64` in payload
    - [x] Handle `IMAGE_COMPLETE` status:
        - Forward to `segmentsReceiver` with segment type `image_complete`
        - Include `responseId`, `revisedPrompt`, `imageBase64`
    - [x] Store thread-level `lastResponseId` on `IMAGE_COMPLETE` for conversation continuity
    - [x] Update `sendChatMessage()` to accept `enableImageGeneration`, `imageSize`, `previousResponseId` options

- [x] **Bypass text parser for image events**
    - [x] Image events emit directly to segmentsReceiver, bypassing markdown parser

### Phase 4: Frontend — ProseMirror Node for Generated Images ✅

Create a new ProseMirror node type that renders generated images inline in AI chat threads.

- [x] **Create `aiGeneratedImage` node in `services/web-ui/src/components/proseMirror/plugins/aiChatThreadPlugin/`**
    - [x] Define node spec with attrs:
        - `imageData: string` (base64)
        - `revisedPrompt: string`
        - `responseId: string`
        - `aiModel: string`
        - `isPartial: boolean`
        - `partialIndex: number`
    - [x] Create NodeView class:
        - [x] Initially render a spinner/preloader element
        - [x] On `isPartial: true` updates, replace with the partial image
        - [x] On `isPartial: false` (complete), show final image with action buttons
        - [x] "Add to Canvas" button — calls `onAddToCanvas(imageData, responseId, revisedPrompt, aiModel)`
        - [x] "Edit in New Thread" button — calls `onEditInNewThread(responseId)`
        - [x] Show `revisedPrompt` as caption below image

- [x] **Wire `SegmentsReceiver` to insert/update `aiGeneratedImage` nodes**
    - [x] On `image_partial` segment: insert or update node with `isPartial: true`
    - [x] On `image_complete` segment: update node to `isPartial: false`, add final data

- [x] **Add styles in `ai-chat-thread.scss`**
    - [x] Spinner/preloader animation
    - [x] Image container with rounded corners, subtle shadow
    - [x] Action button bar (semi-transparent overlay at bottom)
    - [x] Hover states for buttons

### Phase 5: Frontend — Image Generation Toggle in Thread UI ✅

Let users enable image generation mode and pick a size.

- [x] **Update AI chat thread settings dropdown**
    - [x] Add "Enable Image Generation" toggle/checkbox
    - [x] When enabled, show size selector dropdown:
        - Square (1024×1024)
        - Landscape (1536×1024)
        - Portrait (1024×1536)
        - Auto
    - [x] Store `enableImageGeneration` and `imageSize` as thread attributes (persisted in DB)

- [x] **Pass settings through to `AiInteractionService.sendChatMessage()`**
    - [x] Read from thread attrs when submitting
    - [x] Include `previousResponseId` from thread state if available

### Phase 6: Backend — Hash-Based Image Deduplication ✅

Prevent storing duplicate images when the same generated image is added to canvas multiple times.

- [x] **Update `/api/images/:workspaceId` POST endpoint in `services/api`**
    - [x] Accept optional `useContentHash` field in request body
    - [x] If enabled, compute SHA-256 hash of the uploaded buffer
    - [x] Use `hash-{sha256}` as `fileId` instead of random UUID
    - [x] Before calling `putObject()`, check if fileId already exists:
        - If exists, skip upload, return existing URL with `{ isDuplicate: true }`
        - If not, proceed with upload
    - [x] Return `{ fileId, url, isDuplicate }` in response

- [x] **Update client-side upload to send hash when available**
    - [x] Include `useContentHash: true` in form data for AI-generated images

### Phase 7: Frontend — Canvas Integration (Add to Canvas) ✅

Wire up the "Add to Canvas" button to create image nodes and edges.

- [x] **Add `handleAddGeneratedImageToCanvas()` via `setAiGeneratedImageCallbacks`**
    - [x] Parameters: `imageBase64`, `responseId`, `revisedPrompt`, `aiModel`
    - [x] Upload to `/api/images/:workspaceId` with `useContentHash: true`
    - [x] Find the source AI chat thread node in `canvasState.nodes`
    - [x] Calculate new position: `{ x: threadNode.x + threadNode.width + 50, y: threadNode.y }`
    - [x] Create `ImageCanvasNode` with `generatedBy` metadata
    - [x] Create `WorkspaceEdge` from thread to image
    - [x] Update `canvasState` with both new node and edge
    - [x] Persist via `onCanvasStateChange()`

- [x] **Expose callback from `WorkspaceCanvas.ts` to ProseMirror**
    - [x] Use `setAiGeneratedImageCallbacks()` to wire callbacks at canvas level
    - [x] The callback is callable from the `aiGeneratedImage` NodeView

### Phase 8: Frontend — Edit in New Thread ✅

Wire up the "Edit in New Thread" button to spawn a new thread for per-image editing.

- [x] **Add `handleEditImageInNewThread()` via `setAiGeneratedImageCallbacks`**
    - [x] Parameters: `responseId`
    - [x] Find the image node by `generatedBy.responseId`
    - [x] Create new AI chat thread via `aiChatThreadService.createAiChatThread()`:
        - Set `previousResponseId` attribute
        - Set `imageGenerationEnabled: true`
        - Set initial content hint "Describe how you want to edit this image..."
    - [x] Calculate position: `{ x: imageNode.x + imageNode.width + 50, y: imageNode.y }`
    - [x] Create `AiChatThreadCanvasNode` at that position
    - [x] Create `WorkspaceEdge` from image to new thread
    - [x] Persist via `onCanvasStateChange()`

- [x] **Button in `aiGeneratedImageNode` NodeView**
    - [x] "Edit in New Thread" button with pencil icon
    - [x] Calls `onEditInNewThread(responseId)` callback

### Phase 9: Token Usage Tracking ✅

Make sure image generation costs are tracked separately for billing purposes.

- [x] **Update `UsageReporter` with `report_image_usage()` method**
    - [x] Track image size, quality, and count
    - [x] Calculate costs using image pricing from AI model config

- [x] **Update `_calculate_usage()` in base provider**
    - [x] Check for `image_usage` in state
    - [x] Call `report_image_usage()` when present

- [x] **Set `image_usage` in OpenAI provider when images are generated**
    - [x] Include size and quality fields

### Phase 10: Testing & Polish

- [ ] **Manual testing checklist**
    - [ ] Generate an image in a chat thread — verify spinner → partials → final
    - [ ] Click "Add to Canvas" — verify image node appears to the right with edge
    - [ ] Click "Add to Canvas" again on same image — verify no duplicate in storage (hash dedupe)
    - [ ] Continue conversation in same thread — verify multi-turn editing works
    - [ ] Click "Edit in New Thread" on canvas image — verify new thread spawns with edge
    - [ ] Send message in edit thread — verify it references the original image
    - [ ] Delete image node from canvas — verify storage cleanup (if no other references)
    - [ ] Test all three size options
    - [ ] Test with very long prompts
    - [ ] Test stopping generation mid-stream

- [ ] **Edge cases**
    - [ ] What if the AI doesn't generate an image (just responds with text)?
    - [ ] What if image generation fails or times out?
    - [ ] What if user navigates away during generation?
    - [ ] What about concurrent image generations in multiple threads?

- [ ] **Performance**
    - [ ] Partial images can be large — ensure no memory leaks from base64 handling
    - [ ] Consider adding a loading state to "Add to Canvas" button during upload

---

## Follow-up Tasks

The following items are pending implementation:

### Handle Styling Polish

- [ ] Show handles on AI chat thread node hover (CSS selector missing `.workspace-ai-chat-thread-node:hover .workspace-handle`)
- [ ] Add hover effect on handle itself (`:hover` style)
- [ ] Add transition for smooth fade in/out

### Context Icon for AI Chat Thread Nodes

The "branch" icon at the bottom-right corner of AI chat thread cards currently uses the old `contextSelector` plugin. It needs to be refactored to work with the workspace edge system:

- [ ] Refactor icon click handler to work with workspace connection system
- [ ] Show popover listing nodes connected TO this thread (incoming edges)
- [ ] Allow quick disconnect (remove edge) from the popover
- [ ] Optionally highlight connected edges on canvas when popover is open

### Cleanup Old Code

Once the context icon is refactored:

- [ ] Delete `src/components/proseMirror/plugins/primitives/contextSelector/` folder
- [ ] Remove import from `aiChatThreadNode.ts`
- [ ] Remove SCSS import from `ai-chat-thread.scss`

### Edge Cases

- [ ] When a node with edges is deleted, connected edges should be removed too
- [ ] Verify edges update correctly during node drag

### Testing

- [ ] Create edges between different node types (document ↔ document, document ↔ AI thread, etc.)
- [ ] Test edge selection and deletion
- [ ] Test edge reconnection
- [ ] Test with pan/zoom (edges should transform correctly)
- [ ] Test persistence (reload page, edges should still be there)
- [ ] Test with many nodes and edges (performance)
