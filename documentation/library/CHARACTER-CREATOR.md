---
title: Character Creator
description: How Character Creator plans configurable identity-focused shots, publishes progressive sheets, compares them with source evidence, and preserves manual variants.
---

# Character Creator

Character Creator is the built-in Capability module for character design, model-sheet, and turnaround requests. It uses the selected reasoning and image-model matrix. It does not choose a hidden model or bypass normal Asset settlement and lineage.

The Tool produces a provider-neutral `CharacterSheetRenderPlan`. Its package-owned backend runtime renders isolated shots, compares them with structured source evidence, and uses deterministic Sharp code to assemble one 3840x2560 PNG. Each provider request renders one shot; the provider never renders the sheet layout, typography, or metadata.

## Module composition

The module lives at `packages/lixpi/capability-system/src/capabilities/character-creator/` and installs four module-internal packages:

| Package | Responsibility |
|---|---|
| `global.character-creator` Tool | Validates the prompt and up to eight source Asset IDs, then emits the typed render plan. |
| Character Sheet Layout Skill | Defines the configurable shot graph, one-attempt policy, and deterministic composition contract. |
| Reference Fidelity Skill | Defines observed evidence, inference, conflict resolution, and identity-preservation rules. |
| Character Image Prompt Skill | Defines provider-neutral prompts for one isolated shot and comparison reporting. |

Every package carries `parentModuleId: 'character-creator'` and `catalogExposure: 'module-internal'`. The module is the only user-facing catalog entry.

## Activation and preflight

Character Creator becomes active when the prompt contains an explicit module reference or the router recognizes a character creation request. Its Tool uses `executionPolicy: 'required'`, so it runs before the reasoning-model matrix fans out.

The manifest has two steps:

| Step | Action | Result |
|---|---|---|
| Validate request | `character.validate-request` | Trims the prompt, removes duplicate Asset IDs, enforces the eight-reference limit, and rejects invalid input. |
| Build render plan | `character.build-render-plan` | Returns `mediaGenerationMode`, `preserveUserPrompt`, and a validated `capabilityMediaExecutionPlan`. |

The plan carries the Capability run ID, source Asset IDs, user prompt, layout ID, zero semantic retries, and 3 to 10 shot specifications. The API installs the module strategy through `CapabilityModuleCatalog`, and `ImageRouter` delegates the plan by kind without importing Character Creator.

Every media strategy receives one shared Capability media state containing the provider-safe raw user prompt, source subject-identity classifications, all accumulated sibling Capability instructions and reference images, and every resolved Capability output for the request. A reasoning model can produce an expanded image prompt for ordinary image routing, but that expansion cannot replace the raw user prompt as authority for Capability-owned execution. Character Creator consumes the shared state rather than treating its own render plan as an isolated prompt. This lets one output-owning Capability, such as Character Creator, apply visual-style or other media contributions selected in the same prompt. Character Creator has no named transformation or style branches; runtime prompts derive changes only from that shared request state and structured evidence.

The API supplies typed platform adapters for authorized Asset reads, transient Object Store access, selected-provider image calls, structured VLM transport, NEX fidelity requests, progressive image publication, and durable run progress. Character-specific evidence, graph, assessment, prompt, composition, trace, and cleanup logic stays inside the module directory.

## Configurable shot graph

The default run contains exactly three shots and at most three paid image-provider calls:

| Shot | Purpose |
|---|---|
| Neutral front identity portrait | Close straight-on head-and-shoulders view with a relaxed neutral expression, 10-12 percent clean clearance above the complete hair or headwear, the complete face and neck visible, a crop immediately below the collarbones with no armpits or arms, and the head and facial region occupying 55-60 percent of image height. |
| Front body | Relaxed full-body front view with an upright head, level shoulders, naturally lowered arms, and feet hip-width apart. |
| Back body | Straight-on full-body back view that exposes rear garment construction, layers, seams, accessories, materials, and footwear. |

The shared plan represents scheduling and data flow separately. `dependsOn` decides when a shot becomes ready. Named `outputBindings` decide exactly which terminal producer outputs become generated inputs for that consumer. A module can add binding metadata for its own materialization rules; Character Creator records the reference role and filename beside each binding. No runtime rule feeds every earlier shot into the next request.

