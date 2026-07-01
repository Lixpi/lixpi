---
title: Workspace Model
description: The core concepts, data model, and backend surface of the Lixpi canvas — the Workspace, CanvasState, WorkspaceEdge, and the CanvasNode union, plus stores, NATS subjects, HTTP endpoints, persistence, media lifecycle, and visibility tracking.
---

# Workspace Model

A **workspace** is the primary container where users organize and edit their documents, images, videos, and AI context. It is an infinite canvas where cards float, can be arranged freely, resized, and edited in place. The spatial arrangement is not decoration — connections between nodes carry context to the AI, and the layout of generated media records its provenance.

This page explains **what a workspace is made of**: the core concepts a user manipulates, the persisted data model behind them, the frontend stores that hold live state, and the backend NATS/HTTP surface that reads and writes it. It does **not** cover *how* the canvas is drawn or *how* users interact with it turn by turn — those live in sibling pages.

{% callout type="note" %}
This page is part of the canvas domain. For the DOM/PIXI rendering architecture, the layer stack, and canvas configuration ownership see [Rendering Engine](./RENDERING-ENGINE.md). For texture caching, level-of-detail tiers, and the decode pool see [Image Rendering Performance](./IMAGE-RENDERING-PERFORMANCE.md). For drag-release and insertion overlap rules see [Collision Resolution](./COLLISION-RESOLUTION.md). For step-by-step interaction flows see [User Flows](./USER-FLOWS.md), and for the connection system see [Edges & Connections](./EDGES-AND-CONNECTIONS.md).
{% /callout %}

## Core Concepts

| Concept | Definition |
|---------|------------|
| **Workspace** | A named container owned by a user. Holds a canvas state (viewport position, zoom, and node positions) plus references to documents, AI chat threads, and uploaded media files. |
| **Canvas Node** | A positioned item on the canvas. The shared persisted union contains documents, uploaded media documents, images, videos, audio, upload placeholders, and API-planned branch lineage markers (`branchOrigin`, `branchFork`, `branchLine`). The renderer also accepts `aiChatThread` canvas records for compatibility. |
| **Document** | The actual text content (ProseMirror JSON). It lives separately from its canvas representation, so the same document could theoretically appear in multiple workspaces. Documents use `documentType: 'document'`, render through `ProseMirrorEditor`, and submit live edits through the ProseMirror authority step stream. |
| **AI Chat Thread** | A persisted AI conversation session stored in the AI-Chat-Threads DynamoDB table. A thread is standalone; its ProseMirror history is rendered in an AI Chat panel tab, projected into branch marker/info panels, and streamed through server-authored ProseMirror step events plus durable pipeline side events. |
| **AI Chat Panel** | A workspace-owned right-side surface that can be opened without creating a chat session; a standalone thread is created only when the first prompt is submitted. See [Chat Panel & Sessions](../ai-chat/CHAT-PANEL-AND-SESSIONS.md). |
| **Image** | An uploaded, imported, generated, or restored image file stored in NATS Object Store. Canvas nodes reference the workspace-owned object that is safe to render and send to models. Removing the node requests storage cleanup, and the API deletes bytes only after the canonical canvas state no longer references the file. A user can explicitly save a separate Media Library copy that is **not** deleted with the source node. |
| **Video** | A generated, uploaded, imported, or restored MP4 stored in NATS Object Store with a poster and an optional representative still. The canvas renders a PIXI poster behind a browser-composited `<video>` surface so playback, scrubbing, fullscreen, and shared controls do not depend on a PIXI video texture loop. See [Video Player Controls](../media-generation/VIDEO-PLAYER-CONTROLS.md). |
| **Uploaded Audio** | An `audio` canvas node backed by a workspace Object Store object and played through a DOM `<audio>` element. |
| **Uploaded Document Media** | A `mediaDocument` canvas node backed by a stored text, Markdown, PDF, or office-document object. Office documents are converted to PDF before the node is created; PDFs may carry a first-page poster. |
| **Branch Root** | The first generated image or video in a branch. It records the prompt, references, resolver metadata, and visual summaries on its own `generatedBy` metadata; no separate provenance node is persisted. See [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md). |
| **Viewport** | The current view: x/y offset and zoom level, persisted so users return to where they left off. While a workspace is open, the live viewport inside [`WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) is the rendering source of truth; Svelte/store persistence is an acknowledgement path. A delayed store render must not replay an older viewport-only state over the current transform. |

## System Architecture

The browser holds a thin Svelte component layer over a framework-agnostic canvas engine. Components own data fetching through frontend services; the engine owns geometry, the connection manager, and pan/zoom. All persistence travels over NATS to the API service, which fronts DynamoDB and runs the AI workflow in-process.

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

| Layer | Responsibility |
|-------|----------------|
| Svelte components | Route handling, fetching domain objects through services, mounting the canvas. They may create domain objects after service work but do not own geometry. |
| Svelte stores | Hold live workspace, document, and thread state for reactive rendering. |
| Framework-agnostic layer | [`WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) owns geometry, viewport, node DOM, and the PIXI media layer; the connection manager and pan/zoom are its collaborators. |
| Frontend services | Wrap NATS request/response and streaming for workspaces, documents, threads, and AI interaction. |
| Backend | The API service validates access, persists to DynamoDB, and hosts the in-process LangGraph AI workflow ([AI Generation Pipeline](../platform/AI-GENERATION-PIPELINE.md)). |

