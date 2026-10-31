---
title: Workspace Conversations and Generated Output Details
description: Persistent conversations, private composer state, transcript history and replay, and generated-output details.
---

# Workspace Conversations and Generated Output Details

Every canvas AI run uses a conversation Asset with a `conversation` document role. Every workspace mounts a persistent transcript and conversation picker above the rich composer, and every composer message goes to the agent conversation. The right-side panel presents generated-output details, the Media library, and the Tools and Skills catalog. A conversation does not require a canvas node.

The API owns conversation execution and transcript projection. Agent-Conversations records hold ordered commands, messages, events, run state, queues and checkpoints; the Asset holds the projected ProseMirror document. A greeting, discussion or plan does not create a generation request. Selected image/video models are preferences for a later authorized action.

## Conversation Asset

A conversation Asset contains:

- global `Asset.title`;
- workspace/user/organization scope and ACL;
- `documents.conversation`, pointing to the latest immutable ProseMirror snapshot Blob;
- conversation lifecycle state (`idle`, `receiving`, `paused`, `completed`, `failed`);
- one workspace surface reference such as `conversation#<assetId>`;
- a server-managed transcript projection for conversations using the agent runtime.

The ProseMirror document is title-free. Its root contains one or more `aiChatThread` content nodes for existing renderer/schema behavior, but the durable identity is the Asset ID. The root node’s `threadId` equals that Asset ID.

## Creating a conversation

`conversation.create` reserves an identity and initial settings using a stable client conversation ID. The first accepted `conversation.submit` activates the Asset and workspace membership. Acceptance atomically records the user message, idempotency receipt and dispatch intent. A rejected first message leaves only an expiring reservation. The browser sends the rich user fragment, explicit reference identities and settings revision, rather than an authoritative transcript.

The composer keeps its draft until the server acknowledges acceptance. A lost reply is recovered by client message ID. Retrying the same content reuses that identity, while reusing an identity for changed content is rejected. Text typed while a message is pending remains in the composer.

## Transcript and run controls

The conversation picker lists authorized workspace conversations with background run status and unread state. The transcript uses the sidebar's `ProseMirrorEditor`, `aiChatThread` schema and message NodeViews. It opens the authoritative conversation document and preserves the user's saved scroll position. `conversation.get` and `conversation.messages` provide bounded command-history pages for runtime recovery; they do not supply a parallel browser message renderer. Imported message IDs retain their separate storage order.

Snapshots, conversation-list pages and event replay are bounded by serialized UTF-8 bytes as well as item count. Snapshot construction rereads metadata and retries if its revision changed during the read. Queued entries contain summaries rather than copies of their rich drafts and source data.

The conversation controller subscribes before loading its snapshot, then replays ordered private events through `conversation.events.replay` to recover execution, queue and operation state. Duplicate events are ignored and sequence gaps trigger replay or a fresh snapshot. Message content reaches the editor through `ProseMirrorAuthorityService`, using the same versioned steps, selection mapping and reconnect path as sidebar chat. The transcript follows new output only when the reader is near the bottom; otherwise New messages returns to the latest response.

Accepted creation and editing operations appear as action cards inside the assistant response. Each card shows the request, operation status, committed outputs and actionable errors. Pipeline trace expands operation identity, timing, state and output slots. Snapshots and older-message pages include bounded operation summaries, so cards survive reload and pagination. Output buttons recheck Asset access and open the corresponding preview or module editor; media previews also select an existing canvas node when present.

Context mode and model preferences belong to the conversation and are captured for each accepted turn. Settings changes appear as small emphasized entries in the same authoritative conversation document. Explicit mode uses attached sources and authorized conversation outputs; discovery and mixed modes also permit bounded workspace discovery. Changing active context mode rebuilds model context at the next safe boundary while preserving completed work and the visible transcript. Mid-run controls offer Steer, Stop first and Queue, with a one-message override. Stop pauses queued work until Resume queue. A run waiting for necessary input shows Waiting for your answer, and the next message carries its interrupt identity.

A necessary-input answer resumes the saved tool result under the original action scope and budget. The server accepts one answer from the active turn's author, and repeated submission of that same message remains idempotent. Completed work is retained across the question and reconnect. A terminal failure stores an assistant explanation and a structured run error; both remain available after reload.

The active conversation, rich draft, context chips, read position and transcript scroll are private browser state keyed by user, workspace and conversation. The shared workspace panel state does not receive those private selections.

## Generation compatibility

For workspaces outside the conversational rollout, the generation composer pre-generates an Asset UUID, builds the initial conversation document with that ID, and calls `asset.create`. The API validates the document with the `assetConversation` schema, stores the initial JSON snapshot as a Blob, and transactionally creates:

- `Assets`;
- workspace and catalog `Asset-References`;
- base `Assets-Meta`;
- the owner ACL;
- the snapshot `Blob-Reference`.

This generation path keeps a detached editor for document authority, streaming steps, reconnect and branch projection. The document-authority and pipeline-event contracts below also support generated-output history.

## Panel state

`canvasState.aiChatPanel` persists:

```ts
type CanvasAiChatPanelState = {
  isOpen: boolean
  topLevelMode: 'capabilities' | 'media' | 'aiThreads'
  generatedOutputDetailsTarget?: {
    kind: 'output' | 'branch-marker'
    nodeId: string
  }
  contextChips: string[]
  width?: number
}
```

The generated-output target is the single persisted disclosure state for media info, active progress, accepted history, Capability Artifact history, and branch-lineage clicks. Hydration keeps it only when `nodeId` still resolves to a node matching `kind`; otherwise it is omitted. Legacy session, tab, and active-tab fields are neither written nor read.

Panel state is saved through normal Workspace metadata persistence. Refreshing the page therefore restores the same generated-output details component and selected item.

## Unified generated-output details

`generated-output-details-sidebar.ts` is the only right-panel entry point for an output or branch marker. It renders current Asset metadata first: the full-size editable title and description, descriptor tags, scope, subject identity, storage/rendition status, lineage, and Capability Artifact fields where applicable. A separator then starts `Generation details`, which contains the original user turn, assistant reasoning, purple reasoning-authored model-prompt blocks, references, resolver audit, and recursive pipeline timeline.

The component body owns the only vertical scrollbar. Nested ProseMirror, prompt, reasoning, and trace content expands inside that flow. During generation, detached conversation authority and durable JetStream pipeline events rebuild all prior steps, then continue applying live events to the selected sidebar instance. Terminal outputs rebuild the same history from sealed provenance.

Conversation selection and transcript controls belong above the composer. The generated-output panel focuses on the selected Asset and its provenance.

Capability runs use `Capability-Runs` index rows plus durable JetStream events. They are not conversation sessions. A chat-originated Tool run mirrors safe events into the conversation document, while generated-output details rebuild the same progress from replay and the tokenized live relay.

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

Opening a generated Asset can therefore show its source conversation relationship and immutable provenance without copying the live conversation document. The persisted output target selects that same unified renderer after a page reload.

## Cancellation and reconnect

Stopping generation:

- aborts the active matrix group;
- writes cancelled state into the persisted conversation document using the system snapshot path;
- settles unfinished output Assets as cancelled with sealed terminal provenance;
- removes planned transient canvas media nodes while preserving completed siblings;
- drains queued projection and document writes before releasing the lease.

On reconnect during an active response, the browser resumes the conversation snapshot and step stream, then replays pipeline events from its last sequence. A finished response loads entirely from the persisted conversation, output Assets, sealed provenance, and canvas state because its response-specific JetStream subjects have been purged. Duplicate active messages are suppressed by JetStream message IDs and expected subject sequences.

## Global title and local UI

Conversation title edits update `Asset.title` under `revision`. They do not edit the ProseMirror snapshot. Canvas projections and Asset panels resolve the same title.

Panel width, open state, top-level mode and the selected generated-output details target persist on the Workspace. In conversational workspaces, context chips and conversation selections use private browser storage. Conversation Asset access remains subject to scope and ACL rules.

## Relevant code

- [`services/api/src/llm/agent/conversation-service.ts`](../../services/api/src/llm/agent/conversation-service.ts)
- [`packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-conversation-controller.ts`](../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-conversation-controller.ts)
- [`packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-conversation-panel.ts`](../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-conversation-panel.ts)
- [`services/api/src/services/asset-document-service.ts`](../../services/api/src/services/asset-document-service.ts)
- [`services/api/src/prosemirror/asset-prosemirror-step-transport.ts`](../../services/api/src/prosemirror/asset-prosemirror-step-transport.ts)
- [`services/api/src/prosemirror/ai-chat-stream-assembler.ts`](../../services/api/src/prosemirror/ai-chat-stream-assembler.ts)
- [`services/web-ui/src/services/prosemirror-authority-service.ts`](../../services/web-ui/src/services/prosemirror-authority-service.ts)
- [`services/web-ui/src/services/asset-service.ts`](../../services/web-ui/src/services/asset-service.ts)
- [`packages/lixpi/canvas-components-lixpi-specific/src/shared/scene/workspace-panel-state.ts`](../../packages/lixpi/canvas-components-lixpi-specific/src/shared/scene/workspace-panel-state.ts)
- [`packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/generated-output-details-sidebar.ts`](../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/generated-output-details-sidebar.ts)