The neutral front portrait is the first required barrier. The front full-body shot depends on the portrait's successful terminal output through `generated-identity-anchor` and receives it as `GENERATED_IDENTITY_ANCHOR.png`. The front full-body result becomes the second required barrier. The back full-body shot depends on both terminal outputs through `generated-identity-anchor` and `generated-outfit-anchor`; it receives the front full-body result as the primary `canonical-anchor` named `GENERATED_OUTFIT_ANCHOR.png` and the portrait as an `adjacent-angle` reference named `GENERATED_IDENTITY_ANCHOR.png`.

The back full-body result is the third required barrier. Every optional shot depends on all three terminal outputs and additionally receives the back result as `GENERATED_BACK_OUTFIT_ANCHOR.png` with role `opposite-angle`. A missing barrier blocks affected consumers before provider execution. An adapter that omits any required generated-reference role fails the shot instead of silently generating from incomplete evidence.

The portrait → front body → back body chain runs sequentially. Once all three anchors exist, selected optional shots are ready together and may use the configured provider concurrency. This preserves face, front-outfit, and rear-outfit evidence without serializing unrelated optional shots or attaching unrelated earlier results.

Free-form prompt text can request a total from 3 to 10 shots. Additional slots are prioritized by the requested subject matter: belongings or props, profile views, face angles, outfit construction, materials, and action poses. Smile, serious, surprise, emotion-sheet, and other expression variants are not capability options. A 10-shot request fills the complete non-expression catalog with body coverage, neutral identity views, belongings, outfit details, and action coverage. Cost and latency scale with the requested count.

Every planned shot gets one generation attempt. Transport failure, moderation, comparison failure, or low fidelity never starts a replacement provider call automatically.

Pose-bearing body, action, and object-placement shots are conditioned on owned text-free spatial-control images. Those controls define framing, camera direction, upright head angle, posture, limb placement, weight distribution, subject scale, and silhouette. Every control uses the same deliberately gender-neutral, sexless gray mannequin with a featureless head, straight torso, balanced shoulder and hip widths, and no chest, waist, pelvic, muscular, or other sex-specific anatomy. The required neutral front portrait uses the same control language for centered straight-on camera direction, upright head position, symmetric head-and-shoulder alignment, upper-body crop, and subject scale. Control anatomy, physique, material, clothing, and sex presentation are explicitly excluded from identity and design evidence. Other head and outfit-detail shots have no synthetic pose control; dependent shots still receive their declared generated anchors and original evidence. The user prompt and authorized source Assets define the initial facial anatomy, sex presentation, identity, hair, headwear, and neutral expression before the three generated anchors carry identity, front-outfit, and rear-outfit continuity downstream. A shot that requires spatial control fails before the provider call when that control is missing.

## Progressive results and failure surfacing

Each selected image model receives its own durable media run, stable pending output node, and generic progress immediately when the request is accepted. Character Creator then replaces the generic tree for that exact run with four phases: preparation, rendering, assessment, and composition. Preparation is split into source authorization/loading, evidence analysis, and reference-pack construction; each completed row reports source counts, observed and inferred evidence counts, medium, conflicts, and prepared reference roles. Rendering reports the active provider work and then the one-attempt result for every shot, including the reference roles the provider used or omitted. Composition reports layout assembly and final PNG sealing.

Every terminal shot is assessed before it can satisfy a generated-output binding. `single-panel-composition` and `target-view` or `action-pose` are categorical hard release dimensions at 85%: an extra shot, montage, inset, duplicate pose, or wrong camera view rejects that shot as an anchor. The rejected pixels remain visible in composition as review-only progress. `template-conformance` and `framing` remain scored review dimensions because provider crop, subject scale, crown clearance, and white margin variance are normalized again by deterministic sheet composition and must not discard an otherwise usable paid result. Other dimensions remain review signals: a score below 72%, a concrete mismatch code, or an unavailable required face check opens the non-green attention state without discarding structurally valid pixels. Expanding a row shows every dimension, mismatch code, and face-similarity result. The browser renders the nested items as background-free progress directly to the right of that run's media node; ordinary image and video runs use the same component with a generic request → references/capabilities → provider → generation → finalization sequence.

