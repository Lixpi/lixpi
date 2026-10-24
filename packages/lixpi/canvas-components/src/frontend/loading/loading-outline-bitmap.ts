import {
    createTravelingSnakeMeshGeometry,
    writeTravelingOutlineGeometry,
} from '../effects/outline/outline-geometry.ts'
import {
    type LoadingOverlayOptions,
} from './loading-overlay.ts'

type PixelTexture = {
    size: {
        width: number
        height: number
    }
    rgba: Uint8Array | Uint8ClampedArray
}

// A circle's outline is rigid throughout its lap. Bake the existing mesh and
// material once, then rotate the bitmap without waiting for a GPU backend.
export const bakeLoadingOutline = (
    outline: LoadingOverlayOptions['outline'],
    texture: PixelTexture,
    resolution: number,
) => {
    const scale = outline.getStrokeScale?.() ?? 1
    const padding = Math.ceil((Math.abs(outline.style.gap) + outline.style.snakeHeadWidth) * scale + 2)
    const displaySize = outline.size + padding * 2
    const size = Math.ceil(displaySize * resolution)
    const rgba = new Uint8ClampedArray(size * size * 4)
    const geometry = createTravelingSnakeMeshGeometry()
    const offset = writeTravelingOutlineGeometry(
        geometry,
        {
            id: 'loading',
            x: padding,
            y: padding,
            width: outline.size,
            height: outline.size,
            radius: outline.size / 2,
            visible: true,
            snakeLengthFraction: outline.snakeLengthFraction,
        },
        outline.style,
        0,
        scale,
    )
    const {
        positions,
        uvs,
        indices,
    } = geometry
    const sample = (
        u: number,
        v: number,
        channel: number,
    ): number => {
        const x = Math.max(
            0,
            Math.min(texture.size.width - 1, u * texture.size.width - 0.5),
        )
        const y = Math.max(
            0,
            Math.min(texture.size.height - 1, v * texture.size.height - 0.5),
        )
        const left = Math.floor(x)
        const top = Math.floor(y)
        const right = Math.min(left + 1, texture.size.width - 1)
        const bottom = Math.min(top + 1, texture.size.height - 1)
        const pixel = (
            px: number,
            py: number,
        ) => texture.rgba[(py * texture.size.width + px) * 4 + channel]
        const upper = pixel(left, top) * (1 - x + left) + pixel(right, top) * (x - left)
        const lower = pixel(left, bottom) * (1 - x + left) + pixel(right, bottom) * (x - left)

        return upper * (1 - y + top) + lower * (y - top)
    }

    for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const a = indices[triangle] * 2
        const b = indices[triangle + 1] * 2
        const c = indices[triangle + 2] * 2
        const ax = (positions[a] + offset.x) * resolution
        const ay = (positions[a + 1] + offset.y) * resolution
        const bx = (positions[b] + offset.x) * resolution
        const by = (positions[b + 1] + offset.y) * resolution
        const cx = (positions[c] + offset.x) * resolution
        const cy = (positions[c + 1] + offset.y) * resolution
        const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)

        if (Math.abs(area) < 0.000001)
            continue

        const left = Math.max(
            0,
            Math.floor(
                Math.min(
                    ax,
                    bx,
                    cx,
                ),
            ),
        )
        const right = Math.min(
            size - 1,
            Math.ceil(
                Math.max(
                    ax,
                    bx,
                    cx,
                ),
            ),
        )
        const top = Math.max(
            0,
            Math.floor(
                Math.min(
                    ay,
                    by,
                    cy,
                ),
            ),
        )
        const bottom = Math.min(
            size - 1,
            Math.ceil(
                Math.max(
                    ay,
                    by,
                    cy,
                ),
            ),
        )

        for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
                const first = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / area
                const second = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / area
                const third = 1 - first - second

                if (Math.min(
                    first,
                    second,
                    third,
                ) < -0.000001)
                    continue

                const u = first * uvs[a] + second * uvs[b] + third * uvs[c]
                const v = first * uvs[a + 1] + second * uvs[b + 1] + third * uvs[c + 1]
                const target = (y * size + x) * 4

                for (let channel = 0; channel < 4; channel++)
                    rgba[target + channel] = sample(
                        u,
                        v,
                        channel,
                    )
            }
        }
    }

    return {
        size,
        displaySize,
        rgba,
    }
}
