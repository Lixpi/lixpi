'use strict'

import * as process from 'process'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'

import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '@lixpi/constants'
import type { ProviderState, ChatMessage } from '../graph/state.ts'
import { validateImagePrompt } from '../tools/image-generation.ts'
import type { ResolvedImageGenerationReference } from '../image-generation-references.ts'

const MODEL_ENDPOINT_MAP: Record<string, string> = {
    'stability-ultra': '/v2beta/stable-image/generate/ultra',
    'sd3.5-large': '/v2beta/stable-image/generate/sd3',
}

const SD3_MODELS = new Set(['sd3.5-large'])
const STYLE_CONTROL_ENDPOINT = '/v2beta/stable-image/control/style'
const STRUCTURE_CONTROL_ENDPOINT = '/v2beta/stable-image/control/structure'
const STYLE_TRANSFER_ENDPOINT = '/v2beta/stable-image/control/style-transfer'
const STYLE_CONTROL_FIDELITY = 0.7
const STRUCTURE_CONTROL_STRENGTH = 0.9
const MAX_STABILITY_REFERENCE_PIXELS = 9_437_184
const STABILITY_REFERENCE_TILE_SIZE = 768

const resizeReferenceForStability = async (
    ref: ResolvedImageGenerationReference,
    logPrefix: string,
    label: string,
): Promise<ResolvedImageGenerationReference> => {
    let metadata: sharp.Metadata
    try {
        metadata = await sharp(ref.bytes).metadata()
    } catch (e) {
        warn(`${logPrefix} Failed to inspect ${label} reference dimensions: ${e}`)
        return ref
    }

    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const pixels = width * height
    if (width <= 0 || height <= 0 || pixels <= MAX_STABILITY_REFERENCE_PIXELS) return ref

    const scale = Math.sqrt(MAX_STABILITY_REFERENCE_PIXELS / pixels)
    const resizedWidth = Math.max(1, Math.floor(width * scale))
    const resizedHeight = Math.max(1, Math.floor(height * scale))

    try {
        const resizedBytes = await sharp(ref.bytes)
            .resize({
                width: resizedWidth,
                height: resizedHeight,
                fit: 'inside',
                withoutEnlargement: true,
                kernel: 'lanczos3',
            })
            .toBuffer()
        const resizedMetadata = await sharp(resizedBytes).metadata()
        const outWidth = resizedMetadata.width ?? resizedWidth
        const outHeight = resizedMetadata.height ?? resizedHeight

        info(
            `${logPrefix} Resized ${label} reference image ` +
            `${width}x${height} (${pixels} px) -> ${outWidth}x${outHeight} ` +
            `(${outWidth * outHeight} px) for Stability limit ${MAX_STABILITY_REFERENCE_PIXELS}`,
        )

        return {
            ...ref,
            bytes: resizedBytes,
            byteLength: resizedBytes.byteLength,
        }
    } catch (e) {
        warn(`${logPrefix} Failed to resize ${label} reference image for Stability: ${e}`)
        return ref
    }
}

const composeCharacterSourceReferences = async (
    references: ResolvedImageGenerationReference[],
    logPrefix: string,
): Promise<ResolvedImageGenerationReference | undefined> => {
    if (references.length === 0) return undefined
    if (references.length === 1) return references[0]

    const columns = Math.ceil(Math.sqrt(references.length))
    const rows = Math.ceil(references.length / columns)
    const tiles = await Promise.all(references.map(async (reference, index) => ({
        input: await sharp(reference.bytes)
            .resize({
                width: STABILITY_REFERENCE_TILE_SIZE,
                height: STABILITY_REFERENCE_TILE_SIZE,
                fit: 'contain',
                background: '#ffffff',
            })
            .png()
            .toBuffer(),
        left: (index % columns) * STABILITY_REFERENCE_TILE_SIZE,
        top: Math.floor(index / columns) * STABILITY_REFERENCE_TILE_SIZE,
    })))
    const bytes = await sharp({
        create: {
            width: columns * STABILITY_REFERENCE_TILE_SIZE,
            height: rows * STABILITY_REFERENCE_TILE_SIZE,
            channels: 3,
            background: '#ffffff',
        },
    })
        .composite(tiles)
        .png()
        .toBuffer()
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    info(`${logPrefix} Composed ${references.length} authoritative character sources into one style-evidence board sha256=${sha256}`)
    return {
        url: `data:image/png;base64,${bytes.toString('base64')}`,
        role: 'character-source',
        fileName: 'character-source-composite.png',
        bytes,
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        mediaType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
    }
}

