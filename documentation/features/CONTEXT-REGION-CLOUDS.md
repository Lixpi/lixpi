# Context Region Clouds

Context region clouds are the PIXI-rendered visual surface for workspace context regions. They provide an organic cloud-shaped context field while preserving the existing workspace state model, drag model, parent-child containment, and AI chat thread activation flow.

This document is the current source of truth for how context region clouds work.

## Current Status

Context region clouds are implemented in the web UI and run as part of the hybrid workspace canvas:

- The visible cloud and title are drawn by PIXI v8 in [pixiContextRegionLayer.ts](../../services/web-ui/src/infographics/workspace/rendering/pixiContextRegionLayer.ts).
- Pure geometry, style selection, hit testing, title bounds, and adoption scoring live in [contextRegionClouds.ts](../../services/web-ui/src/infographics/workspace/rendering/contextRegionClouds.ts).
- [WorkspaceCanvas.ts](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) still owns canvas state, transparent DOM proxy nodes, drag, selection, activation, parent-child containment, and pane-level pointer routing.
- [viewportBridge.ts](../../services/web-ui/src/infographics/workspace/rendering/viewportBridge.ts) applies the same viewport transform to DOM nodes, the PIXI media layer, and the PIXI context-region layer.
- Theme-level cloud visual settings live together in [webUiThemeSettings.ts](../../services/web-ui/src/webUiThemeSettings.ts).

No backend schema, NATS subject, DynamoDB table, or persisted visual-style field is required. Context region clouds are a frontend rendering and interaction primitive over existing canvas nodes.

## Product Role

The workspace canvas is where users arrange documents, images, AI chat threads, generated outputs, and contextual groupings. A context region means "these items belong together as one creative context." The cloud is meant to read as a soft context field behind content, not as a panel competing with the content.

The original visual reference was the cloud-like NATS cluster region in [services-architecture-diagram.jpeg](../assets/services-architecture-diagram.jpeg). That image was used as style direction only. The shipped renderer does not crop, trace, or ship that asset.

The important product principles are:

1. The cloud outline is the interaction truth.
2. The visual should stay behind the user's documents and images.
3. Pan, zoom, drag, resize, and selection must remain fast with hundreds of regions.
4. Motion should be event feedback, not continuous decoration.
5. Runtime state should stay simple unless users explicitly get style controls later.

## Architecture

The workspace remains a DOM/SVG/PIXI hybrid. Context regions are special because their visible pixels are in a PIXI canvas below the DOM viewport, while their state and interaction proxy remain in the DOM.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph Pane[Workspace Pane]
        subgraph RegionLayer[PIXI Context Region Layer - below DOM]
            RegionWorld[Viewport-synced world Container]
            CloudSprite[One cloud Sprite per region]
            TitleText[PIXI Text title]
        end

        subgraph DomViewport[DOM Viewport]
            RegionProxy[Transparent context-region proxy]
            Documents[Document and chat DOM nodes]
            ImageShells[Image DOM shells and chrome]
            SvgEdges[SVG edge hit-testing]
        end

        subgraph MediaLayer[PIXI Media Layer - above DOM]
            ImageSprites[Image pixel sprites]
            EdgeGraphics[PIXI edge visuals]
            Foreground[Selection and marquee overlays]
        end
    end

    WorkspaceCanvas[WorkspaceCanvas state and events] --> RegionProxy
    WorkspaceCanvas --> RegionLayer
    WorkspaceCanvas --> MediaLayer
    ViewportBridge[viewportBridge.applyViewport] --> RegionWorld
    ViewportBridge --> DomViewport
    ViewportBridge --> MediaLayer
    RegionWorld --> CloudSprite
    RegionWorld --> TitleText
    RegionLayer --> HitGeometry[CO2 mask hit and adoption geometry]
    HitGeometry --> WorkspaceCanvas
