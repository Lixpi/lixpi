'use strict'

import sharp from 'sharp'

import type NatsService from '@lixpi/nats-service'
import {
    info,
    warn,
} from '@lixpi/debug-tools'
import type {
    AiModelInferenceCapabilities,
    AiModelInputKind,
} from '@lixpi/constants'

// Anthropic's 5MB limit applies to the base64-encoded string. Base64 inflates
// raw bytes by ~4/3, so 5242880 * 3/4 = 3932160. Use 3.75MB for safety.
const MAX_IMAGE_BYTES = 3750000
const MAX_IMAGE_DIMENSION = 2048

const SAFE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif'])

// 'OPENAI' targets the Responses API content shape (input_text / input_image),
// used by both the main provider and the structured VLM client.
export type AttachmentFormat = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE'

export const assertMessageInputKindsSupported = (
    provider: string,
    modelVersion: string,
    capabilities: AiModelInferenceCapabilities | undefined,
    messages: Array<{ content?: unknown }>,
): void => {
    if (!capabilities) {
        throw new Error(`MODEL_INFERENCE_CAPABILITIES_REQUIRED:${provider}:${modelVersion}`)
    }
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue
        for (const block of message.content) {
            if (!block || typeof block !== 'object' || Array.isArray(block)) continue
            const type = (block as Record<string, unknown>).type
            const inputKind: AiModelInputKind | undefined = type === 'input_audio'
                ? 'audio'
                : type === 'input_image'
                ? 'image'
                : undefined
            if (inputKind && !capabilities.supportedInputKinds.includes(inputKind)) {
                throw new Error(`MODEL_INPUT_KIND_UNSUPPORTED:${provider}:${modelVersion}:${inputKind}`)
            }
        }
    }
}

const detectImageMime = (data: Buffer): string => {
    if (
        data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
        && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
    ) {
        return 'image/png'
    }
    if (data.length > 2 && data[0] === 0xff && data[1] === 0xd8) {
        return 'image/jpeg'
    }
    if (data.length > 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
        return 'image/gif'
    }
    if (
        data.length > 12
        && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
        && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
    ) {
        return 'image/webp'
    }
    return 'image/png'
}

export const parseNatsObjectRef = (ref: string): { bucket: string; key: string } | undefined => {
    if (!ref.startsWith('nats-obj://')) return undefined
    const path = ref.slice('nats-obj://'.length)
    const slash = path.indexOf('/')
    if (slash < 1) return undefined
    return { bucket: path.slice(0, slash), key: path.slice(slash + 1) }
}

export const parseDataUrl = (dataUrl: string): { mediaType: string; base64: string } => {
    const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
    if (!m) throw new Error(`Invalid data URL format: ${dataUrl.slice(0, 50)}...`)
    return { mediaType: m[1]!, base64: m[2]! }
}

// Convert image bytes to PNG (alpha) or JPEG (opaque) if the MIME type isn't
// natively supported by all major LLM vision APIs (e.g. WebP → PNG/JPEG).
const normalizeAttachmentData = async (
    data: Buffer,
    mimeType: string,
): Promise<{ data: Buffer; mimeType: string }> => {
    if (SAFE_MIMES.has(mimeType)) return { data, mimeType }

    try {
        const img = sharp(data)
        const meta = await img.metadata()
        const hasAlpha = !!meta.hasAlpha

        if (hasAlpha) {
            const out = await img.png().toBuffer()
            return { data: out, mimeType: 'image/png' }
        }
        const out = await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
        return { data: out, mimeType: 'image/jpeg' }
    } catch (e) {
        warn(`Failed to convert image (${mimeType}):`, e)
        return { data, mimeType }
    }
}

