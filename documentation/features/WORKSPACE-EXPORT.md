# Workspace Export

Export a complete workspace backup as a downloadable ZIP archive. The export bundles all workspace data — canvas state, documents, AI chat threads, and image binaries — into a single file.

## Overview

The export is triggered from the workspace dropdown menu in the sidebar. It streams a ZIP archive directly from the API to the browser — no temporary files are written to disk.

**Endpoint**: `GET /api/workspaces/:workspaceId/export`
**Route file**: `services/api/src/routes/workspace-export-routes.ts`
**UI trigger**: "Export" item in `Sidebar2.svelte` dropdown menu

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
    participant Sidebar as Sidebar2.svelte
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
