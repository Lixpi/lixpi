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

The API supplies typed platform adapters for authorized Asset reads, transient Object Store access, selected-provider image calls, structured VLM transport, NEX fidelity requests, progressive image publication, and durable run progress. Character-specific evidence, graph, assessment, prompt, composition, trace, and cleanup logic stays inside the module directory.

## Configurable shot graph

The default run contains exactly three shots and at most three paid image-provider calls:

| Shot | Purpose |
|---|---|
| Neutral front identity portrait | Close straight-on head-and-shoulders view with a relaxed neutral expression, 10-12 percent clean clearance above the complete hair or headwear, the complete face and neck visible, a crop immediately below the collarbones with no armpits or arms, and the head and facial region occupying 55-60 percent of image height. |
| Front body | Relaxed full-body front view with an upright head, level shoulders, naturally lowered arms, and feet hip-width apart. |
| Walking body profile | Exact side-on walking profile with an upright head, level gaze, neutral spine, modest stride, and natural arm counter-swing. |

The neutral front identity portrait is a required pipeline barrier and generated-output binding. It renders first from the authorized source evidence. Every provider-generated downstream shot declares a required `generated-identity-anchor` binding to that result, so the shared media DAG cannot release any dependent work until the portrait succeeds. If the portrait fails, dependent shots are marked blocked and are never sent to the provider.

The completed portrait is attached to every dependent request as `canonical-anchor` and receives the highest identity-reference priority. The selected image model therefore extends the concrete variant it established in its own first result instead of independently reinterpreting the original references for every angle. Original sources remain attached as budget permits and remain authoritative for body proportions, outfit construction, accessories, colors, materials, and details outside the portrait crop. Pose references remain spatial controls. Once the anchor exists, ready dependent shots may run concurrently.

Free-form prompt text can request a total from 3 to 10 shots. Additional slots are prioritized by the requested subject matter: belongings or props, profile and back views, face angles, outfit construction, materials, and action poses. Smile, serious, surprise, emotion-sheet, and other expression variants are not capability options. A 10-shot request fills the complete non-expression catalog with body coverage, neutral identity views, belongings, outfit details, and action coverage. Cost and latency scale with the requested count.

Every planned shot gets one generation attempt. Transport failure, moderation, comparison failure, or low fidelity never starts a replacement provider call automatically.

Pose-bearing body, action, and object-placement shots are conditioned on owned text-free spatial-control images. Those controls define framing, camera direction, upright head angle, posture, limb placement, weight distribution, subject scale, and silhouette. Every control uses the same deliberately gender-neutral, sexless gray mannequin with a featureless head, straight torso, balanced shoulder and hip widths, and no chest, waist, pelvic, muscular, or other sex-specific anatomy. The required neutral front portrait uses the same control language for centered straight-on camera direction, upright head position, symmetric head-and-shoulder alignment, upper-body crop, and subject scale. Control anatomy, physique, material, clothing, and sex presentation are explicitly excluded from identity and design evidence. Other head and outfit-detail shots have no synthetic pose control; dependent shots still receive the generated identity anchor and original evidence. The user prompt and authorized source Assets define the initial facial anatomy, sex presentation, identity, hair, headwear, and neutral expression before the generated anchor carries that established variant downstream. A shot that requires spatial control fails before the provider call when that control is missing.

## Progressive results and failure surfacing

Capability Tool events appear on the transient canvas marker during preflight, so request validation and render-plan construction expose both their current work and terminal result before the media run exists. The durable media-generation run then reports four phases: preparation, rendering, assessment, and composition. Preparation is split into source authorization/loading, evidence analysis, and reference-pack construction; each completed row reports source counts, observed and inferred evidence counts, medium, conflicts, and prepared reference roles. Rendering reports the active provider work and then the one-attempt result for every shot, including the reference roles the provider used or omitted. Composition reports layout assembly and final PNG sealing.

The assessment phase reports a live row for every shot. A clean completed row keeps its overall percentage visible while collapsed; expanding it shows every returned dimension score, concrete mismatch code, and face-similarity result. A review flag means that a dimension scored below 72%, the assessor returned a concrete mismatch code, or a required face-similarity check was unavailable. That scored work uses the non-green attention state rather than the red execution-failure state. The comparison group and flagged shots open automatically so the result cannot be silently hidden, but the user can collapse them manually and that choice survives later progress updates. Explicit face-similarity unavailable reasons, comparison failures, and technical assessment failures remain visible rather than becoming unfinished work. Once the transient preflight marker has resolved onto the canvas, the branch lineage marker renders the same nested items inside its existing background, directly below the reasoning response. Ordinary image and video runs use the same marker surface with a generic request → references/capabilities → provider → generation → finalization sequence.

Each potentially long server operation publishes a five-second heartbeat with elapsed time and live stage facts: requested and loaded sources during preparation, active and queued shot names during provider rendering, active comparison names and completed score counts during fidelity evaluation, and current output dimensions during composition. Start reports do not serialize concurrent provider calls; their immutable snapshots enter one ordered reporting chain while the actual calls begin immediately.

Terminal media status settles every still-pending or running nested item before the temporary operation projection is removed. The durable request, owning marker, recovery path, and immediate completion event all reconcile the same terminal state, so a completed output cannot leave an active ripple or unfinished row behind after a reconnect or event-ordering race. Ordinary canvas saves cannot add, remove, or overwrite server-owned media-operation nodes, ownership edges, or marker progress. If an old workspace has already lost an operation node or edge, durable progress events project directly to its request marker and terminal reconciliation settles the marker from the durable run.

