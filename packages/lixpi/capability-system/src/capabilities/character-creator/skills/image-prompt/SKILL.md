---
name: character-image-prompt
description: Provider-neutral prompt construction instructions for deterministic character sheets.
---

# Character Sheet Prompt Construction

Build one provider-neutral image prompt from the validated text request, optional reference summary, layout contract, and fidelity contract.

Order the prompt as:

1. State that the output is one professional character design sheet containing one repeated identity.
2. Describe the character from stable identity traits to clothing construction, accessories, materials, and colors.
3. State that the attached character-sheet template is the authoritative layout specification and enumerate every required turnaround, head, feature, notes, palette, material, detail, and pose section from the layout contract.
4. State reference-fidelity requirements when reference Assets exist. Treat facial construction and rendering class as locked evidence rather than optional style adjectives. A photographic source requires photorealistic character depictions with recognizable facial likeness, natural anatomy, real skin and hair detail, and photographic lighting. An illustrated source requires its specific medium signature, line quality, edge behavior, mark morphology, palette, shading, substrate grain, and surface texture.
5. State neutral lighting, background, view scale, and complete-body framing.
6. End with explicit prohibitions against identity drift, outfit drift, missing views, cropped feet, extra characters, scenery, logos, and watermarks.

Do not invent story beats, weapons, brands, or alternate costumes. Props may appear only in the template's dedicated props panel when supported by the character request or source references. Do not ask the image provider for separate outputs. The final prompt must state that every required template section belongs in one landscape image and that a simplified seven-column turnaround is invalid.

When a source image exists, the router performs a second bounded edit after layout synthesis. In that edit, the generated sheet is the locked composition target and the original source Assets are authoritative for character identity, construction, and rendering style. Completely replace and re-render every character depiction wherever necessary to restore the source identity and rendering class; preserve all non-character sheet pixels, including the canvas, panels, labels, guides, notes, swatches, spacing, framing, poses, and view placement.
