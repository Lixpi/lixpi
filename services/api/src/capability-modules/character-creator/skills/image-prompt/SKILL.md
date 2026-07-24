---
name: character-image-prompt
description: Provider-neutral prompt construction instructions for deterministic character sheets.
---

# Character Sheet Prompt Construction

Build one provider-neutral image prompt from the validated text request, optional reference summary, layout contract, and fidelity contract.

Order the prompt as:

1. State that the output is one professional character design sheet containing one repeated identity.
2. Describe the character from stable identity traits to clothing construction, accessories, materials, and colors.
3. State the exact fixed cell order and labels from the layout contract.
4. State reference-fidelity requirements when reference Assets exist.
5. State neutral lighting, background, view scale, and complete-body framing.
6. End with explicit prohibitions against identity drift, outfit drift, missing views, cropped feet, extra characters, scenery, logos, and watermarks.

Do not invent story beats, props, weapons, brands, text, or alternate costumes. Do not ask the image provider for separate outputs. The final prompt must repeatedly state that all views belong in one image.