```

The layer order is deliberate:

| Layer | Why it exists |
|---|---|
| PIXI context-region layer below DOM | Draws seafoam cloud backdrops and titles without covering document/editor DOM content. |
| DOM viewport | Keeps ProseMirror, chat, drag overlays, selection paths, transparent region proxies, image chrome, and SVG connector hit-testing. |
| PIXI media layer above DOM | Draws image pixels, edge visuals, image selection outlines, and other high-volume visual surfaces. |

Do not move region visuals into the media layer. The media layer sits above DOM content, so a semi-transparent cloud there can wash over documents and image chrome.

## Runtime Data Model

Persisted canvas nodes remain unchanged. Existing context-region-compatible nodes provide:

| Field | Source | Purpose |
|---|---|---|
| `nodeId` | `CanvasNode` | Stable identity for selection, drag, texture style hashing, and layer entries. |
| `referenceId` | `ContextRegionCanvasNode` / AI chat thread node | Links the region to its AI chat thread. |
| `position` | `CanvasNode` | Persisted position. Child positions remain parent-relative. |
| `dimensions` | `CanvasNode` | Logical region width and height. |
| `parentId` on child nodes | Existing canvas containment | Tracks documents/images adopted into the region. |

The renderer builds runtime-only `ContextRegionCloudDatum` values:

```typescript
type ContextRegionCloudDatum = {
    nodeId: string
    referenceId: string
    x: number
    y: number
    width: number
    height: number
    title: string
    selected: boolean
}
```

`WorkspaceCanvas` resolves parent-chain world positions and live drag/resize overrides before creating these datums. The PIXI layer therefore receives world-space geometry even when persisted child nodes remain parent-relative.

Visual style is not persisted. `getContextRegionCloudStyle(nodeId, width, height)` chooses a deterministic seafoam style from the node id and aspect class (`wide`, `square`, or `tall`). This keeps reloads stable without turning current visual tuning into a data contract.

## Shape Source

The current visible shape is a CO2 SVG cloud silhouette:

- One main cloud path.
- One top-left thought circle.
- A 512 by 512 viewbox.
- The same shape concept is used for rendered pixels, body hit testing, title placement, and drop-adoption scoring.

The constants currently live in both [pixiContextRegionLayer.ts](../../services/web-ui/src/infographics/workspace/rendering/pixiContextRegionLayer.ts) and [contextRegionClouds.ts](../../services/web-ui/src/infographics/workspace/rendering/contextRegionClouds.ts). If the silhouette changes, update both modules in the same change or first extract a shared shape module. A mismatch here causes the most confusing class of bugs: pixels show one shape while clicks/drops behave like another.

The implementation intentionally uses a custom SVG path parser instead of `Path2D(svgString)`. During visual iteration, constructing `Path2D` from SVG path strings was unreliable enough to cause blank rendering in the target browser/runtime path. The custom parser handles the command subset needed by the CO2 path (`m`, `c`, `s`, and `z`) and is duplicated in rendering and sampling form:

- `drawSvgPath(...)` paints the path into Canvas2D for texture generation.
- `sampleSvgPath(...)` converts cubic segments into points for polygon hit testing.

The texture stays square and preserves the CO2 cloud proportions. For non-square logical regions, the logical rectangle is centered inside a square visual backdrop whose side length is `max(width, height) + bleed * 2`. That avoids crushing the cloud silhouette into a cheap-looking stretched blob.

## Visual Texture

Each cloud style bakes a shared Canvas2D texture, then PIXI renders that texture as a `Sprite`. The texture size, mask threshold, gradient colors, gradient positions, cloud style variants, palette values, border, title, frame, and pulse values are configured in the separated context-region cloud section of [webUiThemeSettings.ts](../../services/web-ui/src/webUiThemeSettings.ts).

The current palette is seafoam, taken from `random-useful-things/image-color-analysis-tool/region-gradient-preview.html` and tuned to keep the patchy grain visible:

| Role | Color |
|---|---|
| Gradient color 1 | `#DDECE7` |
| Gradient color 2 | `#C7DAD4` |
| Gradient color 3 | `#EEF8F5` |
| Gradient color 4 | `#D6E7E1` |
| Base fill | `#E5F2EE` |
| Edge/accent | `#A1C3BA` / `#8FB5AB` |
| Title text | `#1F2937` |
| Region-contained image frame | `#FCFCFA` |

The texture pipeline is intentionally bake-heavy and runtime-light:

