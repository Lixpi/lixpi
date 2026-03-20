# Workspace Export & Import

Export a complete workspace backup as a downloadable ZIP archive, or import a previously exported archive to replace all content in an existing workspace.

## Overview

The export is triggered from the workspace dropdown menu in the sidebar. It streams a ZIP archive directly from the API to the browser — no temporary files are written to disk.

**Endpoint**: `GET /api/workspaces/:workspaceId/export`
**Route file**: `services/api/src/routes/workspace-export-routes.ts`
**UI trigger**: "Export" item in `Sidebar.svelte` dropdown menu

## Export Contents

The ZIP archive has the following structure:

```
workspace-export.zip
├── manifest.json          # Workspace metadata + all text content
└── images/                # Binary image files from NATS Object Store
    ├── {fileId}.png
    ├── {fileId}.jpg
    └── ...
```

**manifest.json** contains:

```typescript
{
    exportVersion: 1,
    exportedAt: string,                // ISO 8601 timestamp
    workspace: {
        workspaceId: string,
        name: string,
        canvasState: CanvasState,       // Viewport, nodes, edges
        files: DocumentFile[],          // File metadata (id, name, mimeType)
        createdAt: number,
        updatedAt: number,
    },
    documents: Document[],             // All documents (latest revisions)
    aiChatThreads: AiChatThread[],     // All AI chat threads with messages
}
```

## Export Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Sidebar as Sidebar.svelte
    participant Browser
    participant API as /api/workspaces/:id/export
    participant DB as DynamoDB
    participant ObjStore as NATS Object Store
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: TRIGGER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, ObjStore: PHASE 1 - TRIGGER — User initiates export
        User->>Sidebar: Click "Export" in dropdown
        activate Sidebar
        Sidebar->>Sidebar: getTokenSilently()
        Sidebar->>Browser: window.open(exportUrl?token=jwt)
        deactivate Sidebar
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: AUTH + FETCH
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, ObjStore: PHASE 2 - AUTH + FETCH — Validate and gather data
        Browser->>API: GET /api/workspaces/:id/export?token=jwt
        activate API
        API->>API: authenticateRequest (verify JWT)
        API->>API: validateWorkspaceAccess (check accessList)
        API->>DB: getWorkspaceDocuments()
        API->>DB: getWorkspaceAiChatThreads()
        Note right of API: Parallel fetch
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: STREAM ZIP
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, ObjStore: PHASE 3 - STREAM ZIP — Build and stream archive
        API->>API: Create archiver('zip')
        API->>API: Append manifest.json
        loop For each file in workspace.files
            API->>ObjStore: getObject(bucketName, fileId)
            ObjStore-->>API: binary data
            API->>API: Append to images/ folder
        end
        API->>API: archive.finalize()
        API-->>Browser: Stream ZIP response
        deactivate API
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 4: DOWNLOAD
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, ObjStore: PHASE 4 - DOWNLOAD — Browser saves file
        Browser-->>User: Save dialog (workspace-name-export.zip)
    end
