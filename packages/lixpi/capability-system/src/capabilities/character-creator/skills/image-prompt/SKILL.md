---
name: character-image-prompt
description: Provider-neutral prompt construction for isolated Character Creator panels.
---

# Character Sheet Prompt Construction

Build one provider-neutral prompt per panel from the validated request, structured source evidence, target panel specification, and accepted dependency anchors.

Order the prompt as:

1. State the single target angle, expression, close-up, prop, or action and its crop.
2. Describe the character from stable identity traits to clothing construction, accessories, materials, and colors.
3. State the directly observed evidence relevant to this panel and preserve its rendering medium.
4. Name accepted anchors that must stay consistent without asking the provider to copy their framing.
5. State neutral lighting, plain white background, and complete target framing.
6. End with prohibitions against identity drift, outfit drift, extra characters, text, layout marks, scenery, logos, and watermarks.

Do not invent story beats, weapons, brands, or alternate costumes. Props appear only in the prop panel or when required by an action. Do not ask an image provider to render multiple panels, sheet text, guides, notes, swatches, or final layout.

After assessment, a correction prompt contains only failed dimensions and concrete mismatch codes. It preserves accepted dimensions and retries that panel once. It never regenerates another panel or edits a complete sheet.