1. Create the CO2 cloud mask in an offscreen canvas.
2. Paint per-pixel seafoam gradient color into the mask using weighted gradient stops with a subtle swirl.
3. Add fractal/value-noise modulation for paper grain, pigment variation, and fiber-like texture.
4. Add translucent paint pools biased by aspect and seed.
5. Add soft subtractive cutbacks so the cloud does not read as a solid blob.
6. Add fine pigment speckles.
7. Optionally add the exact vector border ring when `webUiThemeSettings.contextRegionCloudBorderEnabled` is `true`.
8. Apply the CO2 mask once at the end with `destination-in`.
9. Convert the canvas to a PIXI `Texture` and cache it by texture version, border state, and style key.

The reference-like feel comes from the perimeter, uneven alpha, edge pooling, grain, translucent wash, and color variation. The implementation reaches that through the CO2 silhouette plus patchy seafoam texture.

## Theme Configuration

All current context-region cloud visual knobs are centralized in [webUiThemeSettings.ts](../../services/web-ui/src/webUiThemeSettings.ts):

| Setting | Purpose |
|---|---|
| `contextRegionCloudTextureSize` | Shared baked Canvas2D texture resolution. |
| `contextRegionCloudMaskAlphaThreshold` | Alpha cutoff used while painting cloud pixels into the CO2 mask. |
| `contextRegionCloudMinBleed` | Minimum visual bleed around a logical region rectangle. |
| `contextRegionCloudGradientBaseColor` | Base seafoam color mixed under the weighted gradient. |
| `contextRegionCloudGradientColors` | Four seafoam gradient colors used by the baked texture. |
| `contextRegionCloudGradientPositions` | Normalized positions for the four gradient color points. |
| `contextRegionCloudStyles` | Deterministic style options: aspect, bleed ratio, title anchor, palette, and seed. |
| `contextRegionCloudBorderEnabled` | Enables the baked exact vector border ring. |
| `contextRegionCloudBorderMainAlpha` | Border alpha for the main CO2 cloud path. |
| `contextRegionCloudBorderThoughtCircleAlpha` | Border alpha for the top-left thought circle. |
| `contextRegionCloudIdleAlpha` | Default backdrop sprite alpha. |
| `contextRegionCloudSelectedAlpha` | Backdrop sprite alpha while selected. |
| `contextRegionCloudPulseDurationMs` | Duration for the bounded event pulse. |
| `contextRegionCloudPulseAlphaLift` | Extra alpha applied at the peak of the pulse. |
| `contextRegionCloudPulseLiftPx` | Screen-space lift applied at the peak of the pulse. |
| `contextRegionCloudTitleFontFamily` | PIXI title text font family. |
| `contextRegionCloudTitleFontSize` | PIXI title text base font size. |
| `contextRegionCloudTitleFontWeight` | PIXI title text font weight. |
| `contextRegionCloudTitleAlpha` | PIXI title text alpha. |
| `contextRegionCloudTitleHeight` | Title hit/text rect height. |
| `contextRegionCloudTitleCharWidth` | Approximate title character width for hit rect sizing. |
| `contextRegionCloudTitleMinWidth` | Minimum title hit rect width. |
| `contextRegionCloudTitleMaxWidth` | Maximum title hit rect width. |
| `contextRegionCloudTitlePaddingX` | Extra horizontal title hit rect padding. |
| `contextRegionCloudTitleMinX` | Minimum title x inset from the visual bounds. |
| `contextRegionCloudTitleGap` | Gap between title rect and cloud visual bounds. |
| `contextRegionImageFrameColor` | Frame color for image nodes contained by context regions. |

CO2 path constants are still code-level geometry, not theme settings. If the cloud silhouette changes, update rendering and hit/adoption geometry together.

## Border Configuration

The cloud border is optional and controlled centrally:

```typescript
webUiThemeSettings.contextRegionCloudBorderEnabled: boolean
```

The default is `false`.

When enabled, the border is baked into the shared texture as an exact vector ring. It is not a separate selection outline sprite and it is not drawn by runtime chrome. Keeping it baked into the texture prevents duplicate or drifting cloud outlines during selection and pulse transforms.

The texture cache key includes border state. If the default changes, the cache naturally produces separate `border` and `no-border` textures.

## Hit Testing And Adoption

Context region hit testing is shape-based:

1. `WorkspaceCanvas` converts the pointer to world coordinates.
2. It first checks image and document node rectangles through `getNodeHitBeforeContextRegion(...)` so region hits do not steal clicks from content inside the cloud.
3. If no foreground node wins, it asks `contextRegionLayer.hitTest(worldPoint)`.
4. The layer checks datums from topmost to bottommost.
5. `hitTestContextRegionCloud(...)` checks the title rect first, then the CO2 body shape.
6. A hit returns only `title`, `body`, or `none`.

