# UI Primitives

[Gradients](docs/GRADIENTS.md) covers shared color and rendering utilities. [Color analysis](docs/COLOR-ANALYSIS.md) explains the numeric analysis workflow and its limits. See [license and dependency notices](NOTICES.md).

`@lixpi/ui-primitives` supplies shared DOM templates, SVG utilities, gradients, easing functions and Sass transition helpers. It has no dependency on UI-kit, canvas packages, application settings or services. Icon artwork, concrete icon definitions, SVG textures and their licenses belong to [UI-kit](../ui-kit/README.md).

Consumers import TypeScript source through explicit package exports. No package build or generated JavaScript is required.

```typescript
import { html, applyStyle, createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { appendSvgPathIcon, roundedRectanglePath } from '@lixpi/ui-primitives/svg'
import { Easing, easeHover } from '@lixpi/ui-primitives/animation'
import { createShiftingGradientBackground } from '@lixpi/ui-primitives/gradients'
```

`html` and `createEl` create real elements in the current document. They attach event handlers, append child nodes and apply class, style, data and attribute values. `applyStyle` updates several style properties on an existing HTML or SVG element. These helpers do not mount elements or own their cleanup.

`createDocumentHtml(document)` binds a template to a supplied browser document, including detached documents without a window. It supports nested child arrays, numeric text, boolean attributes, `textContent` and trusted `innerHTML`; null, undefined and false attributes are omitted. It keeps document-local rendering independent of the global document. Use this entrypoint for document-scoped embedded views.

`getElementBorderRadius(element, width, height)` resolves a circular corner radius from the element's computed pixel or percentage radii, clamped to its box. It uses the element's document and does not discover or cache DOM targets.

`ElementStyleLease` temporarily overrides named CSS properties on an explicit element. It preserves overlapping owners when they finish out of order, then restores the original inline values and priorities after the final lease ends. Pass CSS property names such as `user-select`; call `destroy()` when the interaction or component ends.

`getElementScale(element)` reads the element's transform scale. `copyCssCustomProperties(source, target, names)` copies an explicit list of computed custom properties, falling back to inline values for detached elements. Neither helper searches for application containers or copies unrelated styling.

`isEditableTarget(target)` recognizes form controls and contenteditable descendants without relying on global browser constructors. Controllers use it to leave text-editing keys with the editor.

`extractSvgPathIcon` parses caller-supplied SVG path data and dimensions. `appendSvgPathIcon` replaces a D3 group's children with normalized paths in a requested box. `roundedRectanglePath` creates path data from a rectangle and radius. `AnimatedSvgIcon` animates caller-defined SVG parts between named states and releases its transitions when destroyed. None of these utilities embeds an icon catalog.

`sanitizeSvgId` normalizes an identifier for SVG resource references. `flattenSvgPath` samples a single continuous path made of `M`, `L`, `H`, `V`, `C`, `Q` and `Z` commands, including relative coordinates and compact numeric syntax. Unsupported commands, multiple subpaths and incomplete coordinates throw. `getPathLength`, `getPointAtPathLength` and `isPointNearPath` operate on those sampled points without a DOM. Curves use fixed sampling, so lengths and hit tests are approximations.

`FreeformGradientRenderer` samples colors and paints bitmaps. `SvgGradientRenderer` creates and animates SVG gradient definitions. `ShiftingGradientBackground` owns its renderer and observers unless the caller supplies a shared `ShiftingGradientRenderer`. Destroy backgrounds individually; destroy an explicitly shared renderer when its owner ends. Pattern loads are cancelled on disposal or replacement. Palettes and pattern artwork are caller data.

The gradient entrypoint also supplies six-digit hex normalization, RGB/HSL conversion, color mixing and bounded saturation/lightness adjustment. Invalid hex input uses the caller's fallback, or black when omitted. `svgToCssImageUrl` in the SVG entrypoint encodes caller-supplied artwork for a CSS background without embedding any icon definitions.

```scss
@use '@lixpi/ui-primitives/styles/transitions' as *;
```

The stylesheet exports hover, standard, pop-out, overlay visibility, panel slide, and click-feedback helpers. The animation module supplies matching JavaScript easing curves and CSS timing strings.

Run colocated tests through the repository's Docker runner:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared ui-primitives
```
