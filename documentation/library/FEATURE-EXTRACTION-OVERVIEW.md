---
title: Feature Extraction — Overview
description: What a feature is, why the system exists, the four design principles, the field-by-field feature model, the per-axis extraction contracts and validators, and the kinds of input extraction accepts.
---

# Feature Extraction — Overview

Lixpi treats **features** as a first-class primitive: reusable, scoped, named
library entries that capture the essence of any visual abstraction — a painting
style, a color palette, a mood, a stroke pattern, a lighting setup, a character
design, anything the user names — extracted from one or more reference inputs
(images, documents, threads, or combinations).

This page is the conceptual entry point: what a feature **is**, **why** the
system exists, the design principles that break every tie, and the field-by-field
shape of an extracted feature. For **how** extraction actually runs, see the
[Extraction Pipeline](./EXTRACTION-PIPELINE.md). For **how leakage is
prevented**, see [Anti-Leakage](./ANTI-LEAKAGE.md). For the daily-use `/use`
path and the scope/sharing model, see [Using Features](./USING-FEATURES.md).
Extracted features are surfaced in the `Features` surface of the right side
panel's [Media Library](./MEDIA-LIBRARY.md).

## Why this exists

Lixpi is a node-based visual canvas for AI image and video generation
pipelines. Its defining win is **artifact piping for character consistency** —
the same image node piped into multiple threads via directional edges gives
later generations a stable visual reference for the same character or object
(see [Product Overview](../PRODUCT-OVERVIEW.md)).

Feature extraction addresses a parallel problem: **stylistic and aesthetic
consistency without subject leakage**. When an artist, art director, or brand
designer wants to apply a specific painting style, color palette, mood, lighting
setup, or stroke pattern across many generations, the obvious alternatives all
fail:

1. **Re-type the style description from scratch every time.** Lossy.
   Inconsistent. Doesn't survive across workspaces. Doesn't survive across
   collaborators.
2. **Pipe the original reference image as edge context.** Carries unwanted
   subject content into outputs. A portrait of a watercolor cat ends up
   appearing — at least in spirit — in every generation that was supposed to
   merely *borrow its watercolor look*. The artist's reference content leaks
   into work that has nothing to do with cats.
3. **Maintain an external prompt cheat-sheet (Notion, Google Doc, etc.).**
   Breaks the spatial workflow paradigm. Not searchable from the canvas. Not
   shareable as first-class data.

None of these preserve a pure, reusable, shareable abstraction of *just the
style* with no content leakage. Features close that gap.

## Design principles

Four principles drive every design decision. They are the tiebreakers when
trade-offs come up.

1. **The artist's reference subject must never leak into downstream
   generations, but the artist's medium must be preserved with fidelity.** If
   you extract a watercolor style from a picture of your cat, generations that
   use that feature must not contain cats unless the user explicitly asks — *and*
   they must carry the cat's paper tooth, dry-brush direction, and deckle-edge
   frame, not a generic smooth watercolor. Both halves are non-negotiable:
   subject leakage is the headline anti-feature; texture loss is what makes the
   feature unusable in practice. The strategy that solves both is content-free
   pixel cropping — withhold subject layout, forward medium evidence (see
   [Anti-Leakage](./ANTI-LEAKAGE.md)).
2. **Extraction must capture the work's actually distinctive traits, not its
   trained-prior category.** A digital cel-shaded illustration is a digital
   cel-shaded illustration, not "soft storybook watercolor." A chibi-style
   character's huge expressive eyes are the signature, not a background paper
   tooth that doesn't exist. The architecture forces the model to commit to a
   medium classification before any axis extractor runs, and uses a router stage
   to score each attribute axis 0–1 on dominance so the dominant signature is
   foregrounded in the synthesis. If the user disagrees with the router, they
   re-run with an explicit intent string ("extract just the character design").
3. **Features are reusable across the artist's entire workflow.** A user who
   builds a library of 50 personal styles, palettes, and moods has effectively
   built a small in-house DSL for their visual brand. Switching workspaces,
   sharing with their org, or publishing to the community is one click.
4. **Application is frictionless.** Typing `/use my-watercolor` in any prompt
   feels as natural as @-mentioning a coworker.

## What's deliberately out of scope

- **A `feature` canvas node type.** Features are library-only; drag-to-canvas
  placement is parked for a later iteration.
- **Inline editing of feature instructions** in the library card. Edits go
  through "Open in Features → Re-extract."
- **Versioning / revision history** of features. The `version` field is
  reserved but only `1` is written today.
- **External or public Feature sharing.** `shared` is reserved in the type
  contract, but no runtime, discovery, moderation, or UI path exists yet.