// progressive quality ladder [92,85,78,70,60] + alpha→white fallback + aggressive resize; mirrors Python Pillow strategy
const downscaleImageIfNeeded = async (
    data: Buffer,
    mimeType: string,
): Promise<{ data: Buffer; mimeType: string }> => {
    if (data.length <= MAX_IMAGE_BYTES) return { data, mimeType }

    info(`Image exceeds ${MAX_IMAGE_BYTES} bytes (${data.length} bytes), downscaling...`)

    let img: sharp.Sharp
    let meta: sharp.Metadata
    try {
        img = sharp(data)
        meta = await img.metadata()
    } catch (e) {
        warn(`Failed to open image for downscaling: ${e}`)
        return { data, mimeType }
    }

    const hasAlpha = !!meta.hasAlpha

    // Resize if dimensions exceed the maximum.
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    const longest = Math.max(width, height)
    let working = img
    if (longest > MAX_IMAGE_DIMENSION) {
        const scale = MAX_IMAGE_DIMENSION / longest
        const newW = Math.round(width * scale)
        const newH = Math.round(height * scale)
        working = working.resize(newW, newH, { kernel: 'lanczos3' })
    }

    // Choose output format: PNG for transparency, otherwise JPEG.
    if (hasAlpha) {
        const out = await working.clone().png({ compressionLevel: 9 }).toBuffer()
        if (out.length <= MAX_IMAGE_BYTES) {
            return { data: out, mimeType: 'image/png' }
        }
        // Still too large — composite onto white and try JPEG quality steps.
        for (const quality of [85, 78, 70, 60]) {
            try {
                const composited = await sharp(out)
                    .flatten({ background: { r: 255, g: 255, b: 255 } })
                    .jpeg({ quality, mozjpeg: true })
                    .toBuffer()
                if (composited.length <= MAX_IMAGE_BYTES) {
                    return { data: composited, mimeType: 'image/jpeg' }
                }
            } catch {}
        }
    } else {
        for (const quality of [92, 85, 78, 70, 60]) {
            const out = await working.clone().jpeg({ quality, mozjpeg: true }).toBuffer()
            if (out.length <= MAX_IMAGE_BYTES) {
                return { data: out, mimeType: 'image/jpeg' }
            }
        }
    }

    // Aggressive resize fallback.
    for (const scale of [0.75, 0.5]) {
        const newW = Math.round(width * scale)
        const newH = Math.round(height * scale)
        try {
            const out = await sharp(data)
                .resize(newW, newH, { kernel: 'lanczos3' })
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 70, mozjpeg: true })
                .toBuffer()
            if (out.length <= MAX_IMAGE_BYTES) {
                return { data: out, mimeType: 'image/jpeg' }
            }
        } catch {}
    }

    warn(`Could not downscale image below ${MAX_IMAGE_BYTES} bytes, returning best effort`)
    // Best effort: re-encode as low-quality JPEG.
    try {
        const out = await sharp(data)
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: 60, mozjpeg: true })
            .toBuffer()
        return { data: out, mimeType: 'image/jpeg' }
    } catch {
        return { data, mimeType }
    }
}

const normalizeAndDownscale = async (
    data: Buffer,
    mimeType: string,
): Promise<{ data: Buffer; mimeType: string }> => {
    const norm = await normalizeAttachmentData(data, mimeType)
    return downscaleImageIfNeeded(norm.data, norm.mimeType)
}

const normalizeDataUrlBlock = async (block: Record<string, any>): Promise<Record<string, any>> => {
    const url = block.image_url ?? ''
    if (typeof url !== 'string') return block
    let mediaType: string
    let base64Data: string
    try {
        const parsed = parseDataUrl(url)
        mediaType = parsed.mediaType
        base64Data = parsed.base64
    } catch {
        return block
    }

    const raw = Buffer.from(base64Data, 'base64')
    const { data: outData, mimeType: outMime } = await normalizeAndDownscale(raw, mediaType)
    if (outData === raw && outMime === mediaType) return block

    const newB64 = outData.toString('base64')
    return { ...block, image_url: `data:${outMime};base64,${newB64}` }
}

// Resolve every cited image or fail the complete request.
export const resolveImageUrls = async (
    content: string | Array<Record<string, any>>,
    natsClient?: NatsService,
): Promise<string | Array<Record<string, any>>> => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return content

    const resolved: Array<Record<string, any>> = []

    for (const block of content) {
        if (typeof block !== 'object' || block === null) {
            resolved.push(block)
            continue
        }

        const blockType = (block as any).type
        if (blockType !== 'input_image') {
            resolved.push(block)
            continue
        }

        const url: string = (block as any).image_url ?? ''

        if (url.startsWith('data:')) {
            resolved.push(await normalizeDataUrlBlock(block))
            continue
        }

        const objRef = parseNatsObjectRef(url)
        if (objRef && natsClient) {
            let raw: Uint8Array | null = null
            try {
                raw = await natsClient.getObject(objRef.bucket, objRef.key)
            } catch (e) {
                throw new Error(`ATTACHMENT_OBJECT_READ_FAILED:${url}`, { cause: e })
            }
            if (!raw) {
                throw new Error(`ATTACHMENT_OBJECT_NOT_FOUND:${url}`)
            }
            const buf = Buffer.from(raw)
            const detected = detectImageMime(buf)
            const { data: outData, mimeType: outMime } = await normalizeAndDownscale(buf, detected)
            const b64 = outData.toString('base64')
            resolved.push({ ...block, image_url: `data:${outMime};base64,${b64}` })
            continue
        }

        if (url.startsWith('https://')) {
            resolved.push(block)
            continue
        }

        throw new Error(`ATTACHMENT_IMAGE_URL_UNSUPPORTED:${url}`)
    }

    return resolved
}

const convertImageBlockToAnthropic = (block: Record<string, any>): Record<string, any> | null => {
    const url: string = block.image_url ?? ''
    if (url.startsWith('data:')) {
        try {
            const { mediaType, base64 } = parseDataUrl(url)
            return {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
            }
        } catch (e) {
            throw new Error('ATTACHMENT_IMAGE_DATA_INVALID:ANTHROPIC', { cause: e })
        }
    }
    return { type: 'image', source: { type: 'url', url } }
}

