# Canvas Engine

[Rendering and lifecycle](docs/RENDERING-ENGINE.md), [connections](docs/EDGES-AND-CONNECTIONS.md), [collisions](docs/COLLISION-RESOLUTION.md), [media resources](docs/IMAGE-RENDERING-PERFORMANCE.md), and [XYFlow integration](docs/xyflow/overview.md) document the engine. [Engine-only example](examples/engine-only.ts) uses public exports. See [license and dependency notices](NOTICES.md).

`@lixpi/canvas-engine` supplies generic scene geometry, collisions, layout, connectors and browser rendering. Component data is opaque to the engine. It does not depend on Lixpi Assets, generation requests, application stores or the constants package.

Shared DOM, SVG, gradients and easing utilities belong to [UI Primitives](../ui-primitives/README.md). Browser engine modules import the utilities they need from that package; engine exports do not expose copies or forwarding aliases.

## Using the source package

Add Canvas Engine and UI Primitives to the consuming workspace. Imports resolve directly to TypeScript; there is no generated distribution or package build. The consumer's frontend tooling must handle TypeScript, Sass package exports and module workers created with `new URL(..., import.meta.url)`. The image decoder also accepts a `workerFactory` when a host needs explicit worker construction.

Use public export paths rather than importing from another package's `src/`. Keep `src/`, `package.json`, the package license and notices together. Shared and backend entrypoints can run without a DOM; frontend entrypoints require browser APIs. Import `@lixpi/canvas-engine/styles/interaction` once for each application using automatic canvas input.

The [engine-only example](examples/engine-only.ts) receives a sized root and error callback, registers a basic node, and accepts engine intents into its own snapshot. Destroy its returned owner when the host unmounts.

## Shared geometry

The root and `/shared` entrypoints expose only runtime-independent code. API code can import them without loading browser rendering:

```typescript
import {
    applyNodeGeometry,
    buildNodesById,
    computeWorldPosition,
    resolveRigidCanvasNodeGroupCollisions,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
```

Scene nodes have an open type key, component data, position, dimensions, optional parent, and named connector ports. Geometry helpers also accept structural node types, so callers can retain their own payload fields without converting their stored data. Geometry updates preserve omitted parent relationships; an explicit `parentId: null` removes a parent.

Shared modules contain:

- `geometry`: points, rectangles, aspect fitting and centering.
- `scene`: generic scene contracts, node indexing, world positions and geometry updates.
- `scene/validation`: typed geometry, parenting, node/port identity and endpoint diagnostics. Scene application validates before changing mounted content.
- `collision`: rectangle collision resolution.
- `canvas-node`: rigid group movement that preserves caller node payloads.
- `tree-layout`: tidy-tree layout over abstract boxes.
- `zoom-scaling`: bounded sizing for controls and connector geometry.

Lixpi branch lineage and generated-output admission belong to `@lixpi/canvas-components-lixpi-specific/shared`. Their adapters supply measurements and constraints to the engine.

## Browser entrypoints


Browser code imports `/frontend`, `/frontend/connectors`, or `/frontend/rendering` explicitly. Shared modules must never import these entrypoints. The rendering backend owns Pixi resources; application-specific source lookup and persistence belong to the caller.

`CanvasController` composes rendering, registered node views, viewport input, selection, drag/resize, named-port connections and extension lifetimes. Import `/styles/interaction` and mount it inside a positioned element with an explicit size. Supply the initial scene, viewport, registry, `onIntent` and `onError`. The host accepts geometry, connection, deletion and viewport intents into its own state and forwards authoritative changes through `setScene` or `setViewport`; the engine does not write application state.

The controller's interaction configuration supplies thresholds, handle sizing, marquee appearance, viewport settings, selection callbacks and interactive-content exclusions. `interaction: false` disables automatic input bindings. Connector settings and marker geometry are explicit. `collisions` enables measured collision resolution when geometry is committed; rigid groups and parent/child movement stay together, and nonmovable groups remain fixed. Geometry intents contain changed parent-relative positions and dimensions. `installExtension` returns an idempotent disposer and releases a failed mount's resources. Destroying the controller removes only its own roots, scopes, input listeners and renderer.

Custom canvas controls can use `interaction: false` and install their callbacks through `installViewport`, `installMarquee`, `installSelectionOverlay` and `installKeyboard`. Each control can be installed once and belongs to the controller lifetime. `startNodeDrag` and `startNodeResize` use its gesture and geometry owners; callbacks receive world bounds to project or commit. A scene switch, removal of a transforming node or controller disposal cancels the session. Custom selection-overlay callbacks retain control of the displayed group bounds. Use `selection` and `geometry` from the controller rather than creating parallel owners.

`root` contains the input surface. An optional `renderRoot` places the renderer inside another element, and `overlayRoot` places DOM content independently. Keep those hosts in the same coordinate system. The controller creates and removes its own children without removing supplied hosts.