## Data Model

### Workspace (Backend)

```typescript
type Workspace = {
    workspaceId: string
    name: string
    accessType: 'private' | 'shared'
    files: DocumentFile[]        // Workspace Object Store metadata
    canvasState: CanvasState
    createdAt: number
    canvasStateUpdatedAt: number // Canvas save token
    updatedAt: number
}
```

### CanvasState

`CanvasState` is the persisted heart of a workspace: the viewport, every node, every edge, and the AI chat panel UI state. Feature-extraction runs are API-owned `ExtractionRun` records; the canvas may hold only transient, unconfirmed UI placeholders before the user starts extraction.

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
        contextChips: string[]
        width?: number
        drafts?: Record<string, { content?: object }>
    }
}
```

The `aiChatPanel` sub-object persists panel presentation only — visibility, Sessions expansion, open tabs, active tab, width, explicit context chips, and prompt drafts. Opening or editing the panel does **not** create a conversation entity; see [Chat Panel & Sessions](../ai-chat/CHAT-PANEL-AND-SESSIONS.md). The `contextChips` array is the explicit-context input to per-turn workspace relevance ([Context Relevance](../ai-chat/CONTEXT-RELEVANCE.md)).

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

The `sourceT` and `targetT` properties let edges attach at any vertical position along a node's side, not just the center. When a user creates a connection by dragging, the `t` values are computed from the pointer position where the drag started and where it was dropped.

The `sourceMessageId` property enables precise per-response-message tracking for AI-generated images. When an AI chat thread generates an image, the resulting canvas image node is connected back to the thread via an edge whose `sourceMessageId` identifies the specific `aiResponseMessage` that produced it. This lets context extraction associate images with their originating conversation turns. The rendering and anchoring behavior of this property lives in [Edges & Connections](./EDGES-AND-CONNECTIONS.md).

### Connection Routing

Edges are planned by `WorkspaceConnectionManager` and drawn by the PIXI edge renderer. The current default routing style is `horizontal-bezier`, with auto-alignment to straight lines where possible, message-level anchoring to a specific AI response message, dashed drag previews, and selection/deletion behavior documented in [Edges & Connections](./EDGES-AND-CONNECTIONS.md).

### AI Generated Content Layout

When an AI chat session generates images or videos, the workspace places them automatically to keep a clean layout: first outputs sit near the active chat context or the combined bounds of selected/reference media, branch continuations become a balanced generated-media tree, generated nodes use a fixed canvas-unit size regardless of zoom, and a synchronous partial tracker prevents overlapping or skipped slots during simultaneous stream updates. Reference/style/source media can anchor and animate placement without becoming a connector parent unless the API lineage plan selects an existing generated-media branch member as the parent. The first generated media node is the branch root and carries its own provenance. The complete placement, spacing, provenance chrome, and references-vs-lineage rules live in [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md).

### CanvasNode

Canvas nodes use a discriminated union keyed on the `type` field. The shared `CanvasNode` type contains text documents, uploaded document media, images, videos, audio, upload placeholders, and branch lineage marker nodes. Every node shares `nodeId`, `position`, and `dimensions`; the rest is type-specific. `WorkspaceCanvas.ts` still contains runtime handling for `aiChatThread` canvas records, but AI chat sessions are primarily workspace panel/session records.

```typescript
type CanvasNodeType =
    | 'document'
    | 'mediaDocument'
    | 'image'
    | 'video'
    | 'audio'
    | 'uploadPlaceholder'
    | 'branchOrigin'
    | 'branchFork'
    | 'branchLine'

