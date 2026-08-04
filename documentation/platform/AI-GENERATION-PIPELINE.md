---
title: AI Generation Pipeline
description: How Lixpi resolves authoritative context, runs Capabilities, executes selected reasoning and media models, and settles generated output through shared Asset lineage.
---

# AI Generation Pipeline

Lixpi uses one generation pipeline for chat, image, video, and Capability-driven output. The API owns authorization, model selection, lineage, usage, cancellation, and Asset settlement. Providers receive only the context and references approved for their concrete run.

## Request flow

```text
validate request
  → resolve authoritative Workspace and prompt context
  → resolve and execute required Capabilities
  → resolve provider-safe media references
  → run selected reasoning models
  → plan concrete media lineage
  → execute image, video, or Capability media strategy
  → settle output into preassigned Assets
  → report usage and clean up transient state
```

The submitted conversation Asset is authoritative. The API acquires its lease, reads the latest ProseMirror document, extracts typed prompt-reference atoms, and reauthorizes every Asset and Capability identity against the active workspace and organization. Browser-serialized history and parallel reference lists are not trusted.

## Capability preflight

Capability resolution seals manifests and resources before execution. A `required` Tool runs before reasoning fanout. A `model-required` Tool runs once inside each selected reasoning provider's continuation loop. A `model-choice` Tool remains optional.

A media-generating Capability can return ordinary provider-neutral instructions and references, or a typed `capabilityMediaExecutionPlan`. The abstract Capability runtime forwards either contract without provider logic. Character Creator uses the typed plan path; Style Extraction uses the instruction/reference path.

Every Capability module publishes a required description sheet with purpose, expected inputs, best-result guidance, limitations, and qualitative cost and latency. Authorized catalog responses carry the same metadata used by prompt-reference hover and focus cards.

## Reasoning and media axes

Reasoning and media models are independent selected axes. The reasoning provider can emit `generate_image` or `generate_video`; the matching router invokes the selected media model in a transient provider workflow. Matrix requests enumerate concrete reasoning/media combinations and isolate failures by run.

Capability policies may remove an axis. Character Creator removes video models before matrix normalization. It never substitutes an image model. Action Timeline produces non-media Artifacts and suppresses media lineage entirely.

## Capability media strategies

`ProviderState.capabilityMediaExecutionPlan` carries a provider-neutral plan from Capability preflight to `ImageRouter`. The Capability package owns `CapabilityMediaStrategyRegistry`, the shared media DAG executor, and each concrete module strategy. A module publishes its strategies through `CapabilityModuleDefinition`; the API installs them through the catalog and never imports a concrete strategy. Common strategy and DAG layers contain no provider-name checks.

Character Creator's strategy:

1. reauthorizes canonical or original source Assets;
2. analyzes source pixels with the selected reasoning model;
3. writes lossless role crops to transient storage;
4. executes 3 to 10 independent shots with bounded concurrency and one provider attempt per shot;
5. attaches the shot's deterministic text-free neutral-mannequin pose image and adapts all provider-neutral reference roles through the selected image provider;
6. publishes a progressive composite after every terminal shot result;
7. compares rendered shots with structured VLM assessment and optional NEX face similarity;
8. surfaces failed dimensions without automatically retrying or replacing pixels;
9. assembles one deterministic 3840x2560 PNG;
10. returns that PNG and its review trace to the normal image-settlement path;
11. clears transient objects on success, failure, or cancellation.

The default graph contains a detailed front face, a relaxed standing front body, and a natural walking profile body. Free-form prompt text can request 3 to 10 shots and prioritize belongings, expressions, back views, face angles, or action poses. Automatic paid and semantic retries are disabled. A failed shot remains visible as an unavailable cell while the runtime composes every successful shot; another attempt requires explicit user action and creates a preserved lineage variant.

Every durable media run can publish an extensible nested `items` tree with its progress payload. After preflight resolves onto the canvas, the owning branch lineage marker renders that tree inside its existing surface through `@lixpi/ui-kit`, below the reasoning stream. The API mirrors progress onto the marker and archives terminal progress there before removing a successful operation projection. Runs that do not publish domain-specific items receive a generic media timeline, so image, video, Capability, Skill, and Tool execution share one transparent progress surface without sharing hardcoded step names.

## Provider capability profiles

Synchronized image models carry `imageReferenceCapabilities`. The profile declares reference budgets, identity budgets, supported conditioning modes, fidelity behavior, iterative-edit and control support, output pixel limits, and aspect ratios.

Provider adapters consume this profile and the same ordered reference roles. They reserve identity evidence before optional style, structure, or pose controls and record which roles were included or omitted. A referenced-character plan fails before paid panel work when the selected model lacks identity conditioning.

## Lineage and settlement

`MediaBranchLineagePlanner` creates one assignment and pending Asset per concrete media run. It records reasoning and media model IDs, reference Asset IDs, branch topology, and the final output Asset ID before provider work begins.

Image and video publishers validate final bytes, store the organization-scoped Blob on the preassigned Asset, start rendition processing, attach the API-owned canvas node, publish the completion event, and materialize provenance. Capability strategies do not create separate output Assets.

Sibling matrix failures remain independent. A failed run detaches only its own pending output and rebalances API-owned canvas geometry without overwriting successful siblings.

## Cancellation and cleanup

Every provider and Capability-media run receives an `AbortSignal`. Cancellation stops active transient providers, cancels pending DAG nodes, settles unfinished planned Assets, drains conversation and projection writes, and releases the conversation lease.

Generated partials and Character Creator panel intermediates use organization-scoped transient Object Store entries. They never appear in durable conversation payloads or final Asset renditions and are deleted at terminal cleanup.

## Related pages

- [Image Generation](../media-generation/IMAGE-GENERATION.md)
- [Video Generation](../media-generation/VIDEO-GENERATION.md)
- [Branch Lineage](../media-generation/BRANCH-LINEAGE.md)
- [Character Creator](../library/CHARACTER-CREATOR.md)
- [Tools, Skills, and Capability Modules](../library/TOOLS-AND-SKILLS.md)
