---
title: Canvas effects
description: Glass refraction, traveling outlines, material pixels and effect lifetime.
---

# Canvas effects

Glass and traveling outlines compose the engine's generic drawing API. Their geometry, material shading, animation and appearance belong here. The engine allocates resources, orders captures and retires GPU storage. Generic gradients and easing belong to [UI Primitives](../../ui-primitives/docs/GRADIENTS.md).

## Traveling outlines

Import `TravelingOutline` from `@lixpi/canvas-components/effects/outline`. Supply a drawing scope, texture pixels and `TravelingOutlineStyle`. Synchronize datums with stable IDs, bounds, radius and visibility. A datum can override direction, duration and snake length.

The effect samples a rounded perimeter into a continuous tapered strip with a rounded head and thin tail. Geometry buffers are reused, and the engine stages updates before upload. Material pixels provide the colored glass highlight/shadow treatment; the effect is not tied to generated images or a particular palette.

Motion uses the loop-safe traveling-outline easing by default. A caller can supply another easing function and stroke scale. Circular placeholders can scale duration to perimeter to retain a similar path speed as a larger rectangle. Node state and that duration choice belong to the consumer.

Hidden datums retain allocations for reuse. The frame subscription stops when no active visible outline remains. Destroying the effect or its scope releases animation and resources without stopping another effect.

## Glass borders

Import `GlassBorder` and material bakers from `@lixpi/canvas-components/effects/glass`. A border receives screen-space rectangles, source layers/groups, material pixels and appearance settings. It does not discover application elements.

The effect creates a rounded ring mask, a stable displacement texture, a capture and a closed material strip. Neutral displacement pixels are centered at 128/128. The normal map bends sampled pixels near each target border; the material adds highlights and shadow without replacing the captured content with an opaque stroke.

The capture excludes the effect's own output to avoid feedback. Sample bounds include relevant target regions and displacement margins, so unrelated scene changes do not refresh it. Texture handles remain stable across size changes. This matters because backend filter bindings may retain references across frames.

`DomGlassBorder` adds explicit DOM target measurement relative to a supplied root. It observes target/root resizing and caches radii. Callers provide element references; it performs no document-wide selector discovery.

Glass samples engine-rendered content only: images, paths, connectors and other included resource groups. DOM text, editors and native video frames are not in that capture. Use ordinary DOM/CSS treatments for controls that do not need engine refraction.

## Material baking

The glass module provides traveling-strip, closed-strip and circular material bakers. `bake()` returns straight-alpha RGBA pixels for an engine texture and does not require a GPU. Circular bakers also support a DOM data URL through a canvas 2D context.

Pass colors and coefficients as configuration. Do not copy the shading math into a product component. The engine normalizes alpha for upload without changing caller pixels.

## Loading surface

`LoadingOverlay` owns a drawing surface, outline, resize observation, error text and retry action. Supply labels, dimensions and callbacks, then import `@lixpi/canvas-components/styles/loading-overlay`. Its custom properties cover text and retry colors, and the stylesheet handles reduced transparency.

Disposal during renderer initialization prevents a late canvas from mounting. Hide/clear state through its public API and destroy it with the enclosing view.

## Custom effects

A custom `CanvasExtension` receives a drawing context and returns a disposer. Allocate resources in that context, subscribe through `requestFrame`, and declare captures through the generic API. The [media-board example](../examples/media-board.ts) includes a custom animated path without importing Pixi.

[Rendering resources](../../canvas-engine/docs/RENDERING-RESOURCES.md) defines paths, masks, pixels, meshes, materials, captures, frame callbacks and resource ownership. Tests cover geometry and lifetimes; they do not prove GPU visual output.
