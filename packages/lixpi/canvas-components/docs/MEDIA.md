---
title: Canvas media surfaces
description: Image registrations, native video and audio playback, source replacement and visibility.
---

# Canvas media surfaces

`ImageSurface`, `NativePlayback` and the registration factories consume engine drawing scopes and opaque media descriptors. They do not read application stores, construct Asset URLs or import UI-kit controls.

## Images

`createImageNodeRegistration` accepts any node type, geometry policy and `getMedia(node)` adapter. `ImageSurface` paints the image, rounded mask and optional placeholder through neutral resources. Configure radius, stretch/contain/cover fitting, progressive loading, minimum loading zoom and resolution explicitly.

The visible pixel footprint selects a rendition. A displayed higher-resolution rendition can satisfy smaller sizes; progressive loading can show a smaller image while an idle upgrade resolves. Replacement preserves the displayed image until new pixels arrive. Content identity combines key and version, so update the version when bytes change.

Culling releases active leases and cancels pending work, while retaining mesh allocations. The engine may keep idle textures under its cache limits. Failed rendition identities are remembered to avoid retrying on every visibility update; explicitly retry or change content identity when the source becomes available.

`onImageLoaded` reports media identity and intrinsic size. The host decides whether those dimensions should change persisted geometry; the image component does not write the scene.

## Native video and audio

`NativePlayback` creates an element under an explicit root. It resolves playback and poster sources independently, preserves an active source while its replacement resolves, and rejects late results after replacement or disposal. A queued play cannot activate a superseded source.

`createPlaybackNodeRegistration` combines that native element with an engine-drawn poster/placeholder. Its content adapter supplies the descriptor and explicit playback/poster rendition IDs. `onElement` exposes the native element to a host control bar; `onPlayback` exposes the player API. Both receive null when the registration is disposed.

Configure mute, loop, preload and cross-origin behavior for the host. `pauseWhenHidden` controls whether culling pauses playback. Poster image leases are released when hidden regardless of that setting. `isImageVisible` can hide pending artwork without destroying the player.

Native controls or a separate UI library can drive the element. The component does not require a canvas-specific toolbar. Playback position, speed and volume remain native element state unless a host explicitly persists them.

The native element remains browser-composited. The engine draws stable poster geometry without a live Pixi video-texture loop. GPU captures therefore do not include native playback frames.

## Sources and teardown

The engine resolver returns sources and release callbacks. Native media URLs must work without custom request headers; an authenticated host can supply signed URLs or owned object URLs. Revoke an owned object URL only through its release callback, after the player releases its source.

Dispose registrations, controls and content slots with their canvas owner. Destroying the player pauses it, removes listeners and elements, releases source leases and prevents late callbacks from remounting content.

The [media-board example](../examples/media-board.ts) supplies URLs, mounts a caller-owned editor, uses browser video controls and mounts two independent canvases with different viewport/effect settings. Import engine structural styles in the host; no package build or service alias is required.

[Engine media resources](../../canvas-engine/docs/IMAGE-RENDERING-PERFORMANCE.md) covers cache, worker and texture lifetimes.