const convertContentBlockToAnthropic = (block: Record<string, any>): Record<string, any> | null => {
    const blockType = block.type
    if (blockType === 'input_text') return { type: 'text', text: block.text ?? '' }
    if (blockType === 'input_image') return convertImageBlockToAnthropic(block)
    if (blockType === 'input_audio') throw new Error('ATTACHMENT_INPUT_KIND_UNSUPPORTED:ANTHROPIC:audio')
    if (blockType === 'file') {
        const file = block.file ?? {}
        const url = file.url ?? ''
        if (typeof url === 'string' && url.startsWith('data:')) {
            try {
                const { mediaType, base64 } = parseDataUrl(url)
                return {
                    type: 'document',
                    source: { type: 'base64', media_type: mediaType, data: base64 },
                }
            } catch (e) {
                throw new Error('ATTACHMENT_FILE_DATA_INVALID:ANTHROPIC', { cause: e })
            }
        }
        throw new Error('ATTACHMENT_FILE_URL_UNSUPPORTED:ANTHROPIC')
    }
    throw new Error(`ATTACHMENT_BLOCK_UNSUPPORTED:ANTHROPIC:${String(blockType)}`)
}

const convertContentForAnthropic = (
    content: string | Array<Record<string, any>>,
): string | Array<Record<string, any>> => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return content
    const out: Array<Record<string, any>> = []
    for (const block of content) {
        if (typeof block !== 'object' || block === null) throw new Error('ATTACHMENT_BLOCK_INVALID:ANTHROPIC')
        const c = convertContentBlockToAnthropic(block)
        if (!c) throw new Error('ATTACHMENT_BLOCK_CONVERSION_FAILED:ANTHROPIC')
        out.push(c)
    }
    return out.length > 0 ? out : ''
}

const convertContentForOpenAI = (
    content: string | Array<Record<string, any>>,
): string | Array<Record<string, any>> => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return content
    const out: Array<Record<string, any>> = []
    for (const block of content) {
        if (typeof block !== 'object' || block === null) throw new Error('ATTACHMENT_BLOCK_INVALID:OPENAI')
        const blockType = block.type
        if (blockType === 'input_text') {
            out.push({ type: 'input_text', text: block.text ?? '' })
        } else if (blockType === 'input_image') {
            out.push({
                type: 'input_image',
                image_url: block.image_url ?? '',
                detail: block.detail ?? 'auto',
            })
        } else if (blockType === 'file') {
            out.push(block)
        } else if (blockType === 'input_audio') {
            out.push(block)
        } else {
            throw new Error(`ATTACHMENT_BLOCK_UNSUPPORTED:OPENAI:${String(blockType)}`)
        }
    }
    return out.length > 0 ? out : ''
}

const convertContentForGoogle = (
    content: string | Array<Record<string, any>>,
): string | Array<Record<string, any>> => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return content
    const out: Array<Record<string, any>> = []
    for (const block of content) {
        if (typeof block !== 'object' || block === null) throw new Error('ATTACHMENT_BLOCK_INVALID:GOOGLE')
        const blockType = block.type
        if (blockType === 'input_text') {
            out.push({ text: block.text ?? '' })
        } else if (blockType === 'input_image') {
            const url: string = block.image_url ?? ''
            if (url.startsWith('data:')) {
                try {
                    const { mediaType, base64 } = parseDataUrl(url)
                    out.push({ inlineData: { mimeType: mediaType, data: base64 } })
                } catch (e) {
                    throw new Error('ATTACHMENT_IMAGE_DATA_INVALID:GOOGLE', { cause: e })
                }
            } else {
                throw new Error('ATTACHMENT_IMAGE_URL_UNSUPPORTED:GOOGLE')
            }
        } else if (blockType === 'input_audio') {
            const dataUrl = block.input_audio?.data
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
                throw new Error('ATTACHMENT_AUDIO_DATA_INVALID:GOOGLE')
            }
            const { mediaType, base64 } = parseDataUrl(dataUrl)
            out.push({ inlineData: { mimeType: mediaType, data: base64 } })
        } else {
            throw new Error(`ATTACHMENT_BLOCK_UNSUPPORTED:GOOGLE:${String(blockType)}`)
        }
    }
    return out.length > 0 ? out : ''
}

export const convertAttachmentsForProvider = (
    content: string | Array<Record<string, any>>,
    targetFormat: AttachmentFormat,
): string | Array<Record<string, any>> => {
    if (targetFormat === 'ANTHROPIC') return convertContentForAnthropic(content)
    if (targetFormat === 'OPENAI') return convertContentForOpenAI(content)
    if (targetFormat === 'GOOGLE') return convertContentForGoogle(content)
    return content
}
