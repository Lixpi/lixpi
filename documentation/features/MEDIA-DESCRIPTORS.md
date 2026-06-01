# Media Descriptors

Every media object on the canvas — generated or uploaded, image or video — carries a compact, model-friendly **descriptor**: a one-to-two sentence summary plus a few entity and style tags. The descriptor exists so any feature can tell media objects apart and feed a short textual hint into model context **without re-analyzing the pixels** each time. Its first consumer is the [image/video branch resolver](IMAGE-BRANCH-LINEAGE.md) (which grounds an edit against prior media); the canvas info panel renders it for the user, and future features can read the same field.

The descriptor is deliberately short — "descriptive but not massive" — so it can be embedded in a resolver transcript or other prompt without bloat. The summary is capped at `MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH` (280 chars) and stamped with `MEDIA_DESCRIPTOR_VERSION` so stale descriptors can be detected later.

## Shape

`MediaDescriptor` (`packages/lixpi/constants/ts/types.ts`) hangs off both `ImageCanvasNode` and `VideoCanvasNode` as the optional `descriptor` field:

| Field | Type | Purpose |
|-------|------|---------|
| `status` | `'analyzing' \| 'ready' \| 'failed'` | Lifecycle; drives the canvas analyzing indicator |
| `summary` | `string` | 1–2 sentences naming the dominant subjects and overall look |
| `entityTags` | `string[]` | A few concrete subjects/objects |
| `styleTags` | `string[]` | A few medium/palette/mood/lighting descriptors |
| `source` | `'generation' \| 'analysis'` | Whether it was derived from generation metadata or a VLM caption |
| `version` | `string` | `MEDIA_DESCRIPTOR_VERSION` |
| `updatedAt` | `number` | Last write timestamp |

## How it is sourced

There are two paths, and they never duplicate model work:

**Generated media — free.** When an AI-generated image or video finalizes, `buildDescriptorFromGeneratedBy` (`services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts`) composes the descriptor from the branch resolver's existing `visualEntitySummary` / `visualStyleSummary` / `entityTags` / `styleTags` already carried on `generatedBy`. No extra model call — `source: 'generation'`, `status: 'ready'`.

**Uploaded media — one VLM caption.** Media added from the Media Library has no generation metadata, so the node is inserted with a `status: 'analyzing'` descriptor and `analyzeUploadedMedia` requests a caption over NATS (`ai.interaction.media.describe`, reply subject). The API handler (`services/api/src/NATS/subscriptions/media-descriptor-subjects.ts`) resolves the user's currently-selected (vision-capable) `aiModel` and calls `describeMediaStill` (`services/api/src/llm/media-descriptor.ts`), which reuses the structured-VLM client. The result patches the node descriptor to `ready` (or `failed`). For a video upload the caption runs on its **poster still — never the MP4**.

## Canvas indicator

While `status === 'analyzing'`, the media node's info (i) button pulses (`.image-info-button.is-analyzing`, animation `workspace-media-analyzing-pulse`) and its title/aria-label explains what is happening; opening the panel shows an "Analyzing media…" note. When ready, the same panel renders the summary and tags via `buildMediaDescriptorSection`. The button + panel are the shared media chrome used by both image and video nodes.

## Why videos send a still, not the clip

A video candidate contributes its representative frame (`frameFileId`, falling back to the frame-0 poster) as the still the resolver and captioner see. This keeps per-candidate VLM cost identical to an image and means an edit to a previous video continues that video's branch instead of starting a new one. See [VIDEO-GENERATION.md](VIDEO-GENERATION.md) for frame extraction and the VEO anchor.

## References

- [IMAGE-BRANCH-LINEAGE.md](IMAGE-BRANCH-LINEAGE.md) — how descriptors/tags feed branch grounding
- [IMAGE-GENERATION.md](IMAGE-GENERATION.md) — the generation trace the generated-media descriptor derives from
- [VIDEO-GENERATION.md](VIDEO-GENERATION.md) — mid-frame extraction and VEO image-to-video anchoring
- [WORKSPACE-FEATURE.md](WORKSPACE-FEATURE.md) — canvas media nodes and chrome
