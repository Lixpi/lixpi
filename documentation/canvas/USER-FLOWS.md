---
title: User Flows
description: The end-to-end canvas interactions — opening a workspace, creating a document, adding and saving and deleting media, editing content, and moving a node — each with its sequence diagram and the rules behind it.
---

# User Flows

This page walks through the canvas interactions a user performs day to day, each illustrated with a sequence diagram across the Svelte component, the framework-agnostic canvas engine, the frontend services, and the backend. Read it alongside the [Workspace Model](./WORKSPACE-MODEL.md), which defines every entity these flows read and write, and [Edges & Connections](./EDGES-AND-CONNECTIONS.md), which covers the connect/disconnect interactions that are not repeated here.

{% callout type="note" %}
This page is part of the canvas domain. The "why" of each persisted shape lives in [Workspace Model](./WORKSPACE-MODEL.md); how the result is drawn lives in [Rendering Engine](./RENDERING-ENGINE.md). AI-driven flows (generating an image or video from a chat thread) are documented in [Image Generation](../media-generation/IMAGE-GENERATION.md), [Video Generation](../media-generation/VIDEO-GENERATION.md), and [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md).
{% /callout %}

## Opening a Workspace

Selecting a workspace fetches the Workspace record, then `AssetService` resolves the Assets referenced by canvas nodes, conversation-panel tabs, and workspace-scoped document/conversation projections before the canvas renders.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Sidebar
    participant Router
    participant WSvc as WorkspaceService
    participant ASvc as AssetService
    participant Canvas
    participant workspaceStore
    participant assetsStore
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: NAVIGATION
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, assetsStore: PHASE 1 - NAVIGATION — User chooses a workspace
        User->>Sidebar: Click workspace
        activate Sidebar
        Sidebar->>Router: navigateTo(/workspace/:id)
        deactivate Sidebar
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: DATA FETCH
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, assetsStore: PHASE 2 - DATA FETCH
        activate WSvc
        Router->>WSvc: getWorkspace()
        WSvc->>WSvc: Fetch via NATS
        WSvc-->>workspaceStore: setDataValues()
        deactivate WSvc
        activate ASvc
        Router->>ASvc: loadWorkspaceAssets()
        ASvc-->>assetsStore: Assets + role snapshots
        deactivate ASvc
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: RENDER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, assetsStore: PHASE 3 - RENDER — Render with loaded state
        activate Canvas
        Canvas->>Canvas: render(canvasState, Assets)
        deactivate Canvas
    end
```

The route resumes mutable `content` and `conversation` roles from their Blob snapshots plus later Asset-step events. Periodic synchronization refreshes global Asset metadata and rendition state without replacing local node topology.

## Creating a Document

Clicking "+ New Document" creates an Asset with a title-free `content` role. The canvas computes a local node position and attaches the `(assetId, nodeId)` membership through the Asset reference transaction.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas
    participant ASvc as AssetService
    participant WSvc as WorkspaceService
    participant assetsStore
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: REQUEST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, assetsStore: PHASE 1 - REQUEST — User initiates document creation
        User->>Canvas: Click "+ New Document"
        activate Canvas
        Canvas->>ASvc: create(primaryCategory=document)
        deactivate Canvas
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: BACKEND WORK
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, assetsStore: PHASE 2 - BACKEND WORK
        activate ASvc
        ASvc->>ASvc: asset.create request
        ASvc-->>assetsStore: upsert Asset
        ASvc-->>Canvas: Return Asset
        deactivate ASvc
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: RENDER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, assetsStore: PHASE 3 - ATTACH
        activate Canvas
        Canvas->>Canvas: Calculate position
        Canvas->>ASvc: attach(assetId, nodeId, canvas mutation)
        Canvas->>Canvas: Re-render with new node
        deactivate Canvas
    end
```

## Adding a File

The canvas upload control accepts images, videos, audio, PDFs, office documents, text, and Markdown. The browser posts the selected file to the Workspace Asset endpoint; the API sniffs the bytes, stores a content-addressed original Blob in the Workspace organization's bucket, creates an Asset, and queues the NEX rendition workload. The browser keeps a generic `operationStatus` upload node until the Asset has the rendition required by its node kind.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Svelte as WorkspaceCanvas.svelte
    participant Picker as Upload Picker
    participant API as /api/assets/workspaces/:workspaceId
    participant NEX as asset-rendition workload
    participant ObjStore as NATS Object Store
    participant WSvc as WorkspaceService
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: UPLOAD
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, WSvc: PHASE 1 - UPLOAD — User picks a file
        User->>Svelte: Click upload control
        activate Svelte
        Svelte->>Picker: open()
        deactivate Svelte
        User->>Picker: Select file
        activate Picker
        Picker->>Svelte: File selected
        activate Svelte
        Svelte->>Svelte: Insert operationStatus upload node
        Svelte->>API: POST multipart file
        activate API
        API->>API: sniff bytes + apply MEDIA_POLICY
        API->>ObjStore: putObject(org bucket, SHA-256 Blob key)
        deactivate API
        deactivate Picker
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: CREATE NODE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, WSvc: PHASE 2 - CONVERT OR PROBE
        alt required rendition already exists
            API-->>Svelte: { status: processing, assetId, kind, originalUrl }
        else rendition work required
            API-->>Svelte: { status: processing, assetId, kind, originalUrl }
            Svelte->>Svelte: Observe Asset update events
            API->>NEX: blob.rendition.request
            activate NEX
            NEX->>ObjStore: read verified original Blob
            NEX->>ObjStore: write required rendition Blobs
            NEX-->>API: rendition Blob descriptors
            deactivate NEX
            API-->>Svelte: publish conversion notification
        end
        deactivate Svelte
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: PERSIST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, WSvc: PHASE 3 - CREATE NODE + PERSIST
        activate Svelte
        Svelte->>Svelte: Replace placeholder with image/video/audio/mediaDocument node
        Svelte->>WSvc: updateCanvasState()
        activate WSvc
        deactivate WSvc
        Svelte->>Svelte: Re-render with stored media node
        deactivate Svelte
    end
