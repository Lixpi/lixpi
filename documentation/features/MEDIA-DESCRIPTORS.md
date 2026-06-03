# Media and Content Descriptors

Every context-bearing canvas node carries a compact, model-friendly
**descriptor**: a one-to-two sentence summary plus a few entity and style tags.
Images and videos still expose the historical `MediaDescriptor` name, but the
canonical shared contract is now `ContentDescriptor` because documents and AI
chat thread nodes use the same shape.

Descriptors exist so workspace-wide features can tell nodes apart and feed short
textual hints into model context without re-analyzing every artifact. Their main
consumers are [Workspace Context Relevance and Branch Origins](WORKSPACE-CONTEXT-RELEVANCE-AND-BRANCH-ORIGINS.md)
and [Image Branch Lineage](IMAGE-BRANCH-LINEAGE.md). The canvas info panel also
renders ready descriptors for media nodes.

The descriptor is deliberately short so it can fit into a resolver transcript or
workspace relevance prompt without bloat. The summary is capped at
`MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH` (280 chars) and stamped with
`MEDIA_DESCRIPTOR_VERSION` so stale descriptors can be detected later.

## Shape

`ContentDescriptor` (`packages/lixpi/constants/ts/types.ts`) hangs off
`DocumentCanvasNode`, `AiChatThreadCanvasNode`, `ImageCanvasNode`, and
`VideoCanvasNode` as the optional `descriptor` field. `MediaDescriptor` is an
alias for the same type.

| Field | Type | Purpose |
|-------|------|---------|
| `status` | `'analyzing' \| 'ready' \| 'failed'` | Lifecycle; drives analyzing indicators and self-heal decisions |
| `summary` | `string` | 1-2 sentences naming the dominant subjects and overall look/content |
| `entityTags` | `string[]` | A few concrete subjects, objects, people, or concepts |
| `styleTags` | `string[]` | A few medium, palette, mood, lighting, or document-style descriptors |
| `source` | `'generation' \| 'analysis'` | Whether it came from generation metadata or an analysis pass |
| `version` | `string` | `MEDIA_DESCRIPTOR_VERSION` |
| `updatedAt` | `number` | Last write timestamp |

## How It Is Sourced

There are three paths, and they avoid duplicate model work:

**Generated media - free.** When an AI-generated image or video finalizes,
`buildDescriptorFromGeneratedBy`
([WorkspaceCanvas.ts](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts))
composes the descriptor from the branch resolver's existing
`visualEntitySummary`, `visualStyleSummary`, `entityTags`, and `styleTags`.
No extra model call is made. The descriptor is `source: 'generation'` and
`status: 'ready'`.

**Uploaded media - one VLM caption.** Media added from the Media Library or
uploaded/imported onto the canvas has no generation metadata, so the node is
inserted with a `status: 'analyzing'` descriptor. The browser requests
`MEDIA_DESCRIBE`, and the API handler
([media-descriptor-subjects.ts](../../services/api/src/NATS/subscriptions/media-descriptor-subjects.ts))
calls `describeMediaStill`
([media-descriptor.ts](../../services/api/src/llm/media-descriptor.ts)). For a
video, captioning runs on its representative still or poster, never the MP4.

**Documents and threads - text analysis.** Document nodes and AI chat thread
nodes get descriptors from their text content/transcript. Create and debounced
edit paths request the same descriptor service shape, but the API summarizes
text instead of pixels.

## Self-Heal

`resolveWorkspaceContext` can repair weak descriptors inside the same chat turn.
Nodes with missing, failed, analyzing, or too-thin descriptors can be flagged by
the relevance model. The API improves flagged descriptors once, persists them
through a targeted node-descriptor patch, re-ranks the workspace snapshot, and
streams `improvedDescriptors` in `CONTEXT_RELEVANCE_RESOLVED`.

This is bounded to one improvement round per turn. The browser applies improved
descriptors to local canvas state so analyzing indicators and info panels update
without a reload.

## Canvas Indicator

While media `status === 'analyzing'`, the media node's info button pulses
(`.image-info-button.is-analyzing`, animation
`workspace-media-analyzing-pulse`) and its title/aria-label explains what is
happening. Opening the panel shows an "Analyzing media..." note. When ready, the
same panel renders the summary and tags via `buildMediaDescriptorSection`.

Documents and thread nodes use descriptors for relevance, not media chrome.

## Why Videos Send a Still, Not the Clip

A video candidate contributes its representative frame (`frameFileId`, falling
back to the poster) as the still the resolver and captioner see. This keeps
per-candidate VLM cost identical to an image and means an edit to a previous
video can continue that video's branch without sending the MP4. See
[VIDEO-GENERATION.md](VIDEO-GENERATION.md) for frame extraction and VEO anchoring.

## References

- [WORKSPACE-CONTEXT-RELEVANCE-AND-BRANCH-ORIGINS.md](WORKSPACE-CONTEXT-RELEVANCE-AND-BRANCH-ORIGINS.md) - workspace relevance, self-heal, and auto chips
- [IMAGE-BRANCH-LINEAGE.md](IMAGE-BRANCH-LINEAGE.md) - how descriptors/tags feed branch grounding
- [IMAGE-GENERATION.md](IMAGE-GENERATION.md) - the generation trace generated-media descriptors derive from
- [VIDEO-GENERATION.md](VIDEO-GENERATION.md) - mid-frame extraction and VEO image-to-video anchoring
- [WORKSPACE-FEATURE.md](WORKSPACE-FEATURE.md) - canvas media nodes and chrome