// Document node - contains a ProseMirror editor
type DocumentCanvasNode = {
    nodeId: string
    type: 'document'
    referenceId: string    // Points to Document.documentId
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

// Image node - displays an uploaded, imported, generated, or restored image
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

// Video node - displays a generated or restored MP4
type VideoCanvasNode = {
    nodeId: string
    type: 'video'
    fileId: string
    posterFileId: string
    frameFileId?: string
    workspaceId: string
    src: string
    posterSrc: string
    aspectRatio: number
    durationSeconds: number
    hasAudio: boolean
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

// Upload placeholder - persisted while the API converts an upload to a supported format
type UploadPlaceholderCanvasNode = {
    nodeId: string
    type: 'uploadPlaceholder'
    fileName: string
    status: 'converting' | 'failed'
    message?: string
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
    createdAt: number
    updatedAt: number
}

// Branch origin marker - neutral generated-media lineage root
type BranchOriginCanvasNode = {
    nodeId: string
    type: 'branchOrigin'
    branchId: string
    generationRequestId: string
    aiChatThreadId?: string
    provenance?: BranchOriginProvenance
    pendingState?: BranchMarkerPendingState
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
    temporary: true
}

// Branch fork marker - one reasoning-run lineage fork
type BranchForkCanvasNode = {
    nodeId: string
    type: 'branchFork'
    branchId: string
    generationRequestId: string
    aiChatThreadId?: string
    reasoningRunId?: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
    parentBranchNodeId?: string
    provenance?: BranchForkProvenance
    pendingState?: BranchMarkerPendingState
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
    temporary: true
}

// Branch line marker - continuation marker for a single media run
type BranchLineCanvasNode = {
    nodeId: string
    type: 'branchLine'
    branchId: string
    generationRequestId: string
    aiChatThreadId?: string
    reasoningRunId?: string
    mediaRunId?: string
    mediaModelId?: AiModelId
    parentBranchNodeId?: string
    provenance?: BranchLineProvenance
    pendingState?: BranchMarkerPendingState
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
    temporary: true
}

type CanvasNode =
    | DocumentCanvasNode
    | DocumentMediaCanvasNode
    | ImageCanvasNode
    | VideoCanvasNode
    | AudioCanvasNode
    | UploadPlaceholderCanvasNode
    | BranchOriginCanvasNode
    | BranchForkCanvasNode
    | BranchLineCanvasNode
```

| Node type | Reference target | Key type-specific fields |
|-----------|------------------|--------------------------|
| `document` | `referenceId` → `Document.documentId` | — (content fetched lazily) |
| `mediaDocument` | `fileId` → NATS Object Store | `workspaceId`, `src`, optional `posterFileId`/`posterSrc`, `pageCount`, `aspectRatio` |
| `image` | `fileId` → NATS Object Store | `workspaceId`, `src`, `aspectRatio` |
| `video` | `fileId` → NATS Object Store | `posterFileId`, optional `frameFileId`, `src`, `posterSrc`, `aspectRatio`, `durationSeconds`, `hasAudio` |
| `audio` | `fileId` → NATS Object Store | `workspaceId`, `src`, `durationSeconds`, `hasAudio` |
| `uploadPlaceholder` | none | `fileName`, conversion `status`, optional failure/conversion message |
| `branchOrigin` | API lineage plan | `branchId`, `generationRequestId`, optional `aiChatThreadId`, provenance, pending state |
| `branchFork` | API lineage plan | `branchId`, `generationRequestId`, reasoning-run ids, parent marker/source id, provenance, pending state |
| `branchLine` | API lineage plan | `branchId`, `generationRequestId`, reasoning/media run ids, parent marker/source id, provenance, pending state |

The shared multimodal, workspace-context, descriptor, and canvas-node types are defined in [`packages/lixpi/constants/ts/types.ts`](../../packages/lixpi/constants/ts/types.ts).

## Frontend Stores

State is split across four stores so the sidebar, the open workspace, its documents, and its threads can load and update independently.

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

The `files` array is metadata for objects in the workspace's NATS Object Store bucket. Backend file registration uses atomic DynamoDB append, and file removal uses a conditional indexed remove instead of rewriting the whole list, so a delete cannot overwrite concurrent media registrations. The API checks canonical `canvasState` before deleting workspace media bytes. Converted uploads preserve the original file record and store a `canonicalFileId`; canvas media nodes reference the canonical object so rendering and descriptor analysis never read unsupported original bytes. Full `canvasState` saves use `canvasStateUpdatedAt` as a canvas-only save token, so file uploads and other workspace metadata changes can update `updatedAt` without making an otherwise current canvas save fail.

### Media Storage Durability Contract

{% callout type="important" %}
Canvas media durability depends on two records staying aligned: `canvasState.nodes[]` names the object key a node renders, and `workspace.files[]` records the Object Store metadata for the original object plus any `canonicalFileId`. Any change that creates, deletes, converts, exports, imports, or rewrites media must preserve both sides.
{% /callout %}

These rules prevent canvas media from disappearing:

1. **Canvas nodes reference renderable objects.** If an upload is converted, the final `image`, `video`, `audio`, or `mediaDocument` node uses the `canonicalFileId`. The preserved original remains in `workspace.files[]` with its `canonicalFileId` pointer.
2. **Placeholders do not own bytes.** `uploadPlaceholder` nodes carry conversion UI state only. They are ignored by media descriptors and storage cleanup, and they must be replaced by a real media node only after the API or conversion notification returns the canvas-safe object id.
3. **File registry writes are atomic.** File registration uses DynamoDB `list_append`; file removal reads the live list, removes the matched index conditionally, and retries on conflicts. Do not replace the whole `files` array from a stale workspace snapshot.
4. **Canvas saves use the canvas token.** Browser canvas saves send `expectedCanvasStateUpdatedAt`, and the API updates `canvasStateUpdatedAt` separately from general `updatedAt`. A media upload, metadata patch, or file deletion must not make an otherwise fresh canvas save look stale, and a stale canvas save must not erase newer media nodes.
5. **Storage delete requests are only requests.** The browser-side lifecycle tracker may detect that an image or video node disappeared, but the API still re-reads the canonical workspace and refuses deletion when any `image`, `video`, `audio`, or `mediaDocument` node references the requested id, its poster, its representative frame, or its canonical/original pair.
6. **Delete metadata before bytes.** The API removes the file record before deleting Object Store bytes. If object deletion fails, the result is an orphaned object; deleting bytes first can leave live metadata and canvas nodes pointing at missing storage.
7. **Object Store reads and deletes must not recreate buckets.** A missing workspace bucket or missing object is a data-loss signal. Read, delete, dedup, export, and import checks should surface the fault rather than silently creating empty storage.
8. **Export/import must cover every canvas media reference.** When a new media node field can point at Object Store bytes, update `Workspace.getCanvasStateReferencedFileIds`, export collection, import validation, URL rewriting, and delete guards together. Imports must reject archives that are missing manifest or canvas-referenced object keys instead of recreating dangling nodes.
9. **Generated-media dedup self-heals.** Content-hash dedup may return an existing `hash-{sha256}` id only after Object Store confirms the object still exists. If metadata exists but bytes are gone, the storage adapter writes the bytes again.

The exact failure to avoid is a stale or partial writer making DynamoDB say a canvas node still exists while its Object Store bytes were removed, or making Object Store contain bytes that no canvas/file metadata can reach. Treat either as a bug in the writer, not as a rendering issue.

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

Workspace, document, and thread persistence all travel over NATS request/response. AI streaming uses its own per-thread subject documented in [Streaming & Events](../platform/STREAMING-AND-EVENTS.md).

| Subject | Purpose |
|---------|---------|
| `WORKSPACE.GET_USER_WORKSPACES` | List user's workspaces |
| `WORKSPACE.GET_WORKSPACE` | Get single workspace with canvas state |
| `WORKSPACE.CREATE_WORKSPACE` | Create new workspace |
| `WORKSPACE.UPDATE_WORKSPACE` | Update name |
| `WORKSPACE.UPDATE_CANVAS_STATE` | Persist viewport and node positions using the canvas save token |
| `WORKSPACE.DELETE_WORKSPACE` | Delete workspace |
| `WORKSPACE.GET_WORKSPACE_DOCUMENTS` | Get documents in workspace |
| `DOCUMENT.CREATE_DOCUMENT` | Create document |
| `DOCUMENT.UPDATE_DOCUMENT` | Update document content/title |
| `DOCUMENT_STEP.DOC_SUBMIT_STEPS` | Submit one or more local ProseMirror steps for server-authoritative document editing |
| `DOCUMENT_STEP.DOC_RESUME` | Load a ProseMirror snapshot and replay missed document step/control events |
| `DOCUMENT.DELETE_DOCUMENT` | Delete document |
| `AI_CHAT_THREAD.CREATE` | Create AI chat thread |
| `AI_CHAT_THREAD.GET` | Get AI chat thread by workspaceId + threadId |
| `AI_CHAT_THREAD.UPDATE` | Update AI chat thread content |
| `AI_CHAT_THREAD.DELETE` | Delete AI chat thread |
| `AI_CHAT_THREAD.GET_BY_WORKSPACE` | Get all AI chat threads in workspace |
| `AI_INTERACTION.CHAT_SEND_MESSAGE` | Send message to AI for processing |
| `AI_INTERACTION.CHAT_PIPELINE_RESUME` | Replay missed chat pipeline events for a thread/pipeline |
| `AI_INTERACTION.CHAT_STOP_MESSAGE` | Stop active AI streaming |
| `AI_INTERACTION.FEATURE_EXTRACT.LIST_BY_WORKSPACE` | List extraction sessions for Sessions history |
| `AI_INTERACTION.FEATURE_EXTRACT.DELETE` | Delete an extraction session without deleting its saved Feature |
| `WORKSPACE_IMAGE.DELETE_IMAGE` | Delete image metadata and Object Store bytes after canonical canvas reference checks |
| `WORKSPACE_VIDEO.DELETE_VIDEO` | Delete video metadata and Object Store bytes after canonical canvas reference checks |
| `FILE_SUBJECTS.CONVERT` | Request heavy upload conversion/probing from the NEX file-conversion workload |
| `FILE_SUBJECTS.CONVERT_RESPONSE.>` | Per-upload conversion completion notification consumed by the browser |
| `WORKSPACE.MEDIA_LIBRARY.CREATE_FROM_IMAGE` | Copy a stored canvas image into the Media Library |
| `WORKSPACE.MEDIA_LIBRARY.CREATE_FROM_VIDEO` | Copy a stored canvas video and poster into the Media Library |
| `WORKSPACE.MEDIA_LIBRARY.LIST_AVAILABLE` | List saved media visible in selected scopes |
| `WORKSPACE.MEDIA_LIBRARY.MATERIALIZE_IMAGE_TO_WORKSPACE` | Copy a saved image into workspace storage for canvas insertion |
| `WORKSPACE.MEDIA_LIBRARY.MATERIALIZE_VIDEO_TO_WORKSPACE` | Copy a saved video and poster into workspace storage for canvas insertion |
| `WORKSPACE.MEDIA_LIBRARY.CHANGE_SCOPE` | Copy a library object to a new scope and update metadata |
| `WORKSPACE.MEDIA_LIBRARY.DELETE` | Delete a saved library item and its stored object(s) |

### Media HTTP Endpoints

Workspace file bytes are served over authenticated HTTP rather than NATS, so the browser can stream pixels and use HTTP Range requests for audio and video.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/files/:workspaceId` | POST | Upload any allowed file, sniff bytes, store the original, and return either a ready canvas-safe object or a conversion id |
| `/api/files/:workspaceId/import-url` | POST | Fetch a public URL into workspace Object Store through the same sniff/convert pipeline |
| `/api/files/:workspaceId/:fileId` | GET | Serve original, canonical, poster, audio, video, image, or document bytes with auth token |
| `/api/media-library/items/:itemId/content` | GET | Serve an ACL-checked saved Media Library image preview or Range-capable video preview |
| `/api/media-library/items/:itemId/poster` | GET | Serve an ACL-checked saved Media Library video poster |
| `/api/workspaces/:workspaceId/export` | GET | Download workspace as ZIP archive (see [Workspace Export & Import](../library/WORKSPACE-EXPORT-IMPORT.md)) |
| `/api/workspaces/:workspaceId/import` | POST | Validate and import a workspace ZIP archive |

## Persistence Strategy

Different changes persist on different cadences so continuous interactions never hammer the backend, while discrete structural changes save immediately.

| Change | Cadence | Path |
|--------|---------|------|
| Viewport pan/zoom | Debounced ~1s | `WORKSPACE.UPDATE_CANVAS_STATE` |
| Node position/dimensions after drag/resize | Immediate via `onCanvasStateChange` | `WORKSPACE.UPDATE_CANVAS_STATE` |
| Edge create / delete / reconnect | Immediate | `WORKSPACE.UPDATE_CANVAS_STATE` |
| Document content | Live batched step submit + settled server snapshot | `DOCUMENT_STEP.DOC_SUBMIT_STEPS` / `DOCUMENT_STEP.DOC_RESUME`; API writes `Document.content` with `proseMirrorVersion` after the edit burst settles |
| AI chat thread content | API final snapshot after stream completion | ProseMirror step stream for live rendering; `AiChatThread.update()` writes `content` and `proseMirrorVersion` when the authoritative stream ends |
| AI chat panel UI (open/close, tabs, width, chips, drafts) | On change | persisted inside `canvasState.aiChatPanel` |

Canvas-state changes are debounced (1 second) before persisting, which prevents hammering the backend during continuous pan/zoom. The browser serializes full canvas saves per workspace and sends the last acknowledged `canvasStateUpdatedAt` value with each save; the API rejects stale canvas saves instead of replacing newer canonical canvas state. Document editor transactions render locally, then submit short ProseMirror step batches to the API authority; the API writes a settled snapshot after the edit burst. AI chat transcript changes are authored by the API stream assembler, replayed through the document step log while active, and written once when the stream finalizes.

AI chat panel state is stored inside `canvasState.aiChatPanel`. Opening or closing the panel, expanding or collapsing Sessions, opening or closing tabs, resizing it, changing context controls, and editing prompt drafts persist workspace UI state but do **not** create a conversation entity. Submitting from an empty panel creates a standalone chat session. Sessions is collapsed by default and toggled from the history icon in the panel control row; when expanded it lists standalone chats and extraction sessions. Closing a tab only changes panel presentation and the session remains reopenable; explicit standalone or extraction deletion removes that session and its saved prompt draft, while a saved Feature remains independent when its extraction session is deleted. The full panel and Sessions behavior is documented in [Chat Panel & Sessions](../ai-chat/CHAT-PANEL-AND-SESSIONS.md).

## Media Node Lifecycle Management

Media nodes on the canvas are tracked by [`canvasMediaNodeLifecycle.ts`](../../services/web-ui/src/infographics/workspace/canvasMediaNodeLifecycle.ts). Each supported node type provides a small tracking/deletion config, so images, videos, and future media types share one state-diff implementation. When a tracked media node is removed from the canvas state:

1. The tracker compares the previous and current canvas states.
2. It detects which tracked media keys are missing from the current canvas state.
3. It calls the configured deletion utility for that node type.

This keeps intentionally removed workspace-node media from accumulating in storage. The tracked browser cleanup paths are image and video nodes; upload placeholders are ignored because they do not own a renderable object. The API re-reads canonical `canvasState` before deleting bytes and refuses deletion while any image, video, audio, or uploaded-document node still references the file. Image nodes use `deleteImage()` from [`imageUtils.ts`](../../services/web-ui/src/utils/imageUtils.ts). Video nodes use `deleteVideo()` from [`videoUtils.ts`](../../services/web-ui/src/utils/videoUtils.ts), which deletes the MP4 and best-effort poster image. Neither path deletes Media Library items — those are intentionally independent saved copies with their own scope and deletion lifecycle (see [Media Library](../library/MEDIA-LIBRARY.md)).

## Workspace Load and Visibility Tracking

Canvas nodes store dimensions in `canvasState`, and the workspace route currently loads the workspace record, documents, and AI chat threads up front. Visibility tracking still matters for rendering work: the canvas can decide which node shells, media sprites, outlines, and overlays should be active around the viewport.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph Initialization
        WS[Workspace Route Load] --> W[Fetch workspace]
        WS --> D[Fetch documents]
        WS --> T[Fetch AI chat threads]
        W --> CS[canvasState]
        D --> STORE[Document store]
        T --> THREADS[Thread store]
        CS --> RN[Render visible node shells]
    end

    subgraph Viewport Detection
        PZ[Pan/Zoom Event] --> VIS{isNodeInViewport?}
        VIS -->|Yes| ACTIVE[Activate overlays/media sync]
        VIS -->|No| SKIP
    end

    subgraph Rendering Work
        ACTIVE --> MEDIA[PIXI media layers]
        ACTIVE --> CHROME[DOM chrome and handles]
        ACTIVE --> EDGES[Edge sync]
    end
```

### Loading Strategy

- **Route-level fetch** — The workspace route loads workspace metadata, canvas state, documents, and AI chat threads before render.
- **No viewport fetch path today** — Visibility tracking does not fetch document/thread records lazily.
- **No unloading** — Once route data is loaded, it remains in the stores until navigation or refresh.
- **ResizeObserver** — Pane bounds are tracked for accurate visibility detection during window resizes.

## Related Pages

- [Rendering Engine](./RENDERING-ENGINE.md) — the DOM/PIXI ownership split, the layer stack, the viewport bridge, and the sync pipeline that turns this model into pixels.
- [Image Rendering Performance](./IMAGE-RENDERING-PERFORMANCE.md) — texture cache, LoD tiers, the decode pool, and known performance issues.
- [User Flows](./USER-FLOWS.md) — opening a workspace, creating documents, and adding/saving/deleting/moving/editing media.
- [Edges & Connections](./EDGES-AND-CONNECTIONS.md) — the connection manager, routing, proximity connect, and message-level anchoring.
- [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md) — generated-media placement, branch-root provenance, and balanced branch-tree layout.
- [Chat Panel & Sessions](../ai-chat/CHAT-PANEL-AND-SESSIONS.md) and [Context Relevance](../ai-chat/CONTEXT-RELEVANCE.md) — the AI chat panel and per-turn workspace relevance.