```

The server is authoritative for detected kind, media facts, rendition status, and canvas hints. Canvas nodes persist only `assetId` and geometry; `canonical`, `poster`, `representativeFrame`, and document-preview details remain Asset renditions. URL insertion uses `POST /api/assets/workspaces/:workspaceId/import-url`, with the same public-URL checks and byte-sniffed ingest pipeline, so a canvas media node is never backed only by an external URL.

On load the client verifies that stored image node dimensions match the natural aspect ratio; if they do not match it corrects the node dimensions and persists the corrected values, so stale image nodes self-heal. Image resize uses a diagonal-based algorithm for smooth, aspect-locked resizing, and the UI computes resize handle size and offsets dynamically so handles stay visually consistent regardless of canvas zoom.

## Asset Library Membership

Every Asset is created with one typed catalog reference, so uploads, generated outputs, documents, and conversations are immediately discoverable in their authorized scope. The node action opens Asset details; it does not create a copy or a second catalog record. Scope controls discovery (`Workspace`, `Mine`, or `Organization`), while `All available` is the union of authorized projections.

Because placement and catalog references are independent, removing a canvas node does not remove a catalog entry. Workspace deletion removes that Workspace's placements and Workspace-owned catalog references; the Asset survives whenever any reference remains. The full contract is documented in [Media Library](../library/MEDIA-LIBRARY.md).

## Deleting Canvas Media

When an Asset-backed node is removed, the browser submits an Asset detach with the new canvas state. The API atomically commits the canvas mutation and removes the node ID from the Workspace reference. An Asset enters maintenance deletion only when its reference count reaches zero.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant AssetSvc as AssetService
    participant NATS as NATS Client
    participant API as API Service
    participant ObjStore as NATS Object Store
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: REMOVE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, ObjStore: PHASE 1 - REMOVE — User deletes media from canvas
        User->>Canvas: Remove media node
        activate Canvas
        Canvas->>Canvas: commitCanvasState(newState)
        deactivate Canvas
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: DETECT
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, ObjStore: PHASE 2 - DETECT
        Canvas->>AssetSvc: detach(assetId, nodeId, canvas mutation)
        activate AssetSvc
        AssetSvc->>AssetSvc: Send authenticated Asset request
        deactivate AssetSvc
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: DELETE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, ObjStore: PHASE 3 - DELETE
        activate AssetSvc
        AssetSvc->>NATS: asset.detach
        NATS->>API: Transactional detach
        activate API
        API->>API: Commit canvas + reference removal
        API->>API: Queue Asset deletion only at zero references
        API->>ObjStore: GC zero-reference rendition Blobs asynchronously
        deactivate API
        deactivate AssetSvc
    end
```

Detachment never deletes bytes inline. Maintenance rechecks Asset and Blob reference counts before deletion, and catalog references protect the Asset independently of canvas placement. See [Workspace Model](./WORKSPACE-MODEL.md) and [Data Storage](../platform/DATA-STORAGE.md).

## Editing Content

Typing in a document's ProseMirror editor applies locally first, then the authority service submits a short batch of ProseMirror steps to the API. The API accepts ordered steps through `DOCUMENT_STEP.DOC_SUBMIT_STEPS`, echoes authoritative step events, and writes the settled `Document.content` snapshot after the edit burst.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant ProseMirror
    participant Auth as ProseMirrorAuthorityService
    participant NATS
    participant API
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: EDIT
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, API: PHASE 1 - EDIT - User edits content
        User->>ProseMirror: Type content
        activate ProseMirror
        ProseMirror->>ProseMirror: apply local transaction
        deactivate ProseMirror
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: PROPAGATE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, API: PHASE 2 - SUBMIT STEP BATCH
        ProseMirror->>Auth: local transaction
        activate Auth
        Auth->>NATS: DOCUMENT_STEP.DOC_SUBMIT_STEPS
        activate NATS
        NATS->>API: validate + CAS publish
        deactivate NATS
        deactivate Auth
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: AUTHORITATIVE ECHO + SETTLE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, API: PHASE 3 - AUTHORITATIVE ECHO + SETTLE
        activate API
        API->>NATS: asset.document.steps.{organizationId}.{assetId}.{role}
        NATS->>Auth: authoritative STEP
        Auth->>ProseMirror: advance local version
        API->>API: write settled snapshot
        deactivate API
    end
```

## Moving a Document

Dragging a node disables pan and updates the node's DOM position live; on mouse-up the canvas reports the new positions, the store updates, and `WorkspaceService.updateCanvasState()` persists them immediately (unlike pan/zoom, which is debounced).

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

On drop, collision resolution may nudge overlapping nodes apart so the surface stays legible; see [Collision Resolution](./COLLISION-RESOLUTION.md). Dragging a document or image near an AI chat thread also surfaces a proximity-connect suggestion — that interaction is documented in [Edges & Connections](./EDGES-AND-CONNECTIONS.md#proximity-connect).
