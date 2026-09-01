---
title: Canvas rendering and lifecycle
description: Scene ownership, DOM and GPU layers, interaction, reconciliation and disposal.
---

# Canvas rendering and lifecycle

The engine combines DOM interaction with a private Pixi renderer. DOM content supports text, editors and native media; drawing resources support images, paths, meshes and effects. The public API exposes no Pixi objects or types. A node registration supplies its own content and appearance.

## Mounting and state

Import `CanvasController` and `NodeRegistry` from `@lixpi/canvas-engine/frontend/runtime`, and `@lixpi/canvas-engine/styles/interaction` for structural positioning. Mount into a positioned element with an explicit size. The [engine-only example](../examples/engine-only.ts) registers two custom boxes, named ports and a connector without any component or application package.

A `SceneSnapshot` contains a scene key, revision, nodes and edges. Each node has an open type, opaque data, dimensions, position, optional parent and named ports. The engine validates identities, finite geometry, parent cycles and edge endpoints before applying a snapshot. Shared contracts and geometry are available from the root and `/shared` without initializing browser code.

The host owns authoritative state. Geometry, connect, reconnect, delete and viewport intents report user actions; accept them into host state and call `setScene` or `setViewport`. Geometry changes preserve component payloads and parent-relative storage. Do not persist transient drag overrides as a second authoritative scene.

`NodeRegistry` maps a type to a geometry policy and a mount function. The returned view implements update, geometry, visibility, selection and disposal. A type replacement disposes the old view before mounting its replacement. Unknown types produce diagnostics and a neutral fallback instead of importing application components.

## Layers and coordinates

`CanvasScene` owns a transformed world DOM root and a screen overlay root. Registered content mounts beneath node-owned roots; effects may mount overlays explicitly in world or screen space. Drawing resources provide media, connector and foreground layers. [Rendering resources](RENDERING-RESOURCES.md) defines their order, masks, captures and materials.

World coordinates describe the scene before pan/zoom. Screen coordinates describe pixels relative to the canvas pane. Parent positions are stored relative to their parent; measurements receive resolved world geometry. A geometry policy reports separate visual, hit, selection, collision and connector bounds, because painted pixels and interaction footprints need not match.

`ViewportController` owns input on the supplied root. `ViewportBridge` applies one transform to explicit DOM roots and neutral renderer targets. A pan/zoom callback updates live rendering immediately; a delayed persistence acknowledgment must not overwrite that live transform. The shared viewport reconciliation helpers allow a host to preserve live state while accepting unrelated authoritative changes.

Zoom helpers distinguish world sizes from screen sizes. World-size callers compensate before the viewport transform; screen-space drawing compensates once after projecting points. Adaptive bounded scaling keeps configured size at normal zoom and progressively shrinks controls at lower zoom. Applying both conversions to the same size doubles the compensation.

## Input and collision geometry

The controller composes viewport, selection, marquee, keyboard, node transforms and optional connectors. Set `interaction: false` when supplying custom input. Editable DOM content and handled events remain outside keyboard deletion; instance ownership prevents a key press from deleting another canvas's selection.

A gesture owns its document listeners, cursor lease, geometry overrides and input lock. Escape, blur, pointer cancellation, source removal, scene replacement and disposal cancel without committing. Ending one gesture releases only its own overrides and lock. An underlying component projection remains visible after a higher-priority drag override ends.

Single and group dragging use measured world geometry. The geometry intent converts results back to parent-relative positions. Resize policies supply minimum/maximum sizes and aspect constraints. The optional `collisions` configuration resolves measured footprints at commit; [collision resolution](COLLISION-RESOLUTION.md) explains fixed boxes, containment and rigid groups. [Connectors](EDGES-AND-CONNECTIONS.md) covers named ports, routing and hit testing.

## Reconciliation and scheduling

Scene reconciliation updates registered views and their measurements. The spatial index determines visibility using the viewport and optional margin. Visible views request media; optional idle prefetch works in bounded batches. Viewport changes update geometry and visibility without requiring application data reconstruction.

The Pixi automatic ticker is stopped. Resource invalidation and active `requestFrame` subscriptions schedule drawing. Multiple requests coalesce into a frame. A frame subscription receives elapsed milliseconds, starting at zero, and returns a disposer. An idle renderer with no invalidation or animation does not need a continuous ticker.

Capture dependencies declare which layers and groups they sample, their bounds and excluded outputs. The engine orders captures before dependent drawing and rejects feedback cycles. Content movement invalidates both old and new bounds; excluded output and changes outside sampled bounds do not cause unnecessary recapture. Capture textures retain handle identity across resizing.

These contracts support component effects without naming glass or outlines in the engine. Browser DOM and native video pixels are outside a GPU capture. Do not expect a canvas capture to behave like a CSS backdrop filter.

## Media and failure handling

A host supplies `mediaResolver` to map descriptors and rendition IDs to URLs, request options and release callbacks. The engine never constructs an Asset URL or reads credentials. Image textures use [media leases, cancellation and caching](IMAGE-RENDERING-PERFORMANCE.md). Native playback belongs to a registered component, not a Pixi video-texture loop.

`CanvasRenderer.ready` resolves initialization success. Its owner reports initialization errors and tears down failed construction; no alternate DOM image renderer is installed. A caller can choose the rendering backend preference and resolution through renderer options.

A drawing scope owns its abort signal, frame subscriptions and allocated resources. It may sample borrowed textures/layers but cannot mutate or release another scope's allocations. Destruction detaches resources immediately and retires physical GPU storage after submitted work finishes. Mesh arrays are staged in backend buffers; caller mutation does not race a GPU upload. The private backend does not patch native GPUBuffer prototypes.

Destroy the controller when unmounting. Disposing one canvas must not terminate another canvas's workers, subscriptions, media or gestures. Host persistence may outlive the rendered view; keep accepted writes in a separate host/session owner.

## Configuration and verification

Neutral interaction/rendering options belong to the engine instance. Geometry and appearance belong to the node registration or effect. Application themes and product presets are supplied by consumers; there is no required application settings module.

The [XYFlow reference](xyflow/overview.md) documents the low-level dependency. Consumers normally use engine contracts rather than its internal node representation.

Colocated tests exercise scene reconciliation, geometry, input cancellation, captures, media leases and failure cleanup. Renderer tests use controlled backends; they do not establish shader compilation, GPU appearance or browser playback behavior.
