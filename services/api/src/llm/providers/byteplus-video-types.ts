'use strict'

// Typed request/response shapes + a thin REST client for the BytePlus ModelArk
// Seedance 2.0 video-generation API. The surface is small (create task, poll
// task, download the resulting MP4), so we use Node `fetch` + `AbortSignal`
// rather than pulling in an SDK.
//
// Official international route (overridable via BYTEPLUS_ARK_BASE_URL):
//   POST {base}/contents/generations/tasks            — create a task
//   GET  {base}/contents/generations/tasks/{id}       — poll a task
// Auth: `Authorization: Bearer $ARK_API_KEY`.
//
// NOTE: the ModelArk task body/content wire shapes below match the documented
// API as of the proposal (re-verified 2026-06-04). They are intentionally kept
// in this one module so a vendor-format change is a single-file edit.

export type SeedanceTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

// content[] image roles. v1 uses first_frame and reference_image; the others are
// reserved for the later asset-handoff phase.
export type SeedanceImageRole = 'first_frame' | 'last_frame' | 'reference_image'

export type SeedanceTextContent = {
    type: 'text'
    text: string
}

export type SeedanceImageContent = {
    type: 'image_url'
    image_url: { url: string }
    role: SeedanceImageRole
}

export type SeedanceContentItem = SeedanceTextContent | SeedanceImageContent

export type CreateVideoGenerationTaskPayload = {
    model: string
    content: SeedanceContentItem[]
    resolution?: string
    ratio?: string
    duration?: number
    generate_audio?: boolean
    watermark?: boolean
    seed?: number
    return_last_frame?: boolean
    callback_url?: string
}

export type CreateVideoGenerationTaskResponse = {
    id: string
    status?: SeedanceTaskStatus
    [key: string]: unknown
}

export type SeedanceUsage = {
    completion_tokens?: number
    total_tokens?: number
    [key: string]: unknown
}

export type RetrieveVideoGenerationTaskResponse = {
    id: string
    status: SeedanceTaskStatus
    model?: string
    content?: {
        video_url?: string
        [key: string]: unknown
    }
    usage?: SeedanceUsage
    error?: { code?: string; message?: string }
    // Echoed generation parameters (present on success).
    duration?: number
    resolution?: string
    ratio?: string
    seed?: number
    [key: string]: unknown
}

export type BytePlusClientConfig = {
    baseUrl: string
    apiKey: string
}

// Carries ModelArk's `error.code` / HTTP status through to callers so the
// provider can surface an actionable message instead of an opaque failure.
export class BytePlusModelArkError extends Error {
    readonly code?: string
    readonly httpStatus?: number

    constructor(message: string, opts: { code?: string; httpStatus?: number } = {}) {
        super(message)
        this.name = 'BytePlusModelArkError'
        this.code = opts.code
        this.httpStatus = opts.httpStatus
    }
}

const parseJsonOrThrow = async (res: Response, action: string): Promise<any> => {
    const text = await res.text()
    let json: any
    try {
        json = text ? JSON.parse(text) : {}
    } catch {
        json = undefined
    }

    if (!res.ok) {
        const code = json?.error?.code
        const message = json?.error?.message ?? (text || res.statusText)
        throw new BytePlusModelArkError(
            `ModelArk ${action} failed (HTTP ${res.status}${code ? `, code=${code}` : ''}): ${message}`,
            { code, httpStatus: res.status },
        )
    }

    if (json === undefined) {
        throw new BytePlusModelArkError(
            `ModelArk ${action} returned a non-JSON response: ${text.slice(0, 200)}`,
            { httpStatus: res.status },
        )
    }
    return json
}

export const createVideoGenerationTask = async (
    config: BytePlusClientConfig,
    payload: CreateVideoGenerationTaskPayload,
    signal?: AbortSignal,
): Promise<CreateVideoGenerationTaskResponse> => {
    const res = await fetch(`${config.baseUrl}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
    })
    return parseJsonOrThrow(res, 'create video generation task')
}

export const retrieveVideoGenerationTask = async (
    config: BytePlusClientConfig,
    taskId: string,
    signal?: AbortSignal,
): Promise<RetrieveVideoGenerationTaskResponse> => {
    const res = await fetch(`${config.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        signal,
    })
    return parseJsonOrThrow(res, 'retrieve video generation task')
}