`NodeRegistry` accepts caller-named component registrations with an opaque data type, geometry policy and mount function. A mounted view receives updates, world geometry, selection, visibility and disposal. Optional prefetch belongs to the view. `ComponentContext` describes scoped drawing/media services, scene/view subscriptions, overlay mounting and a node-owned DOM root. Registrations do not receive Pixi objects.

Connector policies can supply centering, alternate geometry, source anchors and marker selection without replacing controller lifetime or mutation handling. Source-anchor callbacks receive opaque edge data and the owning node's DOM root. Input listens on the supplied canvas root, including a separately supplied `overlayRoot` inside that root.

Use `installConnections` when connection setup follows controller construction. It returns controls for selection, deletion, menu/handle gestures and connector geometry queries. The controller owns graph synchronization and disposal. Supply `onEdgesChange` to translate changes back into an external wire format, including fractional attachment positions; without it, the controller emits connection intents. Failed installation releases its resources and permits a retry. Proximity connections require an explicit policy opt-in.

`CanvasScene` coordinates registered views on an existing renderer. It resolves parent-relative positions before passing nodes to geometry measurement, indexes visual bounds for culling, and propagates live parent transforms to descendants. Pass the visible screen size to `setViewport`, and configure `visibilityMargin` and `prefetchBatchSize` for the host's loading policy. Scene switches dispose node scopes; metadata updates preserve their views. Drawing contexts remove subscriptions and mounted overlays with their scope. Destroy the scene before destroying its renderer.

`getNodeGeometry` returns copies of raw world geometry and the registration's visual, hit, selection, collision and connector footprints. Pass a shared `GeometryOverrides` owner when interaction and presentation need the same coordinates. Call `refreshGeometry` after a batch of scoped changes. Same-scene updates retain externally owned scopes; a scene switch expires their writers. `setLiveBounds` supplies an owned presentation override that resets on snapshot adoption.

Scene snapshots reject nonfinite or negative geometry, duplicate IDs, missing/cyclic parents and invalid edge ports. Geometry measurements are staged before applying a snapshot, so a failed measurement keeps the previous views and bounds. Unregistered types retain an unstyled diagnostic shell and report `unknown-node-type` through `onDiagnostic`, or through `onError` as a `CanvasDiagnosticError` when no diagnostic callback is supplied.

`planVisualState` acknowledges a pending visual commit or retains its visual fields through caller-supplied identity, coverage and merge functions. This allows a host to accept unrelated authoritative metadata while waiting for its visual write to be acknowledged. `planSceneTransition` separates route identity, loaded scene identity and missing/error state without importing application routes or loading enums.

`/frontend/viewport` exports `ViewportBridge`, which applies one viewport to the supplied DOM root, overlay roots and renderer targets. Targets expose only `setViewport`; no rendering-library object crosses this boundary.

`ViewportController` owns pan/zoom on an explicit root and reports transform changes. Each `lock()` call returns its own release callback; releasing one interaction does not unlock another. Configuration and viewport state belong to the instance. Programmatic `syncViewport()` applies authoritative state without reporting a new user interaction.

`/frontend/runtime` exports `GestureController`, `GeometryOverrides`, `InteractionLocks`, `CanvasScrollLock` and `NodeLayerManager`. Gestures own document listeners, optional pointer capture and leased cursor styles. They end once or cancel on Escape, window blur, pointer cancellation or explicit owner disposal. Call `cancelAll('scene-change')` before replacing interaction state. Each geometry override scope can affect only its own entries; higher priorities override lower ones, and ending a gesture reveals an underlying product projection. Clearing the owner expires its scopes, so late callbacks cannot change a replacement scene.

Shared resize functions accept explicit minimum/maximum dimensions, handle direction and aspect policy. Drag planning accepts container and movement policies without knowing a node's product type. `computeConnectorDatum()` resolves connector paths and endpoints using caller-supplied colors, sizes and marker-body length; it contains no icon artwork.

`CanvasKeyboardController` handles Escape and deletion only for its root, optional owned portal targets, or the canvas that most recently received a background pointer interaction. It respects handled events and leaves deletion in editable content alone. Destroy it with the surface to remove its document listeners.

`CanvasSelection` owns membership, toggle behavior and marquee origin independently for each canvas. Replacing membership returns the previous read-only snapshot. Rectangle helpers accept caller-measured footprints for hit tests, marquee intersection and padded selection bounds. `computeConnectorSpread` uses an explicit centered-anchor predicate and alignment limits; product types and settings remain outside engine.

`NodeTransformController` owns drag thresholds, zoom conversion, rigid group geometry, resize constraints, transient override scopes and optional interaction locks. Its callbacks receive copied world bounds; completion releases only that session's overrides and lock before reporting the result. Cancellation restores underlying geometry without committing. `GeometryOverrides.worldPosition()` and `worldBounds()` combine parent-relative nodes with scoped world overrides without applying a parent transform twice.

