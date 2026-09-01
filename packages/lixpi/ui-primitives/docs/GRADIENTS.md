---
title: Gradients and animation
description: Freeform bitmap gradients, SVG stops, shifting backgrounds and shared easing.
---

# Gradients and animation

UI Primitives owns reusable color sampling, gradient generation, SVG utilities and timing. These utilities work without a canvas engine. Product palettes are supplied by callers; static CSS backgrounds remain with their component styles.

## Rendering families

| API | Output |
|---|---|
| `FreeformGradientRenderer` | Four-anchor bitmap sampling, color parsing and canvas drawing |
| `ShiftingGradientRenderer` | Instance-owned subscriptions, phase animation and optional patterns |
| `SvgGradientRenderer` | Linear/repeating stops and rotating SVG gradient endpoints |
| `Easing` | Cubic-bezier evaluation and shared hover, shifting and traveling timing |

Import gradients from `@lixpi/ui-primitives/gradients` and timing from `/animation`. Canvas glass and traveling-outline resource composition belongs to [Canvas Components](../../canvas-components/docs/EFFECTS.md); icons remain in UI-kit.

## Freeform bitmap algorithm

The renderer samples four colors on a small 60 by 80 bitmap, then scales it to the destination with smoothing. It normalizes each pixel coordinate, applies swirl distortion, computes distance to each color anchor and blends with the bounded weight `max(0, 0.9 - distance)^4`.

Eight phase positions place the four anchors around the surface. Phase changes interpolate their positions. The swirl rotates a coordinate around the center by an angle derived from `(distance * 0.35)^2 * 0.8 * 8.0`, so outer pixels rotate more than central ones.

Exactly four colors are required. Pass the exported color tuple shape instead of an arbitrary-length array. Hex colors are parsed into RGB before sampling. The renderer does not automatically brighten a dark palette.

Small bitmap generation limits pixel work, but neither a fixed frame rate nor a CPU budget is guaranteed. Large destination canvases, several independent instances and pattern images still incur browser drawing costs.

## Instance ownership and phase changes

A background owns a renderer unless the caller explicitly supplies one. Equal palettes do not imply shared state. To synchronize several backgrounds and share bitmap work, pass the same renderer and keep its lifetime in a common owner.

`subscribe(canvas)` registers a destination and draws immediately; `unsubscribe(canvas)` releases that subscriber. Visibility controls whether it receives updates. The background wrapper observes intersection, and explicit users can call `setVisibility`. `nextPhase()` starts the next transition, using the shared shifting curve and the renderer's transition duration.

The renderer keeps its bitmap visible during CSS resize and redraws immediately after a backing-store resize. Destroying one background must not dispose a renderer borrowed by another. Destroying the renderer cancels animation and pending pattern loads.

## SVG gradients and easing

Use `appendLinearGradientStops` for ordinary stops, `appendRepeatingLinearGradientStops` for looping borders and `startRotatingLinearGradient` for rotating endpoints. The caller owns the SVG element and disposes its animation.

`Easing.hoverTransition()` uses the hover curve, `shiftingGradientTransition()` uses the phase curve, and `travelingOutlineTransition()` provides a periodic pace change without a lap-boundary stall. Sass transitions are exported through `@lixpi/ui-primitives/styles/transitions`; reuse those helpers for hover timing.

SVG utility functions manipulate shapes, IDs and generic path geometry. They do not own icon artwork.

## Patterns and styling

Patterns draw after the gradient with configurable alpha, blend mode, tint and scale. The renderer cancels obsolete pattern loads; a completed image cannot attach after disposal.

Position the destination canvas within a caller-owned container, below its interactive content. Border radius, stacking, opacity and product overlays belong to that component's stylesheet. Plain CSS fills, dropdown highlights and theme backgrounds should not be routed through a bitmap renderer merely to reuse a color.

## Troubleshooting

| Symptom | Check |
|---|---|
| Banded or blocky gradient | Destination smoothing, backing-store size and source palette |
| No animation | Subscription, visibility and phase trigger |
| Same palette but different phases | Independent renderer instances are intentional; share explicitly if required |
| Reference colors appear too dark | Foreground content, source lightness and additional CSS overlays |
| Removed background still updates | Subscriber disposal and ownership of a shared renderer |

[Color analysis](COLOR-ANALYSIS.md) explains reference-image fitting and the limits of the standalone numeric tool.
