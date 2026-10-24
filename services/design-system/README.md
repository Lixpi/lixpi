# Design System

The [version registry](../../dev-tools/versions-registry/README.md) supplies Node.js, pnpm, and package versions. Edit the central values and synchronize the native declarations before rebuilding this image.

`design-system` is a browser SPA that renders the shared UI packages under `packages/lixpi` with their real factories, styles and settings. It adds no components of its own. Every page composes package components, and the frame around each example is a Gentelella card. Run it when you need to see a component, compare its options, or check a change against the rest of the kit.

It is built the same way as `web-ui` and `web-ui-user-portal`: `createWebClientService()` from `@lixpi/web-client-service-factory` owns startup, routing and teardown, the layout is the Gentelella application shell, and each route view owns the component instances it creates and destroys them when you leave the page. The UI-kit stylesheets are imported once in `src/main.ts`, as `web-ui` imports them.

## Modes

The sidebar has a Mode switch with two modes, and each mode has its own navigation.

Components mode covers regular application UI:

- `@lixpi/ui-primitives`: easing curves, shifting gradients, freeform bitmap phases, SVG gradient stops, color helpers, path geometry and the DOM style utilities.
- `@lixpi/ui-kit`: the icon catalog and animated icon, the D3 SVG switches, sliders, tabs and pills, dropdowns, info bubbles, help tooltips, preview popovers, the bubble menu, the side panel, progress timelines, block card tiles, error placeholders, video controls, the media model badge, the canvas node footer and the auth panel.
- `@lixpi/ui-kit-gentelella`: every component family, the runtime-backed overlays and applications, the theme tokens and the class-name contract.

Canvas mode covers items that live on or around the canvas:

- `@lixpi/canvas-engine` with the `@lixpi/canvas-components` media registrations: selection, marquee, drag, resize, named-port connectors, collisions and pan/zoom.
- `@lixpi/canvas-components`: image fitting and rendition selection, native video and audio playback, traveling outlines, the DOM glass border, the glass material bakers, and the loading overlay and layer.
- `@lixpi/canvas-components-lixpi-specific`: the workspace renderer (canvas chrome, product media layer, node shells, canvas bubble menu and video chrome together), operation status cards, branch markers, generated-output chrome, generation progress, the details frame, the prompt composer, context previews, the media and Capability libraries, and the right panel.

The Light and Dark switch under the mode switch sets the Gentelella `data-theme` attribute. Lixpi UI-kit and canvas components keep their own palette in both themes.

## Demo data

The service has no backend. Images are freeform gradient bitmaps, the video clip is recorded from the shifting gradient with `MediaRecorder`, and the audio tone is a generated WAV file. `src/fixtures/demoAssets.ts` wraps them in Assets with ready renditions, and its source ports resolve each rendition to an object URL the way web-ui resolves authorized media URLs. Product images and mockups come from the Gentelella package.

`MediaRecorder` output carries no duration, so every element that plays the recorded clip calls `settleRecordedVideoDuration()` to make the browser measure it. A real Asset does not need this.

The workspace appearance in `src/fixtures/workspaceAppearance.ts` combines `createLixpiCanvasSettings()` with the panel, preview and composer values from the web-ui settings. Update it when those web-ui values change, so the canvas pages keep matching the workspace.

Callbacks report what happened through a Gentelella toast instead of calling a service.

## What canvas mode leaves out

`LixpiWorkspaceCanvas` and `WorkspaceCanvasSurface` need the web-ui ProseMirror editors, authenticated transport, Capability registries and persistence, so the workspace renderer page assembles the renderer owners directly instead. Document and Capability Artifact nodes, the Artifact library and conversation history need the same editors and registries and are not shown. The composer hosts the Gentelella rich-text control where web-ui mounts its prompt editor, and the media library leaves its title editor empty.

## Local development

Run the service through Docker Compose. It is defined in `docker-compose.ui.yml` with the other browser clients, and it needs no other service:

```bash
docker compose --profile design-system up lixpi-design-system
```

It is available at `http://localhost:3003`. It also starts with the `main` profile. The container syncs `packages/lixpi` from the host, so package edits reload without a rebuild. A change to `pnpm-workspace.yaml` needs `./rebuild-containers.sh lixpi-design-system`.

## Adding a component

Add the example to the page for its package family under `src/views/pages/`, or add a page and its route in `src/routes.ts`. Build the page from `ShowcasePage`, register every instance with `page.own()`, and create anything that measures the DOM or scans the document in `page.onMount()`.

`src/coverage.test.ts` fails when a runtime export of `@lixpi/ui-kit-gentelella` or of a UI-kit component entry point does not appear on any page, so a new public component needs a showcase before the test passes.

## Tests and quality checks

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner design-system
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner design-system validate
```
