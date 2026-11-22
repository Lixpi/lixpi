# Canvas Components

Dependency versions in `package.json` are generated from [the version registry](../../../dev-tools/versions-registry/README.md). Edit the central entry and synchronize before rebuilding a consuming service.

[Media surfaces](docs/MEDIA.md) and [canvas effects](docs/EFFECTS.md) describe component contracts and resource ownership. [Media board example](examples/media-board.ts) mounts two independent canvases with supplied media and editor ports.

`@lixpi/canvas-components` owns the canvas component ecosystem above `@lixpi/canvas-engine`: primitive surfaces and effects, reusable node shells, and richer workspace components. The engine owns drawing resources and interaction plumbing.

Frontend modules, including `src/workspace/frontend`, use native browser console methods for diagnostics. They must not import `@lixpi/debug-tools`, whose implementation depends on Node utilities and terminal formatting.

Image, video and audio each have one content implementation shared by the documentation service and Lixpi workspace. Workspace adapters supply data and behavior to the same image and playback registrations. Metadata belongs to the reusable node shell around that content, so a titled image or video remains the same media node. The documentation's Metadata shell page demonstrates the empty shell and wrapped content variants together.

Primitive entrypoints such as `/media`, `/effects` and `/nodes/shell` own content, controls and appearance without workspace or Asset contracts. `/workspace` and `/workspace/*` compose those primitives with Lixpi's document, branch, generation and conversation contracts through typed host ports. Workspace modules live under `src/workspace`; they may import primitive modules, while primitives must not import workspace modules. UI-kit supplies generic controls and icons, and [UI Primitives](../ui-primitives/README.md) supplies DOM and drawing helpers. No component imports service code, application stores or Pixi directly.

A diagram is an ordinary canvas. A read-only diagram on a documentation page and an editable workspace both use `CanvasController`, and its presentation flags make the difference: `locked` keeps panning and zooming but rejects content changes, `autoFit` keeps the content in view, `scrollCapture: 'on-activate'` leaves page scrolling alone until the canvas is clicked, `layout` places nodes and routes edges from a graph, and `onNodeClick` reports node clicks. The [Canvas Engine README](../canvas-engine/README.md) describes each flag. `LoadingOverlay` from `/loading` covers a canvas root during loading or after an error.

Connector settings come from `createCanvasConnectorSettings`, the same factory as the Lixpi workspace, or from `canvasThemeConnectorSettings(theme.value)` for a themed canvas. Scientific illustrations such as IDBD pass `createDiagramConnectorSettings()` from `/connectors` to retain their directional Bezier paths, 1.5px stroke and arrowless zero-gap endpoints; the scientific factory's optional `markers: true` selects a 6px node gap. Pass UI-kit's `createArrowRightMarker()` as the connector renderer's `marker`, with `arrowRightMarkerBodyLengthFraction` as `markerBodyLengthFraction`, to draw the native arrow artwork. Its reference point and body length let the engine account for the arrow separately from the node gap. A scene edge can select the engine's automatic `orthogonal` path. A diagram draws its nodes with the same registrations as any other canvas. Lixpi branch markers belong to the [branch marker diagrams](docs/workspace/DIAGRAMS.md), which use the actual branch content, theme, measurement and marker policy.

`GlassBorder` composes a rounded refraction mask, a baked material strip and rim highlights through the drawing resource API. Pass screen-space target rectangles, source groups/layers and appearance settings. Its displacement map uses bounded CPU pixel data. The capture excludes the effect's own output, refreshes only around sampled targets, and pauses when targets disappear. Capture and map textures keep their handles across pane resizing. DOM measurement and target discovery belong to the caller.