There is no `resize-handle` hit result for context regions now. Context region DOM proxies also do not create resize handles.

Drop adoption uses the same geometry model. `scoreRectAgainstContextRegionCloud(...)` broad-phase checks the square cloud bounds, then samples the dragged node's center, corners, edge midpoints, and drop point against the CO2 cloud shape. Transparent corners do not count as region body or drop target.

This shared geometry rule is non-negotiable: visible pixels, body clicks, title placement, and adoption scoring must remain aligned. Rectangular math is allowed only as a cheap broad phase.

## Workspace Integration

`WorkspaceCanvas` remains the orchestration owner:

- Builds region datums from current canvas nodes and AI chat thread titles.
- Keeps transparent context-region DOM nodes registered with `data-node-id` so existing drag, selection, connection, and parent-child paths still work.
- Skips resize-handle creation for context-region proxies.
- Routes pane-background clicks through image/document precedence, then cloud hit testing.
- Calls the normal drag machinery when a cloud body/title is clicked, so dragging a region still uses the existing canvas drag lifecycle.
- Includes context-region descendants in the live dragged set so children move visually with the parent region during drag, not only after commit.
- Uses CO2 cloud scoring when releasing a dragged node to decide parent adoption.
- Keeps generated output image nodes from being adopted into regions.

The transparent DOM proxy is compatibility glue, not the visual surface. Do not reintroduce a visible DOM region card or shifting-gradient rectangle unless the product direction changes again.

## Viewport And Rendering Lifecycle

`viewportBridge.applyViewport(...)` is the single sync point for pan/zoom. It applies:

- CSS `translate(...) scale(...)` to the DOM viewport.
- `world.position` and `world.scale` to the PIXI media layer.
- `world.position` and `world.scale` to the PIXI context-region layer.

The context-region PIXI application is initialized with:

- `preference: 'webgpu'` with WebGL fallback.
- Transparent background.
- `autoStart: false`.
- `sharedTicker: false`.
- Device-pixel-ratio capped resolution.
- Manual render scheduling.

The PIXI ticker is stopped. Renders are coalesced through `requestAnimationFrame`, and idle clouds do not consume GPU/CPU every frame. The only animation path is the bounded pulse (`PULSE_DURATION_MS = 700`) triggered per region; it briefly changes alpha and lifts the backdrop, then returns to idle and stops scheduling pulse frames.

Offscreen clouds are culled with a generous world-rect margin. Culling toggles `container.renderable`, not data ownership.

## Performance Model

The performance target is hundreds of clouds on an infinite canvas with fast pan/zoom/scale. The implementation follows the Pixi v8 research from the original docs:

| Research finding | Current design choice |
|---|---|
| Sprites are the cheapest common PIXI primitive for repeated textured visuals. | Each region gets one main cloud `Sprite` plus small title `Text`. |
| Texture generation, filters, masks, and render textures are expensive if repeated per region. | Textures are baked once per style and border state, then shared. |
| `cacheAsTexture()` and `generateTexture()` are useful for static content but risky when recached frequently or used for huge sparse textures. | Runtime does not create per-region `RenderTexture`s or recache on drag/resize. |
| Live filters need careful `filterArea` tuning and become costly at scale. | No live per-region blur, displacement, noise, or mask filters are used. |
| Manual render loops are valid when content is mostly static. | Auto ticker is disabled; renders happen only on sync, viewport, culling, or bounded pulse. |
| Culling should be explicit for large scenes. | Offscreen cloud containers are marked non-renderable. |

The texture cache key includes `CONTEXT_REGION_TEXTURE_VERSION`, border state, and style key. Increment the texture version when changing the baked texture algorithm in a way that could otherwise reuse stale cached results during a session.

## Research Notes

These implementation notes capture the constraints behind the current renderer.

### Visual anatomy

The architecture-diagram cloud reference worked because it had:

- Multi-lobed perimeter rather than a single ellipse.
- Broken alpha edge.
- Darker pigment near portions of the perimeter.
- Soft interior wash variation.
- Paper-like granulation.
- Enough transparency that content feels embedded instead of covered.

