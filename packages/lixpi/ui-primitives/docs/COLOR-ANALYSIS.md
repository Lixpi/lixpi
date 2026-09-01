---
title: Reference gradient color analysis
description: Numeric fitting workflow and limits of the standalone Python reference-image tool.
---

# Reference gradient color analysis

The repository's [analysis script](../../../../random-useful-things/image-color-analysis-tool/advanced_gradient_color_analysis.py) fits four colors to a reference image. It is an optional analysis utility, not a runtime dependency of UI Primitives and not an exact implementation of [the TypeScript gradient](GRADIENTS.md).

## Running the numeric analysis

Use a Python container with NumPy, Pillow, SciPy and colormath. From the repository root, the following one-shot command installs dependencies inside the container and reads the sample through a read-only mount:

```bash
docker run --rm -v "$PWD/random-useful-things/image-color-analysis-tool:/analysis:ro" -w /analysis python:3.12-slim sh -c 'pip install numpy pillow scipy colormath && python advanced_gradient_color_analysis.py gradient-sample.png'
```

Pass an explicit local path for repeatable input. The script also accepts an HTTP/HTTPS URL, but remote images can change or reject requests. Do not depend on its hard-coded fallback URL. Results print to stdout; the script does not save a report or image.

## What the script measures

The script opens the image as RGB, applies Gaussian blur to suppress small patterns, samples a regular grid, and reports RGB ranges plus LAB lightness and LCH chroma/hue. Regional averages seed the four-color optimizer. Differential evolution minimizes average perceptual error for each tested phase.

The main function uses a 50-by-50 sample grid, blur sigma 3 and phases 0, 1 and 2. These are script settings, not command-line flags. Adjust the phase loop when another phase is required; a phase-4 background cannot be fitted by comparing only the first three phases.

After optimization, a lightness correction may brighten the fitted colors. Treat that as another candidate because it can reduce contrast. Output includes the phase, error, colors, a TypeScript-shaped object and sample-point comparisons. Convert the colors into the renderer's four-value tuple; do not paste the output as application settings.

## Limits

The script and renderer use different models. The TypeScript renderer selects four points from one eight-position cycle, uses bounded `max(0, 0.9 - distance)^4` weights and squared center-distance swirl. The Python model stores separate phase positions, uses inverse-distance weights and a different swirl formula. A low numeric error in that model does not establish a matching rendered background.

LAB gives an approximate perceptual distance; it is not a guarantee of equal perceived difference in every color region or viewing condition. Color order matters because each color belongs to an anchor. Do not sort fitted colors without changing their phase mapping.

Blur removes fine texture, not foreground cards, text, photos, shadows or borders. Crop or mask those regions before fitting. Inspect the reported lightness and RGB ranges for contamination.

The repository also contains a [standalone historical region-card preview](../../../../random-useful-things/image-color-analysis-tool/region-gradient-preview.html) and its [sample](../../../../random-useful-things/image-color-analysis-tool/gradient-sample.png). That file duplicates a particular design experiment and is not the live renderer or an automated regression test. Agent verification in this repository does not use browser inspection.

## Applying a candidate

Keep palette choices in the consuming component or application theme. Keep generic sampling and phase math here. Compare the candidate against the actual renderer's algorithm and the target component's opacity, base fill and overlays before accepting it. Numeric fitting alone cannot establish the final appearance.
