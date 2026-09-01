---
title: Rendering Resources
description: Drawing scopes, coordinate spaces, resource ownership, material bindings and capture lifetimes.
---

# Rendering Resources

Import `CanvasRenderer` from `@lixpi/canvas-engine/frontend/rendering`. Supply a DOM root, error callback and optional media resolver. `ready` resolves to a boolean; disposing during initialization prevents a late canvas mount. `invalidate()` schedules a frame and `renderNow()` requests immediate drawing when ready. `beforeRender` runs before capture refresh and screen drawing, so a caller can update DOM-derived effect bounds without a global selector or renderer-specific callback.

## Scopes and layers

Each renderer owns three ordered layers: connectors, media, then foreground. Each layer contains world-space and screen-space groups, in that order. World groups receive the viewport translation and uniform zoom; screen groups retain pixel coordinates. `updateGroup` adds local translation, scale, rotation and sibling order. Children inherit their parent transform.

Create a scope for a component or effect. Its `resources` allocate opaque handles; callers never receive backend objects. Handles belong to one renderer and cannot be transferred between renderers. A scope can sample borrowed textures and capture borrowed layers, but it cannot mutate or release another scope's allocations. Releasing a parent releases its descendants. Release an independently allocated texture or material only after its consumers stop using it.

`requestFrame` invokes its subscriber with elapsed milliseconds, starting with zero, and returns an unsubscribe function. The scope removes subscriptions, cancels media requests and releases allocations when destroyed. Observe its abort signal for component-owned timers, observers, listeners and DOM. Register cleanup as each operation succeeds so a partial mount can be unwound. A scene owns its node scopes; destroying a scene leaves its borrowed renderer available until the host disposes it.

## Paths, meshes and textures

Paths accept SVG path data, fills, strokes and optional holes. Stroke widths use the group's coordinate space. `projection` applies uniform scale and translation to path coordinates without scaling the stroke; `snapResolution` optionally rounds coordinates to device pixels. Dash arrays contain positive lengths in the resulting path space. Curve dashes use tessellated path lengths, continue across segments and restart at subpaths.

`ConnectorRenderer` accepts path geometry and endpoint markers. Callers supply marker path artwork, its width and its reference point. The renderer projects into screen space and applies bounded zoom scaling to strokes and marker size. It retains hidden connectors and marker allocations for reuse until disposal. `RectangleOverlay` draws world-space selection or marquee geometry with a screen-sized border and corner radius. Its colors come from the caller.

Meshes contain paired `Float32Array` positions and UVs, triangle indices in a `Uint32Array`, and a caller version. The engine validates array dimensions and finite values and copies submitted arrays. UVs address the selected texture or material. A null paint hides the mesh while retaining its geometry. Changing paint does not transfer texture or material ownership.

Textures accept straight-alpha RGBA bytes with explicit dimensions, or a browser image/canvas source. The backend premultiplies its own upload copy. It does not change the caller's RGBA data. Image bitmaps supplied by a caller remain caller-owned; decoded media bitmaps belong to the media service until their texture is retired. Optional mipmaps support reduced-size image rendering.

## Material shader contract

`MaterialProgram.abi` is `canvas-material-v1`. Supply both GLSL and WGSL vertex/fragment source. Vertex attributes are `aPosition` and `aUV`, each two floats. WGSL entry points are `mainVertex` and `mainFragment`; use attribute locations 0 and 1 for position and UV. The engine supplies a column-major `mat3` named `canvas_transform` that maps local position to clip space, including viewport and capture transforms. In WGSL it occupies `@group(0) @binding(0)` as `mat3x3<f32>`; in GLSL declare `uniform mat3 canvas_transform`.

Component resources occupy WGSL group 1. Each declared uniform has its own binding, with the exact name, binding number and scalar/vector/matrix type from `MaterialBinding`. Supported uniform types are `f32`, `vec2f`, `vec3f`, `vec4f`, `mat3f` and `mat4f`. Float arrays must have the corresponding element count and contain finite values. GLSL declares uniforms with the same names.

A texture binding declares a `texture_2d<f32>` using its name and binding number, plus a sampler named `<name>_sampler` at `samplerBinding`. GLSL uses a `sampler2D` under the texture's name. Names and binding slots must be unique. Only the declared resources and engine transform may appear in WGSL bindings. `updateMaterial` changes values, textures and sampling while preserving the binding layout and types. Texture handles are borrowed and must outlive their use by the material. Shader outputs must use the renderer's premultiplied-alpha convention.

See the [material validation and lifecycle tests](../src/frontend/rendering/pixi-material-resource.test.ts) for complete source examples. These tests verify declared bindings and resource behavior; they do not compile shaders on a GPU or verify rendered pixels.

## Captures and disposal

A capture lists included layers/groups, excluded output groups, a coordinate space and bounds. Declare the effect's own output in `exclude` to avoid feedback. The backend orders captures by dependencies and rejects cycles. `sampleBounds` limits invalidation to the rectangles actually sampled; include displacement/filter margins. `enabled: false` pauses refresh while keeping the capture texture allocated. Enabling it requests fresh content before dependent drawing.

`displace` samples a capture through a displacement texture and returns a disposer for that attachment. Captures and displacement inputs retain stable handles across bounds changes. Dispose the effect attachment before releasing its sampled resources, or let the owning scope dispose them together.

Released drawing objects detach immediately. The backend retires GPU storage after submitted work has finished, and stages mutable mesh geometry separately from submitted buffers. WebGPU buffer retirement applies to records owned by that renderer; it does not patch native global prototypes. Keep component lifetime decisions above this boundary and leave physical GPU destruction to the engine.
