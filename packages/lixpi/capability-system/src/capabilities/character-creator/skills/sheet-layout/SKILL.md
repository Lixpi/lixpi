---
name: character-sheet-layout
description: Provider-neutral panel graph and deterministic composition contract for character sheets.
---

# Character Sheet Layout

Produce a provider-neutral `CharacterSheetRenderPlan`. Image providers render only isolated character panels. Deterministic server-side composition owns the 3840x2560 layout, labels, guides, notes, swatches, clipping, and derived crops.

The plan contains:

1. Five full-body views: front, three-quarter front-left, profile-left, three-quarter back-left, and back.
2. Five matching head views.
3. Four expression panels and four additional mouth panels.
4. Two hand close-ups.
5. One conditional prop panel, omitted when an observed prop crop exists.
6. Six action-pose panels.

The front body and head panels establish canonical anchors. Adjacent views depend on the closest accepted view. Head angles depend on the canonical head and matching body angle. Actions depend on the accepted front body and head.

Each provider request asks for one character on a plain white background with no text, labels, borders, grids, scenery, logos, watermarks, or additional people. The provider must never see or reproduce the final sheet layout.
