---
title: Feature Extraction — Future Work
description: Deliberately deferred enhancements to the feature-extraction and library system, with the rationale for each deferral.
---

# Feature Extraction — Future Work

The items below are **deliberate non-features** as of today. They are not blockers; the live system described in the [Feature Extraction Overview](../library/FEATURE-EXTRACTION-OVERVIEW.md) and its sibling pages is fully functional without them. This page is the parking lot — moved out of the reference docs so those stay focused on current behavior.

For real failure modes the live system can hit (and their mitigations), see "Known limitations and trade-offs" in [Feature Storage](../library/FEATURE-STORAGE.md) — those are current risks, not deferred features, and belong with the implementation.

## Deferred enhancements

- **Feature versioning / revision history.** The `version` field exists on the schema for forward compatibility; multi-revision history with rollback is deferred.
- **Drag-to-reorder tabs** and **pinned tabs** in the AI chat panel. The tab strip uses chronological order only.
- **Drag-to-canvas placement** of features as canvas nodes. Features are non-spatial today. A future `feature` `CanvasNodeType` could wrap an embedded library entry, with edges to threads auto-applying the feature on every send — leveraging Lixpi's spatial-is-the-workflow paradigm.
- **Inline editing of feature instructions** in the library card. Reads, deletes, change-scope, and report exist today; edits go through "Open in extraction tab → Re-extract."
- **i18n of category names.** Categories are free-form and agent-determined; localized UI labels are post-launch work.
- **Batch extraction** ("extract 5 different features from this collection of references"). Single-extraction only today.
- **Feature composition** (a feature that references other features as building blocks). One level of indirection only.
- **Admin moderation UI** for public features. CLI / direct-DB-driven today.
- **Feature analytics** (most-used, most-shared, trending public features). Deferred until we have data.
- **Per-feature usage limits** (rate-limit aggressive `/use` patterns). Addressed if abuse appears.

## Related

- [Feature Extraction Overview](../library/FEATURE-EXTRACTION-OVERVIEW.md) — what a feature is and the design principles.
- [Feature Storage](../library/FEATURE-STORAGE.md) — current known limitations and trade-offs (live risks, not deferred work).
- [Historical build phases](../knowledge/archive/feature-extraction-build-phases.md) — the archived implementation record.