Smooth ellipse-based clouds read as synthetic and radial. The CO2 silhouette provides the macro shape; the seafoam texture provides the internal wash and grain.

### Pixi documentation findings

The fetched Pixi v8 docs supported these decisions:

- `Application` initialization is async and should be configured explicitly.
- Manual rendering is appropriate when no continuous animation is needed.
- `Sprite` plus shared `Texture` is the right runtime primitive for many repeated visuals.
- `Graphics` is fine for simple vector drawing but should not be cleared and rebuilt every frame for hundreds of decorative shapes.
- `cacheAsTexture()` and `renderer.generateTexture(...)` are useful tools, but recaching dynamic or very large content can create memory and frame-time problems.
- Filters such as blur, noise, and displacement can create interesting watercolor effects, but live per-region filter stacks are the wrong baseline for hundreds of clouds.
- Culling, explicit bounds, and non-interactive visual layers keep large scenes tractable.

### Alternative outcomes

| Alternative | Decision |
|---|---|
| Keep DOM/CSS regions and add masks | Rejected for current feature. It keeps DOM paint/layout cost and does not naturally solve shared texture reuse or shape-based adoption. |
| Draw every cloud from PIXI `Graphics` at runtime | Rejected as baseline. It can make scallops, but not the textured watercolor/seafoam wash without more cached layers. |
| Per-region `RenderTexture` generation | Deferred. Good for selected hero regions or future high-fidelity paths, but too much memory/churn for hundreds of arbitrary regions. |
| Custom shader/SDF watercolor | Deferred. High ceiling, higher risk, harder tuning, and unnecessary for the current accepted direction. |
| Authored bitmap atlas | Still viable future work if art direction requires hand-authored variation. Not used now. |
| SVG/CSS filters | Rejected as baseline. It does not fit the existing PIXI texture/culling pipeline and still needs custom hit testing. |
| Canvas2D-only background renderer | Rejected because PIXI already owns adjacent high-volume rendering, texture lifecycle, and viewport sync patterns. |

## Gotchas And Don'ts

Do not reintroduce rectangular body hit testing. Rectangles are broad-phase only.

Do not use a handmade `hitPolygon` style manifest unless it is generated from, or strictly aligned with, the visible silhouette.

Do not add context-region resize handles through the DOM proxy or PIXI chrome unless the interaction is redesigned. The current cloud hit API has no resize-handle branch.

Do not use `Path2D(svgString)` for the CO2 path without testing the target browser/runtime path. The custom parser exists because SVG-string `Path2D` was unreliable during implementation.

Do not apply masks component-by-component. Apply the CO2 mask once at the end of texture generation so grain, pools, cutbacks, speckles, and border remain coherent.

Do not create a separate selected outline cloud sprite. Selection should stay subtle and should not require a second silhouette copy.

Do not animate every cloud continuously. Use bounded event pulses and then stop scheduling frames.

Do not generate or upload per-region textures while dragging, resizing, panning, or zooming. Runtime gestures should update transforms and culling only.

Do not put context-region visuals in the media PIXI layer above DOM content.

Do not make the cloud opaque enough to compete with documents, images, or chat text. The region is context atmosphere.

Do not copy, crop, trace, or ship [services-architecture-diagram.jpeg](../assets/services-architecture-diagram.jpeg) as an asset. It is reference material only.

Do not persist visual style keys yet. Style selection is deterministic runtime behavior. Persist only if a future user-facing style picker is designed.

Do not wash out the seafoam gradient with too much alpha, bloom, or white overlay. The preview gradient colors should remain visibly present beneath the patchy grain.

Do not edit `WorkspaceCanvas` region behavior without checking image/document hit precedence. Region body hits must not steal clicks from content inside the cloud.

