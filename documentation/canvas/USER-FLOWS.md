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

Selecting a workspace in the sidebar navigates the router, which fetches the workspace and its documents through their services and hydrates the stores before the canvas renders with the loaded state.

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
        activate Sidebar
        Sidebar->>Router: navigateTo(/workspace/:id)
        deactivate Sidebar
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
        activate Canvas
        Canvas->>Canvas: render(canvasState, documents)
        deactivate Canvas
    end
```

The workspace route loads the workspace record, documents, and AI chat threads before rendering. The canvas still tracks visible nodes for render/performance decisions, but document/thread data is not fetched lazily today.

## Creating a Document

Clicking "+ New Document" asks `DocumentService` to create the document, adds it to the store, then the canvas computes a position, creates a `document` node, and persists the updated canvas state.

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
        activate Canvas
        Canvas->>DSvc: createDocument()
        deactivate Canvas
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
        activate Canvas
        Canvas->>Canvas: Calculate position
        Canvas->>WSvc: updateCanvasState()
        Canvas->>Canvas: Re-render with new node
        deactivate Canvas
    end
```

## Adding an Image

Adding an image opens the upload modal, posts the file to the workspace image endpoint (which stores it in Object Store), then the canvas loads the image to read its aspect ratio, creates an `ImageCanvasNode`, and persists the canvas state.

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

After an image is uploaded or imported from a public URL, the client loads the persisted workspace object to determine the natural aspect ratio. URL insertion uses `POST /api/images/:workspaceId/import-url`, which validates and stores the fetched image in the workspace Object Store **before** creating a canvas node; a canvas image node is therefore never backed only by an external URL. The validation and import rules for URLs live in [Media Library](../library/MEDIA-LIBRARY.md). On load the client verifies that the stored node dimensions match that ratio; if they do not match it corrects the node dimensions and persists the corrected values, so stale nodes self-heal. Image resize uses a diagonal-based algorithm for smooth, aspect-locked resizing, and the UI computes resize handle size and offsets dynamically so handles stay visually consistent regardless of canvas zoom.

## Saving Media to the Media Library

Completed image and video nodes expose `Add to Media Library` in their canvas bubble menu. Saving is **explicit**: it copies the image bytes (or video MP4 plus poster bytes) from `workspace-{workspaceId}-files/{fileId}` into a Media Library scope-owned Object Store bucket and writes a generic media-metadata record. New saves start in `Workspace` scope; users can view or move items through `Workspace`, `Mine`, `Organization`, and `Public` scopes, or browse `All available`. Saving confirms in place with a transient message on the canvas and does not open or switch the panel. Re-saving the same source media is deduplicated — the server returns the existing library item instead of writing a second independent copy. Partially streaming AI-generated images and VEO videos still polling do not expose the action until a stored final object exists.

Because a saved copy is independent, removing the original canvas media does **not** remove its Media Library copy, and deleting a workspace removes only the library items still scoped to that workspace. The full saved-media panel, scopes, ownership, materialization-back-to-canvas, and Feature-promotion rules are documented in [Media Library](../library/MEDIA-LIBRARY.md).

## Deleting an Image

When an image node is removed from the canvas — by user action or programmatically — the lifecycle tracker diffs the canvas state, detects the removed `fileId`, and issues a delete request over NATS. The API re-reads the workspace and deletes bytes only when canonical `canvasState` no longer references the file.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas as WorkspaceCanvas.ts
    participant Tracker as canvasMediaNodeLifecycle
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
        API->>API: Remove from workspace.files
        API->>ObjStore: deleteObject(fileId)
        deactivate API
        deactivate Tracker
    end
```

Video nodes follow the same shape over the `DELETE_VIDEO` subject. The delete handler refuses to remove bytes while canonical canvas state still references the MP4, poster, or representative frame. Neither deletion path touches Media Library items, which are independent saved copies; the full lifecycle is described in [Media Node Lifecycle Management](./WORKSPACE-MODEL.md#media-node-lifecycle-management).

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
        API->>NATS: document.steps.{workspaceId}.{docType}.{docId}
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
