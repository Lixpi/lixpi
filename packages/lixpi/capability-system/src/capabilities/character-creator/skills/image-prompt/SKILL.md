---
name: character-image-prompt
description: Provider-neutral prompt construction for isolated Character Creator panels.
---

# Character Sheet Prompt Construction

Build one compact provider-neutral prompt per shot from the validated request, structured source evidence, and target shot specification.

Order the prompt as:

1. State the single target angle, neutral portrait, prop, outfit detail, or action and its crop.
2. Describe input roles: original sources define identity and design; named controls define spatial pose and framing only. The required neutral front portrait uses a text-free, featureless gray mannequin control for camera, upright head position, alignment, crop, and scale; other head shots use no portrait control.
3. State the visible frame bounds and occupancy: identity portraits leave 10-12 percent clean clearance above the complete hair or headwear, preserve the complete face and neck, crop immediately below the collarbones with no armpits or arms, and make the head and facial region occupy 55-60 percent of image height. Other upper-body shots may extend through mid-torso. Full-body shots occupy 82-90 percent of image height with even top and bottom margins.
4. State the directly observed identity, clothing, material, and medium evidence relevant to the shot.
5. State an eye-level studio camera with a normal focal-length perspective, pure white background, and minimal perspective distortion.
6. End with a short preserve list and prohibitions against text, extra people, scenery, logos, watermarks, cropping, and design drift.

Do not overload the prompt with duplicated prose, generic quality slogans, camera specifications the model cannot enforce, story beats, weapons, brands, or alternate costumes. Props appear only in the prop shot or when required by an action. Do not ask an image provider to render multiple shots, sheet text, guides, notes, swatches, or final layout.

Assessment compares each rendered shot with source evidence, then records failed dimensions and concrete mismatch codes outside the image. Preserve every rendered shot and surface those issues to the user. Never start a correction or regeneration automatically; another attempt requires an explicit user action and becomes a new lineage variant.