```

## Implementation Details

- **Streaming**: The ZIP is streamed directly to the HTTP response using the `archiver` npm package — no temporary files are written to disk.
- **Auth**: Supports JWT via query parameter (`?token=`) since the download is triggered via `window.open()`, which cannot set Authorization headers. Also supports `Authorization: Bearer` header.
- **File naming**: Images are stored as `images/{fileId}{extension}` where the extension is derived from the file's MIME type or original filename.
- **Error handling**: Individual image fetch failures are logged but don't abort the export — the manifest and remaining images are still included.
- **Compression**: Uses zlib level 5 (balanced speed/size).

## Dependencies

| Package | Purpose |
|---------|---------|
| `archiver` | ZIP archive creation and streaming |
| `@types/archiver` | TypeScript types (dev) |

---

# Workspace Import

Import a previously exported ZIP archive into an existing workspace, replacing all current content. The import wipes documents, AI chat threads, and images, then restores everything from the archive — keeping workspace identity (ID, name, access list) intact.

## Overview

The import is triggered from the workspace dropdown menu in the sidebar. It opens a file picker for the user to select a `.zip` archive. The file is uploaded to the API, which validates the archive, wipes the workspace content, and restores from the manifest.

**Endpoint**: `POST /api/workspaces/:workspaceId/import`
**Route file**: `services/api/src/routes/workspace-export-routes.ts`
**UI trigger**: "Import" item in `Sidebar.svelte` dropdown menu

## Import Strategy

The import follows a **validate-first, wipe, replace** approach:

1. **Parse** — Extract the ZIP and read `manifest.json` entirely in memory
2. **Validate** — Check export version, required fields, document/thread arrays. If invalid, return 400 — no data is touched
3. **Wipe** — Delete all existing content in parallel: NATS Object Store bucket (all images), DynamoDB documents, DynamoDB AI chat threads
4. **Restore** — Recreate images, documents, AI chat threads, and update workspace canvas state + files array from the manifest

This ensures no garbage is left behind. The NATS bucket is deleted entirely (not individual objects), which guarantees a clean slate for images. Documents and threads are queried by `workspaceId` and each record is deleted individually.

## Import Behavior

- **Workspace identity preserved**: The workspace's ID, name, `accessType`, and `accessList` remain unchanged. Only content (canvas state, documents, threads, images) is replaced.
- **Document IDs preserved**: Original document IDs from the export are reused so canvas node references (which store document IDs) remain valid without remapping.
- **`workspaceId` overridden**: Documents and threads from the manifest receive the target workspace's ID — an export from one workspace can be imported into a different workspace.
- **Cross-workspace import**: Since `workspaceId` is overridden, a user can export from workspace A and import into workspace B.

## Import Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Sidebar as Sidebar.svelte
    participant Browser
    participant API as /api/workspaces/:id/import
    participant DB as DynamoDB
    participant ObjStore as NATS Object Store
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: TRIGGER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, ObjStore: PHASE 1 - TRIGGER — User selects file
        User->>Sidebar: Click "Import" in dropdown
        activate Sidebar
        Sidebar->>Browser: Open file picker (.zip)
        User->>Browser: Select ZIP archive
        Browser->>Sidebar: File selected
        Sidebar->>API: POST multipart/form-data (ZIP file)
        deactivate Sidebar
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: VALIDATE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, ObjStore: PHASE 2 - VALIDATE — Parse and verify archive
        activate API
        API->>API: authenticateRequest (verify JWT)
        API->>API: validateWorkspaceAccess (check accessList)
        API->>API: Extract ZIP with AdmZip
        API->>API: Parse + validate manifest.json
        Note right of API: If invalid → 400 error, no data touched
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: WIPE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, ObjStore: PHASE 3 - WIPE — Delete all existing content
        API->>ObjStore: deleteObjectStore(bucketName)
        API->>DB: deleteWorkspaceDocuments(workspaceId)
        API->>DB: deleteWorkspaceAiChatThreads(workspaceId)
        Note right of API: Parallel deletion
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 4: RESTORE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, ObjStore: PHASE 4 - RESTORE — Recreate content from archive
        API->>ObjStore: ensureObjectStore(bucketName)
        loop For each image in ZIP
            API->>ObjStore: putObject(bucketName, fileId, data)
        end
        loop For each document in manifest
            API->>DB: importDocument(doc)
        end
        loop For each AI chat thread in manifest
            API->>DB: createAiChatThread(thread)
        end
        API->>DB: replaceWorkspaceContent(canvasState, files)
        API-->>Browser: JSON response (success + counts)
        deactivate API
    end
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 5: RELOAD
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(200, 220, 228)
        Note over User, ObjStore: PHASE 5 - RELOAD — Refresh UI with imported content
        Browser->>Browser: Reload workspace, documents, threads
        Browser-->>User: Workspace displays imported content
    end
```

## Implementation Details

- **In-memory extraction**: The ZIP is buffered by `multer` and extracted with `adm-zip` — no temporary files on disk.
- **Auth**: Uses `Authorization: Bearer` header (standard `fetch` POST, not `window.open`).
- **Validation-first**: The archive is fully parsed and validated before any existing data is deleted. Invalid archives produce a 400 error with zero data loss.
- **Bucket wipe**: The NATS Object Store bucket is deleted entirely via `deleteObjectStore()`, then recreated via `ensureObjectStore()`. This is faster than deleting individual objects and guarantees no orphans.
- **File size**: Accepts uploads up to 1GB via multer memory storage.
- **Post-import reload**: The frontend automatically reloads workspace data, documents, and AI chat threads if the imported workspace is currently open.

## Dependencies

| Package | Purpose |
|---------|---------|
| `adm-zip` | ZIP archive extraction in memory |
| `@types/adm-zip` | TypeScript types (dev) |
| `multer` | Multipart file upload handling (already used by image routes) |