`MarqueeController` owns the movement threshold, rectangle normalization and gesture lock. It reports activation only after movement crosses the threshold, and cancellation does not call its completion callback. `SelectionOverlay` owns the marquee DOM and invisible group drag target; import `/styles/interaction` for structural positioning. The caller supplies marquee colors and radius. The group surface has no visual skin and can be paired with `RectangleOverlay` drawing.

`NodeShell` owns canvas placement, a drag overlay and optional resize handles. Its callbacks supply selection and content behavior. `NodeResizeHandles` owns handle listeners, custom content disposal and zoom-dependent dimensions; callers provide artwork or a content mount without moving that artwork into engine. `NodeHandles` combines the same resize owner with named-port hit targets for registered scenes.

`ConnectionManager` accepts structural graph projections, connector settings and explicit root/viewport elements. A node may supply named ports in local world units on any of the four sides. Port roles preserve input/output direction even when a drag starts at an input. The default structural projection uses left/right handles. Product adapters supply centered-anchor, source-content anchor, marker and optional proximity policies. Proximity is disabled unless `canConnectProximity` is supplied.

A finite `sourceAnchorT` returned by the content policy overrides the vertical position of a left/right named port and aligns an eligible target. Returning null or a nonfinite value preserves the configured port. Top/bottom ports retain their explicit coordinates.

Each connection manager has its own flow identity and owns connector hover/click listeners, handle gestures and auto-pan work. `cancelTransientConnection()` ends a gesture without treating it as an empty-space reconnect drop. Escape, blur, source-node removal and disposal cancel the same way. An actual reconnect drop in empty space removes its edge. Late auto-pan completion cannot resume a cancelled gesture.

`/frontend/media` exports `ImageDecoder`. Each instance owns a lazy worker pool. Pass a URL or a source descriptor with credentials/headers, and an optional abort signal per request. Cancellation rejects that request and closes late bitmaps; destruction rejects pending requests and terminates only that instance's workers. The worker is TypeScript source resolved relative to the package. A caller can provide a worker factory when its environment requires another URL or worker setup.

Components acquire images and native playback URLs through their drawing scope's `media` service. Supply `mediaResolver` to the renderer to map content descriptors and rendition IDs into sources; the engine does not construct application URLs. Image leases share decoding and cached textures by content key, version and rendition. Each request and scope can cancel independently. Larger decoded renditions can satisfy smaller requests, and mipmaps support zoomed-out rendering. Idle textures are evicted according to `mediaCache` limits; live leases remain retained. Source cleanup runs after decoding, and decoded bitmaps remain owned until their texture can be physically disposed. Playback resolvers must return URLs usable by native media elements without custom request headers.

`CanvasRenderer` mounts a transparent drawing surface and exposes `ready`, `setViewport`, `resize`, and `destroy`. Create a drawing scope with `createScope()` for each component or effect. Its `resources` accept opaque handles, pixels, mesh arrays and vector paths. A scope can sample borrowed textures and layers, but can only mutate or release its own allocations. Its abort signal, frame subscriptions and resources end together when the scope or renderer is destroyed. `requestFrame` supplies milliseconds since the preceding frame, starting with zero.

Captures declare their source layers/groups and excluded output groups. The backend orders dependent captures, rejects feedback cycles and refreshes captures when included content changes within their bounds. Movement invalidates both the old and new area. Explicit `invalidate(bounds)` uses screen coordinates; omitting bounds invalidates all captures. Resizing a capture preserves its borrowed texture handle. Release the capture, not its texture.

Use `sampleBounds` when an effect reads only part of a larger capture. These rectangles use the capture's coordinate space and limit which changes refresh its texture. Include any displacement or filter sampling margin in those rectangles. Setting `enabled: false` pauses capture updates while retaining the texture; enabling it refreshes the capture before dependent drawing.

Mesh inputs are copied into backend buffers. Pixel inputs use straight-alpha RGBA; the backend premultiplies its upload copy without changing caller data. Resources detach from the scene immediately when released, while physical GPU disposal waits for submitted work. The WebGPU backend applies retirement to buffer records allocated by its own Pixi renderer, without changing native GPUBuffer prototypes. Renderer initialization and resource lifetime tests do not verify shader compilation or GPU output.

## Development

See [Rendering Resources](docs/RENDERING-RESOURCES.md) for layer order, transforms, vector strokes, material shader bindings, captures and disposal.

Consumers import TypeScript source directly through the package export map, following the repository's shared-package convention. No package build is required. Run tests only through the Docker test runner.

The shared test runner runs the colocated engine tests:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared canvas-engine
```

Tests cover behavior and the server-safe shared import boundary. Source under `shared` must not import another Lixpi package, browser modules or application code.