Enable [Web UI profiling](../../../documentation/platform/DEVELOPMENT.md#profiling-the-web-ui) to measure glass sync and compare the same interaction with the rim and capture paused.

`/effects/outline` exports `TravelingOutline`. Supply a drawing scope, material pixels and stroke/animation settings. The component writes neutral mesh geometry and subscribes to the scope's frame scheduler; the engine owns GPU buffer staging. Hidden targets retain their allocation for reuse, and the animation pauses at its current position when none are visible. Loading request handoffs resume that position without restarting the lap. Destroying the component or its scope releases its frame subscription and resources.

`/loading` exports `LoadingOverlay`, which owns its circular outline, error message and retry action. It bakes the shared traveling-outline mesh and material into a small canvas synchronously, then rotates that bitmap with the shared easing. Loading feedback does not wait for a GPU backend or another module download. The bitmap preserves the tapered trail and head/tail gap. The rotation and the fade run as Web Animations and CSS transitions on the compositor, so they keep moving while the main thread renders the content that just loaded. The spinner turns in repeating cycles that `spinCycle` describes. Each cycle is `fastTurns` full turns that each take `durationMs`, then one slow turn that takes `slowTurnDurationFactor` times as long. Every cycle after the first slows all of its turns at once: the second cycle adds `firstSlowdownMs` to each turn, and every later cycle adds `slowdownGrowthFactor` times the previous cycle's slowdown. A quick load shows a few complete fast turns, and a long load slows down harder each cycle. When the next slow turn would take longer than `maxSlowTurnDurationMs`, the current cycle repeats until loading ends. When loading ends, the overlay stays briefly while the content paints and then fades out fast, and the spinner keeps turning until the fade finishes. Loading that resumes before then continues the same turns; loading that starts after the overlay has fully hidden starts again from the fastest turn. Pass the circle size, animation settings, error title, retry label and callbacks. Import `/styles/loading-overlay` to style it. The overlay exposes `setVisible`, `setErrorMessage`, `setAppearance`, and `destroy`. Its stylesheet supports reduced transparency and the `--canvas-loading-text-color`, `--canvas-loading-retry-background`, and `--canvas-loading-retry-color` theme properties.

`/loading/layer` exports `LoadingLayer` for application-wide feedback. Create one owner at the application root and pass it to consumers. Each `acquire()` call returns an independent loading/error lease; destroying one lease leaves other pending work visible. The owner paints the first active request synchronously, retains one overlay across requests, and routes retry to the failed lease. `contain(root)` confines the layer to one element instead of the whole window, positioning it absolutely inside that element, and returns the function that puts it back. A layer already on screen keeps its place until it has faded out, and the new placement applies to the next load, so the startup spinner stays centered in the window while the application mounts around it. A host whose own controls float over the start of that element sets `--canvas-loading-layer-inset-inline-start` so the contained layer stops at the edge of those controls. The overlay fades its blurred scrim in only when loading outlasts a short delay, so quick loads never show it. When the last request ends, the layer stays mounted until the fade-out finishes, letting pointer input through meanwhile, and then leaves the document. `restartSpin()` starts the visible spinner over from its first fast cycle, for loading that begins again, such as a newer workspace click replacing one still in progress. Destroy the owner during application teardown. The loading entrypoints have no runtime GPU dependency.

Shared DOM, SVG, gradients, easing and transition helpers come from UI Primitives. Canvas Components owns the effects that compose canvas drawing resources, including glass refraction and traveling outlines.

`/media` exports `ImageSurface` and `createImageNodeRegistration`. Register any node type with a geometry policy and a `getMedia(node)` adapter; the engine does not reserve an image type or inspect component data. Image surfaces retain displayed content until a replacement arrives, discard cancelled or superseded results, upgrade previews to the visible footprint, and release active leases when culled. They retain their mesh allocation while hidden. `fit` supports stretch, contain and cover without changing node dimensions. Missing image renditions remain unloaded; failed requests require a retry or new content identity.

`NativePlayback` mounts a native video or audio element in a supplied root and exposes it to playback controls. Source and poster URLs come from the drawing scope's media resolver. The component preserves an active source until its replacement resolves, discards late results, releases source leases and pauses/removes its element on disposal. Configure mute, loop, preload and cross-origin behavior explicitly for the product. Set `controls: true` to expose the browser player controls; controls default to false. Audio stays in a 1px transport element by default and fills its supplied root when controls are enabled. A queued play cannot start a superseded source. No hidden host is appended to the global document.

`createPlaybackNodeRegistration` combines the native player and an engine-drawn poster or placeholder under the same node registration contract. Its `getContent` adapter supplies the media descriptor and explicit playback/poster rendition IDs. `onElement` gives controls the native element; `onPlayback` gives them the player API. Both receive `null` on disposal. `pauseWhenHidden` controls whether culling pauses playback; poster image leases are released when hidden regardless of that setting. `isImageVisible` can suppress a pending node's poster and placeholder without removing its native playback element.

`PlaybackControls` from `/media` supplies the native UI-kit video/audio controls for any host-owned node shape. Its generic node contract requires only `nodeId` and `type: 'video' | 'audio'`. Bounds, viewport, native media elements and drag/resize actions arrive through ports. It owns player control instances, responsive geometry, media-element placement and cleanup; it has no Asset, generation or workspace dependency. Import `/styles/playback-controls`. The workspace's `WorkspaceVideoControls` supplies its node types to this same implementation.

`CanvasNodeShell` and `withNodeShell` from `/nodes/shell` add independently mounted title, metadata and action slots around any content. The shell owns placement, bounded zoom scaling and slot cleanup. It does not add selection outlines, port artwork or node-specific business behavior. `withNodeShell(registration, options)` decorates an existing node registration, preserving its geometry policy, content updates, visibility, selection and prefetch lifecycle. Its controls mount in the engine's screen overlay and are released with the node or drawing context. Hosts supply slot components with optional `update(node)` and required `destroy()`, plus the current gap/zoom settings. `enabled(node)` toggles the controls through ordinary node updates while retaining the content and slots. `getFooterOffsetScreen(node, viewport)` reserves space below content controls, such as a video player's external control bar, while keeping the title anchored above the content. Geometry policy stays with the registration; a richer host can reserve its controls in collision and visibility footprints. Import `/styles/node-shell`. The production generated-output title and review footer use this shell too; review actions and Asset editing remain workspace-owned.

`DomGlassBorder` accepts explicit element references and a root for screen-space measurement. It measures those targets before rendering, caches their corner radii and observes resizing. It does not discover targets through document selectors. Destroying it or its drawing scope removes its observer and effect resources.

Consumers import TypeScript source directly through the package export map. Styles and assets live in the package. No package build is required; tests run through the Docker test runner.

`/effects/glass` exports glass material bakers for traveling strips, closed borders and circular surfaces. `bake()` returns RGBA pixels that can be passed to a drawing scope's `createTexture()`. It does not allocate GPU resources or require a DOM. Circular surfaces also provide `bakeDataUrl()` for DOM backgrounds, using the same pixel shading through a canvas 2D context. Colors and material coefficients are supplied by the caller.

The [workspace conversation layout](docs/workspace/README.md) composes the retained chat and prompt with shared panel resize handles and BubbleMenu controls for centered, docked and detached canvas placement.

Generic panels, menus, tooltips, video controls, footers, preview popovers and DOM error placeholders belong to [UI Kit](../ui-kit/README.md). Using them beside a canvas does not make them canvas components. They have no canvas package dependency; Lixpi workspace surfaces compose them with the canvas packages.

## Canvas themes

`/theme` owns one serializable `CanvasTheme` contract for colors, typography, shapes, controls, shadows, selection, connectors and GPU effects. `createCanvasTheme()` returns independent Lixpi production light defaults: a transparent canvas, the Söhne-first system font stack, established media geometry, connector settings and glass/outline colors. The host remains visible through the canvas unless it explicitly supplies a background. `createCanvasThemeFromCss(root)` reads the host's semantic `--theme-*` colors, such as a named preset from `@lixpi/themes`, without importing a UI package. Reading a page theme preserves the transparent canvas background. A host that explicitly wants its page background painted on the canvas can pass `{ inheritPageBackground: true }` to the CSS reader; explicit `CanvasTheme.colors.background` overrides also remain supported.

```typescript
import {
    CanvasController,
    NodeRegistry,
} from '@lixpi/canvas-engine/frontend/runtime'
import { createImageNodeRegistration } from '@lixpi/canvas-components/media'
import {
    CanvasThemeStore,
    bindCanvasTheme,
    canvasThemeConnectorSettings,
    createCanvasThemeFromCss,
} from '@lixpi/canvas-components/theme'

const theme = new CanvasThemeStore(createCanvasThemeFromCss(host))
const releaseTheme = bindCanvasTheme(host, theme)
const canvas = new CanvasController({
    root: host,
    registry: new NodeRegistry().register(createImageNodeRegistration({
        type: 'image',
        geometry,
        getMedia: node => node.data.media,
        getStyle: () => ({
            radius: theme.value.shape.mediaRadius,
            placeholder: { color: theme.value.colors.surface },
        }),
    })),
    scene,
    viewport: { x: 0, y: 0, zoom: 1 },
    connectors: { settings: canvasThemeConnectorSettings(theme.value) },
    onIntent: acceptIntent,
    onError: reportError,
})
theme.subscribe(next => canvas.setConnectionSettings(canvasThemeConnectorSettings(next)))

theme.update({
    colors: { accent: '#4cd1e0' },
    shape: { nodeRadius: 12 },
    connectors: { scaling: { strokeWidth: 2 } },
})
```

Palette colors are opaque six-digit hex values shared by DOM and GPU renderers; `colors.background` also accepts `transparent`. Effect and connector colors can reference those roles with `var(--canvas-accent)` and the other canvas color properties; the resolver produces concrete colors before material baking. The explicit `colorScheme` field is `light` or `dark` and applies to native browser controls. Optional `properties` extends the same scoped binding with component-owned CSS custom properties; extension names cannot replace the shared canvas roles. References to extension properties resolve through the same DOM/GPU color resolver. The store validates complete updates, keeps immutable snapshots and notifies subscribers. Partial updates merge nested fields and replace arrays. `bindCanvasTheme(root, theme)` applies scoped `--canvas-*` properties and returns a disposer that restores the root's previous values. Added and removed extension properties follow source updates and are restored on disposal. Different canvases can use independent stores; sharing a store synchronizes them. Destroy components or release bindings when unmounting.

Canvas hosts subscribe to the same source, use `canvasThemeConnectorSettings(theme.value)` for concrete connector colors and `resolveCanvasThemeColors(theme.value, theme.value.effects)` before baking GPU materials. Effects use the same semantic color references as DOM surfaces; shader parameters are explicit data in `effects`.

`GlassBorder`, `DomGlassBorder` and `TravelingOutline` expose `setAppearance(style, texture)` for retained resources. `LoadingOverlay` and `LoadingLayer` expose `setAppearance({ outline })`; updating the material and animation settings preserves visibility, errors and active loading leases. Image and playback registrations support style getters so radius and placeholder changes retain loaded media and native players.

The workspace navigation and right panel settings derive their starting geometry from the same application theme profiles as the documentation service. The right panel mode switch scales with the canvas control height.

The Lixpi workspace adapter consumes this contract through `WorkspaceCanvasHost.theme`. It maps semantic roles into product-specific settings and refreshes retained media, panels, connectors and effects. Branch markers retain their dark product palette in light mode, and model circles retain their transparent base. Hosts can explicitly override those settings with the `--canvas-lixpi-branch-*` and `--canvas-lixpi-model-circle-*` properties. See [Lixpi Canvas Components](docs/workspace/README.md).

## Editor integration

Canvas workspace components mount editors through ports supplied by the host. The ProseMirror implementation and its editor styles live in `@lixpi/prosemirror/frontend/editor` and `@lixpi/prosemirror/styles/editor`. The canvas package keeps workspace geometry, context previews, prompt controls, and capability integrations that those ports use.

## Using the source package

Add Canvas Components, Canvas Engine and UI Primitives to the consuming workspace. These packages resolve TypeScript directly and do not require generated JavaScript. The host processes Sass and module-worker URLs as described by [Canvas Engine](../canvas-engine/README.md#using-the-source-package).

[MediaBoard](examples/media-board.ts) accepts image/video/poster URLs, an editor mount callback, appearance and error handling. `mountTwoBoards` demonstrates separate scenes and viewports. Each board owns its controller, media leases and effect subscriptions; destroying one leaves the other mounted. The editor callback returns its own disposer. A synchronous editor change during mount is retained and published after controller construction.

The primitive examples use supplied media, appearance and editor ports without application services or authentication. Supply authorized URLs through the host when media is private. The packages remain private workspace members in this repository; publication metadata and registry release are separate operations.

## Live documentation

The [Documentation Service](../../../services/documentation/documentation/DOCUMENTATION.md) runs these components alongside engine interaction examples and Lixpi workspace nodes in a separate Docker service. It imports the packages from its own checkout and supplies local media and typed host fixtures. Each example names the components it demonstrates and releases its resources when replaced.

`/library` owns reusable library presentation adapters for image placeholders and workspace controls. They consume the same `CanvasTheme` and production UI settings as the components. `CanvasTheme.controls.typography` and `controls.slidingSwitch` preserve compact control labels and native switch paints separately from body typography; panel content uses `typography.panelFontSize` and `panelLineHeight`. Updating body text size does not enlarge these controls. `/styles/library-examples` owns fixture and overview presentation. These compositions live under `src/library`, separate from primitive modules, because they can combine primitive and workspace settings. The service supplies scenes, ports and dynamic geometry; UI Kit owns the documentation layout, navigation and controls.