Every partial image received from a shot provider immediately replaces that panel's live bytes and publishes a newly composed full-sheet preview on the preassigned output Asset. Terminal shot bytes replace the panel's last provider partial; unrendered cells remain blank. Capture-only provider calls never expose an isolated panel as the top-level result. A partial neutral-front portrait is presentation-only: only its successful terminal result satisfies the required `generated-identity-anchor` binding and releases dependent shots. When dependent shots run concurrently, each preview contains every completed panel plus the latest partial from every in-flight panel. Presentation failures are logged and cannot invalidate provider work or already-rendered results.

After all render nodes settle, the runtime compares every assessable shot with source evidence. The live timeline, Asset description, and versioned image-generation trace expose match scores, every dimension score, concrete mismatch codes, face-similarity results or unavailable reasons, failed dimensions, unavailable comparisons, unavailable shots, source-coverage notes, and retry guidance; none of those details are written into the generated pixels. Comparison is advisory: pixels are preserved even when they need review.

If no shot renders, the run fails visibly. Otherwise the runtime publishes the best partial sheet it can assemble and marks missing or questionable cells for review.

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

Observed facts require an authorized source and in-bounds coordinates. Explicit prompt changes override source facts. Otherwise observed evidence overrides descriptive prompt text, and evidence from the closest target angle wins. Unresolved conflicts remain in the trace.

Role-specific PNG references are written to organization-scoped transient storage. Original sources are reduced only when the selected model's declared pixel limit requires it. Every transient object is removed after success, failure, or cancellation.

When evidence does not show a requested detail, the prompt uses the smallest plausible inference and the trace discloses it. Generated shots never become identity references for later shots.

## Provider capabilities and adapters

Every synchronized image model declares `imageReferenceCapabilities`: reference and identity budgets, conditioning modes, iterative-edit and control support, input-fidelity behavior, pixel limits, and aspect ratios. Character Creator fails before shot generation when the selected model cannot perform identity conditioning.

The common graph uses provider-neutral roles such as `canonical-anchor`, `original-source`, `pose-reference`, `face-crop`, `body-outfit-crop`, and `prop-crop`. For the required neutral-front portrait, provider adapters order original evidence before its spatial control. Once the anchor exists, adapters order the generated anchor first, the shot-specific spatial control second when one is required, and original evidence next. This preserves the identity anchor and pose under tight total-reference budgets while retaining as much original construction evidence as the selected model allows. Other head and outfit-detail shots omit `pose-reference` entirely. Adapters trim remaining optional inputs to declared model limits and record included and omitted roles. OpenAI's multi-image edit conditioning accepts spatial controls as normal image inputs; Google can combine character evidence with a spatial control where the selected model exposes that support. Character Creator and provider logs record whether a shot used a pose control, plus the exact control filename, byte length, digest, final reference order, and included/omitted roles.

- OpenAI uses the multi-image edit path and synchronized fidelity metadata.
- Google interleaves explicit role labels with image parts.
- Stability uses only the image, style, or structure controls supported by the selected endpoint. Style transfer is not treated as identity conditioning.

Provider names do not appear in the Character graph or capability-media scheduler.

## Assessment

The selected reasoning model compares each rendered shot with its target, source pixels, and structured evidence. It scores the requested dimensions and emits concrete mismatch codes.

Photographic head-bearing shots also request the internal NEX character-fidelity workload in parallel with structured VLM scoring. The workload runs pinned YuNet and SFace ONNX artifacts through single-threaded WASM, returns detections and scalar cosine similarity, and never returns or persists embeddings. A malformed VLM score payload therefore does not prevent an independent NEX result from being computed and shown. Illustration and unreliable-face cases produce a typed unavailable reason instead of a fabricated score.

Evidence analysis and assessment each use a single structured-VLM attempt with no transport, truncation, or provider-fallback retry. Assessment never modifies a rendered shot and never schedules a second image attempt. Malformed VLM output, unavailable fidelity infrastructure, and threshold failures become visible comparison issues on the preserved candidate. The normalizer accepts equivalent structured representations such as dimension-keyed objects and numeric or percent score strings without inventing missing values. Invalid assessment payloads report a user-readable reason such as a missing score list, invalid fields, or missing requested dimensions; internal error codes and payload-shape diagnostics remain in server logs instead of appearing in the timeline.

## Deterministic composition and settlement

The compositor derives a compact grid from the requested shot count, removes near-white outer margins from each provider result, and fits the visible subject into its cell with bounded padding. Full-body subjects are preserved from hair or headwear through footwear. Identity portraits preserve clean crown clearance plus the complete hair or headwear, face, neck, shoulder line, and collarbones while keeping the head and facial region large enough to inspect; other upper-body shots may extend through mid-torso. The sheet contains imagery only: no generated or server-rendered headings, labels, captions, statuses, guides, borders, notes, swatches, logos, or watermarks.

The final PNG and review trace return to `ImageRouter`. `ImagePublisher.complete` stores the bytes on the preassigned Asset, starts renditions, attaches the API-owned canvas node, records usage and lineage, clears transient partials, and publishes the normal completion event. Intermediate isolated shot pixels never become Assets.

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
