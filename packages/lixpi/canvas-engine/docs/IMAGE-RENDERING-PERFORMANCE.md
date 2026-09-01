---
title: Media resources and performance
description: Rendition selection, image decoding, texture leases, idle work and resource retirement.
---

# Media resources and performance

The engine owns image decoding and GPU texture lifetimes. Components decide when to request an image; a host resolver maps opaque media descriptors to sources. The cache does not require Asset IDs, application URLs or an authentication service.

## Descriptors and renditions

A `MediaDescriptor` contains a key, content version, kind, optional dimensions and named renditions with MIME types and optional sizes. A source resolver receives the descriptor, selected rendition ID and abort signal, then returns a URL, optional request headers/credentials and a release callback.

Use a distinct rendition for distinct bytes. Adding a cosmetic size query parameter that still returns the original payload does not reduce decoding or network work. A host is responsible for listing available renditions and materializing them before advertising them as ready.

Image acquisition selects a rendition for the visible pixel footprint. A cached larger rendition can satisfy a smaller request. Progressive preview selection and visibility policy belong to the [image component](../../canvas-components/docs/MEDIA.md); there is no fixed product zoom-tier table in the engine.

## Leases and caching

Drawing scopes expose `media.acquireImage` and `media.acquirePlayback`. Image interests share decoding and cached textures by content key, version and rendition. Cancelling one interest leaves other owners intact. Content version changes prevent stale data reuse.

An image lease contains a texture handle, intrinsic size, rendition ID and release function. Release it when the component no longer uses the texture. Cache limits count textures and estimated bytes; eviction targets idle entries and preserves live leases. Limits are pressure targets, not permission to invalidate an active component's resource.

Native playback resolves to a URL usable by a browser media element. Custom request headers cannot be attached to native video/audio requests; the resolver must supply an appropriate URL or fetch/release an owned object URL. Source cleanup is explicit.

Decoded bitmaps remain alive until the corresponding texture can retire safely. GPU mipmaps support smaller projected sizes without fetching a lower-resolution texture solely because of zoom-out. Do not infer actual VRAM consumption or frame rate from the cache byte estimate.

## Decode workers

`ImageDecoder` lazily creates its own bounded worker pool, with a default maximum of six. Requests are assigned round-robin. The worker fetches with supplied options, calls `createImageBitmap`, transfers the result and closes cancelled or obsolete bitmaps.

An aborted request rejects independently. A failed worker rejects affected requests and can be replaced. Destroying the decoder rejects outstanding work and terminates only its own workers.

The default worker URL resolves `image-decode-worker.ts` relative to the decoder module. Consumers must support TypeScript worker imports in their toolchain. Supply `workerFactory` through renderer decoder options when worker hosting, CSP or URL conventions differ. The source export package includes the worker; it has no application alias.

## Visibility and idle work

`CanvasScene` maintains spatial measurements and calls registered views with their visibility state. Configure `visibilityMargin` in world units to load just beyond the viewport. Configure `prefetchBatchSize` to enable distance-ordered idle prefetch; zero disables it.

Components can release live leases when culled while leaving idle textures available for reuse. This separates memory pressure from visual ownership. Progressive upgrades should preserve an already displayed preview until its replacement is ready. Cancelled or superseded replies must be released rather than attached to a replacement scene.

Rendering is invalidation-driven with a stopped automatic ticker. Active effects subscribe through `requestFrame`; a removed effect stops its own subscription. Connector resource signatures avoid repainting unchanged paths. [Rendering resources](RENDERING-RESOURCES.md) explains staging, capture invalidation and GPU retirement.

## Tuning and limits

| Option | Tradeoff |
|---|---|
| `visibilityMargin` | Earlier loading during pan versus more active requests |
| `prefetchBatchSize` | Warmer offscreen content versus background decoding |
| `mediaCache.maxTextures/maxBytes` | Idle reuse versus retained memory |
| `decoder.maxWorkers` | Decode concurrency versus worker and network pressure |
| Renderer `resolution` | Pixel density versus fill rate and render texture size |

Worker requests are not priority scheduled. Large scenes can make background work compete with visible requests, so tune prefetch together with decode concurrency. The engine does not perform application-specific authentication caching or infer network health. Retry policy belongs to the requesting component/host; inspect failed rendition identity before retrying.

Tests cover selection, shared interests, cancellation, worker failures, cache eviction, bitmap disposal and staged resource retirement. They do not establish GPU memory budgets, shader output or browser frame-rate guarantees.