// Downloads the hosted MP4. ModelArk output URLs are cleaned after 24 hours, so
// the provider must call this inside the same request and persist the bytes.
export const downloadVideo = async (videoUrl: string, signal?: AbortSignal): Promise<Buffer> => {
    const res = await fetch(videoUrl, { signal })
    if (!res.ok) {
        throw new BytePlusModelArkError(
            `Failed to download Seedance video (HTTP ${res.status})`,
            { httpStatus: res.status },
        )
    }
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
}

export const SEEDANCE_TERMINAL_STATUSES: ReadonlySet<SeedanceTaskStatus> =
    new Set(['succeeded', 'failed', 'cancelled', 'expired'])

export const SEEDANCE_EXTENSION_UNSUPPORTED_MESSAGE =
    'Seedance video extension requires provider-fetchable video URLs. ' +
    'Use VEO for extension until external asset handoff is implemented.'

export type SeedanceContentInputs = {
    videoSourceForExtension?: string
    videoFirstFrameImage?: string
    videoReferenceImages?: string[]
}

// Seedance reads inline base64 data URLs (the resolver already supplies them) or
// public https URLs. Internal nats-obj:// URIs are private and must never reach
// ModelArk — fail explicitly rather than emit an opaque vendor error.
const toModelArkImageUrl = (url: string, label: string): string => {
    if (!url) throw new Error(`Seedance: empty ${label} URL`)
    if (url.startsWith('nats-obj://')) {
        throw new Error(
            `Seedance: refusing to send a private object-store URI as a ${label}. ` +
            `The resolver must supply a base64 data URL.`,
        )
    }
    return url
}

// Build the ModelArk content[] array. Order: text first, then FRAME CONDITIONING
// ONLY — provided images become the start frame and (optionally) the stop frame,
// never asset/style `reference_image`s. The selected images arrive in a stable
// order via videoFirstFrameImage (start frame) followed by videoReferenceImages
// (the optional stop frame): the first becomes role=first_frame, the second
// role=last_frame. Source-video extension has no provider-fetchable asset handoff
// yet, so it is rejected with a capability error.
export const buildSeedanceContent = (prompt: string, inputs: SeedanceContentInputs): SeedanceContentItem[] => {
    const content: SeedanceContentItem[] = [{ type: 'text', text: prompt }]

    if (inputs.videoSourceForExtension) {
        throw new Error(SEEDANCE_EXTENSION_UNSUPPORTED_MESSAGE)
    }

    const frameUrls = [inputs.videoFirstFrameImage, ...(inputs.videoReferenceImages ?? [])]
        .filter((url): url is string => typeof url === 'string' && url.length > 0)

    if (frameUrls[0]) {
        content.push({
            type: 'image_url',
            image_url: { url: toModelArkImageUrl(frameUrls[0], 'first frame') },
            role: 'first_frame',
        })
    }
    if (frameUrls[1]) {
        content.push({
            type: 'image_url',
            image_url: { url: toModelArkImageUrl(frameUrls[1], 'last frame') },
            role: 'last_frame',
        })
    }
    return content
}

export type PollVideoGenerationTaskOptions = {
    pollIntervalMs: number
    signal?: AbortSignal
    // Abort hook (e.g. circuit breaker / user stop). Checked before every poll.
    shouldStop?: () => boolean
    // Called on every non-terminal poll so the caller can emit a keepalive.
    onKeepalive?: () => void
    // Injectable for tests; defaults to the real retrieve + setTimeout sleep.
    retrieve?: (config: BytePlusClientConfig, taskId: string, signal?: AbortSignal) => Promise<RetrieveVideoGenerationTaskResponse>
    sleep?: (ms: number) => Promise<void>
}

// Polls a task to a terminal status, emitting a keepalive on every non-terminal
// poll. Returns the terminal task (succeeded OR failed/cancelled/expired — the
// caller decides how to react). Throws only on abort.
export const pollVideoGenerationTask = async (
    config: BytePlusClientConfig,
    taskId: string,
    opts: PollVideoGenerationTaskOptions,
): Promise<RetrieveVideoGenerationTaskResponse> => {
    const retrieve = opts.retrieve ?? retrieveVideoGenerationTask
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

    for (;;) {
        if (opts.shouldStop?.()) throw new Error('Video generation aborted')
        const task = await retrieve(config, taskId, opts.signal)
        if (SEEDANCE_TERMINAL_STATUSES.has(task.status)) return task
        opts.onKeepalive?.()
        await sleep(opts.pollIntervalMs)
    }
}
