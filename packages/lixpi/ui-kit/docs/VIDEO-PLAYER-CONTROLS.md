---
title: Video player controls
description: Generic SVG controls for a supplied native video element.
---

# Video player controls

`createVideoControls(parent, config)` mounts a D3 SVG control bar for a supplied `HTMLVideoElement`. It does not render frames or depend on a canvas package. The native element is the playback state authority. Import the component from `@lixpi/ui-kit/components/video-controls`.

## Control Set

| Control | Behavior |
|---------|----------|
| Play / pause | Calls `videoEl.play()` or `videoEl.pause()` and reflects `play` / `pause` events |
| Current time / duration | Renders `m:ss`; duration stays `0:00` until metadata is loaded |
| Scrubber | Shows buffered and played ranges; dragging seeks the element |
| Playback speed | Speed value plus continuous slider writes `playbackRate`; double-click resets to the configured default rate, and configured guide ticks are visual references only |
| Volume / mute | Toggles `muted`; slider writes `volume` and reflects `volumechange` |
| Fullscreen | Uses `requestFullscreen()` / `exitFullscreen()` when supported |

The layout is responsive. Controls stay present while the seek, speed, and volume rails absorb tight widths by shrinking.

## Component API

```typescript
export type VideoControlsConfig = {
    icons: VideoControlIcons
    settings?: VideoControlsSettings
    id: string
    x: number
    y: number
    width: number
    height?: number
    responsiveWidth?: number
    videoEl: HTMLVideoElement
    className?: string
}

export type VideoControlsInstance = {
    render: () => void
    resize: (x: number, y: number, width: number, responsiveWidth?: number) => void
    destroy: () => void
}
```

`render()` re-syncs SVG state from the element. `resize()` updates bar geometry after canvas node resize or chat player resize. `responsiveWidth` lets hosts scale the SVG viewBox for canvas zoom or chat sizing while keeping responsive sizing decisions tied to the visible row width. `destroy()` removes SVG nodes, media listeners, document listeners, pointer listeners, and in-flight scrub handlers.

Pass the six play, pause, volume and fullscreen glyphs through `icons`; UI-kit keeps their artwork. Optional `settings` override the package defaults from [settings.ts](../src/components/videoControls/settings.ts). The speed default controls double-click reset, the guide rate controls the slider midpoint, and guide rates control reference ticks. Resizing never replaces the media element.

## Scrubbing Behavior

Scrubbing is designed to keep paused frames responsive:

1. Pointer down on the scrubber records whether playback was active.
2. If the video was playing, the control pauses it for the drag.
3. Drag movement updates a preview time and queues `videoEl.currentTime`.
4. Only one seek is kept in flight; later drag targets are applied after the current seek settles.
5. `seeked` / `loadeddata` or a short failsafe timer advances the queue.
6. On release, the final target is applied and playback resumes only if the video had been playing before the drag.

This avoids piling many seeks onto short clips while still making paused scrubbing feel immediate.

## Accessibility and Capability Handling

Buttons are SVG groups with `role="button"`, `tabindex="0"`, and `aria-label`s. Enter and Space activate button controls. The speed control is an SVG slider with `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext`; arrow keys adjust by the configured keyboard step, while Home and End jump to the configured range bounds.

Fullscreen controls are gated by browser support:

- fullscreen requires `videoEl.requestFullscreen` and `document.exitFullscreen`

If fullscreen support is missing, the fullscreen action returns without changing layout. Failures from `play()`, fullscreen, or resume-after-scrub are logged as warnings without breaking the rest of the bar.

## Host integration

The caller owns video mounting, source authorization, layout and any persistence. Playback position, speed, volume and scrubbing are ephemeral by default. Canvas and chat hosts can use the same control bar without sharing a renderer or control instance.

The bar writes SVG attributes and exposes host style properties through `applyVideoControlsHostStyleProperties`. Keep the SVG viewport and responsive width synchronized with the visible row. Actual control hit areas isolate their pointer input; a canvas host decides whether empty row space should pan or select.

Destroy the controls before releasing the borrowed video element. Destruction removes SVG nodes, media/document listeners and in-flight scrub handlers. It does not own an Asset, transport subscription or canvas session.

The [Lixpi workspace integration](../../canvas-components-lixpi-specific/docs/WORKSPACE.md) places controls below browser-composited canvas videos. Other consumers can mount them below any native video surface.
