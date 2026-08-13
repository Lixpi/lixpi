---
name: character-sheet-layout
description: Provider-neutral panel graph and deterministic composition contract for character sheets.
---

# Character Sheet Layout

Produce a provider-neutral `CharacterSheetRenderPlan`. Image providers render only isolated single-shot character images. Deterministic server-side composition owns the 3840x2560 sheet, white-margin trimming, spacing, and packing.

The default plan contains exactly three shots:

1. A close straight-on head-and-shoulders identity portrait with a relaxed neutral expression, 10-12 percent clean clearance above the complete hair or headwear, the complete face and neck visible, a crop immediately below the collarbones with no armpits or arms, and the head and facial region occupying 55-60 percent of image height.
2. A relaxed straight-on full-body view from headwear through footwear, with an upright head, level shoulders, naturally lowered arms, and feet hip-width apart.
3. A neutral straight-on full-body back view from headwear through footwear that clearly preserves rear garment construction, layers, seams, accessories, materials, and footwear.

Free-form prompt text may request any total from 3 to 10 shots. Fill additional slots only from priorities explicitly stated by the user. Do not add any unrequested variant or content category.

Declare shot dependencies and generated-reference materialization in the plan's `dependsOn` and `outputBindings` fields. The neutral front portrait has no dependency. The front full-body shot depends on the portrait's terminal output through `generated-identity-anchor`. The back full-body shot depends on the terminal portrait and front full-body outputs through `generated-identity-anchor` and `generated-outfit-anchor`. Every optional shot depends on all three required terminal outputs through those bindings plus `generated-back-outfit-anchor`. Do not attach every earlier shot implicitly; only declared bindings become generated inputs.

The front full-body request materializes the portrait as `GENERATED_IDENTITY_ANCHOR.png` with role `canonical-anchor`. The back full-body request materializes the completed front full-body shot as `GENERATED_OUTFIT_ANCHOR.png` with role `canonical-anchor` and the portrait as `GENERATED_IDENTITY_ANCHOR.png` with role `adjacent-angle`. Optional requests also materialize the completed back full-body shot as `GENERATED_BACK_OUTFIT_ANCHOR.png` with role `opposite-angle`. All declared roles are required for their provider calls. Original sources remain baseline evidence for unchanged details absent from the anchors, and pose controls remain spatial-only. Once all three barriers succeed, ready optional shots may run concurrently. A missing terminal anchor or an adapter that omits any required generated-reference role blocks or fails the affected shot instead of falling back to a less consistent request.

Render every planned shot once. Publish a newly composed full-sheet preview for every partial image received from the provider and again for each terminal shot result, including unavailable cells. Provider partials are presentation-only: they never satisfy a required generated-output binding or release a dependent shot. Compare the rendered shots after generation and place findings in the character-sheet description and review trace, never inside the image. Do not retry automatically.

Each provider request asks for exactly one character on the declared plain background, with no additional visible content or server-owned layout. The provider must never see or reproduce the final sheet layout.

Pose-bearing shots receive text-free spatial controls for framing, camera direction, posture, placement, scale, and silhouette. Every control uses the same deliberately identity-neutral, featureless mannequin without identity-bearing anatomy. The required neutral front portrait defines only centered camera direction, alignment, upper-body crop, and subject scale. Controls are never identity, anatomy, design, material, or presentation evidence. Other head and detail shots have no synthetic pose control; dependent shots still receive the configured generated anchors and original evidence. The prompt and authorized subject references define initial identity and design before the generated anchors carry the render-plan-assigned continuity downstream.

The compositor removes near-white outer margins from each generated shot, then fits the complete visible subject into its cell with bounded padding. It renders no typography or non-image annotation.
