# Media Library

The Media Library is the right-side canvas panel for media a user has chosen to keep. It has three categories: **Features**, which exposes the existing extracted-feature library, **Images**, which stores reusable copies of finished canvas images, and **Videos**, which stores reusable copies of finished canvas videos.

The important detail is ownership. A saved image or video is not a bookmark to a canvas node and is not an alias to the workspace object. Saving makes a separate Object Store copy. Adding it back to a canvas makes another workspace copy. A user can therefore tidy or delete the original canvas media without losing the asset they saved for reuse.

For the larger canvas rendering and placement architecture, see [CANVAS-ENGINE.md](CANVAS-ENGINE.md) and [WORKSPACE-FEATURE.md](WORKSPACE-FEATURE.md). For feature extraction, sample images, and `/use` prompt references, see [FEATURE-EXTRACTION-AND-LIBRARY.md](FEATURE-EXTRACTION-AND-LIBRARY.md).

## Core Concepts

**Media Library** — A canvas-owned panel rendered by [`mediaLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts). The first time it is opened for a canvas instance, it starts on `Features` with the current `Workspace` scope selected.

**Feature** — An extracted reusable feature such as a palette or style instruction. Features appear inside the Media Library, but they still use the established Feature model, NATS subjects, samples, extraction workflow, and `/use` resolution. They are not `MediaLibraryItem` records.

**Saved Image** — A library-owned copy of a stored canvas image. It has its own item ID, scope, metadata record, preview route, and Object Store object.

**Saved Video** — A library-owned copy of a stored canvas video. It has its own item ID, scope, metadata record, Range-capable MP4 content route, optional poster route, and Object Store object.

**Canvas Image** — An image node whose bytes belong to a workspace. Uploaded images, imported URL images, completed generated images, and images restored from the library all become normal stored canvas images.

**Canvas Video** — A video node whose MP4 and poster bytes belong to a workspace. Completed VEO generations and videos restored from the library become normal stored canvas videos.

**Materialization** — Copying a saved library image or video into the active workspace so it can be inserted as a new normal canvas node. The new node does not inherit AI-generation lineage or the deleted state of any earlier canvas node.

**Scope** — The visibility and storage owner of a saved media item: `Workspace`, `Mine`, `Organization`, or `Public`. Media is first saved to the active workspace. Moving scope moves the canonical library copy as well as its browse metadata.

## What Users Can Do

- Open **Media Library** from the independent bottom-right icon above the existing zoom indicator.
- Browse extracted `Features`, explicitly saved `Images`, or explicitly saved `Videos`.
- Search the active category and switch between `Workspace`, `Mine`, `Organization`, `Public`, and `All available`.
- Select a completed stored image or video on the canvas and choose **Add to Media Library**.
- Add a saved image or video back to the active canvas as a fresh node.
- Move a media item they own into another available scope or delete it from the library.
- Inspect extracted Features, use them in a prompt, change sharing for Features they own, delete owned Features, or report public Features.

The panel does not collect every generated asset automatically. It contains images and videos only after an explicit save action.

## Architecture

The panel is part of the framework-agnostic canvas layer. Svelte owns the independent bottom-right launcher above the unchanged zoom indicator and image-upload/import integration, while `WorkspaceCanvas.ts` owns panel toggling, bubble-menu saving, and new-node insertion. The API keeps saved media separate from the extraction domain.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph Browser["Browser Workspace"]
        Toolbar[Bottom-right utilities<br/>Media Library button and zoom]
        Bubble[Media bubble menu<br/>Add to Media Library]
        Canvas[WorkspaceCanvas.ts<br/>panel and node insertion]
        Panel[mediaLibraryPanel.ts<br/>Features, Images, and Videos]
        MediaService[media-library-service.ts]
        Toolbar --> Canvas
        Bubble --> Canvas
        Canvas --> Panel
        Panel --> MediaService
    end

    subgraph FeatureDomain["Existing Feature Domain"]
        FeatureSubjects[Feature NATS subjects]
        FeatureRecords[(Feature records<br/>and sample objects)]
        Resolver[Extraction and /use resolver]
        FeatureSubjects <--> FeatureRecords
        Resolver <--> FeatureRecords
    end

    subgraph MediaDomain["Saved Media Domain"]
        MediaSubjects[Media Library NATS subjects]
        MediaRoutes[Authorized content and poster routes]
        MediaModel[MediaLibraryItem model]
        MediaStorage[Media library storage service]
        MediaRecords[(Media Library<br/>DynamoDB tables)]
        LibraryObjects[(Scope-owned<br/>Object Stores)]
        WorkspaceObjects[(Workspace image/video<br/>Object Stores)]
        MediaSubjects --> MediaModel
        MediaSubjects --> MediaStorage
        MediaRoutes --> MediaModel
        MediaRoutes --> LibraryObjects
        MediaModel <--> MediaRecords
        MediaStorage <--> LibraryObjects
        MediaStorage <--> WorkspaceObjects
    end

    Panel <--> FeatureSubjects
    MediaService <--> MediaSubjects
    Panel -.->|Preview media request| MediaRoutes
```

### Ownership Boundary

Workspace media and saved media live in different objects:

```text
workspace-{workspaceId}-files/{fileId}

media-library-workspace-{workspaceId}-files/{itemId}
media-library-user-{userId}-files/{itemId}
media-library-organization-{organizationId}-files/{itemId}
media-library-public-files/{itemId}
```

This gives the feature its deletion behavior:

| Action | Object that changes | Object that remains untouched |
|--------|---------------------|-------------------------------|
| Save a canvas image or video | New library object(s) are written | The source workspace object |
| Delete the original canvas media | Its workspace object is removed through normal canvas lifecycle | Any saved library copy |
| Add saved media to canvas | New workspace object(s) are written | The library object |
| Delete the newly added canvas copy | That new workspace object is removed | The library object |
| Move media scope | A copy is written in the destination library bucket, then metadata points to it | Canvas copies |

## Panel Behavior

The old feature-only drawer is replaced by [`mediaLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts) and [`media-library-panel.scss`](../../services/web-ui/src/infographics/workspace/media-library-panel.scss).

### Position and Layout

- The panel opens from the right side of the workspace pane.
- It is flush to the top and bottom of the pane; there is no outer vertical whitespace.
- Its width is two-thirds of the space available after any open AI chat panel is reserved.
- If AI chat is open, AI chat remains rightmost and the Media Library moves immediately to its left.
- The bottom-right Media Library icon and the existing zoom indicator independently move left with AI chat. While the panel is open, the drawer covers the launcher.
- `settings.mediaLibrary.panelWidthFraction` owns the drawer width.
- Features use a browser and inspector layout: browse cards show a large preview, title, scope, and a two-line summary preview; the selected inspector preserves the full summary, tags, instructions, samples, palette data, and management controls.
- When the remaining width is narrow, selecting a Feature replaces the browser with a focused detail view and an explicit **Back** action.

### Categories

The initial category is `Features`, preserving the path users already had from the old Feature Library. After a user changes category or scope, closing and reopening the panel in the same canvas instance retains that in-memory selection.

| Category | Contents | Main actions |
|----------|----------|--------------|
| `Features` | Concise browse cards plus a selected Feature inspector | View full details and samples, `Use Feature`, change owned sharing, delete owned items, report public items, start extraction |
| `Images` | Saved image metadata and authorized previews | `Add to canvas`, move scope, delete |
| `Videos` | Saved video metadata, authorized posters, and hover MP4 previews | `Add to canvas`, move scope, delete |

Feature `created`, `updated`, and `deleted` events update or reload the Feature browser while it is open. Media Library `created`, `updated`, and `deleted` events reload image rows while the panel is open on `Images` and video rows while it is open on `Videos`. A successful media save on the canvas displays an in-place toast; it does not force the panel open or switch the current category.

### Filters

The compact **Scope** selector exposes `Workspace`, `Mine`, `Organization`, `Public`, and `All available`; a segmented `Features` / `Images` / `Videos` control makes the content type separate from permissions.

- The panel's initial filter is `Workspace`; filter selection is retained in memory when the panel is closed and reopened on the same canvas instance.
- `All available` asks the backend for readable media from all accessible workspaces, the current user's own scope, organizations the user belongs to, and public items.
- Image and video search is applied by the media-list request against `displayName`.
- Feature search stays in the Feature rendering path and matches feature name, summary, category, and tags.
- A Feature owner changes that Feature's scope from its inspector only. Promotion to `Public` requires confirmation; moves to `Workspace`, `Mine`, or `Organization` apply immediately after server authorization.

## Saving and Reusing Media

### Eligible Canvas Media

`Add to Media Library` appears in the canvas bubble menu when an image or video node has a stored `fileId` and is not still tracked as an in-progress generation. The backend then verifies that the corresponding workspace object really exists before it saves anything.

This includes:

- Uploaded images.
- Images imported from a URL after the server has stored them in the workspace.
- Completed AI-generated images.
- Images previously added to the canvas from the Media Library.
- Completed AI-generated videos.
- Videos previously added to the canvas from the Media Library.

A generated image or video that is still streaming or polling does not show the action.

### Save and Add-to-Canvas Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Canvas as Workspace Canvas
    participant Media as Media Library Handlers
    participant WS as Workspace Store
    participant LS as Library Store
    participant DB as Media Records

    rect rgb(220, 236, 233)
        Note over User, DB: PHASE 1 - SAVE A COMPLETED CANVAS MEDIA NODE
        User->>Canvas: Choose Add to Media Library
        activate Canvas
        Canvas->>Media: CREATE_FROM_IMAGE or CREATE_FROM_VIDEO(workspaceId, fileId)
        activate Media
        Media->>DB: Find active workspace save for this source
        activate DB
        DB-->>Media: Existing item or no match
        deactivate DB
        alt Item already saved in this workspace scope
            Media-->>Canvas: Existing item, deduplicated = true
        else First save or item was moved out of workspace scope
            Media->>WS: Read stored source bytes<br/>and poster for video
            activate WS
            WS-->>Media: Bytes and file metadata
            deactivate WS
            Media->>LS: Write independent workspace-scoped copy
            activate LS
            LS-->>Media: Library object stored
            deactivate LS
            Media->>DB: Write item, browse metadata, owner access row
            activate DB
            DB-->>Media: Saved item
            deactivate DB
            Media-->>Canvas: New item
        end
        deactivate Media
        Canvas-->>User: Show saved or already-saved toast
        deactivate Canvas
    end

    rect rgb(195, 222, 221)
        Note over User, DB: PHASE 2 - ADD SAVED MEDIA TO THE ACTIVE CANVAS
        User->>Canvas: Choose Add to canvas
        activate Canvas
        Canvas->>Media: MATERIALIZE_IMAGE_TO_WORKSPACE or MATERIALIZE_VIDEO_TO_WORKSPACE
        activate Media
        Media->>DB: Read authorized active item
        activate DB
        DB-->>Media: Library asset reference
        deactivate DB
        Media->>LS: Read canonical saved bytes
        activate LS
        LS-->>Media: Media bytes
        deactivate LS
        Media->>WS: Store fresh workspace object(s)
        activate WS
        WS-->>Media: New fileId and route URLs
        deactivate WS
        Media-->>Canvas: Materialized response
        deactivate Media
        Canvas->>Canvas: Insert centered normal image/video node
        Canvas-->>User: Fresh canvas media appears
        deactivate Canvas
    end
```

Repeated saving is intentionally conservative. If the same user saves the same source `fileId` again while its active saved item is still scoped to that workspace, the handler returns that existing item and does not copy bytes again. If the user has moved the item to `Mine`, `Organization`, or `Public`, saving the source again creates a new workspace-scoped item.

When saved media is added to the canvas, [`WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) sends the materialized response through its existing centered insertion and collision-resolution path. The inserted node is a regular `ImageCanvasNode` or `VideoCanvasNode`; it does not borrow generation edges or provenance from the media that was originally saved.

## URL Image Imports

An image inserted from a URL must be a real workspace image before it can behave like other canvas media. [`WorkspaceCanvas.svelte`](../../services/web-ui/src/components/WorkspaceCanvas.svelte) now sends URL insertion through `POST /api/images/:workspaceId/import-url`, then builds a node only from the stored response returned by that route.

[`remote-image-import.ts`](../../services/api/src/services/remote-image-import.ts) applies the server-side rules:

- Only `http` and `https` URLs whose destination passes the server's address checks are accepted.
- URLs containing credentials are rejected.
- DNS results and literal addresses are rejected for implemented private/local ranges, including IPv4 private, loopback, link-local, carrier-grade NAT and multicast ranges, plus IPv6 loopback, unique-local and link-local ranges and IPv4-mapped forms of denied IPv4 addresses.
- Redirects are followed manually, with the same address check applied at every hop, for at most four redirects.
- Fetches time out after 15 seconds.
- The response must use an allowed image MIME type and fit within the shared image-size limit.
- `sharp` must be able to read intrinsic width and height before the image is stored.

On success, the image goes through [`image-storage.ts`](../../services/api/src/services/image-storage.ts), receives a workspace `fileId`, and becomes eligible for normal canvas lifecycle and Media Library saving. On failure, no canvas image node is created.

## Scopes and Access

Saved media starts in `Workspace` scope and can be moved only by the user who saved it. The scope determines both who may read the item and which Object Store bucket owns its canonical bytes.

| Scope in UI | Persisted scope | Stored under | Readable by |
|-------------|-----------------|--------------|-------------|
| `Workspace` | `workspace` | Active workspace ID | Item owner and users with access to that workspace |
| `Mine` | `user` | Saving user's ID | Item owner |
| `Organization` | `organization` | Selected organization ID | Item owner and members with access to that organization |
| `Public` | `public` | `public` sentinel | Any authenticated user |

The content route, `GET /api/media-library/items/:itemId/content`, performs the same scope check before reading Object Store bytes. For video items it supports HTTP Range requests so `<video>` previews and canvas playback can seek without downloading the full MP4. The poster route, `GET /api/media-library/items/:itemId/poster`, serves the copied frame-0 poster for video rows. Both routes resolve all workspaces and organizations available to the requesting user so an item visible under `All available` can also render its preview.

The access-list table currently receives an owner row when an item is created. Browsing, preview, and materialization use the read checks in [`media-library-item.ts`](../../services/api/src/models/media-library-item.ts); scope changes and deletion use its owner-only lookup from the NATS handlers. There is not yet a separate per-item sharing UI.

## Data Model

Features remain in their Feature records. The stored media records implemented by the Media Library are kind-discriminated images and videos:

```typescript
type MediaLibraryImageItem = {
    itemId: string
    version: 1
    kind: 'image'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId: string
    scope: 'workspace' | 'user' | 'organization' | 'public'
    scopeOwnerId: string
    scopeAndOwner: string
    status: 'active' | 'deleted'
    asset: {
        bucketName: string
        objectKey: string
        mimeType: string
        byteSize: number
        originalName: string
    }
    image: {
        width: number
        height: number
        aspectRatio: number
    }
    createdAt: number
    updatedAt: number
}

type MediaLibraryVideoItem = {
    itemId: string
    version: 1
    kind: 'video'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId: string
    sourcePosterFileId?: string
    scope: 'workspace' | 'user' | 'organization' | 'public'
    scopeOwnerId: string
    scopeAndOwner: string
    status: 'active' | 'deleted'
    asset: {
        bucketName: string
        objectKey: string
        mimeType: string
        byteSize: number
        originalName: string
    }
    poster?: {
        bucketName: string
        objectKey: string
        mimeType: string
        byteSize: number
        originalName: string
    }
    video: {
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        width?: number
        height?: number
    }
    createdAt: number
    updatedAt: number
}
```

`sourceFileId` records where a save came from; it is used to avoid repeated workspace saves, not to render or restore the item. `asset.bucketName` and `asset.objectKey` point to the independent library object. Video items may also carry a separate `poster` asset. The browser panel's list path uses `MediaLibraryMeta`, which contains preview URLs and display metadata without those storage pointers. The authorized `workspace.mediaLibrary.get` subject returns the full item, including its asset reference.

### DynamoDB Tables

| Table | Key | Secondary lookup | Purpose |
|-------|-----|------------------|---------|
| `Media-Library-Items` | `itemId`, `version` | GSI `scopeAndOwner`, `updatedAt` | Full saved-media record including server-owned asset reference |
| `Media-Library-Items-Meta` | `itemId` | GSI `scopeAndOwner`, `updatedAt` | Browse response metadata and preview URL |
| `Media-Library-Items-Access-List` | `principalId`, `itemId` | LSI `updatedAt` | Owner access entry created with an item |

## Service Surface

### NATS Subjects

The image and video categories talk to `WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS`:

| Subject | What it does |
|---------|--------------|
| `workspace.mediaLibrary.image.createFromCanvas` | Verifies workspace access, reuses an existing active save by the same user for the same source file in that workspace scope, or copies the stored image into a new saved item |
| `workspace.mediaLibrary.video.createFromCanvas` | Verifies workspace access, reuses an existing active save by the same user for the same source file in that workspace scope, or copies the stored MP4 and poster into a new saved item |
| `workspace.mediaLibrary.get` | Returns an authorized full image or video item |
| `workspace.mediaLibrary.listAvailable` | Lists authorized image and video metadata for requested scopes and optional filename query |
| `workspace.mediaLibrary.image.materializeToWorkspace` | Copies a saved image to the active workspace using normal workspace image storage |
| `workspace.mediaLibrary.video.materializeToWorkspace` | Copies a saved video and poster to the active workspace using normal workspace video storage |
| `workspace.mediaLibrary.changeScope` | Copies an owned item to its new scope bucket and updates its metadata |
| `workspace.mediaLibrary.delete` | Removes an owned saved item and its library object |

The subjects publish `created`, `updated`, and `deleted` Media Library events. Open `Images` and `Videos` categories listen for those events and reload their results.

The `Features` category continues to use `WORKSPACE_SUBJECTS.FEATURE_SUBJECTS`, including existing list, detail, deletion, report, and feature events.

### HTTP Routes

| Route | Purpose |
|-------|---------|
| `POST /api/images/:workspaceId/import-url` | Fetch a public remote image safely and store it as a workspace image before node insertion |
| `GET /api/media-library/items/:itemId/content` | Return authorized saved-image bytes or Range-capable saved-video MP4 bytes for panel previews and materialized playback |
| `GET /api/media-library/items/:itemId/poster` | Return authorized saved-video poster bytes |
| `GET /api/features/:featureId/samples/:sampleIndex` | Return authorized Feature sample bytes, preferring durable promoted storage with legacy origin-workspace fallback |

## Lifecycle and Failure Handling

Saving writes the library object before publishing item metadata. If the metadata records cannot be created, the handler attempts to delete the copied object instead of leaving a usable item pointing nowhere.

Changing scope follows the same copy-first rule. It writes the destination object, updates the item and metadata records, and then removes the old object. If metadata update fails, the copied destination object is retained for reconciliation rather than deleting a possible recovery copy. If removing the old object fails after a successful move, the item still points at the new canonical copy.

Deleting a library image removes its records and then attempts to remove its current library object. Deleting a library video also removes its copied poster when present. Deleting a library item does not remove canvas copies previously materialized from that item.

The workspace deletion handler attempts to delete saved media still scoped to that workspace and remove its workspace-scoped Media Library bucket before deleting the workspace. Cleanup failures are logged and do not stop workspace deletion, so failed cleanup may leave orphaned media records or bytes. Media already moved to `Mine`, `Organization`, or `Public` is not included in this workspace-scoped cleanup.

Feature sharing has a separate durability rule. Samples begin in their origin workspace bucket while the Feature is workspace-scoped. Before an owned Feature is promoted to `Mine`, `Organization`, or `Public`, its samples are copied into `user-{ownerUserId}-features`; only then is its scope metadata updated. Reads prefer that durable bucket and fall back to the origin workspace for legacy promoted records. Workspace deletion first migrates any such legacy promoted Feature samples and aborts deletion if preservation fails.

## Implementation Map

| Area | File | Responsibility |
|------|------|----------------|
| Panel UI | [`services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts) | Segmented category control, compact scope selector, Feature browser/inspector, image rows, video rows, preview URLs and actions |
| Panel layout | [`services/web-ui/src/infographics/workspace/media-library-panel.scss`](../../services/web-ui/src/infographics/workspace/media-library-panel.scss) | Full-height drawer, glass chrome, AI-chat offset, inspector and focused narrow view |
| Canvas integration | [`services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) | Toggle panel, save selected images/videos, show feedback, materialize and insert media nodes |
| Canvas utilities and URL import | [`services/web-ui/src/components/WorkspaceCanvas.svelte`](../../services/web-ui/src/components/WorkspaceCanvas.svelte) | Independent bottom-right Media Library launcher, standalone zoom indicator and stored URL-image ingestion |
| Browser service | [`services/web-ui/src/services/media-library-service.ts`](../../services/web-ui/src/services/media-library-service.ts) | NATS requests for image/video list/save/materialize/scope/delete actions |
| Shared contracts | [`packages/lixpi/constants/ts/types.ts`](../../packages/lixpi/constants/ts/types.ts) | Scope, category, image/video item and metadata types |
| NATS contract | [`packages/lixpi/constants/nats-subjects.json`](../../packages/lixpi/constants/nats-subjects.json) | Media Library subject names and events |
| Item model | [`services/api/src/models/media-library-item.ts`](../../services/api/src/models/media-library-item.ts) | Records, browse metadata, access decisions and save deduplication |
| Object copy service | [`services/api/src/services/media-library-storage.ts`](../../services/api/src/services/media-library-storage.ts) | Canvas-to-library copy, scope copy, materialization and object cleanup |
| Feature sample storage | [`services/api/src/services/feature-sample-storage.ts`](../../services/api/src/services/feature-sample-storage.ts) | Copy-first promotion and durable/legacy Feature sample reads |
| NATS handlers | [`services/api/src/NATS/subscriptions/media-library-subjects.ts`](../../services/api/src/NATS/subscriptions/media-library-subjects.ts) | Authorized lifecycle operations and events |
| Preview route | [`services/api/src/routes/media-library-routes.ts`](../../services/api/src/routes/media-library-routes.ts) | Authorized image bytes, Range-capable video bytes, and video poster bytes |
| URL ingestion | [`services/api/src/services/remote-image-import.ts`](../../services/api/src/services/remote-image-import.ts) | Public-URL validation, bounded download and stored import |
| Infrastructure | [`infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts`](../../infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts) | Media Library DynamoDB tables |

## Current Boundaries

- The stored media domain currently supports images and videos. Documents do not appear as a disabled category.
- Images and videos enter the library only through explicit saving from a completed stored canvas node.
- Features share the panel but not the saved-media records or Object Store path.
- Public saved media may be read by authenticated users; media reporting or moderation actions have not been added.
- Panel category, filter, and search selection are transient UI state. Saved records and copied media bytes persist.

## Test Coverage

The implementation has focused coverage for the boundaries that make saving safe:

| Test file | Covered behavior |
|-----------|------------------|
| [`services/api/src/models/media-library-item.test.ts`](../../services/api/src/models/media-library-item.test.ts) | Scope keys and item read authorization |
| [`services/api/src/services/media-library-storage.test.ts`](../../services/api/src/services/media-library-storage.test.ts) | Independent save copy, materialization and scope storage ownership |
| [`services/api/src/NATS/subscriptions/media-library-subjects.test.ts`](../../services/api/src/NATS/subscriptions/media-library-subjects.test.ts) | Image/video save deduplication, materialization and scope-change failure behavior |
| [`services/api/src/NATS/subscriptions/feature-subjects.test.ts`](../../services/api/src/NATS/subscriptions/feature-subjects.test.ts) | Feature ownership enforcement, validated scope movement and copy-before-promotion ordering |
| [`services/api/src/services/feature-sample-storage.test.ts`](../../services/api/src/services/feature-sample-storage.test.ts) | Durable Feature sample copies and legacy source-workspace fallback |
| [`services/api/src/routes/media-library-routes.test.ts`](../../services/api/src/routes/media-library-routes.test.ts) | Preview authorization across accessible workspaces and organizations, including video Range responses and poster routes |
| [`services/api/src/services/remote-image-import.test.ts`](../../services/api/src/services/remote-image-import.test.ts) | Network destination rejection for URL imports |
| [`services/web-ui/src/infographics/workspace/mediaLibraryPanel.test.ts`](../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.test.ts) | Compact controls, concise browser cards, full inspector, image/video previews, full-height layout and insertion integration |
| [`services/web-ui/src/infographics/workspace/canvasBubbleMenuItems.test.ts`](../../services/web-ui/src/infographics/workspace/canvasBubbleMenuItems.test.ts) | Media save action and eligibility hiding |
