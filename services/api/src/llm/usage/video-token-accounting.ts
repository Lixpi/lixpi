'use strict'

// Vendor token accounting for token-metered video models (Seedance through
// BytePlus ModelArk). Converts a clip's duration into the vendor's own token
// count, so the pre-call spend gate can send an upper bound in the unit the
// tariff is actually metered in. Seconds sent against a token tariff understate
// the cost by orders of magnitude.

// SOURCED. The formula and frame rate are the parts we trust.
//
//   token 数 ≈ (输入视频时长 + 输出视频时长)(秒) × 输出宽 × 输出高 × 24 / 1024
//   tokens  ≈ (input video seconds + output video seconds) × width × height × 24 / 1024
//
// Frame rate is fixed at 24fps for the Seedance 2.0 series, with no `frames`
// parameter. BytePlus states the Seedance 1.x form of the same formula
// first-party as "Tokens per video = Width×Height×Frame Rate×Duration/1024"
// (https://www.byteplus.com/en/blog/seedance-1-0-pro-guide-api-pricing), and its
// pricing page states the 2.0 form verbatim as "Estimated token consumption =
// (Input video duration + Output video duration) × Output video width × Output
// video height × Output video frame rate / 1024".
const VIDEO_FRAMES_PER_SECOND = 24
const VIDEO_TOKEN_DIVISOR = 1024

export type VideoFrameSize = {
    width: number
    height: number
}

// TODO(seedance-frame-sizes): replace with BytePlus's own Seedance 2.0 output
// dimension table. EVERY NUMBER BELOW IS A PLACEHOLDER, NOT SOURCED DATA.
//
// Why it is unsourced: the vendor documentation that carries the table
// (https://docs.byteplus.com/en/docs/ModelArk/2291680, "Dreamina Seedance 2.0
// series tutorial") is a client-rendered SPA, as is the Volcengine equivalent, so
// neither is readable programmatically. The two tables that are readable disagree
// with each other on nearly every cell:
//
//   source A: BytePlus first-party blog, but for Seedance 1.0 Pro, not 2.0.
//             480p 16:9 864x480, 4:3 736x544, 1:1 640x640, 21:9 960x416.
//             1080p 16:9 1920x1088, 4:3 1664x1248, 1:1 1440x1440, 21:9 2176x928.
//             Publishes no 720p row at all.
//   source B: docs.apiyi.com, a third-party API reseller, for Seedance 2.0.
//             480p 16:9 864x496, 4:3 752x560, 1:1 640x640, 21:9 992x432.
//             720p 16:9 1280x720, 4:3 1112x834, 1:1 960x960, 21:9 1470x630.
//             1080p 16:9 1920x1080, 4:3 1664x1248, 1:1 1440x1440, 21:9 2206x946.
//
// 720p is the worst case: it is one of only two tiers the catalog offers for
// Seedance, and NO first-party source publishes its dimensions.
//
// How these placeholders were derived, and the bias that must be preserved:
// take the larger of the two sources for each axis independently, then round each
// axis UP to a multiple of 16, which is the padding the first-party page shows
// (1080p 16:9 is 1920x1088, not 1920x1080). The result is deliberately at or above
// both sources. KEEP THAT BIAS when the real table lands: over-estimating only
// makes the admission gate stricter, while under-estimating lets a run through
// that the balance cannot cover, which is the exact failure this path exists to
// remove. Round real values up rather than reproducing them exactly if in doubt.
//
// A one-time comparison with first-party 5-second 16:9 examples put these
// provisional areas within the provider's published rounding tolerance. The
// comparison is evidence for the usage estimate only; provider-cost values stay
// behind the pricing service and are intentionally not copied here.
//
// This is why the bias rule is not merely cautious: source A's 480p 16:9 864x480
// would have come in 2.8% low, understating the gate. Still unvalidated: every
// non-16:9 ratio, and 720p/1080p on anything but the single published sample.
// No cell is promoted out of provisional status on this evidence, and the
// PROVISIONAL_ naming stays until the vendor's own table replaces it.
const PROVISIONAL_SEEDANCE_FRAME_SIZES: Record<string, Record<string, VideoFrameSize>> = {
    '480p': {
        '16:9': { width: 864, height: 496 },
        '4:3': { width: 752, height: 560 },
        '1:1': { width: 640, height: 640 },
        '3:4': { width: 560, height: 752 },
        '9:16': { width: 496, height: 864 },
        '21:9': { width: 992, height: 432 },
    },
    '720p': {
        '16:9': { width: 1280, height: 720 },
        '4:3': { width: 1120, height: 848 },
        '1:1': { width: 960, height: 960 },
        '3:4': { width: 848, height: 1120 },
        '9:16': { width: 720, height: 1280 },
        '21:9': { width: 1472, height: 640 },
    },
    '1080p': {
        '16:9': { width: 1920, height: 1088 },
        '4:3': { width: 1664, height: 1248 },
        '1:1': { width: 1440, height: 1440 },
        '3:4': { width: 1248, height: 1664 },
        '9:16': { width: 1088, height: 1920 },
        '21:9': { width: 2208, height: 960 },
    },
}

