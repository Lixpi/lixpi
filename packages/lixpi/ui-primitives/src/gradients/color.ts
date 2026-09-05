export type ColorAdjustment = {
    saturationMultiplier: number
    minSaturation: number
    maxSaturation: number
    lightnessMultiplier: number
    minLightness: number
    maxLightness: number
}

export type RgbColor = {
    r: number
    g: number
    b: number
}
export type HslColor = {
    h: number
    s: number
    l: number
}

export const normalizeHexColor = (value: string | null | undefined): string | null => {
    const normalized = String(value ?? '')
        .trim()
        .replace(/^#/, '')

    if (!/^[\da-f]{6}$/i.test(normalized))
        return null

    return `#${normalized.toUpperCase()}`
}

export const parseHexColor = (
    hex: string,
    fallback = '#000000',
): RgbColor => {
    const normalized = normalizeHexColor(hex)
        ?? normalizeHexColor(fallback)
        ?? '#000000'
    const value = Number.parseInt(
        normalized.slice(1),
        16,
    )

    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
    }
}

const clampColorUnit = (value: number): number => {
    if (!Number.isFinite(value))
        return 0

    return Math.max(
        0,
        Math.min(1, value),
    )
}

export const rgbToHsl = ({
    r,
    g,
    b,
}: RgbColor): HslColor => {
    const red = r / 255
    const green = g / 255
    const blue = b / 255
    const max = Math.max(
        red,
        green,
        blue,
    )
    const min = Math.min(
        red,
        green,
        blue,
    )
    const lightness = (max + min) / 2
    const delta = max - min

    if (delta === 0)
        return {
            h: 0,
            s: 0,
            l: lightness,
        }

    const saturation = lightness > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min)
    let hue = 0

    if (max === red)
        hue = (green - blue) / delta + (green < blue ? 6 : 0)

    if (max === green)
        hue = (blue - red) / delta + 2

    if (max === blue)
        hue = (red - green) / delta + 4

    return {
        h: hue / 6,
        s: saturation,
        l: lightness,
    }
}

const hueToRgb = (
    p: number,
    q: number,
    hue: number,
): number => {
    let normalizedHue = hue

    if (normalizedHue < 0)
        normalizedHue += 1

    if (normalizedHue > 1)
        normalizedHue -= 1

    if (normalizedHue < 1 / 6)
        return p + (q - p) * 6 * normalizedHue

    if (normalizedHue < 1 / 2)
        return q

    if (normalizedHue < 2 / 3)
        return p + (q - p) * (2 / 3 - normalizedHue) * 6

    return p
}

export const hslToRgb = ({
    h,
    s,
    l,
}: HslColor): RgbColor => {
    if (s === 0) {
        const value = Math.round(l * 255)

        return {
            r: value,
            g: value,
            b: value,
        }
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q

    return {
        r: Math.round(hueToRgb(
            p,
            q,
            h + 1 / 3,
        ) * 255),
        g: Math.round(hueToRgb(
            p,
            q,
            h,
        ) * 255),
        b: Math.round(hueToRgb(
            p,
            q,
            h - 1 / 3,
        ) * 255),
    }
}

export const rgbToHex = ({
    r,
    g,
    b,
}: RgbColor): string => {
    const channel = (value: number): string =>
        Math.max(
            0,
            Math.min(
                255,
                Math.round(value),
            ),
        )
            .toString(16)
            .padStart(2, '0')

    return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

export const adjustHexColor = (
    hex: string,
    adjust: ColorAdjustment,
    fallback = '#000000',
): string => {
    const hsl = rgbToHsl(
        parseHexColor(hex, fallback),
    )
    const saturation = Math.min(
        clampColorUnit(adjust.maxSaturation),
        Math.max(
            clampColorUnit(adjust.minSaturation),
            clampColorUnit(hsl.s * adjust.saturationMultiplier),
        ),
    )
    const lightness = Math.max(
        clampColorUnit(adjust.minLightness),
        Math.min(
            clampColorUnit(adjust.maxLightness),
            clampColorUnit(hsl.l * adjust.lightnessMultiplier),
        ),
    )

    return rgbToHex(
        hslToRgb({
            h: hsl.h,
            s: saturation,
            l: lightness,
        }),
    )
}

export const mixHexColors = (
    fromHex: string,
    toHex: string,
    amount: number,
    fallback = '#000000',
): string => {
    const from = parseHexColor(fromHex, fallback)
    const to = parseHexColor(toHex, fallback)
    const boundedAmount = clampColorUnit(amount)
    const channel = (
        fromChannel: number,
        toChannel: number,
    ): string =>
        Math.round(fromChannel + (toChannel - fromChannel) * boundedAmount)
            .toString(16)
            .padStart(2, '0')

    return `#${channel(from.r, to.r)}${channel(from.g, to.g)}${channel(from.b, to.b)}`.toUpperCase()
}
