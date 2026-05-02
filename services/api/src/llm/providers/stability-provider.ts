'use strict'

import * as process from 'process'
import { randomUUID } from 'node:crypto'

import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '../config.ts'
import type { ProviderState, ChatMessage } from '../graph/state.ts'
import { validateImagePrompt } from '../tools/image-generation.ts'

const MODEL_ENDPOINT_MAP: Record<string, string> = {
    'stability-ultra': '/v2beta/stable-image/generate/ultra',
    'sd3.5-large': '/v2beta/stable-image/generate/sd3',
}

const SD3_MODELS = new Set(['sd3.5-large'])
const STYLE_CONTROL_ENDPOINT = '/v2beta/stable-image/control/style'
const STYLE_TRANSFER_ENDPOINT = '/v2beta/stable-image/control/style-transfer'
const STYLE_CONTROL_FIDELITY = 0.7

const decodeDataUrlWithMime = (url: string): { bytes: Buffer; mime: string } | undefined => {
    if (!url || !url.startsWith('data:')) return undefined
    const commaIdx = url.indexOf(',')
    if (commaIdx === -1) return undefined
    const header = url.slice(0, commaIdx)
    const data = url.slice(commaIdx + 1)
    let mime = 'image/png'
    if (header.includes(':') && header.includes(';')) {
        mime = header.split(':')[1]!.split(';')[0]!
    }
    return { bytes: Buffer.from(data, 'base64'), mime }
}

const extractAllReferenceImages = (messages: ChatMessage[]): Array<{ bytes: Buffer; mime: string }> => {
    const images: Array<{ bytes: Buffer; mime: string }> = []
    for (const msg of messages) {
        if (msg.role !== 'user') continue
        const content = msg.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            const blockType = (block as any).type
            if (blockType === 'input_image') {
                const url = (block as any).image_url
                const decoded = typeof url === 'string' ? decodeDataUrlWithMime(url) : undefined
                if (decoded) images.push(decoded)
            } else if (blockType === 'image') {
                const source = (block as any).source ?? {}
                if (source.type === 'base64' && source.data) {
                    images.push({
                        bytes: Buffer.from(source.data, 'base64'),
                        mime: source.media_type ?? 'image/png',
                    })
                }
            } else if (blockType === 'inline_data') {
                const data = (block as any).data
                if (data) {
                    images.push({
                        bytes: Buffer.from(data, 'base64'),
                        mime: (block as any).mime_type ?? 'image/png',
                    })
                }
            }
        }
    }
    return images
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
        const allRefs = extractAllReferenceImages(messages)
        info(`[Stability:${this.instanceKey}] Found ${allRefs.length} reference image(s) in messages`)

        let primaryRef: { bytes: Buffer; mime: string } | undefined
        let styleRef: { bytes: Buffer; mime: string } | undefined
        if (allRefs.length >= 2) {
            allRefs.sort((a, b) => b.bytes.length - a.bytes.length)
            primaryRef = allRefs[0]
            styleRef = allRefs[1]
            if (allRefs.length > 2) {
                warn(`[Stability:${this.instanceKey}] ${allRefs.length - 2} extra references skipped`)
            }
        } else if (allRefs.length === 1) {
            primaryRef = allRefs[0]
        }

        await this.imagePub.partial('', 0)

        const requestId = randomUUID()
        const formData = new FormData()
        formData.set('prompt', prompt)
        formData.set('output_format', 'png')

        let endpoint: string
        if (primaryRef && styleRef) {
            endpoint = STYLE_TRANSFER_ENDPOINT
            const initExt = primaryRef.mime.split('/')[1] ?? 'png'
            const styleExt = styleRef.mime.split('/')[1] ?? 'png'
            const initBlob = new Blob([new Uint8Array(primaryRef.bytes)], { type: primaryRef.mime })
            const styleBlob = new Blob([new Uint8Array(styleRef.bytes)], { type: styleRef.mime })
            formData.set('init_image', initBlob, `init.${initExt}`)
            formData.set('style_image', styleBlob, `style.${styleExt}`)
        } else if (primaryRef) {
            endpoint = STYLE_CONTROL_ENDPOINT
            formData.set('aspect_ratio', aspectRatio)
            formData.set('fidelity', String(STYLE_CONTROL_FIDELITY))
            const refExt = primaryRef.mime.split('/')[1] ?? 'png'
            const refBlob = new Blob([new Uint8Array(primaryRef.bytes)], { type: primaryRef.mime })
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
            `aspect=${aspectRatio} refs=${allRefs.length} promptLen=${prompt.length}`,
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
        }
    }
}
