---
title: Canvas Component Library
description: Run and extend the isolated library of current canvas components and interactions.
---

# Canvas Component Library

The canvas library in `services/design-system` mounts the source packages from the same checkout in a standalone browser service. It covers the engine, reusable canvas components and Lixpi workspace composition. Its examples use local scene, Asset and conversation fixtures; actions do not contact an API, authenticate a user or submit provider work.

## Run the service

From the checkout containing the library:

```sh
docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml up --build -d lixpi-design-system
```

Open [http://127.0.0.1:3003](http://127.0.0.1:3003). The service is part of the application stack under **Dev tools**, off by default, and you can also tick it in `./run.sh` under **Start services**. It binds only the local loopback interface and starts without the other services. Source and fixture assets come from that checkout; shared packages are copied into the container-owned workspace by the existing [workspace package sync helper](../../../scripts/docker/workspace-package-sync.sh).

Stop this service with:

```sh
docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml stop lixpi-design-system
```

Rebuild after changing dependency manifests or the Dockerfile. TypeScript, styles and fixture assets update through the development server. Dependencies and generated installation files stay inside Docker volumes or image layers.

## Browse the canvas surface

Each page covers a canvas domain. Nodes provides an All node types overview and one list containing Diagram, Image, Video, Audio, Document, branch nodes and Metadata shell. Basic and composite nodes share the same navigation. The overview shows each media kind once alongside the composite nodes. The Image page includes contain, cover and stretch variants. One Metadata shell page displays an empty shell and several wrapped nodes together. Branches shows origin, fork and continuation together with their native parent links and directional connections. A native Variant selector keeps the embedded diagram adapter, document lease/loading/retry states, Artifact module views, operation states and branch actions on their corresponding canonical node pages. Connectors includes every path, line style and endpoint marker, named ports, routing and proximity connections. Interaction covers independent canvases and validation. The dedicated Stress testing section opens Large scenes directly, starts with 1000 nodes and regenerates the requested scene count without a demo ceiling. Its grid scales with the requested count, and initial mounting, regeneration and Fit all fit the complete scene without a demo minimum zoom. The inspector reports the engine's scene-node, mounted-view and visible-node counts; visibility includes the engine culling margin and does not imply that off-screen node views were destroyed. Arrangement, Tree layout and Collisions form a separate Layout navigation group. Effects and loading, and Workspace components, contain their related surface and composition examples.

The resizable left panel contains grouped navigation. Groups with nested pages have a UI-kit chevron button and indented sub-items. Their expansion state is independent of the selected page: navigating to another domain leaves opened groups expanded, and the chevron explicitly toggles its group. Search reveals matching nested pages. The active Parameters panel sits on the right, starts at the top edge and is open by default. A native UI-kit dropdown selects examples within the domain; Parameters and Code tabs expose live controls and their current public API snippets. Search includes domain names, example titles, descriptions, package entrypoints, component names and node types. Domain URLs and direct example URLs can be opened independently. The center canvas fills the remaining stage. Navigation, Parameters and Theme each use the shared UI-kit SidePanel component for resizing, its icon toggles and the same open and close slide the web UI uses. The library only flips each panel's open state; `CanvasLibraryLayout` in UI-kit places the panel and plays the slide. UI-kit panels overlay their content by default, but the library configures all three panels to push, so the stage shrinks beside an open panel and examples are never covered. Parameter choices use UI-kit Dropdown, boolean fields use ToggleSwitch, and the inspector tabs use SlidingTabsSwitch. These controls retain their instances during live theme changes, including body-mounted dropdown menus.

Descriptions and component references use read-only ProseMirror views. Code uses the same ProseMirror code-block NodeView and nested CodeMirror editor as the web UI, through `@lixpi/prosemirror/frontend/code-block`. Its shared Gruvbox Light theme, Söhne Mono font and code-block stylesheet retain the web UI presentation. Read-only mode disables editing in both editors while preserving text selection and copying. Navigation releases these editor views with the selected example.

Dedicated examples compare all connector paths, solid and dashed lines, endpoint markers, proximity preview and commit, collision resolution, rigid groups and tidy-tree spacing. They call the same exported engine algorithms and renderers as application canvases. The engine examples also expose real scene updates for selection, marquee, drag, resize, deletion, parenting, collisions, named-port connections, orthogonal routing, viewport movement, scene replacement and validation. Separate examples exercise visibility in a larger scene and independent canvas lifetimes.

The reusable component examples mount the diagram adapter, image surfaces, native video/audio playback, glass materials and borders, traveling outlines, loading overlays and shared loading leases. Media fixtures are local synthetic PNG, WebM and WAV files. Failure controls change the fixture's resolver or request state; recovery uses the component's normal lifecycle.
Effects expose component-specific controls: glass width and height resize both the measured and explicit rectangles, while rectangle radius writes the shared media or generation-outline theme field. Circular samples retain their circular geometry. Loading controls reflect the current overlay visibility or active leases after start, completion, failure and retry; the next failure message does not replace an error already displayed.

Video and Audio use the shared `PlaybackChrome` adapter and UI-kit SVG controls around native media elements. Browser controls are disabled. The gallery supplies engine gesture, bounds and viewport ports, and starts from `createLixpiUiSettings()` production settings. Loop, mute, playback speed, volume and player control height update the actual player. Theme changes retain the native media elements and dispose replaced control instances.

Metadata shell opens with an empty shell beside wrapped Diagram, Image, Video and Audio nodes in one canvas. Every example uses `withNodeShell` to wrap an existing registration; the empty example supplies a NodeView with no content rendering. The wrapped examples reuse the same Diagram and media registrations as their standalone pages. The standalone pages focus on node content and controls, while this page owns the shared chrome examples.

`CanvasNodeShell` provides DOM slots for a title, metadata and actions. `withNodeShell` mounts the original NodeView in the engine's content root and the shell in its screen overlay, retaining the registration's geometry and media contract. The title appears above the node, and metadata and actions appear below it. Node and viewport changes keep the shell aligned through dragging, resizing, panning and zooming. Playback examples offset the footer after their player controls.

The host supplies slot factories with update and destroy lifecycles. This page uses text slots for the title and current type, dimensions and media identity, plus shared canvas-node footer controls for Select and Delete. Show shell changes chrome visibility while preserving the content, native playback elements and slot instances. Production workspace output chrome supplies a ProseMirror title editor through its host editor port; the reusable shell has no editor or product-model dependency. Removing the node or leaving the page releases the wrapped view and its slots. The Diagram page also retains its embedded adapter variant.

Workspace examples compose the package-owned renderer, node views, editors, libraries, conversation surfaces, progress and review components through typed host ports. Capability Artifact views and validation come from the installed module definitions. The service supplies fixture documents and transport responses; it does not implement Capability behavior.

Prompt input, agentic conversation and read-only generation history are demonstrated only in **Input and agentic chat**. The All node types overview and individual canvas-node variants use the original renderer with composer, conversation panel, side panel and app toolbars disabled. Libraries omit the optional history mount; progress/review retains metadata and timeline components without a chat transcript. The dedicated history example preserves the original read-only conversation projection.
The input example uses the same `WorkspacePromptComposer.mountConversation` composition and `WorkspacePromptControlRail` as production. Conversation, context tray and prompt share the native composer host; media-mode and model controls occupy the native responsive rail. The fixture supplies editor, catalog and transport ports.

Reset destroys and remounts the selected example. Navigation releases its scene, renderer, subscriptions and editor instances. Live parameters update the example through public setters or a controlled remount when a component only accepts constructor configuration. Numeric fields have no demo min/max/step limits. The real component or framework validates values; count generators reject negative or fractional counts with a visible error instead of rounding. Code snippets reflect the current parameter values.

## Shared theme

Application text and side panels use the web UI's shared [UI Kit styles](../../../packages/lixpi/ui-kit/README.md): `@lixpi/ui-kit/styles/typography` and `@lixpi/ui-kit/styles/navigation-side-panel`. Navigation uses the production row, title and active-state classes. Its section headings use the same theme roles as the AI Experiments sidebar. `@lixpi/ui-kit/styles/canvas-library` and `@lixpi/ui-kit/canvas-library` own docking and control layout. `@lixpi/themes` supplies the pane widths, resize geometry and icon sizes. Navigation starts at 280 pixels and Parameters starts at 416 pixels. The inspector and Theme content sit on the shared side panel glass backdrops.

The default named preset is `lixpi-light`. TypeScript imports both `lixpiLightTheme` and `oneDarkProMarianaTheme` from `@lixpi/themes`, then passes those native preset objects to `createLixpiCanvasThemeFromPreset`. Their matching `@lixpi/themes/dist/scss/<preset>/theme` style entries supply the same canonical semantic roles to application CSS. Preset selection updates the document's named theme scope as well as the canvas store. The service does not recover preset values from hidden DOM elements.

The live store supplies `--canvas-*` tokens to example canvases. The global Theme icon control opens a separate right panel, closed by default, whose state and width are independent of the page controls. When open, Theme docks beside Parameters at the outer right edge.

One `CanvasThemeStore` supplies every example through the original canvas package APIs. Its live editor exposes colors, typography, shape, controls, shadows, selection, connectors, GPU effects and Lixpi component properties. Preset changes and field edits update mounted canvases and remain active when switching domains. Theme JSON can be copied into an application's own store. Theme source and attribution are documented in [Application themes](../../../packages/lixpi/ui-kit/README.md#application-themes).

## Extend an example

The application runtime, routing, Vite setup and document foundation come from [Web Client Service Factory](../../../packages/lixpi/web-client-service-factory/README.md). The service owns its catalogue, domain navigation and fixture composition.

The service defines no stylesheets or static visual defaults. Its entrypoint composes public package style entries. Canvas fixture presentation and reusable diagram, media and workspace chrome appearance come from `@lixpi/canvas-components/styles/library-examples` and `@lixpi/canvas-components/library`. Add reusable presentation to the owning package; keep scene data, host ports, event handling and dynamic geometry in the example. Use the canonical component and named-theme defaults rather than defining a library palette.

Add metadata and a lazy mount in [the catalogue](../src/catalog/catalog.ts), then assign its ID to one domain in [the domain catalogue](../src/catalog/domains.ts). List only the actual components and node types demonstrated by the example. Use public package exports and the package-owned styles. A mount returns an owner with `destroy()` and its `ExampleFrame` instances. Each frame owns a canvas host and a separate inspector. Canonical node variants dispose the previous factory before mounting a different component into the same host and replace its inspector in place. The Metadata shell page mounts all five examples in one scene; its Show shell control updates their retained shells and content. Register numeric, selection, boolean or text parameters on the frame and provide a `code()` callback that reflects their current values. Asynchronous mounts must also be safe to destroy after the user navigates away.

Keep fixture state in the example or its typed host adapter. Accept engine intents into that state and send updated snapshots back through the public API. Reuse shared components, settings, renderers and module definitions instead of copying their implementation into the service. The Icons page searches the real public SVG artwork from UI-kit and displays export names. Other generic UI-kit galleries are outside this canvas-only service scope.

## Verification

Build the browser bundle inside its running container:

```sh
docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml exec -T lixpi-design-system pnpm run build
```

Check direct-route loading and navigation, every registered example, reset, source failures and recovery, independent canvases, document and Artifact editing, and pointer/keyboard interactions. A successful bundle build alone does not establish that GPU output, media playback or canvas gestures work.

The same standalone Compose project exposes the shared TypeScript quality runner through the `quality` profile:

```sh
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.design-system-quality.yml --profile quality run --rm --no-deps -T lixpi-design-system-quality files validate services/design-system/src services/design-system/vite.config.ts
```

Use `files fix` with the same paths to apply the repository formatter and lint fixes. The adapter mounts only this service's sources for writing and uses the existing runner implementation.
