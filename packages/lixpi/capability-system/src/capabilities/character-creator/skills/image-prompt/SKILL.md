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
4. Describe input roles. During an edit, the matching stored panel is a named edit target, never another original source: preserve only request-approved or unchanged traits from it, replace every conflicting visible trait, and forbid returning it unchanged when the requested edit affects that shot. Original sources remain independent evidence and carry the traits assigned to them by the authoritative request. Each generated anchor carries only the identity, design, construction, proportion, or viewpoint evidence assigned to it by the render plan. Generated anchors apply only where they comply with the authoritative request. Original sources remain baseline evidence for unchanged details absent from the supplied anchors; shared Capability references follow their sibling Capability instructions; named controls define spatial pose and framing only. The required neutral front portrait uses a text-free, featureless spatial control for camera, alignment, crop, and scale; other head shots use no portrait control.
5. State the visible frame bounds and occupancy: identity portraits leave 10-12 percent clean clearance above the complete hair or headwear, preserve the complete face and neck, crop immediately below the collarbones with no armpits or arms, and make the head and facial region occupy 55-60 percent of image height. Other upper-body shots may extend through mid-torso. Full-body shots occupy 82-90 percent of image height with even top and bottom margins.
6. State only directly observed identity, clothing, material, and medium evidence not overridden by the request or shared Capability state.
7. State an eye-level studio camera with a normal focal-length perspective, pure white background, and minimal perspective distortion.
8. End with a short invariant list covering unchanged traits, the declared frame and background, and exclusion of all unrequested visible content or design drift. Never say that only camera, crop, or pose may change.

Do not overload the prompt with duplicated prose, generic quality slogans, unenforceable specifications, or any content absent from the authoritative request and assigned panel contract. Do not ask an image provider to render multiple shots or any server-owned composition element.

Assessment compares each terminal shot with the authoritative request, shared Capability state, source evidence, and exact grayscale spatial control when one exists. Reject the terminal shot from anchor release when it contains a montage, lineup, inset, split view, extra pose, wrong view, wrong crop, or material deviation from the spatial template, but retain its pixels as a review-only panel in the partial sheet. `request-compliance` fails when a result preserves source identity but omits a requested transformation. `depiction-medium` fails when a result changes the source medium without an explicit request or sibling Capability instruction. Record non-structural failed dimensions and concrete mismatch codes outside the image and preserve those structurally valid shots for review. Never start a correction or regeneration automatically; another attempt requires an explicit user action and becomes a new lineage variant.
