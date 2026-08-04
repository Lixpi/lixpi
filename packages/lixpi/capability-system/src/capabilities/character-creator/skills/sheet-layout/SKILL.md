---
name: character-sheet-layout
description: Provider-neutral panel graph and deterministic composition contract for character sheets.
---

# Character Sheet Layout

Produce a provider-neutral `CharacterSheetRenderPlan`. Image providers render only isolated character panels. Deterministic server-side composition owns the 3840x2560 layout, labels, guides, notes, swatches, clipping, and derived crops.

The default plan contains exactly three shots:

1. A straight-on facial close-up large enough to inspect identity details.
2. A straight-on full-body view from head to footwear.
3. A full-body three-quarter back view showing silhouette, outfit construction, and footwear.

Free-form prompt text may request any total from 3 to 10 shots. Fill additional slots according to the user's stated priorities: belongings or props, facial expressions, profile and back views, face angles, and action poses. The front body and face shots establish canonical anchors. Additional views depend only on the closest required anchors; do not create a long sequential dependency chain.

Render every planned shot once. Publish a partial composite after each terminal shot result, including unavailable cells. Compare rendered shots after generation, annotate any mismatch, and do not retry automatically.

Each provider request asks for one character on a plain white background with no text, labels, borders, grids, scenery, logos, watermarks, or additional people. The provider must never see or reproduce the final sheet layout.