Do not update only one copy of the CO2 path constants. Rendering and hit/adoption geometry must move together.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Cloud pixels and clicks do not line up | Renderer shape and geometry shape diverged | Compare CO2 constants in `pixiContextRegionLayer.ts` and `contextRegionClouds.ts`. |
| Cloud becomes a square/rectangle hit target | Rectangular broad phase used as final hit | Inspect `hitTestContextRegionCloud(...)` and adoption scoring. |
| Image clicks inside a region start dragging the region | Foreground hit precedence broke | Check `getNodeHitBeforeContextRegion(...)` in `WorkspaceCanvas.ts`. |
| Children lag behind while dragging a region | Descendants were not included in live drag set | Check `includeContextRegionDescendants(...)` and live transforms. |
| A ghost cloud appears on selection | Separate selection silhouette was reintroduced | Keep selection chrome separate from a duplicate cloud sprite. |
| Texture looks pale or flat | Gradient/overlay alpha washed out color and grain | Check seafoam gradient mix, bloom overlays, and final alpha. |
| Border does not match the cloud | Border drawn as generic stroke or separate sprite | Use the baked exact vector ring path controlled by `contextRegionCloudBorderEnabled`. |
| Pan/zoom stutters with many regions | Runtime work moved into gestures | Look for per-region texture generation, live filters, or continuous ticker usage. |

## Future Work

These ideas are intentionally not part of the current implementation, but the research supports them if the product needs more fidelity later:

- Extract the CO2 path and sampled geometry into one shared module to remove duplicated constants.
- Add authored original bitmap atlas variants for more visual variety, still rendered as shared sprites.
- Add resolution tiers or low-memory texture variants if GPU memory pressure appears on lower-end devices.
- Consider a shader/SDF approach only after the shared-texture path reaches its visual ceiling.
- Add a user-facing region style/palette picker only with an explicit persisted data model and migration plan.
- Add a stress harness or Playwright visual scenario with hundreds of regions once this visual design stabilizes further.

## Related Documentation

- [CANVAS-ENGINE.md](CANVAS-ENGINE.md) documents the full DOM/SVG/PIXI canvas rendering architecture.
- [WORKSPACE-FEATURE.md](WORKSPACE-FEATURE.md) documents the workspace feature, data flow, and user-facing canvas concepts.
- [SHIFTING-GRADIENT.md](SHIFTING-GRADIENT.md) documents the shared gradient renderer used by AI chat thread backgrounds.

## Research Sources

Internal sources:

- [PRODUCT-OVERVIEW.md](../PRODUCT-OVERVIEW.md)
- [CANVAS-ENGINE.md](CANVAS-ENGINE.md)
- [WORKSPACE-FEATURE.md](WORKSPACE-FEATURE.md)
- [services-architecture-diagram.jpeg](../assets/services-architecture-diagram.jpeg)
- [pixiContextRegionLayer.ts](../../services/web-ui/src/infographics/workspace/rendering/pixiContextRegionLayer.ts)
- [contextRegionClouds.ts](../../services/web-ui/src/infographics/workspace/rendering/contextRegionClouds.ts)
- [WorkspaceCanvas.ts](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts)
- [viewportBridge.ts](../../services/web-ui/src/infographics/workspace/rendering/viewportBridge.ts)
- [workspace-canvas.scss](../../services/web-ui/src/infographics/workspace/workspace-canvas.scss)
- [webUiThemeSettings.ts](../../services/web-ui/src/webUiThemeSettings.ts)

PixiJS v8 sources fetched during research:

- <https://pixijs.com/8.x/guides/components/application>
- <https://pixijs.com/8.x/guides/components/application/culler-plugin>
- <https://pixijs.com/8.x/guides/concepts/render-loop>
- <https://pixijs.com/8.x/guides/concepts/render-groups>
- <https://pixijs.com/8.x/guides/concepts/render-layers>
- <https://pixijs.com/8.x/guides/components/scene-objects/container>
- <https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture>
- <https://pixijs.com/8.x/guides/components/scene-objects/graphics>
- <https://pixijs.com/8.x/guides/components/scene-objects/sprite>
- <https://pixijs.com/8.x/guides/components/textures>
- <https://pixijs.download/release/docs/app.Application.html>
- <https://pixijs.download/release/docs/scene.Graphics.html>
- <https://pixijs.download/release/docs/scene.GraphicsContext.html>
- <https://pixijs.download/release/docs/scene.Sprite.html>
- <https://pixijs.download/release/docs/scene.RenderLayer.html>
- <https://pixijs.download/release/docs/rendering.RenderTexture.html>
- <https://pixijs.download/release/docs/filters.BlurFilter.html>

External background:

- Curtis et al., "Computer-generated watercolor," SIGGRAPH. The current implementation does not simulate watercolor physics, but the paper's language around pigment glazing, edge darkening, granulation, paper texture, and diffusion informed the visual diagnosis.
