"""
Advanced Gradient Color Analysis Tool

This tool performs a deep, high-resolution analysis of a reference gradient image
to extract the exact 4 colors used in the shifting gradient algorithm.

Uses multiple color spaces (RGB, LAB, LCH) for perceptually accurate analysis.
"""

import urllib.request
from io import BytesIO
import numpy as np
from PIL import Image, ImageFilter
from colormath.color_objects import sRGBColor, LabColor, LCHabColor
from colormath.color_conversions import convert_color
from scipy.optimize import minimize, differential_evolution
from scipy.ndimage import gaussian_filter
import math
import os
import sys
from typing import Tuple, List, Dict
import json


# ============================================================================
# GRADIENT ALGORITHM (exact replication of shifting gradient renderer)
# ============================================================================

# 8 phases for the gradient positions
PHASE_POSITIONS = [
    # Phase 0
    [(0.80, 0.10), (0.60, 0.20), (0.35, 0.25), (0.25, 0.60)],
    # Phase 1
    [(0.65, 0.10), (0.80, 0.40), (0.20, 0.25), (0.35, 0.75)],
    # Phase 2
    [(0.50, 0.10), (0.75, 0.65), (0.15, 0.25), (0.45, 0.90)],
    # Phase 3
    [(0.35, 0.10), (0.55, 0.85), (0.20, 0.40), (0.55, 1.05)],
    # Phase 4
    [(0.20, 0.10), (0.40, 0.80), (0.35, 0.55), (0.65, 0.90)],
    # Phase 5
    [(0.20, 0.25), (0.25, 0.60), (0.50, 0.70), (0.75, 0.75)],
    # Phase 6
    [(0.25, 0.40), (0.10, 0.40), (0.65, 0.85), (0.85, 0.60)],
    # Phase 7
    [(0.35, 0.55), (0.15, 0.20), (0.80, 1.00), (0.95, 0.45)],
]


def apply_swirl(x: float, y: float, factor: float = 0.35) -> Tuple[float, float]:
    """Apply swirl distortion to coordinates."""
    cx, cy = 0.5, 0.5
    dx = x - cx
    dy = y - cy
    dist = math.sqrt(dx * dx + dy * dy)
    angle = dist * factor * math.pi
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    new_x = cx + dx * cos_a - dy * sin_a
    new_y = cy + dx * sin_a + dy * cos_a
    return new_x, new_y


def render_gradient_at_pixel(
    x: float, y: float,
    colors: List[Tuple[int, int, int]],
    positions: List[Tuple[float, float]],
    width: int, height: int
) -> Tuple[int, int, int]:
    """
    Render gradient color at a specific pixel using the shifting gradient algorithm.
    Uses inverse distance weighting with distance^4 falloff.
    """
    # Normalize coordinates
    nx = x / width
    ny = y / height

    # Apply swirl distortion
    swirled_x, swirled_y = apply_swirl(nx, ny)

    # Calculate weighted color using inverse distance^4
    total_r, total_g, total_b = 0.0, 0.0, 0.0
    total_weight = 0.0

    for i, (px, py) in enumerate(positions):
        dx = swirled_x - px
        dy = swirled_y - py
        dist_sq = dx * dx + dy * dy
        # Avoid division by zero
        dist_sq = max(dist_sq, 0.0001)
        # Weight = 1 / distance^4
        weight = 1.0 / (dist_sq * dist_sq)

        r, g, b = colors[i]
        total_r += r * weight
        total_g += g * weight
        total_b += b * weight
        total_weight += weight

    return (
        int(min(255, max(0, total_r / total_weight))),
        int(min(255, max(0, total_g / total_weight))),
        int(min(255, max(0, total_b / total_weight)))
    )


def render_full_gradient(
    colors: List[Tuple[int, int, int]],
    phase: int,
    width: int = 200,
    height: int = 200
) -> np.ndarray:
    """Render full gradient image at given resolution."""
    positions = PHASE_POSITIONS[phase]
    img = np.zeros((height, width, 3), dtype=np.uint8)

    for y in range(height):
        for x in range(width):
            r, g, b = render_gradient_at_pixel(x, y, colors, positions, width, height)
            img[y, x] = [r, g, b]

    return img


