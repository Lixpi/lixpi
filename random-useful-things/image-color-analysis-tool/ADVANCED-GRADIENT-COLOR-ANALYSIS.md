# Advanced Gradient Color Analysis

`advanced_gradient_color_analysis.py` is a Python utility for fitting four shifting-gradient colors to a reference image.

Use it when you have a screenshot or mockup of a soft gradient and want a structured first pass at the four colors that could drive Lixpi's shifting gradient renderer.

It is an analysis helper, not an authoritative visual matcher. Always verify its output in `region-gradient-preview.html` or the actual app before copying values into production code.

## What It Is For

The script answers these questions:

- What are the reference image's brightness, chroma, hue, and RGB ranges?
- What colors dominate several important regions of the image?
- Which set of four RGB colors produces the lowest perceptual error for the script's gradient model?
- Which tested phase gives the lowest error?
- How do several rendered sample points compare with the original image?

It is most useful for clean abstract gradients, wallpapers, and reference images where most pixels belong to the background gradient.

It is less reliable for UI mockups that contain large foreground cards, text, images, shadows, or borders. Those pixels still affect the analysis even after blur.

## Dependencies

The script imports:

- `numpy`
- `Pillow` (`PIL`)
- `scipy`
- `colormath`

For local one-off use:

```bash
python -m pip install numpy pillow scipy colormath
```

For Lixpi container-based use, run it in a Python service container that already has or can install those packages. If the utility folder is not mounted into the container, copy the script and image into a mounted or writable container path first.

## How To Run It

From the repo root, pass a local image path explicitly:

```bash
python random-useful-things/image-color-analysis-tool/advanced_gradient_color_analysis.py random-useful-things/image-color-analysis-tool/gradient-sample.png
```

The script also accepts an HTTP or HTTPS URL:

```bash
python random-useful-things/image-color-analysis-tool/advanced_gradient_color_analysis.py https://example.com/reference-gradient.png
```

If no argument is passed, it uses the hard-coded default Pinterest URL in `main()`. Do not rely on that default for reproducible work; remote images can disappear, change, block automated requests, or fail when network access is unavailable.

When running through Docker Compose, copy the files into the Python container and execute the script with `docker compose exec`:

```bash
docker compose cp random-useful-things/image-color-analysis-tool/advanced_gradient_color_analysis.py lixpi-llm-api:/app/src/tmp/advanced_gradient_color_analysis.py
docker compose cp random-useful-things/image-color-analysis-tool/gradient-sample.png lixpi-llm-api:/app/src/tmp/gradient-sample.png
docker compose exec lixpi-llm-api python /app/src/tmp/advanced_gradient_color_analysis.py /app/src/tmp/gradient-sample.png
```

The script prints all results to stdout. It does not write JSON, images, or reports to disk.

## What It Does

### 1. Loads The Reference Image

`load_image()` accepts a local path or URL, opens it with Pillow, and converts it to RGB.

Local paths are resolved relative to the current working directory. If you get `FileNotFoundError`, run the command from the repo root or pass an absolute path.

### 2. Blurs High-Frequency Detail

`remove_pattern_overlay()` applies a Gaussian blur to each RGB channel.

In `main()`, this currently uses `sigma=3.0`:

```python
smoothed = remove_pattern_overlay(img_array, sigma=3.0)
```

This helps with small texture or wallpaper patterns. It does not remove large UI foreground elements such as cards, screenshots, labels, borders, or shadows.

### 3. Samples A Color Grid

`create_high_res_color_grid()` samples a regular grid across the blurred image and records each sample in RGB, LAB, and LCH.

In `main()`, the grid is currently 50x50:

```python
GRID_SIZE = 50
```

That gives 2,500 samples. Increasing the grid can improve detail but makes optimization slower.

### 4. Reports Color Distribution

`analyze_color_distribution()` prints:

- LAB lightness range, mean, and standard deviation
- LCH chroma range, mean, and standard deviation
- LCH hue range
- RGB min, max, and mean values per channel

This section is useful for sanity checking. If the lightness range is unexpectedly wide or the RGB ranges include very dark/white extremes, foreground content is probably influencing the analysis.

### 5. Extracts Regional Starting Colors

`find_corner_colors()` averages four hard-coded regions:

| Region name | Approximate sample area | Intended use |
|-------------|-------------------------|--------------|
| `top_right` | Right side near the top | Initial `color1` |
| `center_right` | Right side around the middle | Initial `color2` |
| `top_left` | Left side near the top | Initial `color3` |
| `bottom_center` | Center area near the bottom | Initial `color4` |

Those averages become the optimizer's initial color estimate. They are only a heuristic; they may be wrong if the target image's gradient blobs are elsewhere.

### 6. Optimizes Four Colors In LAB Space

`optimize_colors_perceptual()` uses SciPy differential evolution to search for four RGB colors that minimize `compute_perceptual_error()`.

The error function:

- Renders the script's gradient model at each sample point
- Converts the rendered color to LAB
- Compares it to the reference sample's LAB value
- Weights lightness more heavily than the `a` and `b` channels

Current optimization settings favor speed over exhaustive precision:

```python
maxiter=20
popsize=8
tol=0.1
polish=False
workers=1
seed=42
```

The fixed seed makes runs more repeatable. Because `maxiter`, `popsize`, and `tol` are relaxed, the result is a practical estimate, not a guaranteed global best fit.

### 7. Tests A Limited Set Of Phases

The script currently tests only phases 0, 1, and 2:

```python
for phase in [0, 1, 2]:
```

This is one of the biggest gotchas. The accepted workspace region-card background uses phase 4. If you are fitting that region card, change the loop to include phase 4, or test all phases:

