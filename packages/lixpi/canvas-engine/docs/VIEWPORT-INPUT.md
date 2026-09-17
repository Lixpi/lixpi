---
title: Viewport Input
description: Native viewport gestures, engine input policy, synchronization and cleanup.
---

# Viewport input

`ViewportController` owns input for one sized canvas root. Its private `ViewportInput` uses native Pointer Events, wheel events and animation frames. Shared coordinate math has no DOM dependency. Node dragging, resizing, selection and connection gestures have separate engine owners.

## Coordinates and host state

`CanvasViewport` is `{ x, y, zoom }`; `CanvasTransform` is `[x, y, zoom]`. Translations are pane-local screen pixels. `paneToWorld` subtracts translation and divides by zoom. `worldToPane` scales a world point and adds translation. Client coordinates first subtract the root's bounding rectangle.

The controller rejects nonfinite translations and nonpositive or nonfinite zoom. `syncViewport` applies authoritative state without reporting a user transform. `setViewport` reports the applied transform and resolves to true, or resolves to false while locked or disposed. Programmatic transforms are not clamped to user zoom limits. An authoritative change rebases active contact anchors and interrupts animation; a synchronous echo of the current transform leaves animation running. `ViewportBridge` applies state to explicit DOM and renderer targets; host persistence stays outside the input adapter.

## Input policy

Defaults enable free wheel panning at speed 1, mouse/touch/pen dragging, pinch and double-click zoom. Ordinary wheel zoom is disabled. User scale limits default to 0.1 and 2. Panning has no coordinate extent.

Scroll-pan mode takes precedence unless `zoomActivationKeyPressed` is set. It normalizes line-mode deltas by 20 and maps Shift+wheel horizontally on non-Mac platforms, except in vertical-only mode. Ctrl+wheel uses anchored pinch zoom when enabled. Zoom deltas use `2 ** delta`, with factors 0.002 for pixel mode, 0.05 for line mode and 1 for page mode; Mac Ctrl+wheel adds a factor of 10.

`nowheel` protects nested scrollable content. Ctrl+wheel over that content prevents native page zoom while leaving the canvas transform unchanged. `nopan` excludes embedded content from drag input. In scroll-pan mode, wheel admission follows the separate scroll handler, so `nowheel` is the wheel exclusion. In zoom mode, `preventScrolling: false` leaves ordinary wheel input to native scrolling while permitting enabled pinch zoom.

One accepted pointer pans. Two touch contacts zoom around their midpoint; lifting or replacing a contact rebases the remaining anchors without moving the viewport. Mouse primary/middle buttons and pen primary contact are accepted; right-click and Ctrl-modified pointer presses are left alone. Unrelated pointer IDs cannot move an active gesture.

Double-click zoom doubles scale over 250ms using cubic easing and exponential scale interpolation around a fixed world anchor. Shift+double-click halves scale. Two short touch taps within 500ms and 10 pixels use the same animation. Compatibility double-clicks following touch are ignored to prevent duplicate zoom. `paneClickDistance` controls post-drag click suppression on the owning root; `selectionOnDrag` supplies an infinite threshold. `panOnDrag` is a boolean. `connectionInProgress` blocks non-wheel gestures, and `userSelectionActive` blocks input. The `lib` field is accepted for configuration compatibility and has no selector effect.

## Embedded content and touch policy

The root leases `touch-action: none` while drag input is enabled. This policy is installed before pointerdown, so the browser does not take over an accepted canvas drag or pinch. Disabling input or destroying its owner restores the supplied root's original inline value and priority.

`nopan` content receives no viewport pointer capture or selection suppression. A scrollable editor must have its own scroll container inside the canvas root, with normal touch behavior at and below that container. Browser panning checks stop at the nearest scroll container; placing `touch-action: auto` on an arbitrary child alone does not undo an ancestor restriction. The document and prompt editors supply their own scrolling containers. Native page pinch remains disabled under the canvas root. See the [Pointer Events direct-manipulation rules](https://www.w3.org/TR/pointerevents3/#determining-supported-direct-manipulation-behavior).

## Ownership and cancellation

Each `lock()` returns an independent release callback. The first lock cancels active input, and releasing one lease does not release another. Authoritative synchronization remains available while locked. Escape, blur, pointer cancellation and lost pointer capture also cancel input. A mouse or pen move with no pressed buttons cancels a gesture whose release happened outside the WebView.

Each instance owns its root handlers, contact map, capture, animation frame and short-lived click guard. Gesture move/up/cancel listeners use the supplied root document's window, including iframe roots. A document selection-style lease lasts for the accepted gesture and releases independently of other canvases. Cleanup removes exact listener references and releases captured pointers after clearing their contact records, so capture-loss events cannot restart cancellation.

Cancellation clears contact and tap state and cancels scheduled animation. Destruction also detaches root handlers and releases root styles. Constructor failure follows the same cleanup path. Reentrant host callbacks can lock or destroy input without leaving another animation frame scheduled.

## Desktop WebViews

Viewport calculations stay inside the WebView and use CSS pixels. A Tauri host configures page zoom and window behavior separately from canvas transforms; ordinary pointer movement does not need Rust IPC. Trackpad pinch uses the wheel path rather than synthetic touch contacts. The engine adds no platform-specific gesture fallback without evidence that a supported runtime needs it.

Automated DOM tests do not establish physical-device equivalence. A desktop host must verify its minimum WebView versions, trackpad/mouse/touch/pen input, page zoom conflicts, focus loss and mixed-DPI displays across its supported operating systems.

Event-driven tests cover native handlers, including concurrent canvas roots, authoritative synchronization, wheel modes, touch transitions, pointer cancellation, nested locks and interrupted double-click animation. See [rendering and lifecycle](RENDERING-ENGINE.md) for renderer synchronization and [connections](EDGES-AND-CONNECTIONS.md) for port input.