Each potentially long server operation publishes a five-second heartbeat with elapsed time and live stage facts: requested and loaded sources during preparation, active and queued shot names during provider rendering, active comparison names and completed score counts during fidelity evaluation, and current output dimensions during composition. Start reports do not serialize concurrent provider calls; their immutable snapshots enter one ordered reporting chain while the actual calls begin immediately.

Terminal media status settles every still-pending or running nested item before the temporary operation projection is removed. The durable request, output node, recovery path, and immediate completion event all reconcile the same terminal state, so a completed output cannot leave an active ripple or unfinished row behind after a reconnect or event-ordering race. Ordinary canvas saves cannot add, remove, or overwrite server-owned media-operation nodes or media-node progress. If an old workspace has lost an operation node, durable progress events resolve the stable output by request/run identity. Terminal progress is embedded in that output Asset's provenance document; accepting the node hides the live side timeline and its history mounts the same timeline component from provenance.

Every provider partial immediately replaces that panel's live presentation bytes and publishes a newly composed full-sheet preview on the preassigned output Asset. Terminal bytes replace the last partial after structural assessment; unrendered cells remain blank. Partials are presentation evidence only: they never satisfy `generated-identity-anchor`, `generated-outfit-anchor`, or `generated-back-outfit-anchor` and never release a dependent shot. If the provider fails after emitting a partial, or the terminal structural gate rejects the terminal image, the latest usable pixels remain in the sheet as a durable `character-sheet-panel-review-only` component. When optional shots run concurrently, each preview contains accepted panels plus the latest partial from every in-flight panel.

The live timeline, Asset description, and versioned image-generation trace expose match scores, every dimension score, concrete mismatch codes, face-similarity results or unavailable reasons, failed dimensions, unavailable comparisons, unavailable shots, source-coverage notes, and retry guidance; none of those details are written into the generated pixels. Structural comparison is a release gate. Remaining identity and design comparison is advisory and preserves accepted pixels for review.

If a required anchor fails generation or structural validation, no dependent shot starts. The run still completes a durable partial sheet when any accepted, terminal, or streamed panel pixels exist, with the failed candidate retained visibly and its exact diagnostics attached. A run fails without an output only when no usable panel pixels exist. Review-only components are retained for inspection but excluded from future generated-anchor resolution.

## Manual variants and branch lineage

The runtime always records `automaticRetries: 0`. A comparison issue recommends keeping the current candidate or explicitly generating another variant. The existing candidate remains on the canvas.

An explicit “Regenerate” action replays the request as a new run. For a single output, the API verifies the sealed source provenance without requiring the source Asset to be superseded, creates a branch-continuation marker from that media node, and places the new output after it. Repeating the action produces an editing line such as candidate 1 → continuation → candidate 2 → continuation → candidate 3. The user can inspect every candidate and accept the preferred output.

Prompt regeneration remains a separate action: it creates fresh lineage because the reasoning model is asked to write a different prompt.

## Source evidence

Every source Asset is reauthorized against the active user, workspace, and organization. Character Creator resolves `canonical` first and `original` second. It never uses `preview`.

The selected reasoning model analyzes source pixels into structured evidence:

- source medium;
- observed and inferred facts for face, hair, skin, body, clothing, accessories, materials, and props;
- source regions for lossless face, body/outfit, and prop crops;
- target-angle and body-region coverage;
- palette and design notes for prompting and trace metadata;
- conflicts between references.

Observed facts require an authorized source and in-bounds coordinates. Evidence analysis receives original references and editable prior panels as separate input classes; only originals can produce source facts and crop coordinates. Every original keeps its provider-safe `REFERENCE_n` alias in the analyzer message, generated filename, and per-shot evidence summary, so assignments in the request still identify the same pixels at the image provider. Each fact records its closed region and whether the request assigns that source to the feature, names it as supporting context, or leaves it unassigned. Request-assigned evidence wins before target-angle specificity and confidence. Evidence analysis extracts explicit prompt directives and the observed feature names those directives change. Changed source facts remain available as explicitly marked target evidence because a request may reject the old panel while assigning the corrected trait to an original source; they are not preservation defaults, and an explicit replacement value still wins. Every per-shot prompt places the complete request and sibling Capability instructions ahead of baseline evidence and never limits changes to camera, crop, or pose. Otherwise observed evidence overrides descriptive prompt text, and evidence from the closest target angle wins. Unresolved conflicts remain in the trace.

