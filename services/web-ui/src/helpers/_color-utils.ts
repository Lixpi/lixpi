// https://github.com/PimpTrizkit/PJs/wiki/12.-Shade,-Blend-and-Convert-a-Web-Color-(pSBC.js)
// Has a nice screenshot https://stackoverflow.com/questions/5560248/programmatically-lighten-or-darken-a-hex-color-or-rgb-and-blend-colors
// Lixpi fork    https://github.com/Lixpi/PJs

const parseColorChannels = (color: string): [string, string, string, string | undefined] => {
    const [red, green, blue, alpha] = color.split(',')
    return [red, green, blue, alpha]
}

const parseRedChannel = (red: string): number => parseInt(red[3] === 'a' ? red.slice(5) : red.slice(4), 10)

export const RgbLogShade = (percentage: number, color: string): string | undefined => {
    if (!percentage || !color) {
        return undefined
    }

    const [red, green, blue, alpha] = parseColorChannels(color)
    const isDarkening = percentage < 0
    const offset = isDarkening ? 0 : percentage * 255 ** 2
    const scale = isDarkening ? 1 + percentage : 1 - percentage
    const shade = (channel: number): number => Math.round((scale * channel ** 2 + offset) ** 0.5)

    return `rgb${alpha ? 'a(' : '('}${shade(parseRedChannel(red))},${shade(parseInt(green, 10))},${shade(parseInt(blue, 10))}${alpha ? `,${alpha}` : ')'}`
}

export const RgbLinearShade = (percentage: number, color: string): string | undefined => {
    if (!percentage || !color) {
        return undefined
    }

    const [red, green, blue, alpha] = parseColorChannels(color)
    const isDarkening = percentage < 0
    const offset = isDarkening ? 0 : 255 * percentage
    const scale = isDarkening ? 1 + percentage : 1 - percentage
    const shade = (channel: number): number => Math.round(channel * scale + offset)

    return `rgb${alpha ? 'a(' : '('}${shade(parseRedChannel(red))},${shade(parseInt(green, 10))},${shade(parseInt(blue, 10))}${alpha ? `,${alpha}` : ')'}`
}