- **Multi-step autonomous-planning agent behavior** (DeepAgents-style
  `write_todos` planning, dynamic subagent spawning, virtual filesystem for
  cross-step reasoning). The pipeline is multi-stage and runs many parallel VLM
  calls, but the stage graph is fixed and deterministic. The reasoning is
  detailed in the [Extraction Pipeline](./EXTRACTION-PIPELINE.md).
- **Procedural / synthetic texture generation.** Earlier iterations explored an
  SVG-path renderer that synthesized "texture specimens" from regex-matched
  keyword parameters; the marks produced had no relationship to the source's
  actual textures and the path was removed. There is no synthesis-from-text path
  anywhere in the pipeline — all visual evidence is pixel-grounded.

## What is an extracted feature?

A **feature** is a reusable, scoped library entry that captures the essence of
one specific visual abstraction. Conceptually it's a "saved style preset"
generalized far beyond style.

Every feature contains the following fields.

| Field | Description |
|---|---|
| `category` | Synthesis-determined from the dominant attribute axis (or user intent override): `illustration-style`, `painting-style`, `color-palette`, `mood`, `lighting-setup`, `character-design`, `composition-rule`, `surface-texture`, `prompt-pattern`, or any axis-grouping the synthesis stage names. The router stage produces a `medium` classification (digital-illustration, watercolor, oil, photograph, etc.) which feeds into `parameters.mediumSignature` — the user-facing `category` is the dominant axis, the underlying medium is structured metadata. |
| `name` | Synthesized from the dominant axis traits (e.g. `cel-shaded-chibi-cat-style` or `dusty-sage-and-coral-palette`) or from the user's explicit intent if provided. Used for `/use {name}` references. |
| `summary` | One line that names the dominant signature traits explicitly (e.g. "Cel-shaded digital chibi-cat illustration with oversized expressive eyes, soft warm window lighting, and a painterly cream background — digital, NOT traditional watercolor"). Used in the library list and in the hover info bubble. |
| `tags` | Short string tags derived from dominant axes. Tags reflect the actual extracted traits, not generic medium tropes (a digital illustration is not tagged `watercolor` unless the router and `MediumSignatureExtractor` both confirm it is). |
| `instructions` | A markdown body — the rich how-to-apply guide the LLM consumes when the feature is invoked. Written by the synthesis stage. Sections are weighted by axis dominance: ≥ 0.8 axes get dedicated top-level sections; 0.5–0.8 axes get short sections; 0.3–0.5 axes are mentioned briefly; < 0.3 axes are absent. Always opens with a "DO NOT" section enumerating training-prior tropes the synthesis explicitly rejected (e.g. "this is digital — DO NOT add paper tooth, dry-brush, deckle edges, or wash bleeds"). Anywhere from 200 to 3500 words. This is the workhorse field. |
| `parameters` | Nested per-axis structured JSON. Top-level fields include `axisDominance` (the router's 0–1 scores per axis), and one nested block per axis that was extracted (e.g. `parameters.palette`, `parameters.lighting`, `parameters.characterDesign`, `parameters.mediumSignature`, etc.). Every axis block has the same envelope: `{ dominance: number, fields: {...axis-specific schema}, rationale: string }`. The full Stage 1 `sceneAssessment` is also nested at `parameters.sceneAssessment` for downstream consumers. Filterable on any nested path. |
| `sampleImages` | A mixed list of source crops, texture specimens, and applied-medium probes with stable indexes and audit metadata. Each sample stores a Feature-owned Blob hash in the Workspace organization's Blob bucket; Feature references protect those Blobs independently of canvas Assets. |
| `scope` | `organization` for every active Feature. `shared` is reserved and unavailable. |
| `status` | `'active'`, `'reported'` (auto-flipped past report threshold), `'removed'`. |
| `sourceContext` | Provenance: which `extractionRunId` produced it, which workspace it was born in, and the authorized source Asset IDs. Object Store coordinates and tokenized URLs are never persisted here. |
| `version` | Schema version, currently `1`. Reserved for future revisions. |

{% callout type="note" %}
The sample kinds (`source-crop`, `texture-specimen`, `applied-medium-probe`) and
the strict anti-leakage instruction attached to model-rendered probes are the
heart of the leakage strategy. They are explained in full on the
[Anti-Leakage](./ANTI-LEAKAGE.md) page.
{% /callout %}

### Why hybrid representation

A feature is a **hybrid** of a structured envelope + a markdown `instructions`
body + a freeform `parameters` blob. That combination is deliberate:

- **Pure markdown loses queryability** — you can't filter "all warm-tone
  palettes" or "features with stroke type = crosshatch."
- **Pure structured JSON loses expressiveness** — no fixed schema can capture
  every conceivable artistic concept the user might invent, and agent-determined
  categories are the whole point.
- **Hybrid lets the agent fill in whatever structured signals make sense** for
  the category, while keeping a free-form prose explanation for everything else.
  The LLM consumes the markdown; the library UI uses the envelope + parameters
  for filtering and display.

## Per-axis extraction contracts (and validators)

The feature system is flexible, but flexibility cannot mean accepting slop. Each
extractor enforces a strict output schema; the synthesis stage enforces global
contracts; and the persistence layer enforces medium-correctness sanity checks.
Failures short-circuit the run rather than silently saving a vague feature.

The full list of axis contracts lives in
[`services/api/src/llm/extraction/extractors/<axis>-extractor.ts`](../../services/api/src/llm/extraction/extractors/)
(one file per axis). The headline contracts the validator enforces follow.

### `palette` axis

Required fields: `palette[]` of 5–12 entries (at least 4) each with `name`,
`hex`, `role`, `usage` (percent), `temperature`, `notes`; plus `harmony`,
`contrast`, `usageGuidance`, `backgroundTreatment`, `shadowStrategy`,
`highlightStrategy`, `avoid`. If the user's intent string explicitly asks for
"palette" / "color" / "colors" and the analysis model does not return concrete
hex values, the run fails validation rather than saving a vague feature.

### `character-design` axis

Only applicable when the router's `subjects[]` is non-empty. Required fields:
`archetype` (e.g. `chibi-kitten`, `realistic-portrait`, `stylized-figure`),
`proportions` (head-to-body ratio, eye-to-face ratio, limb proportions),
`featureEmphasis[]` (which features are oversized/exaggerated — eyes, paws,
ears, etc.), `expression`, `pose`, `shadingApproach` (`cel-shaded`, `painterly`,
`photoreal`, `line-art`, etc.), `silhouetteStyle`, `lineTreatment`. The
validator rejects extractions where `featureEmphasis` is empty for a clearly
stylized subject — a chibi kitten always emphasizes something.

### `medium-signature` axis

Required fields: `medium` (must match the router's `medium` classification),
`techniqueSignatures[]` (`cel-shading`, `glazing`, `dry-brush`,
`digital-airbrush`, etc.), `softwareGuess[]` (best-effort: `Procreate`,
`Photoshop`, `traditional`, etc.), `digitalArtifacts[]` (clean anti-aliased
edges, perfect gradient tools, pixel-perfect symmetry), `traditionalArtifacts[]`
(paper tooth, wash bleeds, dry-brush, granulation). The validator enforces: if
`medium = digital-illustration` then `traditionalArtifacts` should be empty or
near-empty — a non-empty `traditionalArtifacts` on a digital medium triggers a
re-evaluation flag. This is the primary structural fix for the v0 "watercolor on
a digital cat" bug (see ["What worked, what didn't"](./EXTRACTION-PIPELINE.md#what-worked-what-didnt)).

### `surface-texture` axis

Only applicable when the router scores `surface-texture` dominance ≥ 0.3.
Required fields: `baseSurface`, `grain`, `markPattern`, `edgeBehavior`,
`density`, `scale`, `repeatability`, `applicationGuidance`, `visibleArtifacts[]`.
The validator distinguishes between digital-imitating-traditional (a digital
airbrush "watercolor" effect) and actually-traditional (real paper); the former
has `medium-signature.medium = digital-illustration` with non-trivial
`techniqueSignatures`, the latter has
`medium-signature.medium = traditional-watercolor`. The earlier monolithic
extractor collapsed both into "watercolor"; this split is the structural fix.

### Other axes

`lighting`, `line-quality`, `composition`, `mood`, `background-treatment`,
`edge-treatment` each have their own schema documented in their extractor file.
Schemas are strict — the VLM is configured for structured output via Gemini's
`responseSchema`, OpenAI's `response_format: json_schema`, or Anthropic's
tool-use enforcement.

### Source-crops contract (Stage 3, all extractions)

The router's `subjects[]` and `regions[]` bounding boxes feed Stage 3. The
pipeline materializes 3–8 crops per reference image: 2–4 sub-anatomical crops on
each primary subject (focused on the parts the router named in the subject
description), 1–2 content-free crops per identified background region, and 1
composition-preserving low-res thumbnail. Each crop must be ≥ 128 px on each axis
after clamping. If fewer than 3 valid crops materialize, the run fails before
synthesis.

### Sample requirements (Stage 5)

All visual features require saved sample images. The synthesis stage's
`recommendedSampleSubjects` drives Stage 5; if the synthesis selects a
`texture-specimen` sample for a `surface-texture`-dominant feature, the backend
composites it deterministically from source crops (2×2 grid via sharp — the v0
`renderTextureReferenceSheet` SVG path is removed entirely). For
`palette`-dominant features, sample 0 is always a deterministic palette board.
For `character-design`-dominant features, sample 0 is typically a model-rendered
neutral character (a generic stylized animal head, not the source subject)
generated with source crops as visual reference. If any required sample cannot be
generated, validated as PNG/JPEG, stored, and read back, the run fails rather
than saving a library item that says "No sample image saved."

## Concrete examples

The **Visual evidence** column shows the full sample composition: source crops
(pixel-grounded medium evidence) + specimen composite (where applicable) +
model-rendered applied-medium probes.

| User request | Detected category | Auto-named | Visual evidence stored on the feature |
|---|---|---|---|
| "extract painting style from these 3 watercolor pieces" | `painting-style` | `loose-watercolor` | 4 source crops (paper-edge, background, fur-detail, deckle-edge from the 3 inputs) + 2 model-rendered applied-medium probes (sphere on a wooden table; abstract landscape) |
| "save the surface texture of this storybook cat" | `surface-texture` | `soft-storybook-watercolor-tooth` | 4 source crops (paper-tooth, dry-brush fibre, deckle-edge, background corner) + 1 deterministic 2×2 texture-specimen composite of those crops + 1 model-rendered applied-medium probe (ceramic sphere on a plain plank) |
| "save this as a color palette" | `color-palette` | `dusty-sage-and-coral` | 1 palette-board sample (swatches, hex codes, roles, usage proportions). No source crops required — palette features are concrete via hex values. |
| "extract the mood" | `mood` | `melancholy-late-autumn` | 3 source crops (light-quality regions, ambient color, atmosphere-edge) + 1 model-rendered applied-medium probe (generic empty room with afternoon light) |
| "stroke pattern from this etching" | `stroke-pattern` | `crosshatch-rough` | 3 source crops (stroke-density region, edge-crosshatch, white-space) + 2 model-rendered probes (sphere; cube) |
| "the lighting setup in this portrait" | `lighting-setup` | `north-window-soft` | 3 source crops (rim-light region, falloff-gradient, shadow-edge) + 1 model-rendered probe (generic head-and-shoulders silhouette in that light) |
| "save these as a composition rule" (user provides 4 reference compositions) | `composition-rule` | `rule-of-thirds-with-leading-diagonal` | 0 samples — agent decides this is best expressed as instructions only; sample images would mislead. Source crops do not apply to composition (it's about layout relationships, not pixel evidence). |
| "extract the prompt-engineering pattern I keep using for product photos" (user supplies 2 prior chat threads, no images) | `prompt-pattern` | `clean-product-shot-recipe` | 0 samples — non-image input, instructions-only feature |

The agent picks count + subjects per category according to its analysis. The
schema accommodates 0 samples for cases where samples wouldn't help (or where the
input is non-visual).

## Inputs are not limited to images

The extraction tool accepts the Asset-backed context snapshot assembled by
[`WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts)
and resolved by
[`workspace-context-resolver.ts`](../../services/api/src/llm/graph/workspace-context-resolver.ts).
That includes:

- Image canvas nodes (submitted as `asset://<assetId>`, authorized by the API,
  then resolved to internal Blob coordinates for model input)
- Document canvas nodes (ProseMirror JSON → plain text)
- Upstream AI chat thread canvas nodes (full conversation history)
- Mixed combinations of the above

A feature extracted from a thread of past conversations is just as valid as one
from images. The agent decides what kind of feature is appropriate based on what
it sees.

## Where to go next

- **[Extraction Pipeline](./EXTRACTION-PIPELINE.md)** — the six-stage
  dominance-weighted LangGraph, the research foundations, the modular extractor
  architecture, dominance-weighted synthesis, tracing, and the end-to-end
  walkthrough.
- **[Anti-Leakage](./ANTI-LEAKAGE.md)** — content-free pixel cropping, why
  withholding all pixels failed, the disentanglement literature, sample QA, and
  the v2 escalation path.
- **[Using Features](./USING-FEATURES.md)** — entry points, `/use`, and the
  scope & sharing model.
- **[Feature Storage](./FEATURE-STORAGE.md)** — DDB tables, object-store layout,
  NATS subjects, the `resolveFeatures` pre-stage, and known limitations.
