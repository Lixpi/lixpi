---
name: character-sheet-layout
description: Provider-neutral panel graph and deterministic composition contract for character sheets.
---

# Character Sheet Layout

Produce a provider-neutral `CharacterSheetRenderPlan`. Image providers render only isolated single-shot character images. Deterministic server-side composition owns the 3840x2560 sheet, white-margin trimming, spacing, and packing.

The default plan contains exactly three shots:

1. A close straight-on head-and-shoulders identity portrait with a relaxed neutral expression, 10-12 percent clean clearance above the complete hair or headwear, the complete face and neck visible, a crop immediately below the collarbones with no armpits or arms, and the head and facial region occupying 55-60 percent of image height.
2. A relaxed straight-on full-body view from headwear through footwear, with an upright head, level shoulders, naturally lowered arms, and feet hip-width apart.
3. An exact side-on walking full-body profile with upright head, level gaze, neutral spine, modest stride, and natural arm counter-swing.

Free-form prompt text may request any total from 3 to 10 shots. Fill additional slots according to the user's stated priorities: belongings or props, back views, face angles, outfit construction, materials, and action poses. Do not add smile, serious, surprise, emotion-sheet, or other expression variants.

Every shot uses the original source evidence directly and can run independently. Do not feed a generated shot into another generation request: generated-anchor chains increase latency and compound identity, pose, and clothing errors.

Render every planned shot once. Publish a partial composite after each terminal shot result, including unavailable cells. Compare the rendered shots after generation and place findings in the character-sheet description and review trace, never inside the image. Do not retry automatically.

Each provider request asks for one character on a pure white background with no text, labels, borders, grids, scenery, logos, watermarks, or additional people. The provider must never see or reproduce the final sheet layout.

Pose-bearing body, action, and object-placement shots receive text-free spatial controls for framing, camera direction, upright head angle, posture, limb placement, gesture, scale, and silhouette. Every control uses the same deliberately gender-neutral, sexless gray mannequin with a featureless head, straight torso, balanced shoulder and hip widths, and no chest, waist, pelvic, muscular, or other sex-specific anatomy. The required neutral front portrait defines only centered straight-on camera direction, upright head position, symmetric head-and-shoulder alignment, upper-body crop, and subject scale. Controls are never identity, anatomy, body-design, clothing, or sex-presentation evidence. Other head and outfit-detail shots are source-only. The prompt and authorized subject references alone define facial anatomy, sex presentation, identity, hair, headwear, and neutral expression.

The compositor removes near-white outer margins from each generated shot, then fits the visible subject into its cell with bounded padding. It never crops hair, headwear, shoulders, hands, props, or footwear. It renders no titles, captions, statuses, notes, guides, palettes, or other typography.