Source medium is a separate baseline constraint. References preserve their observed depiction medium unless the raw request or a sibling Capability explicitly requests a different one. A requested identity, state, design, material, or appearance change does not implicitly authorize a depiction-medium change. Evidence analysis may conservatively normalize an obvious misspelling from context, but it cannot turn an unknown word into an unrequested style.

Role-specific PNG references are written to organization-scoped transient storage. Evidence analysis classifies prior-sheet authority as `preserve-panel`, `identity-only`, `discard`, or `not-present` from explicit approved and rejected regions. A preserved matching component uses role `edit-target` and filename `EDIT_TARGET_<reference-alias>_<panel>.png`. An identity-only edit sends no rejected full-body panel pixels: only the face region of `head-front-neutral` is attached, with role `edit-target-identity` and filename `EDIT_TARGET_IDENTITY_FACE.png`; body shots receive no edit-target reference. Portrait shots exclude body/outfit and carried-element crops even when those crops are authoritative for later shots. Original reference Assets keep the separate `original-source` role and their exact `REFERENCE_n.png` filename so prompt instructions can assign construction, placement, and other requested traits independently. Structured fact regions drive lossless face, body/outfit, and carried-element crops instead of keyword matching against feature names. Original sources are reduced only when the selected model's declared pixel limit requires it. Every transient object is removed after success, failure, or cancellation.

When evidence does not show a requested detail, the prompt uses the smallest plausible inference and the trace discloses it. Only generated outputs named by the plan's bindings become references for later shots; the default graph names the portrait, front full-body, and back full-body anchors.

## Provider capabilities and adapters

Every synchronized image model declares `imageReferenceCapabilities`: reference and identity budgets, conditioning modes, iterative-edit and control support, input-fidelity behavior, pixel limits, and aspect ratios. Character Creator fails before shot generation when the selected model cannot perform identity conditioning or cannot carry the generated references required by the selected graph.

The common graph uses provider-neutral roles such as `edit-target`, `edit-target-identity`, `canonical-anchor`, `adjacent-angle`, `opposite-angle`, `original-source`, `capability-reference`, `pose-reference`, `face-crop`, `body-outfit-crop`, and `prop-crop`. These relationships enter each transient image provider through the `imageGenerationReferences` LangGraph state channel, survive byte resolution in `resolvedImageGenerationReferences`, and are budgeted into `imageReferenceAdaptation`; providers only serialize that shared state to their native payloads. Sibling Capability reference images are attached to every shot and are scoped by their shared Capability instructions rather than treated as character identity. For the required neutral-front portrait, provider adapters prioritize its scoped edit identity when present, then original evidence and spatial control. The front full-body request prioritizes the generated portrait, its pose control, and then original evidence. The back full-body request prioritizes the generated front outfit anchor, generated portrait, pose control, and original evidence. Optional requests prioritize the generated front outfit anchor, generated portrait, generated rear-outfit anchor, shot-specific pose control, and original evidence in that order. Adapters trim remaining optional inputs to declared model limits and record included and omitted roles. Other head and outfit-detail shots omit `pose-reference` entirely. Character Creator and provider logs record whether a shot used a pose control, plus the exact control filename, byte length, digest, final reference order, and included/omitted roles.

- OpenAI uses the multi-image edit path and synchronized fidelity metadata.
- Google interleaves explicit role labels with image parts.
- Stability uses only the image, style, or structure controls supported by the selected endpoint. Style transfer is not treated as identity conditioning.

Provider names do not appear in the Character graph or capability-media scheduler.

## Assessment

The selected reasoning model compares each rendered shot with the complete authoritative prompt, sibling Capability instructions and references, its target, source pixels, and structured evidence. Every panel includes `request-compliance` and `depiction-medium` dimensions. Preserving recognizable source identity while omitting a requested transformation is an explicit failure rather than a successful fidelity match. Any unrequested depiction-medium or visual-style change also fails both dimensions. The assessor scores every requested dimension and emits concrete mismatch codes.

Photographic head-bearing shots also request the internal NEX character-fidelity workload in parallel with structured VLM scoring. The workload runs pinned YuNet and SFace ONNX artifacts through single-threaded WASM, returns detections and scalar cosine similarity, and never returns or persists embeddings. A malformed VLM score payload therefore does not prevent an independent NEX result from being computed and shown. Illustration and unreliable-face cases produce a typed unavailable reason instead of a fabricated score.

