---
name: character-image-prompt
description: Provider-neutral prompt construction for isolated Character Creator panels.
---

# Character Sheet Prompt Construction

Build one compact provider-neutral prompt per shot from the complete authoritative request, every sibling Capability contribution in the shared media state, structured source evidence, and the target shot specification. Never reduce the request to layout, pose, or identity-preservation instructions.

Order the prompt as:

1. State the single target angle, neutral portrait, prop, outfit detail, or action and its crop.
2. State the provider-safe raw user request and sibling Capability instructions as authoritative. Reasoning-model prompt expansions are not user authority. Explicit transformations and design changes override the unmodified state depicted by source images or an earlier generated anchor.
3. State the source depiction medium as the baseline. Preserve it unless the raw request or a sibling Capability explicitly requests a different medium or visual style. A requested subject, state, design, material, or appearance change does not imply a depiction-medium or visual-style change.
4. Describe input roles. For the neutral front portrait, original sources define baseline identity and unchanged design evidence. The front full-body shot receives `GENERATED_IDENTITY_ANCHOR.png` for facial identity, hair, headwear, and close-detail continuity. The back full-body shot receives that portrait plus `GENERATED_OUTFIT_ANCHOR.png` for full-body proportions and frontal outfit construction. Every optional shot receives those two references plus `GENERATED_BACK_OUTFIT_ANCHOR.png` for rear garment construction, rear layers, back-facing accessories, rear materials, and back-of-footwear continuity. Generated anchors apply only where they comply with the authoritative request. Original sources remain baseline evidence for unchanged details absent from the supplied anchors; shared Capability references follow their sibling Capability instructions; named controls define spatial pose and framing only. The required neutral front portrait uses a text-free, featureless gray mannequin control for camera, upright head position, alignment, crop, and scale; other head shots use no portrait control.
5. State the visible frame bounds and occupancy: identity portraits leave 10-12 percent clean clearance above the complete hair or headwear, preserve the complete face and neck, crop immediately below the collarbones with no armpits or arms, and make the head and facial region occupy 55-60 percent of image height. Other upper-body shots may extend through mid-torso. Full-body shots occupy 82-90 percent of image height with even top and bottom margins.
6. State only directly observed identity, clothing, material, and medium evidence not overridden by the request or shared Capability state.
7. State an eye-level studio camera with a normal focal-length perspective, pure white background, and minimal perspective distortion.
8. End with a short preserve list for unchanged traits and prohibitions against text, extra people, scenery, logos, watermarks, cropping, and design drift. Never say that only camera, crop, or pose may change.

Do not overload the prompt with duplicated prose, generic quality slogans, camera specifications the model cannot enforce, story beats, weapons, brands, or alternate costumes. Props appear only in the prop shot or when required by an action. Do not ask an image provider to render multiple shots, sheet text, guides, notes, swatches, or final layout.

Assessment compares each rendered shot with the authoritative request, shared Capability state, and source evidence. `request-compliance` fails when a result preserves source identity but omits a requested transformation. `depiction-medium` fails when a result changes the source medium without an explicit request or sibling Capability instruction. Record failed dimensions and concrete mismatch codes outside the image. Preserve every rendered shot and surface those issues to the user. Never start a correction or regeneration automatically; another attempt requires an explicit user action and becomes a new lineage variant.
