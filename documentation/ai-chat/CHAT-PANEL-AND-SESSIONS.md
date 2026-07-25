---
title: Chat Panel and Sessions
description: Conversation Assets, the workspace chat panel, tabs, sessions, leases, streaming, resume, and deletion.
---

# Chat Panel and Sessions

Every standalone conversation is an Asset with a `conversation` document role. There is no separate chat-thread persistence table. The workspace right-side panel presents conversation Assets, the Media library, and the Tools and Skills catalog; its tabs and layout remain workspace-local state.

## Conversation Asset

A conversation Asset contains:

- global `Asset.title`;
- workspace/user/organization scope and ACL;
- `documents.conversation`, pointing to the latest immutable ProseMirror snapshot Blob;
- conversation lifecycle state (`idle`, `receiving`, `paused`, `completed`, `failed`);
- one workspace surface reference such as `conversation#<assetId>`;
- an edit lease while a composer/editor or AI writer is active.

The ProseMirror document is title-free. Its root contains one or more `aiChatThread` content nodes for existing renderer/schema behavior, but the durable identity is the Asset ID. The root node’s `threadId` equals that Asset ID.

## Creating a conversation

The browser pre-generates an Asset UUID, builds the initial conversation document with that ID, and calls `asset.create`. The API validates the document with the `assetConversation` schema, stores the initial JSON snapshot as a Blob, and transactionally creates:

- `Assets`;
- workspace and catalog `Asset-References`;
- base `Assets-Meta`;
- the owner ACL;
- the snapshot `Blob-Reference`.

The panel then opens `thread:<assetId>` as a workspace-local tab. The tab does not own the conversation and closing it does not delete the Asset.

## Panel state

`canvasState.aiChatPanel` persists:

```ts
type CanvasAiChatPanelState = {
  isOpen: boolean
  isSessionHistoryOpen: boolean
  topLevelMode: 'capabilities' | 'media' | 'aiThreads'
  tabs: Array<{
    tabId: string
    type: 'thread'
    refId: string
    title: string
  }>
  activeTabId?: string
  contextChips: string[]
  width?: number
}
```

For `type: 'thread'`, `refId` is a conversation Asset ID. `lastActiveConversationAssetId` is the only top-level active-conversation pointer. Pre-cutover duplicated tab fields are not written or read.

Panel state is saved through normal Workspace metadata persistence. Adding or removing a tab does not change Asset membership because the conversation’s durable surface reference is created/deleted explicitly.

## Sessions

The Sessions surface loads workspace-scoped conversation Assets from `Assets-Meta`, point-loads authorized Assets, and resumes their conversation documents. Each row shows the global Asset title, last update time, status, and transcript-derived information.

Capability runs use `Capability-Runs` index rows plus durable JetStream events. They are not conversation sessions. A chat-originated Tool run mirrors safe events into the conversation transcript, while a side-panel run rebuilds the same progress card from replay and the tokenized live relay. Style Extraction uses this generic path and saves a `visual-style` Tool.

Closing a conversation tab keeps it reopenable. Deleting a conversation session performs two explicit operations:

1. detach workspace surface `conversation#<assetId>`;
2. detach its catalog reference.

If those were the last references, the Asset becomes deleting and maintenance removes its snapshots and rows.

## Live document authority

Conversation steps use:

```text
asset.document.steps.<organizationId>.<conversationAssetId>.conversation
```

The organization stream is `ASSET_STEPS_<organizationId>`. The current immutable snapshot remains the recovery baseline; the stream holds unsettled steps and control events.

The browser’s `ProseMirrorAuthorityService`:

1. acquires the Asset lease for the current workspace;
2. subscribes to the role subject;
3. resumes from local document version and stream sequence;
4. batches local steps with stable message IDs;
5. rebases pending local steps across remote steps;
6. renews the lease every 10 seconds;
7. releases it on disconnect.

A mount without the lease is read-only and receives holder/expiry information. There is no force takeover; another workspace waits for the 30-second expiry.