Evidence analysis and assessment each use a single structured-VLM attempt with no transport, truncation, or provider-fallback retry. Assessment never modifies a rendered shot and never schedules a second image attempt. Malformed or unavailable structural evaluation rejects the candidate because its single-shot and template contract cannot be verified. Non-structural threshold failures become visible comparison issues on the preserved candidate. The normalizer accepts equivalent structured representations such as dimension-keyed objects and numeric or percent score strings without inventing missing values. Invalid assessment payloads report a user-readable reason such as a missing score list, invalid fields, or missing requested dimensions; internal error codes and payload-shape diagnostics remain in server logs instead of appearing in the timeline.

## Deterministic composition and settlement

The compositor derives a compact grid from the requested shot count, removes near-white outer margins from each provider result, and fits the visible subject into its cell with bounded padding. Full-body subjects are preserved from hair or headwear through footwear. Identity portraits preserve clean crown clearance plus the complete hair or headwear, face, neck, shoulder line, and collarbones while keeping the head and facial region large enough to inspect; other upper-body shots may extend through mid-torso. The sheet contains imagery only: no generated or server-rendered headings, labels, captions, statuses, guides, borders, notes, swatches, logos, or watermarks.

The final PNG, isolated panel bytes, and review trace return to `ImageRouter`. Before normal completion is published, the preassigned Asset stores a media-composition manifest whose Blob-backed components preserve every isolated shot and whose source Asset IDs preserve the original references separately from the flattened sheet. The components are not standalone Assets. For a later edit, structured evidence returns `full-sheet` or `selected-panels` plus every affected panel ID. Only a strict selected-panel scope reuses unaffected components; every affected or missing panel is regenerated, and unresolved scope rebuilds the sheet.

The generic media context also carries the resolver-selected edit target Asset ID. Modern Character Creator sheets resolve directly to their Blob-backed composition components. When any authorized Character Creator sheet reference predates media-composition metadata, whether edit target or supporting source, the module validates its deterministic 3:2 white-sheet layout and extracts the panel cells locally. Those recovered cells enter the same component-aware routing path, and each provider call receives at most the component matching that panel. The flattened multi-panel sheet is never sent as a panel reference.

`ImagePublisher.complete` stores the final bytes on the preassigned Asset, starts renditions, attaches the API-owned canvas node, records usage and lineage, clears transient partials, and publishes the normal completion event.

## Model-compatible design decisions

The implementation follows the parts of current frontier-model guidance that transfer reliably across providers:

- separate identity and design references from pose and spatial references, and state each input's role explicitly;
- generate one isolated shot per request instead of asking a model to solve identity, pose, typography, and sheet layout at once;
- specify subject scale, visible body bounds, camera direction, gaze, and pose in concrete terms;
- repeat the identity and design invariants that must not change;
- use a frontal, unobstructed source face when available, while keeping complete hair or headwear and useful upper-body context in the generated identity shot;
- keep deterministic composition, whitespace removal, and all textual metadata outside the image model.

Primary references:

- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI GPT Image prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [Google Vertex AI subject customization guidance](https://cloud.google.com/vertex-ai/generative-ai/docs/image/subject-customization)
- [ControlNet: spatial conditioning for text-to-image diffusion](https://arxiv.org/abs/2302.05543)
- [IP-Adapter: decoupled image and text conditioning](https://arxiv.org/abs/2308.06721)
- [InstantID: identity and spatial face conditioning](https://arxiv.org/abs/2401.07519)

## Capability description card

Hovering or focusing a Character Creator prompt-reference chip opens the module's description sheet through the same context-preview component used by media references. The description explains the three-shot default, free-form 3-to-10-shot configuration, optional reference images, best reference set, best-effort identity limits, inferred regions, one-attempt policy, and scaling cost and latency.

## Related pages

- [Tools, Skills, and Capability Modules](./TOOLS-AND-SKILLS.md)
- [AI Generation Pipeline](../platform/AI-GENERATION-PIPELINE.md)
- [Image Generation](../media-generation/IMAGE-GENERATION.md)
- [Branch Lineage](../media-generation/BRANCH-LINEAGE.md)