# ============================================================================
# COLOR SPACE CONVERSION UTILITIES
# ============================================================================

def rgb_to_lab(r: int, g: int, b: int) -> Tuple[float, float, float]:
    """Convert RGB to CIE LAB color space for perceptual analysis."""
    rgb = sRGBColor(r / 255.0, g / 255.0, b / 255.0)
    lab = convert_color(rgb, LabColor)
    return (lab.lab_l, lab.lab_a, lab.lab_b)


def lab_to_rgb(l: float, a: float, b: float) -> Tuple[int, int, int]:
    """Convert CIE LAB back to RGB."""
    lab = LabColor(l, a, b)
    rgb = convert_color(lab, sRGBColor)
    return (
        int(min(255, max(0, rgb.clamped_rgb_r * 255))),
        int(min(255, max(0, rgb.clamped_rgb_g * 255))),
        int(min(255, max(0, rgb.clamped_rgb_b * 255)))
    )


def rgb_to_lch(r: int, g: int, b: int) -> Tuple[float, float, float]:
    """Convert RGB to LCH (cylindrical LAB) for better hue analysis."""
    rgb = sRGBColor(r / 255.0, g / 255.0, b / 255.0)
    lch = convert_color(rgb, LCHabColor)
    return (lch.lch_l, lch.lch_c, lch.lch_h or 0)


# ============================================================================
# ADVANCED IMAGE ANALYSIS
# ============================================================================

