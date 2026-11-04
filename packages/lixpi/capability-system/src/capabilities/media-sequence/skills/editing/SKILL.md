---
name: media-sequence-editing
description: Edit media sequences through authorized source bindings, rational timing, conflict-aware patches, and revision-bound exports.
---

# Sequence editing

Inspect the sequence before editing. Use its exact revision as `baseRevision` and a fresh `clientMutationId` for each intended edit. Retry a lost acknowledgement with the same ID and identical request. A conflict returns the latest sequence and changed object IDs; reconcile the user's intent before submitting a new patch.

Select only authorized source Assets. Use `resolve_sequence_source` with the Asset and local source ID before an `add-source` patch. Omit `renditionId` to select `original`; specify another rendition only when its existing name is known. `source` is not a rendition name. A source fixes the selected rendition, Blob hash, byte size, dimensions or channels, duration, and time base. Never invent source metadata, URLs, filesystem paths, or missing generated outputs. Pipeline outputs can be inserted after the operation has completed and its immutable source metadata has been resolved.

All time values are integer ticks. Sequence placement and keyframes use the sequence time base. Source in/out use the source time base. Playback rate is a positive rational. The source range divided by rate determines clip duration. Images are held clips with source in/out zero. Text clips use supplied text and never imply automatic speech transcription.

New sequences use 240000 ticks per second, 30 frames per second, and a 1920 by 1080 output frame. Five seconds is 1200000 sequence ticks. An image source may report a 1/1000000 time base; that does not make the sequence use microseconds. For a requested 320 by 180 output, include `{"op":"set-properties","values":{"width":320,"height":180}}`. Source dimensions do not set output dimensions. For an existing sequence, inspect its own time base and output properties. Verify the resulting clip duration in seconds and the sequence output dimensions against the user request before claiming completion.

Available patch operations cover track changes; clip insertion, movement, split, trim and ripple; rate, transform and audio edits; keyframes; transitions; sequence and export properties. A locked track rejects edits. Do not unlock a track without an explicit user instruction. Cross-dissolves require two overlapping clips on the same track; the transition duration equals the overlap, and `clipId` identifies the outgoing clip.

Inspect and plan freely within the current conversation's granted context. Creating, patching and exporting require the corresponding user intent and target authority. Export freezes a revision and its input hashes, returns a durable operation handle, and never returns a speculative media URL. An edit made during export belongs to a later revision.