```python
for phase in range(8):
```

### 8. Applies Brightness Correction

After selecting the best phase and colors, the script compares the fitted colors' LAB lightness range against the reference image.

If the fitted colors are too dark, it shifts their LAB lightness upward while trying to preserve hue:

```python
new_l = min(100, max(0, lab[0] + l_shift * 0.7))
```

This can help when the optimizer underestimates brightness, but it can also wash out useful contrast. Treat the corrected output as a candidate, not a final answer.

### 9. Prints Pasteable Output

The final section prints:

- Best tested phase
- Average perceptual error
- Four colors as `color1` through `color4`
- A TypeScript object named `GRADIENT_COLORS`
- `const CURRENT_PHASE = ...`
- Sample point comparisons between reference and rendered colors

The printed TypeScript object is not the current app's preferred configuration shape. Convert the colors into the hex array in `services/web-ui/src/webUiThemeSettings.ts`:

```typescript
contextRegionAreaShiftingGradientColors: ['#DDECE7', '#C7DAD4', '#EEF8F5', '#D6E7E1']
```

Then verify `INITIAL_PHASE` in `services/web-ui/src/utils/shiftingGradientRenderer.ts`.

## Important Gotchas

### The Script Is Not An Exact Match For The Current Renderer

The file header says it is an exact replication of the shifting gradient renderer, but the current web UI renderer has diverged.

Important differences include:

- The current TypeScript renderer uses one 8-entry `PHASE_POSITIONS` list and selects color positions with `(phase + i * 2) % 8`; this script stores each phase as a separate 4-position list.
- The current TypeScript renderer uses a bounded falloff: `max(0, 0.9 - dist)^4`; this script uses inverse-distance weighting: `1 / distance^4`.
- The current TypeScript swirl math uses a squared center-distance formula; this script uses `angle = dist * factor * pi`.
- The current accepted region card uses phase 4, while this script only tests phases 0, 1, and 2 unless edited.

Because of those differences, analyzer output can be directionally useful while still looking wrong in the app.

### Foreground UI Pollutes Results

The blur step removes small texture, not large objects. In `gradient-sample.png`, the foreground cards, text, image thumbnails, shadows, and white borders influence the sampled colors.

For better results:

- Crop to the largest clean background area before running the script
- Mask or paint over foreground cards with nearby background colors
- Compare regional averages against what your eyes see in the background, not the whole screenshot
- Use `region-gradient-preview.html` before touching app constants

### Color Order Matters

The four output colors are not just a palette. Each one is tied to a renderer position for the tested phase.

For the accepted region-card phase 4 in the current app:

| Color | Visual area |
|-------|-------------|
| `color1` | Bottom-left |
| `color2` | Bottom-right |
| `color3` | Upper-right |
| `color4` | Upper-left |

If a corner looks wrong, adjust the color mapped to that corner. Do not sort colors by lightness or hue after optimization unless you also update the phase mapping.

### A Low Delta E Does Not Guarantee A Good UI Match

The optimizer minimizes average sample error. A UI background can still feel wrong if:

- The center depth is too flat
- One corner is too dark
- Edges are not glassy enough
- Foreground content biased the sampled colors
- The CSS overlays in the app change the perceived result

Use the numerical output to get close, then tune visually.

### The Script Has No CLI Flags

The only command-line input is the optional image source. To change behavior, edit constants or code directly:

| What to change | Where |
|----------------|-------|
| Input image default | `source = ...` in `main()` |
| Blur amount | `sigma=3.0` in `remove_pattern_overlay()` call |
| Sample density | `GRID_SIZE = 50` |
| Tested phases | `for phase in [0, 1, 2]` |
| Optimizer speed/quality | `maxiter`, `popsize`, `tol`, `polish` |
| Renderer model | `PHASE_POSITIONS`, `apply_swirl()`, `render_gradient_at_pixel()` |

### Remote URLs Are Fragile

URL inputs depend on network access and remote server behavior. Some hosts block automated downloads even with the script's browser-like user agent.

For repeatable work, download the image first and run the script on a local file.

### It Prints Old-Style TypeScript

The output uses `GRADIENT_COLORS` and `CURRENT_PHASE`. Current app code uses:

- `webUiThemeSettings.contextRegionAreaShiftingGradientColors` for context region card color hex values
- `webUiThemeSettings.shiftingGradientColors` for the shared default gradient and animated border palette
- `INITIAL_PHASE` in `shiftingGradientRenderer.ts` for the starting phase

Do the conversion manually and keep comments accurate.

## Recommended Workflow

1. Prepare the cleanest possible reference image. Crop or mask foreground UI if needed.
2. Run `advanced_gradient_color_analysis.py` on the local image.
3. Check the color distribution and regional averages for obvious pollution.
4. If targeting the region card, make sure phase 4 is tested.
5. Copy candidate colors into `region-gradient-preview.html` first.
6. Tune the preview visually against `gradient-sample.png`.
7. Copy accepted colors to `services/web-ui/src/webUiThemeSettings.ts`.
8. Copy accepted overlay changes to `services/web-ui/src/infographics/workspace/workspace-canvas.scss`.
9. Verify the actual app still uses `createShiftingGradientBackground()` for the region card.

## When To Use The Preview Instead

Use `region-gradient-preview.html` directly when:

- The reference image is already the region-card mockup
- You are only making small corner or edge-lightness adjustments
- The analyzer output looks gray, muddy, too dark, or too flat
- The target phase is known and you need a quick visual comparison

The analyzer is good at finding a first palette family. The preview is better at deciding whether the final UI actually looks right.