const extractPrompt = (messages: ChatMessage[]): string => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]!
        if (msg.role !== 'user') continue
        const content = msg.content
        if (typeof content === 'string') return content.trim()
        if (Array.isArray(content)) {
            for (const block of content) {
                if (typeof block !== 'object' || block === null) continue
                const blockType = (block as any).type
                if (blockType === 'input_text' || blockType === 'text') {
                    return ((block as any).text ?? '').trim()
                }
                if ('text' in block) {
                    return (((block as any).text) ?? '').trim()
                }
            }
        }
    }
    return ''
}

const resolveAspectRatio = (imageSize: string | undefined): string => {
    if (!imageSize || imageSize === 'auto') return '1:1'
    return imageSize
}

export class StabilityProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Stability'

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        if (!state.enableImageGeneration) {
            throw new Error('Stability AI is an image-only provider and requires enableImageGeneration=true')
        }

        const apiKey = process.env.STABLE_DIFFUSION_API_KEY
        if (!apiKey) throw new Error('STABLE_DIFFUSION_API_KEY is not configured')

        const modelVersion = state.modelVersion
        const imageSize = state.imageSize ?? '1:1'

        const messages = state.messages
        const prompt = extractPrompt(messages)
        if (!prompt) throw new Error('No prompt found in messages')

        const validationError = validateImagePrompt(prompt, state.aiModelMetaInfo, this.providerName)
        if (validationError) throw new Error(validationError)

        const aspectRatio = resolveAspectRatio(imageSize)
        const allRefs = [...(state.resolvedImageGenerationReferences ?? [])]
        info(`[Stability:${this.instanceKey}] reference images ${JSON.stringify(allRefs.map(reference => ({
            role: reference.role,
            fileName: reference.fileName,
            byteLength: reference.byteLength,
            mediaType: reference.mediaType,
            sha256: reference.sha256,
        })))}`)

        const logPrefix = `[Stability:${this.instanceKey}]`
        const characterLayoutRef = allRefs.find(reference => reference.role === 'character-layout-example')
        const characterDraftRef = allRefs.find(reference => reference.role === 'character-sheet-draft')
        const characterSourceRefs = allRefs.filter(reference => reference.role === 'character-source')
        let routingMode: 'generate' | 'style-control' | 'structure-control' | 'style-transfer' = 'generate'
        let primaryRef: ResolvedImageGenerationReference | undefined
        let styleRef: ResolvedImageGenerationReference | undefined

        if (characterLayoutRef) {
            routingMode = 'structure-control'
            primaryRef = characterLayoutRef
            if (characterSourceRefs.length > 0) {
                info(`${logPrefix} Character sources are reserved for the fidelity-restoration pass; the layout-synthesis pass uses the packaged template as structural control`)
            }
        } else if (characterDraftRef && characterSourceRefs.length > 0) {
            routingMode = 'style-transfer'
            primaryRef = characterDraftRef
            styleRef = await composeCharacterSourceReferences(characterSourceRefs, logPrefix)
        } else if (allRefs.length >= 2) {
            routingMode = 'style-transfer'
            allRefs.sort((a, b) => b.bytes.length - a.bytes.length)
            primaryRef = allRefs[0]
            styleRef = allRefs[1]
            if (allRefs.length > 2) {
                warn(`${logPrefix} ${allRefs.length - 2} extra non-character references skipped`)
            }
        } else if (allRefs.length === 1) {
            routingMode = allRefs[0]?.role === 'character-layout-example'
                ? 'structure-control'
                : 'style-control'
            primaryRef = allRefs[0]
        }

        if (primaryRef) {
            primaryRef = await resizeReferenceForStability(primaryRef, logPrefix, 'primary')
        }
        if (styleRef) {
            styleRef = await resizeReferenceForStability(styleRef, logPrefix, 'style')
        }

        await this.imagePub.partial('', 0)

        const requestId = randomUUID()
        const formData = new FormData()
        formData.set('prompt', prompt)
        formData.set('output_format', 'png')

        let endpoint: string
        if (routingMode === 'style-transfer' && primaryRef && styleRef) {
            endpoint = STYLE_TRANSFER_ENDPOINT
            const initExt = primaryRef.mediaType.split('/')[1] ?? 'png'
            const styleExt = styleRef.mediaType.split('/')[1] ?? 'png'
            const initBlob = new Blob([new Uint8Array(primaryRef.bytes)], { type: primaryRef.mediaType })
            const styleBlob = new Blob([new Uint8Array(styleRef.bytes)], { type: styleRef.mediaType })
            formData.set('init_image', initBlob, `init.${initExt}`)
            formData.set('style_image', styleBlob, `style.${styleExt}`)
            formData.set('style_strength', '1')
        } else if (routingMode === 'structure-control' && primaryRef) {
            endpoint = STRUCTURE_CONTROL_ENDPOINT
            formData.set('aspect_ratio', aspectRatio)
            formData.set('control_strength', String(STRUCTURE_CONTROL_STRENGTH))
            const refExt = primaryRef.mediaType.split('/')[1] ?? 'png'
            const refBlob = new Blob([new Uint8Array(primaryRef.bytes)], { type: primaryRef.mediaType })
            formData.set('image', refBlob, `structure.${refExt}`)
        } else if (routingMode === 'style-control' && primaryRef) {
            endpoint = STYLE_CONTROL_ENDPOINT
            formData.set('aspect_ratio', aspectRatio)
            formData.set('fidelity', String(STYLE_CONTROL_FIDELITY))
            const refExt = primaryRef.mediaType.split('/')[1] ?? 'png'
            const refBlob = new Blob([new Uint8Array(primaryRef.bytes)], { type: primaryRef.mediaType })
            formData.set('image', refBlob, `reference.${refExt}`)
        } else {
            const ep = MODEL_ENDPOINT_MAP[modelVersion]
            if (!ep) throw new Error(`Unknown Stability model: ${modelVersion}`)
            endpoint = ep
            formData.set('aspect_ratio', aspectRatio)
            if (SD3_MODELS.has(modelVersion)) formData.set('model', modelVersion)
        }

        info(
            `[Stability:${this.instanceKey}] API request endpoint=${endpoint} model=${modelVersion} ` +
            `aspect=${aspectRatio} refs=${allRefs.length} mode=${routingMode} promptLen=${prompt.length}`,
        )

        const response = await fetch(`https://api.stability.ai${endpoint}`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${apiKey}`,
                accept: 'application/json',
            },
            body: formData,
            signal: this.signal,
        })

        info(`[Stability:${this.instanceKey}] API response status=${response.status}`)

        if (response.status !== 200) {
            let errorBody: any = {}
            try {
                if (response.headers.get('content-type')?.startsWith('application/json')) {
                    errorBody = await response.json()
                }
            } catch { }
            const errors: string[] = errorBody.errors ?? [String(response.status)]
            const errorName: string = errorBody.name ?? 'api_error'
            err(`[Stability:${this.instanceKey}] API error name=${errorName} errors=${errors}`)
            throw new Error(`Stability API error (${errorName}): ${errors.join('; ')}`)
        }

        const result: any = await response.json()
        const imageBase64: string = result.image ?? ''
        const finishReason: string = result.finish_reason ?? ''

        info(
            `[Stability:${this.instanceKey}] Generation complete finishReason=${finishReason} ` +
            `imageLen=${imageBase64.length}`,
        )

        if (finishReason === 'CONTENT_FILTERED') {
            throw new Error('Image was filtered by Stability AI content moderation. Please try a different prompt.')
        }
        if (!imageBase64) {
            throw new Error('Stability API returned empty image data')
        }

        await this.imagePub.complete({
            imageBase64,
            responseId: requestId,
            revisedPrompt: prompt,
            imageModelId: modelVersion,
        })

        return {
            usage: {
                promptTokens: 0,
                promptAudioTokens: 0,
                promptCachedTokens: 0,
                completionTokens: 0,
                completionAudioTokens: 0,
                completionReasoningTokens: 0,
                totalTokens: 0,
            },
            aiVendorRequestId: requestId,
            imageUsage: {
                generatedCount: 1,
                size: aspectRatio,
                quality: 'high',
            },
            generatedImages: [imageBase64],
        }
    }
}