def load_image(source: str) -> Image.Image:
    """Load image from a URL or local file path."""
    if source.startswith("http://") or source.startswith("https://"):
        print(f"Downloading image from: {source}")
        req = urllib.request.Request(source, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = response.read()
        return Image.open(BytesIO(data)).convert('RGB')

    if not os.path.exists(source):
        raise FileNotFoundError(f"Image not found: {source}")

    print(f"Loading image from: {source}")
    return Image.open(source).convert('RGB')


def remove_pattern_overlay(img: np.ndarray, sigma: float = 5.0) -> np.ndarray:
    """
    Remove pattern overlay from image using frequency domain analysis.
    Many gradient wallpapers have a doodle pattern overlay that we need to remove
    to analyze the underlying gradient colors.
    """
    # Apply Gaussian blur to remove high-frequency pattern
    smoothed = np.zeros_like(img, dtype=np.float64)
    for c in range(3):
        smoothed[:, :, c] = gaussian_filter(img[:, :, c].astype(np.float64), sigma=sigma)
    return smoothed


def create_high_res_color_grid(img: np.ndarray, grid_size: int = 100) -> List[Dict]:
    """
    Create a high-resolution grid of color samples from the image.
    Returns list of dicts with position and color info in multiple color spaces.
    """
    h, w = img.shape[:2]
    samples = []

    for gy in range(grid_size):
        for gx in range(grid_size):
            # Calculate pixel position
            x = int((gx + 0.5) * w / grid_size)
            y = int((gy + 0.5) * h / grid_size)

            # Get RGB color
            r, g, b = int(img[y, x, 0]), int(img[y, x, 1]), int(img[y, x, 2])

            # Convert to other color spaces
            lab_l, lab_a, lab_b = rgb_to_lab(r, g, b)
            lch_l, lch_c, lch_h = rgb_to_lch(r, g, b)

            samples.append({
                'x': gx / grid_size,
                'y': gy / grid_size,
                'rgb': (r, g, b),
                'lab': (lab_l, lab_a, lab_b),
                'lch': (lch_l, lch_c, lch_h)
            })

    return samples


def analyze_color_distribution(samples: List[Dict]) -> Dict:
    """
    Analyze color distribution to understand the gradient structure.
    """
    # Extract arrays
    lab_l = np.array([s['lab'][0] for s in samples])
    lab_a = np.array([s['lab'][1] for s in samples])
    lab_b = np.array([s['lab'][2] for s in samples])

    lch_c = np.array([s['lch'][1] for s in samples])
    lch_h = np.array([s['lch'][2] for s in samples])

    rgb_r = np.array([s['rgb'][0] for s in samples])
    rgb_g = np.array([s['rgb'][1] for s in samples])
    rgb_b = np.array([s['rgb'][2] for s in samples])

    return {
        'lightness': {'min': float(lab_l.min()), 'max': float(lab_l.max()), 'mean': float(lab_l.mean()), 'std': float(lab_l.std())},
        'chroma': {'min': float(lch_c.min()), 'max': float(lch_c.max()), 'mean': float(lch_c.mean()), 'std': float(lch_c.std())},
        'hue': {'min': float(lch_h.min()), 'max': float(lch_h.max()), 'mean': float(lch_h.mean()), 'std': float(lch_h.std())},
        'rgb_ranges': {
            'r': {'min': int(rgb_r.min()), 'max': int(rgb_r.max()), 'mean': float(rgb_r.mean())},
            'g': {'min': int(rgb_g.min()), 'max': int(rgb_g.max()), 'mean': float(rgb_g.mean())},
            'b': {'min': int(rgb_b.min()), 'max': int(rgb_b.max()), 'mean': float(rgb_b.mean())}
        }
    }


def find_corner_colors(samples: List[Dict], grid_size: int = 100) -> Dict[str, Tuple[int, int, int]]:
    """
    Find the dominant colors in each corner region.
    The gradient positions colors roughly in corners/edges.
    """
    quarter = grid_size // 4

    regions = {
        'top_right': [],     # Color 1
        'center_right': [],  # Color 2
        'top_left': [],      # Color 3
        'bottom_center': [], # Color 4
    }

    for s in samples:
        gx = int(s['x'] * grid_size)
        gy = int(s['y'] * grid_size)

        # Top right quadrant
        if gx > grid_size * 0.6 and gy < grid_size * 0.3:
            regions['top_right'].append(s)
        # Center right
        elif gx > grid_size * 0.6 and grid_size * 0.3 <= gy < grid_size * 0.6:
            regions['center_right'].append(s)
        # Top left
        elif gx < grid_size * 0.4 and gy < grid_size * 0.4:
            regions['top_left'].append(s)
        # Bottom center
        elif grid_size * 0.3 < gx < grid_size * 0.7 and gy > grid_size * 0.6:
            regions['bottom_center'].append(s)

    result = {}
    for region_name, region_samples in regions.items():
        if region_samples:
            avg_r = int(np.mean([s['rgb'][0] for s in region_samples]))
            avg_g = int(np.mean([s['rgb'][1] for s in region_samples]))
            avg_b = int(np.mean([s['rgb'][2] for s in region_samples]))
            result[region_name] = (avg_r, avg_g, avg_b)

    return result


# ============================================================================
# ADVANCED OPTIMIZATION IN LAB SPACE
# ============================================================================

def compute_perceptual_error(
    colors_flat: np.ndarray,
    reference_samples: List[Dict],
    phase: int,
    grid_size: int = 100
) -> float:
    """
    Compute perceptual error in LAB color space (Delta E).
    This is more accurate than RGB MSE for human perception.
    """
    # Extract colors
    colors = [
        (int(colors_flat[0]), int(colors_flat[1]), int(colors_flat[2])),
        (int(colors_flat[3]), int(colors_flat[4]), int(colors_flat[5])),
        (int(colors_flat[6]), int(colors_flat[7]), int(colors_flat[8])),
        (int(colors_flat[9]), int(colors_flat[10]), int(colors_flat[11])),
    ]

    positions = PHASE_POSITIONS[phase]
    total_error = 0.0

    for sample in reference_samples:
        # Get reference LAB
        ref_lab = sample['lab']

        # Calculate rendered pixel
        px = int(sample['x'] * grid_size)
        py = int(sample['y'] * grid_size)
        rendered_rgb = render_gradient_at_pixel(
            px, py, colors, positions, grid_size, grid_size
        )

        # Convert rendered to LAB
        rendered_lab = rgb_to_lab(*rendered_rgb)

        # Delta E (CIE76 - simple Euclidean distance in LAB)
        dL = ref_lab[0] - rendered_lab[0]
        da = ref_lab[1] - rendered_lab[1]
        db = ref_lab[2] - rendered_lab[2]

        # Weight lightness more heavily (more perceptually important)
        delta_e = math.sqrt(dL * dL * 1.5 + da * da + db * db)
        total_error += delta_e

    return total_error / len(reference_samples)


def optimize_colors_perceptual(
    reference_samples: List[Dict],
    initial_colors: List[Tuple[int, int, int]],
    phase: int,
    grid_size: int = 100
) -> Tuple[List[Tuple[int, int, int]], float]:
    """
    Optimize colors using perceptual Delta E metric in LAB space.
    Uses differential evolution for global optimization.
    """
    # Flatten initial colors for optimizer
    x0 = np.array([c for color in initial_colors for c in color], dtype=np.float64)

    # Bounds: RGB values 0-255
    bounds = [(0, 255)] * 12

    def objective(x):
        return compute_perceptual_error(x, reference_samples, phase, grid_size)

    # Use differential evolution for global optimization
    print(f"  Running differential evolution optimization for phase {phase}...", flush=True)
    result = differential_evolution(
        objective,
        bounds,
        seed=42,
        maxiter=20,  # Reduced for speed
        popsize=8,   # Smaller population
        mutation=(0.5, 1.0),
        recombination=0.7,
        tol=0.1,     # Higher tolerance to converge faster
        polish=False,  # Skip polishing for speed
        workers=1
    )

    # Extract optimized colors
    opt_colors = [
        (int(result.x[0]), int(result.x[1]), int(result.x[2])),
        (int(result.x[3]), int(result.x[4]), int(result.x[5])),
        (int(result.x[6]), int(result.x[7]), int(result.x[8])),
        (int(result.x[9]), int(result.x[10]), int(result.x[11])),
    ]

    return opt_colors, result.fun


def brightness_adjust_colors(
    colors: List[Tuple[int, int, int]],
    target_lightness_range: Tuple[float, float],
    current_lightness_range: Tuple[float, float]
) -> List[Tuple[int, int, int]]:
    """
    Adjust colors to match target lightness range while preserving hue.
    Works in LAB color space.
    """
    adjusted = []
    target_min, target_max = target_lightness_range
    current_min, current_max = current_lightness_range

    for r, g, b in colors:
        lab_l, lab_a, lab_b = rgb_to_lab(r, g, b)

        # Scale lightness to target range
        if current_max > current_min:
            normalized = (lab_l - current_min) / (current_max - current_min)
            new_l = target_min + normalized * (target_max - target_min)
        else:
            new_l = lab_l

        # Convert back to RGB
        adj_r, adj_g, adj_b = lab_to_rgb(new_l, lab_a, lab_b)
        adjusted.append((adj_r, adj_g, adj_b))

    return adjusted


# ============================================================================
# MAIN ANALYSIS PIPELINE
# ============================================================================

def main():
    source = "https://i.pinimg.com/736x/88/21/1f/88211ffcd43a21a9a16dc460d05b3713.jpg"
    if len(sys.argv) > 1:
        source = sys.argv[1]

    print("=" * 80)
    print("ADVANCED GRADIENT COLOR ANALYSIS")
    print("=" * 80)

    # Download and preprocess image
    img = load_image(source)
    img_array = np.array(img)
    print(f"Original image size: {img_array.shape}")

    # Remove pattern overlay with multiple blur levels
    print("\nRemoving pattern overlay...")
    # Use moderate blur to remove pattern but preserve gradient structure
    smoothed = remove_pattern_overlay(img_array, sigma=3.0)

    # Create color grid - 50x50 is enough for optimization (2500 samples)
    GRID_SIZE = 50  # Reduced for faster optimization
    print(f"\nCreating {GRID_SIZE}x{GRID_SIZE} color sample grid...")
    samples = create_high_res_color_grid(smoothed, GRID_SIZE)
    print(f"Total samples: {len(samples)}")

    # Analyze color distribution
    print("\nAnalyzing color distribution...")
    distribution = analyze_color_distribution(samples)
    print(f"  Lightness range: {distribution['lightness']['min']:.1f} - {distribution['lightness']['max']:.1f}")
    print(f"  Lightness mean: {distribution['lightness']['mean']:.1f}, std: {distribution['lightness']['std']:.1f}")
    print(f"  Chroma range: {distribution['chroma']['min']:.1f} - {distribution['chroma']['max']:.1f}")
    print(f"  Hue range: {distribution['hue']['min']:.1f}° - {distribution['hue']['max']:.1f}°")
    print(f"  RGB ranges:")
    print(f"    R: {distribution['rgb_ranges']['r']['min']}-{distribution['rgb_ranges']['r']['max']} (mean: {distribution['rgb_ranges']['r']['mean']:.0f})")
    print(f"    G: {distribution['rgb_ranges']['g']['min']}-{distribution['rgb_ranges']['g']['max']} (mean: {distribution['rgb_ranges']['g']['mean']:.0f})")
    print(f"    B: {distribution['rgb_ranges']['b']['min']}-{distribution['rgb_ranges']['b']['max']} (mean: {distribution['rgb_ranges']['b']['mean']:.0f})")

    # Find corner colors as initial estimates
    print("\nExtracting regional color averages...")
    corner_colors = find_corner_colors(samples, GRID_SIZE)
    for region, color in corner_colors.items():
        print(f"  {region}: #{color[0]:02X}{color[1]:02X}{color[2]:02X}")

    # Set initial color estimates from corner analysis
    initial_colors = [
        corner_colors.get('top_right', (40, 115, 190)),
        corner_colors.get('center_right', (50, 125, 175)),
        corner_colors.get('top_left', (85, 150, 135)),
        corner_colors.get('bottom_center', (100, 160, 135)),
    ]

    print("\nInitial color estimates:")
    for i, color in enumerate(initial_colors):
        print(f"  Color {i+1}: #{color[0]:02X}{color[1]:02X}{color[2]:02X}")

    # Run perceptual optimization for each phase
    print("\n" + "=" * 80)
    print("PERCEPTUAL OPTIMIZATION (Delta E in LAB space)")
    print("=" * 80)

    best_phase = 0
    best_error = float('inf')
    best_colors = initial_colors

    # Only test phases 0, 1, 2 (most commonly used)
    for phase in [0, 1, 2]:
        opt_colors, error = optimize_colors_perceptual(
            samples, initial_colors, phase, GRID_SIZE
        )
        print(f"\nPhase {phase}:")
        print(f"  Perceptual error (Delta E): {error:.2f}")
        print(f"  Colors:")
        for i, c in enumerate(opt_colors):
            lab = rgb_to_lab(*c)
            print(f"    {i+1}: #{c[0]:02X}{c[1]:02X}{c[2]:02X} (L={lab[0]:.1f})")

        if error < best_error:
            best_error = error
            best_phase = phase
            best_colors = opt_colors

    # Apply brightness correction if needed
    print("\n" + "=" * 80)
    print("BRIGHTNESS ANALYSIS AND CORRECTION")
    print("=" * 80)

    # Analyze reference image brightness
    target_l_min = distribution['lightness']['min']
    target_l_max = distribution['lightness']['max']
    print(f"\nReference image lightness: {target_l_min:.1f} - {target_l_max:.1f}")

    # Analyze best colors brightness
    best_labs = [rgb_to_lab(*c) for c in best_colors]
    best_l_min = min(l[0] for l in best_labs)
    best_l_max = max(l[0] for l in best_labs)
    print(f"Fitted colors lightness: {best_l_min:.1f} - {best_l_max:.1f}")

    # If colors are too dark, brighten them
    if best_l_max < target_l_max - 5:
        print("\nColors are too dark! Applying brightness correction...")
        # Shift the range up while maintaining relative positions
        l_shift = (target_l_min + target_l_max) / 2 - (best_l_min + best_l_max) / 2
        brightness_corrected = []
        for c in best_colors:
            lab = rgb_to_lab(*c)
            new_l = min(100, max(0, lab[0] + l_shift * 0.7))  # Apply 70% of shift
            new_rgb = lab_to_rgb(new_l, lab[1], lab[2])
            brightness_corrected.append(new_rgb)
        best_colors = brightness_corrected

        # Show corrected brightness
        corrected_labs = [rgb_to_lab(*c) for c in best_colors]
        corrected_l_min = min(l[0] for l in corrected_labs)
        corrected_l_max = max(l[0] for l in corrected_labs)
        print(f"Corrected colors lightness: {corrected_l_min:.1f} - {corrected_l_max:.1f}")

    # Final results
    print("\n" + "=" * 80)
    print("FINAL OPTIMIZED COLORS")
    print("=" * 80)
    print(f"\nBest phase: {best_phase}")
    print(f"Perceptual error (Delta E): {best_error:.2f}")
    print("\nColors for shiftingGradientRenderer.ts:")
    print("-" * 40)

    color_names = ['color1', 'color2', 'color3', 'color4']
    for i, (name, c) in enumerate(zip(color_names, best_colors)):
        lab = rgb_to_lab(*c)
        lch = rgb_to_lch(*c)
        print(f"  {name}: {{ r: 0x{c[0]:02x}, g: 0x{c[1]:02x}, b: 0x{c[2]:02x} }}, // #{c[0]:02X}{c[1]:02X}{c[2]:02X} L={lab[0]:.0f} C={lch[1]:.0f} H={lch[2]:.0f}°")

    print("\n" + "-" * 40)
    print("\nTypeScript code snippet:")
    print("-" * 40)
    print("const GRADIENT_COLORS = {")
    for name, c in zip(color_names, best_colors):
        print(f"    {name}: {{ r: 0x{c[0]:02x}, g: 0x{c[1]:02x}, b: 0x{c[2]:02x} }}, // #{c[0]:02X}{c[1]:02X}{c[2]:02X}")
    print("}")
    print(f"\nconst CURRENT_PHASE = {best_phase}")

    # Additional analysis: sample a few rendered vs reference comparisons
    print("\n" + "=" * 80)
    print("SAMPLE POINT COMPARISONS")
    print("=" * 80)

    test_points = [(0.2, 0.2), (0.5, 0.5), (0.8, 0.2), (0.3, 0.7), (0.7, 0.7)]
    for px, py in test_points:
        # Reference color
        idx = int(py * GRID_SIZE) * GRID_SIZE + int(px * GRID_SIZE)
        if idx < len(samples):
            ref = samples[idx]['rgb']
            ref_lab = samples[idx]['lab']

            # Rendered color
            rendered = render_gradient_at_pixel(
                int(px * GRID_SIZE), int(py * GRID_SIZE),
                best_colors, PHASE_POSITIONS[best_phase],
                GRID_SIZE, GRID_SIZE
            )
            rendered_lab = rgb_to_lab(*rendered)

            # Delta E
            dL = ref_lab[0] - rendered_lab[0]
            da = ref_lab[1] - rendered_lab[1]
            db = ref_lab[2] - rendered_lab[2]
            delta_e = math.sqrt(dL * dL + da * da + db * db)

            print(f"Point ({px:.1f}, {py:.1f}):")
            print(f"  Reference: #{ref[0]:02X}{ref[1]:02X}{ref[2]:02X} (L={ref_lab[0]:.1f})")
            print(f"  Rendered:  #{rendered[0]:02X}{rendered[1]:02X}{rendered[2]:02X} (L={rendered_lab[0]:.1f})")
            print(f"  Delta E: {delta_e:.2f}")


if __name__ == "__main__":
    main()
