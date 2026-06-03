---
title: Lixpi Documentation
description: Map of the Lixpi documentation — product, platform, canvas, AI chat, media generation, and the feature library.
---

# Lixpi Documentation

Lixpi is a visual, node-based AI workspace for image and video generation pipelines — **the spatial arrangement of nodes _is_ the workflow**. This is the documentation map. Start with the [Product Overview](PRODUCT-OVERVIEW.md), then dive into the domain you care about.

{% callout type="note" %}
These docs are authored as Markdoc-friendly Markdown and render to a static HTML site via a standalone, single-dependency renderer in [`site/`](site/README.md). They also read fine as plain Markdown on GitHub.
{% /callout %}

## Start here

| Page | What it covers |
|------|----------------|
| [Product Overview](PRODUCT-OVERVIEW.md) | The product thesis: canvas primitives, artifact piping, character consistency, the image/video pipelines, multi-model support |
| [System Architecture](platform/SYSTEM-ARCHITECTURE.md) | Services, the NATS backbone, subject naming, key design decisions, horizontal scaling |
| [Development](platform/DEVELOPMENT.md) | Local dev quick start: env wizard, infrastructure init, running services |

## Platform

The cross-cutting spine. Every feature references these instead of re-explaining them.

| Page | What it covers |
|------|----------------|
| [System Architecture](platform/SYSTEM-ARCHITECTURE.md) | Service responsibilities, NATS as the backbone, subject conventions, design decisions, scaling |
| [AI Generation Pipeline](platform/AI-GENERATION-PIPELINE.md) | The shared LangGraph workflow, `ProviderState`, the post-stream 3-way router, dual-model routing, tool injection/extraction, `ImageRouter`/`VideoRouter`, stream lifecycle, usage |
| [Streaming & Events](platform/STREAMING-AND-EVENTS.md) | The per-thread `receiveMessage` subject and the full stream-event catalog; the browser parse → insert path |
| [Authentication](platform/AUTHENTICATION.md) | Dual auth model, NATS auth callout, `@lixpi/auth-service`, LocalAuth0 |
| [Infrastructure Overview](platform/deployment/INFRASTRUCTURE-OVERVIEW.md) | Pulumi, AWS topology, network, ECS `api`, web-ui delivery, DynamoDB |
| [NATS Cluster](platform/deployment/NATS-CLUSTER.md) | NATS on Fargate, CloudMap discovery, the Route53 sidecar, Caddy-in-Lambda TLS, the auth-callout boundary |
| [Scaling & Operations](platform/deployment/SCALING-AND-OPERATIONS.md) | Scaling profile, capacity ceilings, failure modes, environments, observability |

## Canvas

The infinite workspace surface: data model, interaction, and the DOM/PIXI renderer.

| Page | What it covers |
|------|----------------|
| [Workspace Model](canvas/WORKSPACE-MODEL.md) | Core concepts, the `CanvasState`/`CanvasNode`/`WorkspaceEdge` data model, stores, NATS subjects, HTTP endpoints, persistence, media lifecycle, lazy loading |
| [User Flows](canvas/USER-FLOWS.md) | Opening a workspace, creating documents, adding/saving/deleting/moving/editing media |
| [Edges & Connections](canvas/EDGES-AND-CONNECTIONS.md) | `WorkspaceConnectionManager`, proximity connect, routing, handles, selection/deletion/persistence |
| [Rendering Engine](canvas/RENDERING-ENGINE.md) | DOM/PIXI ownership split, layer stack, viewport bridge, sync pipeline, config ownership, file map |
| [Image Rendering Performance](canvas/IMAGE-RENDERING-PERFORMANCE.md) | LoD tiers, texture cache, decode pool, mipmaps, edge renderer, optimizations, known issues, tuning constants |
| [Collision Resolution](canvas/COLLISION-RESOLUTION.md) | The geometry-agnostic resolver, when it runs, parent/child rules, invariants |
| [Visual Effects](canvas/VISUAL-EFFECTS.md) | Gradient rendering families, shared easing, the shifting background, the color-analysis tool |

## AI Chat & Context

| Page | What it covers |
|------|----------------|
| [Chat Panel & Sessions](ai-chat/CHAT-PANEL-AND-SESSIONS.md) | The workspace-owned AI chat panel, standalone chats, tabs, Sessions, extraction sessions, persistence |
| [Context Relevance](ai-chat/CONTEXT-RELEVANCE.md) | Descriptor-first workspace relevance, the resolver, explicit/auto chips, data contracts, context-region removal |
| [Media & Content Descriptors](ai-chat/MEDIA-DESCRIPTORS.md) | The `ContentDescriptor` shape, sourcing paths, self-heal, the canvas indicator |

## Media Generation

| Page | What it covers |
|------|----------------|
| [Image Generation](media-generation/IMAGE-GENERATION.md) | The `generate_image` tool, provider paths (Image API / Responses API / Gemini native), sizes, image events |
| [Video Generation](media-generation/VIDEO-GENERATION.md) | VEO submit/poll, the `generate_video` tool, the VEO provider, storage/durability, video events, the video node, model sync, usage, extension |
| [Branch Lineage & Provenance](media-generation/BRANCH-LINEAGE.md) | The structured VLM resolver, candidate snapshot, persisted metadata, placement rules, branch-origin circles, references-vs-lineage |
| [Video Player Controls](media-generation/VIDEO-PLAYER-CONTROLS.md) | The shared SVG control bar, two mount points, scrubbing, accessibility |

## Library

| Page | What it covers |
|------|----------------|
| [Feature Extraction — Overview](library/FEATURE-EXTRACTION-OVERVIEW.md) | The feature primitive, why it exists, design principles, the field model, examples |
| [Extraction Pipeline](library/EXTRACTION-PIPELINE.md) | The six-stage LangGraph, research foundations, modular extractors, dominance-weighted synthesis, tracing |
| [Anti-Leakage](library/ANTI-LEAKAGE.md) | Content-free pixel cropping, why it beats text-only, sample QA, the v2 escalation path |
| [Using Features](library/USING-FEATURES.md) | Entry points (Ask AI / natural language / `/extract`), applying features via `/use`, scope & sharing |
| [Feature Storage](library/FEATURE-STORAGE.md) | DDB tables, object-store layout, NATS subjects, the `resolveFeatures` pre-stage, the dedicated extraction graph, known limitations |
| [Media Library](library/MEDIA-LIBRARY.md) | The saved-media panel, saved images/videos, scopes, ownership, URL import, data model, service surface |
| [Workspace Export & Import](library/WORKSPACE-EXPORT-IMPORT.md) | ZIP export and the validate-wipe-replace import |

## Conventions & deep dives

| Page | What it covers |
|------|----------------|
| [Markdown Rendering](conventions/MARKDOWN-RENDERING.md) | The one-parser rule and the two renderers |
| [Rendering Architecture for a Media-Heavy Canvas](knowledge/RENDERING-ARCHITECTURE-FOR-MEDIA-HEAVY-CANVAS.md) | Why the DOM/PIXI split; what the leading canvases use |
| [Why Model Combinations Produce Different Styles](knowledge/WHY-DIFFERENT-MODEL-COMBINATIONS-PRODUCE-DIFFERENT-STYLES.md) | Model chaining and visual signatures |
| [Internal Service NATS Auth Pattern](knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md) | NKey-signed service auth recipe |

## Building these docs

The docs render to HTML with a zero-framework Markdoc renderer. See [`site/README.md`](site/README.md). Everything runs in Docker — never on the host.
