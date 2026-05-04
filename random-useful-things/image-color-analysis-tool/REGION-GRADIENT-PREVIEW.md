# Region Gradient Preview

`region-gradient-preview.html` is a standalone visual test page for the workspace AI chat region-card background.

It sits next to `gradient-sample.png` so the preview can render the current region card beside the reference image without starting the full web UI.

For numeric first-pass color fitting, see `ADVANCED-GRADIENT-COLOR-ANALYSIS.md` and `advanced_gradient_color_analysis.py` in this directory.

## What It Solves

The region card background is not a plain CSS gradient. In the app it comes from `ShiftingGradientRenderer`, then `workspace-canvas.scss` adds a pale base color, a soft center-depth overlay, and a glass edge overlay.

That combination is hard to tune from numeric color analysis alone because `gradient-sample.png` includes foreground image cards, text, shadows, and white borders. Those foreground elements can make analyzer-only palettes too dark or too gray.

The preview solves that by reproducing the important visual stack in one file:

- The same 60x80 bitmap renderer shape used by `ShiftingGradientRenderer`
- The same phase-4 color placement
- The same `distance^4` falloff and swirl math
- The same region-card CSS base, center-depth pass, and edge-glass pass
- A side-by-side comparison with `gradient-sample.png`

## How To Use It

Open the file directly in a browser:

```text
random-useful-things/image-color-analysis-tool/region-gradient-preview.html
```

The file expects `gradient-sample.png` to remain in the same directory.

When tuning the region card:

1. Edit the `colors` array in `region-gradient-preview.html`.
2. Edit the CSS values on `.workspace-ai-chat-thread-node--region`, `::before`, and `::after` if the base, center depth, or glass edge needs adjustment.
3. Reload the preview and compare the empty card against the sample.
4. Copy accepted palette changes to `contextRegionAreaShiftingGradientColors` in `services/web-ui/src/webUiThemeSettings.ts`.
5. Copy accepted CSS changes to `services/web-ui/src/infographics/workspace/workspace-canvas.scss`.
6. Keep `INITIAL_PHASE = 4` in `services/web-ui/src/utils/shiftingGradientRenderer.ts` unless intentionally retuning the color placement.

## Current Accepted Fit

The current accepted values are:

```typescript
contextRegionAreaShiftingGradientColors: ['#DDECE7', '#C7DAD4', '#EEF8F5', '#D6E7E1']
```

The region card CSS uses:

```scss
background: #E5F2EE;

> canvas.shifting-gradient-canvas {
    opacity: 0.80;
}
```

At phase 4, the renderer places the colors like this:

| Color | Visual area | Current value | Tuning note |
|-------|-------------|---------------|-------------|
| `color1` | Bottom-left | `#DDECE7` | Darkened slightly because the corner was too light |
| `color2` | Bottom-right | `#C7DAD4` | Lightened because the corner was too dark |
| `color3` | Upper-right | `#EEF8F5` | Keeps the top-right airy |
| `color4` | Upper-left | `#D6E7E1` | Keeps the top-left mint-sage |

## Important Limits

This preview is a design/tuning aid, not an app test. It does not cover drag/drop, region resizing, child adoption, ProseMirror editors, or Docker runtime behavior.

Use it only to judge the background rendering quickly. After tuning, verify the actual app files still use `createShiftingGradientBackground()` so the real region card remains backed by the renderer feature.