## AI streaming

The API acquires the same conversation Asset lease before starting an AI response and renews it while the run is active. `AiChatProseMirrorStreamAssembler` converts model tokens, reasoning sections, traces, generated-media nodes, and control states into Asset document steps.

Before submission, the editor flushes its pending local steps. The API then rebuilds the LLM transcript from the authoritative conversation snapshot plus durable later steps; browser-serialized prior messages are not accepted as transcript authority. Asset-backed workspace/context selections remain separate inputs and are authorized before their Blob renditions are resolved.

The response event subject remains the interaction transport:

```text
ai.interaction.chat.receiveMessage.<organizationId>.<conversationAssetId>              # internal canonical
ai.interaction.chat.receiveMessage.<userIdToken>.<organizationId>.<conversationAssetId> # authorized browser relay
```

Pipeline replay is separate from document authority. The durable pipeline log supports reconnect while the response is active. Generated-output provenance is built from the persisted conversation snapshot, so the pipeline subject is purged after response settlement. The conversation streams once; output Assets do not receive duplicate live transcript steps.

On normal settlement, the API replays accepted role steps over the latest snapshot, validates the final document, writes a new JSON Blob, swaps the document pointer/reference under Asset revision and lease conditions, and purges settled step messages.

## Generated output relationship

Each planned media run creates its own pending output Asset. The output’s lineage stores:

- `sourceConversationAssetId`;
- optional `parentAssetId`;
- `sourceAssetIds`;
- generation, reasoning, and media run IDs;
- reasoning/media model IDs;
- prompt fingerprint.

On terminal state, the provenance materializer reads the persisted conversation snapshot and writes one sealed provenance document per output. Shared reasoning events are included for siblings, while media-run events are filtered to the output’s own `mediaRunId`. Once the final response snapshot and terminal canvas writes are persisted, the API purges the response's pipeline-event and conversation-step JetStream subjects.

Opening a generated Asset can therefore show its source conversation relationship and immutable provenance without copying the live conversation document.

## Cancellation and reconnect

Stopping generation:

- aborts the active matrix group;
- writes cancelled state into the persisted conversation document using the system snapshot path;
- settles unfinished output Assets as cancelled with sealed terminal provenance;
- removes planned transient canvas media nodes while preserving completed siblings;
- drains queued projection and document writes before releasing the lease.

On reconnect during an active response, the browser resumes the conversation snapshot and step stream, then replays pipeline events from its last sequence. A finished response loads entirely from the persisted conversation, output Assets, sealed provenance, and canvas state because its response-specific JetStream subjects have been purged. Duplicate active messages are suppressed by JetStream message IDs and expected subject sequences.

## Global title and local UI

Conversation title edits update `Asset.title` under `revision`. They do not edit the ProseMirror snapshot. Every Session row, tab, canvas projection, and Asset panel resolves the same title.

Tab order, active tab, panel width, open state, and context chips are local to a Workspace. The same conversation Asset may be opened in another workspace under a different tab arrangement, subject to scope and ACL access.

## Relevant code

- [`services/api/src/services/asset-document-service.ts`](../../services/api/src/services/asset-document-service.ts)
- [`services/api/src/prosemirror/asset-prosemirror-step-transport.ts`](../../services/api/src/prosemirror/asset-prosemirror-step-transport.ts)
- [`services/api/src/prosemirror/ai-chat-stream-assembler.ts`](../../services/api/src/prosemirror/ai-chat-stream-assembler.ts)
- [`services/web-ui/src/services/prosemirror-authority-service.ts`](../../services/web-ui/src/services/prosemirror-authority-service.ts)
- [`services/web-ui/src/services/asset-service.ts`](../../services/web-ui/src/services/asset-service.ts)
- [`services/web-ui/src/infographics/workspace/aiChatPanelState.ts`](../../services/web-ui/src/infographics/workspace/aiChatPanelState.ts)