// TODO(seedance-frame-sizes): also unsourced. BytePlus documents that a minimum
// token consumption applies when the input contains video (our
// videoSourceForExtension path), but not what the minimum is. Left at 0, which
// makes it inert: the computed token count always wins. Raising it can only make
// the gate stricter, so fill it in with the documented value when the table above
// is replaced.
const PROVISIONAL_MINIMUM_VIDEO_INPUT_TOKENS = 0

export type VideoTokenEstimate = {
    tokens: number
    frameSize: VideoFrameSize
    // The tier and ratio actually looked up, which may be a fallback rather than
    // what was requested. Surfaced so the usage log can show what was priced.
    resolutionTier: string
    aspectRatio: string
    // True while the frame size came from the placeholder table above. Every
    // lookup is provisional today; the flag exists so the log stops shouting on
    // its own once real values replace them.
    provisional: boolean
}

// estimateVideoTokens bounds one clip in vendor video tokens. Unknown tiers and
// ratios resolve to the largest entry available rather than to nothing, keeping
// an unrecognized option on the over-estimating side of the gate.
export function estimateVideoTokens({
    resolutionTier,
    aspectRatio,
    outputSeconds,
    inputSeconds,
}: {
    resolutionTier: string | undefined
    aspectRatio: string | undefined
    outputSeconds: number
    inputSeconds: number
}): VideoTokenEstimate {
    const tier = resolveTier(resolutionTier)
    const ratio = resolveRatio(tier, aspectRatio)
    const frameSize = PROVISIONAL_SEEDANCE_FRAME_SIZES[tier]![ratio]!
    const seconds = Math.max(0, outputSeconds) + Math.max(0, inputSeconds)
    const tokens = Math.ceil(
        seconds * frameSize.width * frameSize.height * VIDEO_FRAMES_PER_SECOND / VIDEO_TOKEN_DIVISOR,
    )
    return {
        tokens: Math.max(tokens, inputSeconds > 0 ? PROVISIONAL_MINIMUM_VIDEO_INPUT_TOKENS : 0),
        frameSize,
        resolutionTier: tier,
        aspectRatio: ratio,
        provisional: true,
    }
}

// An unrecognized tier gets the largest one on file. A new tier the catalog has
// not been taught about (Seedance also advertises 4K) is then over-estimated
// rather than silently priced as the smallest option.
function resolveTier(requested: string | undefined): string {
    const tiers = Object.keys(PROVISIONAL_SEEDANCE_FRAME_SIZES)
    if (requested && Object.hasOwn(PROVISIONAL_SEEDANCE_FRAME_SIZES, requested)) return requested
    return tiers.reduce((largest, tier) => (
        largestFramePixels(tier) > largestFramePixels(largest) ? tier : largest
    ), tiers[0]!)
}

function resolveRatio(tier: string, requested: string | undefined): string {
    const sizes = PROVISIONAL_SEEDANCE_FRAME_SIZES[tier]!
    if (requested && Object.hasOwn(sizes, requested)) return requested
    return Object.keys(sizes).reduce((largest, ratio) => (
        framePixels(sizes[ratio]!) > framePixels(sizes[largest]!) ? ratio : largest
    ), Object.keys(sizes)[0]!)
}

function largestFramePixels(tier: string): number {
    return Object.values(PROVISIONAL_SEEDANCE_FRAME_SIZES[tier]!)
        .reduce((largest, size) => Math.max(largest, framePixels(size)), 0)
}

function framePixels(size: VideoFrameSize): number {
    return size.width * size.height
}
