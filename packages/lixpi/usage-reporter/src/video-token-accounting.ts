// Turns a clip's duration into the vendor token count reported by Seedance, for
// the pre-call usage estimate. The formula, its sources, and the state of the frame
// sizes below are in ../documentation/SEEDANCE-VIDEO-TOKENS.md.
//
//   tokens = (input seconds + output seconds) × width × height × 24 / 1024
//
// The formula and the fixed 24fps are first-party. The frame sizes are not.
const VIDEO_FRAMES_PER_SECOND = 24
const VIDEO_TOKEN_DIVISOR = 1024

export type VideoFrameSize = {
    width: number
    height: number
}

// TODO(seedance-frame-sizes): replace with BytePlus's own Seedance 2.0 output
// dimension table. EVERY NUMBER BELOW IS A PLACEHOLDER, NOT SOURCED DATA. It is
// biased high on purpose, and any replacement must keep that bias: over-estimating
// preserves a conservative upper-bound estimate. The frame derivation and
// calibration against published provider information are in ../documentation/SEEDANCE-VIDEO-TOKENS.md.
const PROVISIONAL_SEEDANCE_FRAME_SIZES: Record<string, Record<string, VideoFrameSize>> = {
    '480p': {
        '16:9': {
            width: 864,
            height: 496,
        },
        '4:3': {
            width: 752,
            height: 560,
        },
        '1:1': {
            width: 640,
            height: 640,
        },
        '3:4': {
            width: 560,
            height: 752,
        },
        '9:16': {
            width: 496,
            height: 864,
        },
        '21:9': {
            width: 992,
            height: 432,
        },
    },
    '720p': {
        '16:9': {
            width: 1280,
            height: 720,
        },
        '4:3': {
            width: 1120,
            height: 848,
        },
        '1:1': {
            width: 960,
            height: 960,
        },
        '3:4': {
            width: 848,
            height: 1120,
        },
        '9:16': {
            width: 720,
            height: 1280,
        },
        '21:9': {
            width: 1472,
            height: 640,
        },
    },
    '1080p': {
        '16:9': {
            width: 1920,
            height: 1088,
        },
        '4:3': {
            width: 1664,
            height: 1248,
        },
        '1:1': {
            width: 1440,
            height: 1440,
        },
        '3:4': {
            width: 1248,
            height: 1664,
        },
        '9:16': {
            width: 1088,
            height: 1920,
        },
        '21:9': {
            width: 2208,
            height: 960,
        },
    },
}

// TODO(seedance-frame-sizes): also unsourced. BytePlus documents that a minimum
// applies when the input contains video, but not what it is. Zero leaves it inert.
const PROVISIONAL_MINIMUM_VIDEO_INPUT_TOKENS = 0

export type VideoTokenEstimate = {
    tokens: number
    frameSize: VideoFrameSize
    // The tier and ratio actually looked up, which may be a fallback rather than
    // what was requested. Surfaced so the usage log can show what was priced.
    resolutionTier: string
    aspectRatio: string
    // True while the frame size came from the placeholder table above, which is
    // every lookup today. The usage log warns on a provisional estimate.
    provisional: boolean
}

const framePixels = (size: VideoFrameSize): number => size.width * size.height

const largestFramePixels = (tier: string): number => Object.values(PROVISIONAL_SEEDANCE_FRAME_SIZES[tier]!).reduce(
    (largest, size) => Math.max(
        largest,
        framePixels(size),
    ),
    0,
)

const resolveTier = (requested: string | undefined): string => {
    const tiers = Object.keys(PROVISIONAL_SEEDANCE_FRAME_SIZES)

    if (
        requested
        && Object.hasOwn(PROVISIONAL_SEEDANCE_FRAME_SIZES, requested)
    )
        return requested

    return tiers.reduce(
        (largest, tier) => (
            largestFramePixels(tier) > largestFramePixels(largest) ? tier : largest
        ),
        tiers[0]!,
    )
}

const resolveRatio = (
    tier: string,
    requested: string | undefined,
): string => {
    const sizes = PROVISIONAL_SEEDANCE_FRAME_SIZES[tier]!

    if (
        requested
        && Object.hasOwn(sizes, requested)
    )
        return requested

    return Object.keys(sizes).reduce(
        (largest, ratio) => (
            framePixels(sizes[ratio]!) > framePixels(sizes[largest]!) ? ratio : largest
        ),
        Object.keys(sizes)[0]!,
    )
}

// Bounds one clip in vendor video tokens. An unknown tier or ratio resolves to the
// largest entry available, which keeps it on the over-estimating side of the gate.
export const estimateVideoTokens = ({
    resolutionTier,
    aspectRatio,
    outputSeconds,
    inputSeconds,
}: {
    resolutionTier: string | undefined
    aspectRatio: string | undefined
    outputSeconds: number
    inputSeconds: number
}): VideoTokenEstimate => {
    const tier = resolveTier(resolutionTier)
    const ratio = resolveRatio(tier, aspectRatio)
    const frameSize = PROVISIONAL_SEEDANCE_FRAME_SIZES[tier]![ratio]!
    const seconds = Math.max(0, outputSeconds) + Math.max(0, inputSeconds)
    const tokens = Math.ceil((seconds * frameSize.width * frameSize.height * VIDEO_FRAMES_PER_SECOND) / VIDEO_TOKEN_DIVISOR)

    return {
        tokens: Math.max(tokens, inputSeconds > 0 ? PROVISIONAL_MINIMUM_VIDEO_INPUT_TOKENS : 0),
        frameSize,
        resolutionTier: tier,
        aspectRatio: ratio,
        provisional: true,
    }
}
