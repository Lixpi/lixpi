# Canvas Components

[Media surfaces](docs/MEDIA.md) and [canvas effects](docs/EFFECTS.md) describe component contracts and resource ownership. [Media board example](examples/media-board.ts) mounts two independent canvases with supplied media and editor ports. See [license and dependency notices](NOTICES.md).

`@lixpi/canvas-components` is the optional appearance and content layer for `@lixpi/canvas-engine`. Its modules own canvas node surfaces, canvas visual effects and their styles. The engine owns drawing resources and interaction plumbing.

The package may depend on canvas-engine, [UI Primitives](../ui-primitives/README.md) and third-party libraries. It must not import Pixi, UI-kit, Lixpi constants, service code or application stores. Product-specific content is supplied through component data and lifecycle slots.

`GlassBorder` composes a rounded refraction mask, a baked material strip and rim highlights through the drawing resource API. Pass screen-space target rectangles, source groups/layers and appearance settings. Its displacement map uses bounded CPU pixel data. The capture excludes the effect's own output, refreshes only around sampled targets, and pauses when targets disappear. Capture and map textures keep their handles across pane resizing. DOM measurement and target discovery belong to the caller.

`/effects/outline` exports `TravelingOutline`. Supply a drawing scope, material pixels and stroke/animation settings. The component writes neutral mesh geometry and subscribes to the scope's frame scheduler; the engine owns GPU buffer staging. Hidden targets retain their allocation for reuse, and the animation stops when none are visible. Destroying the component or its scope releases its frame subscription and resources.

`/loading` exports `LoadingOverlay`, which owns its drawing surface, outline, resize observation, error message and retry action. Pass the circle size, animation settings, error title, retry label and callbacks. Import `/styles/loading-overlay` to style it. The overlay exposes `setVisible`, `setErrorMessage`, and `destroy`; disposal during renderer initialization cannot mount a late canvas. Its stylesheet supports reduced transparency and the `--canvas-loading-text-color`, `--canvas-loading-retry-background`, and `--canvas-loading-retry-color` theme properties.

Shared DOM, SVG, gradients, easing and transition helpers come from UI Primitives. Canvas Components owns the effects that compose canvas drawing resources, including glass refraction and traveling outlines.

`/media` exports `ImageSurface` and `createImageNodeRegistration`. Register any node type with a geometry policy and a `getMedia(node)` adapter; the engine does not reserve an image type or inspect component data. Image surfaces retain displayed content until a replacement arrives, discard cancelled or superseded results, upgrade previews to the visible footprint, and release active leases when culled. They retain their mesh allocation while hidden. `fit` supports stretch, contain and cover without changing node dimensions. Missing image renditions remain unloaded; failed requests require a retry or new content identity.

`NativePlayback` mounts a native video or audio element in a supplied root and exposes it to playback controls. Source and poster URLs come from the drawing scope's media resolver. The component preserves an active source until its replacement resolves, discards late results, releases source leases and pauses/removes its element on disposal. Configure mute, loop, preload and cross-origin behavior explicitly for the product. A queued play cannot start a superseded source. No hidden host is appended to the global document.

`createPlaybackNodeRegistration` combines the native player and an engine-drawn poster or placeholder under the same node registration contract. Its `getContent` adapter supplies the media descriptor and explicit playback/poster rendition IDs. `onElement` gives controls the native element; `onPlayback` gives them the player API. Both receive `null` on disposal. `pauseWhenHidden` controls whether culling pauses playback; poster image leases are released when hidden regardless of that setting. `isImageVisible` can suppress a pending node's poster and placeholder without removing its native playback element.

`DomGlassBorder` accepts explicit element references and a root for screen-space measurement. It measures those targets before rendering, caches their corner radii and observes resizing. It does not discover targets through document selectors. Destroying it or its drawing scope removes its observer and effect resources.

Consumers import TypeScript source directly through the package export map. Styles and assets live in the package. No package build is required; tests run through the Docker test runner.

`/effects/glass` exports glass material bakers for traveling strips, closed borders and circular surfaces. `bake()` returns RGBA pixels that can be passed to a drawing scope's `createTexture()`. It does not allocate GPU resources or require a DOM. Circular surfaces also provide `bakeDataUrl()` for DOM backgrounds, using the same pixel shading through a canvas 2D context. Colors and material coefficients are supplied by the caller.

Generic panels, menus, tooltips, video controls, footers, preview popovers and DOM loading placeholders belong to [UI Kit](../ui-kit/README.md). Using them beside a canvas does not make them canvas components. They have no canvas package dependency; Lixpi workspace surfaces compose them with the canvas packages.

## Using the source package

Add Canvas Components, Canvas Engine and UI Primitives to the consuming workspace. These packages resolve TypeScript directly and do not require generated JavaScript. The host processes Sass and module-worker URLs as described by [Canvas Engine](../canvas-engine/README.md#using-the-source-package).

[MediaBoard](examples/media-board.ts) accepts image/video/poster URLs, an editor mount callback, appearance and error handling. `mountTwoBoards` demonstrates separate scenes and viewports. Each board owns its controller, media leases and effect subscriptions; destroying one leaves the other mounted. The editor callback returns its own disposer. A synchronous editor change during mount is retained and published after controller construction.

The examples do not require UI-kit, Lixpi constants, application services or authentication. Supply authorized URLs through the host when media is private. The packages remain private workspace members in this repository; publication metadata and registry release are separate operations.
