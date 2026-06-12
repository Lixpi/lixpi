'use strict'

import * as process from 'process'

import { GoogleGenAI } from '@google/genai'
import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '@lixpi/constants'
import type { ProviderState, ChatMessage } from '../graph/state.ts'
import { getSystemPrompt } from '../prompts/load-prompts.ts'
import {
    convertAttachmentsForProvider,
    parseDataUrl,
    resolveImageUrls,
} from '../utils/attachments.ts'
import {
    TOOL_NAME,
    applyImagePromptLimitToSystemPrompt,
    buildImagePromptRewriteInstruction,
    extractReferenceImages,
    getToolForProvider,
} from '../tools/image-generation.ts'
import {
    VIDEO_TOOL_NAME,
    getVideoToolForProvider,
} from '../tools/video-generation.ts'
import { extractPosterFrame, extractRepresentativeFrame } from '../../services/video-storage.ts'
import { VEO_POLL_INTERVAL_MS } from '../config.ts'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type VeoImageInput = { imageBytes: string; mimeType: string }

export function buildVeoReferenceImages(refs: VeoImageInput[]): Array<{ image: VeoImageInput; referenceType: 'asset' }> {
    return refs.map(image => ({ image, referenceType: 'asset' }))
}

export class GoogleProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Google'
    private readonly client: GoogleGenAI

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
        const apiKey = process.env.GOOGLE_API_KEY
        if (!apiKey) throw new Error('GOOGLE_API_KEY environment variable is required')
        this.client = new GoogleGenAI({ apiKey })
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        const messages = state.messages
        const modelVersion = state.modelVersion
        const maxTokens = state.maxCompletionSize
        const temperature = state.temperature ?? 0.7
        const supportsSystemPrompt = state.aiModelMetaInfo?.supportsSystemPrompt ?? true
        const enableImageGeneration = state.enableImageGeneration ?? false
        const imageSize = state.imageSize ?? 'auto'

        const modalities = (state.aiModelMetaInfo as any)?.modalities ?? []
        const modelSupportsImageOutput = Array.isArray(modalities) && modalities.some((m: any) => {
            const modality = typeof m === 'object' ? m?.modality : m
            return modality === 'image' || modality === 'image_generation'
        })
        const modelNameImpliesImageOutput = /gemini-.*(?:-image|image-generation)/i.test(modelVersion)
        const effectiveImageGen = enableImageGeneration && (modelSupportsImageOutput || modelNameImpliesImageOutput)

        const hasImageModel = !!state.imageModelVersion
        const injectTool = hasImageModel && !enableImageGeneration

        const enableVideoGeneration = state.enableVideoGeneration ?? false
        const modelNameImpliesVideoOutput = /veo/i.test(modelVersion)
        const effectiveVideoGen = enableVideoGeneration && modelNameImpliesVideoOutput

        const hasVideoModel = !!state.videoModelVersion
        const injectVideoTool = hasVideoModel && !enableImageGeneration && !enableVideoGeneration

        // Resolve message content (so reference-image extraction sees data URLs)
        // and convert each message to a Google `Content` object.
        const resolvedMessages: ChatMessage[] = []
        const contents: Array<Record<string, any>> = []
        for (const msg of messages) {
            let content: any = msg.content ?? ''
            content = await resolveImageUrls(content, this.nats)
            resolvedMessages.push({ role: msg.role, content })

            content = convertAttachmentsForProvider(content, 'GOOGLE')
            const role = msg.role === 'assistant' ? 'model' : msg.role
            contents.push({ role, parts: this.buildParts(content) })
        }

        const config: Record<string, any> = { temperature }
        if (maxTokens) config.maxOutputTokens = maxTokens

        if (effectiveImageGen) {
            config.responseModalities = ['TEXT', 'IMAGE']
            if (imageSize && imageSize !== 'auto') {
                config.imageConfig = { aspectRatio: imageSize }
            }
        }

        if (injectTool || injectVideoTool) {
            const functionDeclarations: Array<Record<string, any>> = []
            if (injectTool) {
                const toolDef = getToolForProvider('Google', state.imageModelMetaInfo, state.imageProviderName)
                functionDeclarations.push({ name: TOOL_NAME, description: toolDef.description, parameters: toolDef.parameters })
            }
            if (injectVideoTool) {
                const videoToolDef = getVideoToolForProvider('Google')
                functionDeclarations.push({ name: VIDEO_TOOL_NAME, description: videoToolDef.description, parameters: videoToolDef.parameters })
            }
            config.tools = [{ functionDeclarations }]

            // In an explicit media-generation run (the matrix fans this reasoning
            // model out to image/video models) the model MUST emit the tool call —
            // its prompt is the whole point of the run, and without it that variant
            // produces no media. Gemini in AUTO mode sometimes answers in prose and
            // skips the call, so force it here. Outside the matrix (opportunistic
            // chat image-gen) we leave AUTO so plain replies still work.
            if (state.mediaFanoutPlan) {
                config.toolConfig = {
                    functionCallingConfig: {
                        mode: 'ANY',
                        allowedFunctionNames: functionDeclarations.map((declaration) => declaration.name),
                    },
                }
            }
        }

        let systemInstruction: string | undefined
        if (supportsSystemPrompt) {
            systemInstruction = getSystemPrompt(injectTool, injectVideoTool)
            if (injectTool && systemInstruction) {
                systemInstruction = applyImagePromptLimitToSystemPrompt(
                    systemInstruction,
                    state.imageModelMetaInfo,
                    state.imageProviderName,
                ) ?? systemInstruction
            }
        }
        if (systemInstruction) config.systemInstruction = systemInstruction

        if (effectiveImageGen && !modelVersion.startsWith('gemini-2.5')) {
            config.thinkingConfig = { includeThoughts: true }
        }

        const update: Partial<ProviderState> = {}

        try {
            if (!effectiveImageGen && !effectiveVideoGen) this.publisher.start()

            let usageMetadata: any = null

            if (effectiveVideoGen) {
                // Native video-generation path (called via VideoRouter). Async
                // submit + poll with keepalive pings; no streamed partial frames.
                await this.runVeoGeneration(state)
                update.generatedVideos = ['veo-complete']
                update.videoUsage = {
                    durationSeconds: state.videoDurationSeconds ?? 0,
                    resolution: state.videoResolution ?? '',
                    aspectRatio: state.videoAspectRatio ?? '',
                }
            } else if (effectiveImageGen) {
                // Native image-generation path (called via ImageRouter).
                const inputImageCount = contents.reduce((acc, c) => acc + (Array.isArray((c as any).parts)
                    ? (c as any).parts.filter((p: any) => p?.inlineData || p?.inline_data).length
                    : 0), 0)
                const inputTextLen = contents.reduce((acc, c) => acc + (Array.isArray((c as any).parts)
                    ? (c as any).parts.reduce((s: number, p: any) => s + (typeof p?.text === 'string' ? p.text.length : 0), 0)
                    : 0), 0)
                info(`[Google:${this.instanceKey}] image-gen call ${JSON.stringify({
                    model: modelVersion,
                    responseModalities: config.responseModalities,
                    aspectRatio: (config as any).imageConfig?.aspectRatio ?? 'auto',
                    temperature,
                    maxOutputTokens: maxTokens,
                    contentsCount: contents.length,
                    inputImageCount,
                    inputTextLen,
                }, null, 0)}`)
                await this.imagePub.partial('', 0)
                const response = await this.client.models.generateContent({
                    model: modelVersion,
                    contents: contents as any,
                    config: config as any,
                })
                usageMetadata = response.usageMetadata

                // Collect image parts in order. Gemini 3 image models may emit
                // images marked thought=true; treat all parts equally and use
                // the LAST image part as the final.
                const imageParts: string[] = []
                const textChunks: string[] = []

                for (const candidate of response.candidates ?? []) {
                    if (!candidate.content?.parts) continue
                    for (const part of candidate.content.parts) {
                        if (this.shouldStop) break
                        const inline = (part as any).inlineData ?? (part as any).inline_data
                        const text = (part as any).text
                        if (inline?.data) {
                            imageParts.push(inline.data)  // already base64 in JS SDK
                        } else if (text) {
                            textChunks.push(text)
                        }
                    }
                }

                if (textChunks.length > 0) {
                    this.publisher.chunk(textChunks.join(''))
                }

                if (imageParts.length === 0) {
                    const errMsg = `Google image model ${modelVersion} returned no inline image data.`
                    err(`[Google:${this.instanceKey}] ${errMsg}`)
                    update.error = errMsg
                } else {
                    for (let i = 0; i < imageParts.length - 1; i++) {
                        await this.imagePub.partial(imageParts[i]!, i + 1)
                    }
                    const final = imageParts[imageParts.length - 1]!
                    await this.imagePub.complete({
                        imageBase64: final,
                        responseId: '',
                        revisedPrompt: '',
                        imageModelId: modelVersion,
                    })
                    update.generatedImages = [final]
                }
            } else if (injectTool || injectVideoTool) {
                const stream = await this.client.models.generateContentStream({
                    model: modelVersion,
                    contents: contents as any,
                    config: config as any,
                })
                let detectedImage: string | undefined
                let detectedVideo: string | undefined
                for await (const chunk of stream) {
                    if (this.shouldStop) break
                    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata
                    for (const candidate of chunk.candidates ?? []) {
                        if (!candidate.content?.parts) continue
                        for (const part of candidate.content.parts) {
                            const fnCall = (part as any).functionCall ?? (part as any).function_call
                            if (fnCall && fnCall.name === TOOL_NAME) {
                                detectedImage = (fnCall.args ?? {}).prompt ?? ''
                            } else if (fnCall && fnCall.name === VIDEO_TOOL_NAME) {
                                detectedVideo = (fnCall.args ?? {}).prompt ?? ''
                            } else if ((part as any).text) {
                                this.publisher.chunk((part as any).text)
                            }
                        }
                    }
                }
                if (detectedVideo) {
                    update.generatedVideoPrompt = detectedVideo
                    info(`[Google:${this.instanceKey}] generate_video tool call ${JSON.stringify({
                        chatModel: modelVersion,
                        targetVideoProvider: state.videoProviderName,
                        targetVideoModel: state.videoModelVersion,
                        promptLen: detectedVideo.length,
                    }, null, 0)}`)
                } else if (detectedImage) {
                    const refs = extractReferenceImages(resolvedMessages)
                    update.generatedImagePrompt = detectedImage
                    update.referenceImages = refs
                    info(`[Google:${this.instanceKey}] generate_image tool call ${JSON.stringify({
                        chatModel: modelVersion,
                        targetImageProvider: state.imageProviderName,
                        targetImageModel: state.imageModelVersion,
                        promptLen: detectedImage.length,
                        referenceImagesExtracted: refs.length,
                    }, null, 0)}`)
                } else if (injectTool && injectVideoTool) {
                    warn(`Google did not emit generate_image or generate_video tool call for ${this.instanceKey}`)
                } else if (injectTool) {
                    warn(`Google did not emit generate_image tool call for ${this.instanceKey}`)
                } else {
                    warn(`Google did not emit generate_video tool call for ${this.instanceKey}`)
                }
            } else {
                // Pure text streaming
                const stream = await this.client.models.generateContentStream({
                    model: modelVersion,
                    contents: contents as any,
                    config: config as any,
                })
                for await (const chunk of stream) {
                    if (this.shouldStop) break
                    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata
                    for (const candidate of chunk.candidates ?? []) {
                        if (!candidate.content?.parts) continue
                        for (const part of candidate.content.parts) {
                            if ((part as any).text) {
                                this.publisher.chunk((part as any).text)
                            }
                        }
                    }
                }
            }

            if (usageMetadata) {
                const promptTokens = usageMetadata.promptTokenCount ?? 0
                const completionTokens = usageMetadata.candidatesTokenCount ?? 0
                update.usage = {
                    promptTokens,
                    promptAudioTokens: 0,
                    promptCachedTokens: usageMetadata.cachedContentTokenCount ?? 0,
                    completionTokens,
                    completionAudioTokens: 0,
                    completionReasoningTokens: usageMetadata.thoughtsTokenCount ?? 0,
                    totalTokens: usageMetadata.totalTokenCount ?? (promptTokens + completionTokens),
                }
                update.aiVendorRequestId = `google-${state.workspaceId}-${state.aiChatThreadId}`
            }

            if (effectiveImageGen && !update.error) {
                update.imageUsage = {
                    generatedCount: 1,
                    size: imageSize,
                    quality: 'high',
                }
            }

            if (!effectiveImageGen && !effectiveVideoGen) this.publisher.end()
        } catch (e: any) {
            err(`Google streaming failed: ${e?.message ?? e}`)
            update.error = e?.message ?? String(e)
        }

        return update
    }

    private buildParts(content: any): Array<Record<string, any>> {
        if (typeof content === 'string') return [{ text: content }]
        if (!Array.isArray(content)) return [{ text: String(content) }]
        const parts: Array<Record<string, any>> = []
        for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            if ('text' in block) {
                parts.push({ text: block.text })
            } else if ('inlineData' in block) {
                parts.push({ inlineData: block.inlineData })
            } else if ('inline_data' in block) {
                const inline = block.inline_data
                parts.push({ inlineData: { data: inline.data, mimeType: inline.mime_type } })
            }
        }
        return parts.length > 0 ? parts : [{ text: '' }]
    }

    protected override async rewriteImagePromptToFitLimit(
        state: ProviderState,
        prompt: string,
        maxChars: number,
    ): Promise<string | undefined> {
        const response = await this.client.models.generateContent({
            model: state.modelVersion,
            contents: [{ role: 'user', parts: [{ text: `Original image prompt:\n${prompt}` }] }] as any,
            config: {
                temperature: 0.2,
                maxOutputTokens: Math.max(256, Math.ceil((maxChars + 3) / 4) + 128),
                systemInstruction: buildImagePromptRewriteInstruction(maxChars),
            } as any,
        })

        const direct = (response as any).text
        if (typeof direct === 'string' && direct.trim()) return direct.trim()

        const parts: string[] = []
        for (const candidate of response.candidates ?? []) {
            if (!candidate.content?.parts) continue
            for (const part of candidate.content.parts) {
                if ((part as any).text) parts.push(((part as any).text as string).trim())
            }
        }
        const out = parts.filter(Boolean).join('\n').trim()
        return out || undefined
    }

    // Synchronous submit + poll loop for VEO video generation. Emits
    // VIDEO_PENDING immediately, then VIDEO_GENERATING keepalive pings every
    // VEO_POLL_INTERVAL_MS, then VIDEO_COMPLETE on success (or VIDEO_ERROR +
    // throws on failure, which the streamImpl catch converts to update.error).
    //
    // Image-to-video first frame and reference-conditioned generation are wired
    // through state.videoFirstFrameImage / state.videoReferenceImages, which the
    // structured VLM resolver populates from the candidate snapshot. VEO's
    // `image` (top-level) and `referenceImages` (config) are MUTUALLY EXCLUSIVE
    // per the SDK — the resolver picks ONE based on whether it identified a
    // target image (edit/style operations) vs. a set of style references.
    private async runVeoGeneration(state: ProviderState): Promise<void> {
        const modelVersion = state.modelVersion
        // VideoRouter passes the prompt as the first user message's string content.
        const first = state.messages[0]
        const prompt = typeof first?.content === 'string' ? first.content : ''
        if (!prompt) throw new Error('VEO: missing prompt in user message')

        const veoConfig: Record<string, any> = {
            numberOfVideos: 1,
            personGeneration: 'allow_adult',
            abortSignal: this.signal,
        }
        // `generateAudio` is a Vertex-AI-only knob. The Gemini Developer API
        // (apiKey mode) rejects it outright — VEO 3 still generates audio there
        // by default — so only send the flag when the client is in Vertex mode.
        if (this.client.vertexai) veoConfig.generateAudio = true
        if (state.videoAspectRatio) veoConfig.aspectRatio = state.videoAspectRatio
        if (state.videoResolution) veoConfig.resolution = state.videoResolution
        if (state.videoDurationSeconds) veoConfig.durationSeconds = state.videoDurationSeconds

        // Video extension (Phase 6) is mutually exclusive with image/referenceImages
        // per the VEO API ("Not allowed if image is provided"). When the canvas
        // submits with sourceVideoNodeId set, the backend reads the existing MP4
        // bytes from the workspace Object Store and passes them as VEO's `video`
        // parameter. Extension takes precedence; first-frame + reference images
        // are skipped on this path.
        let extensionVideo: { videoBytes: string; mimeType: string } | undefined
        if (state.videoSourceForExtension) {
            try {
                const bytes = await this.fetchObjectStoreBytes(state.videoSourceForExtension)
                if (bytes && bytes.length > 0) {
                    extensionVideo = { videoBytes: bytes.toString('base64'), mimeType: 'video/mp4' }
                }
            } catch (e) {
                warn(`[Google:${this.instanceKey}] extension source load failed: ${(e as any)?.message ?? e}`)
            }
        }

        // First-frame (image-to-video) takes precedence over reference images —
        // they're mutually exclusive. The resolver should only populate one.
        // When extension is active, both are suppressed.
        let firstFrameImage: { imageBytes: string; mimeType: string } | undefined
        if (!extensionVideo && state.videoFirstFrameImage) {
            const parsed = this.dataUrlToImageBytes(state.videoFirstFrameImage)
            if (parsed) firstFrameImage = parsed
        }
        if (!extensionVideo && !firstFrameImage && state.videoReferenceImages && state.videoReferenceImages.length > 0) {
            const refs = state.videoReferenceImages
                .map(url => this.dataUrlToImageBytes(url))
                .filter((r): r is VeoImageInput => !!r)
                .slice(0, 3)
            if (refs.length > 0) {
                veoConfig.referenceImages = buildVeoReferenceImages(refs)
            }
        }

        const referenceImagesCount = (veoConfig.referenceImages as any[] | undefined)?.length ?? 0

        info(`[Google:${this.instanceKey}] VEO submit ${JSON.stringify({
            model: modelVersion,
            aspectRatio: veoConfig.aspectRatio,
            resolution: veoConfig.resolution,
            durationSeconds: veoConfig.durationSeconds,
            promptLen: prompt.length,
            hasFirstFrame: !!firstFrameImage,
            referenceImagesCount,
            hasExtensionSource: !!extensionVideo,
        }, null, 0)}`)

        try {
            this.videoPub.pending()

            const veoParams: Record<string, any> = {
                model: modelVersion,
                prompt,
                config: veoConfig,
            }
            // VEO precedence: extension > first-frame > reference-images > text-only.
            if (extensionVideo) {
                veoParams.video = extensionVideo
            } else if (firstFrameImage) {
                veoParams.image = firstFrameImage
            }
            let operation: any = await this.client.models.generateVideos(veoParams as any)

            while (!operation.done) {
                if (this.shouldStop) throw new Error('Video generation aborted')
                await new Promise(resolve => setTimeout(resolve, VEO_POLL_INTERVAL_MS))
                if (this.shouldStop) throw new Error('Video generation aborted')
                this.videoPub.generating()
                operation = await this.client.operations.getVideosOperation({
                    operation,
                    config: { abortSignal: this.signal } as any,
                } as any)
            }

            if ((operation as any).error) {
                const opErr = (operation as any).error
                throw new Error(`VEO operation error: ${typeof opErr === 'object' ? JSON.stringify(opErr) : String(opErr)}`)
            }

            const video = operation.response?.generatedVideos?.[0]?.video
            if (!video) throw new Error('VEO: operation completed without a video')

            const videoBuffer = await this.fetchVideoBytes(video)
            if (!videoBuffer || videoBuffer.length === 0) {
                throw new Error('VEO: empty video bytes after download')
            }

            const durationSeconds = Number(state.videoDurationSeconds) || 0
            const posterBuffer = await extractPosterFrame(videoBuffer)
            // Seek to the clip midpoint for the representative frame; fall back to
            // frame-0 semantics when the duration is unknown.
            const frameBuffer = await extractRepresentativeFrame(videoBuffer, durationSeconds > 0 ? durationSeconds / 2 : undefined)

            await this.videoPub.complete({
                videoBuffer,
                posterBuffer,
                frameBuffer,
                durationSeconds,
                aspectRatio: state.videoAspectRatio ?? '',
                hasAudio: true,
                responseId: typeof operation.name === 'string' ? operation.name : '',
                revisedPrompt: prompt,
                videoModelId: modelVersion,
            })
        } catch (e: any) {
            const message = e?.message ?? String(e)
            err(`[Google:${this.instanceKey}] VEO failed: ${message}`)
            try { this.videoPub.error(message) } catch { /* publisher may not be initialized */ }
            throw e
        }
    }

    // Reads a `nats-obj://workspace-{ws}-files/{fileId}` URI from the workspace
    // Object Store and returns the raw bytes. Used by the video-extension path
    // to load the source MP4 so VEO can extend it. Returns undefined when the
    // URI is malformed, the bucket is missing, or the object can't be fetched —
    // callers must treat that as "fall back to non-extension generation".
    private async fetchObjectStoreBytes(natsObjUri: string): Promise<Buffer | undefined> {
        const match = /^nats-obj:\/\/([^/]+)\/(.+)$/.exec(natsObjUri || '')
        if (!match) {
            warn(`[Google:${this.instanceKey}] unrecognized object-store URI: ${natsObjUri}`)
            return undefined
        }
        const bucket = match[1]!
        const objectKey = match[2]!
        try {
            const data = await this.nats.getObject(bucket, objectKey)
            if (!data) return undefined
            return Buffer.from(data)
        } catch (e: any) {
            warn(`[Google:${this.instanceKey}] getObject(${bucket}/${objectKey}) failed: ${e?.message ?? e}`)
            return undefined
        }
    }

    // Parses a `data:<mime>;base64,<payload>` URL into the SDK's Image_2 shape
    // (base64 imageBytes + mimeType). Returns undefined for non-data URLs so the
    // caller can fall back to text-to-video gracefully rather than throw.
    private dataUrlToImageBytes(dataUrl: string): { imageBytes: string; mimeType: string } | undefined {
        if (!dataUrl || !dataUrl.startsWith('data:')) return undefined
        try {
            const { mediaType, base64 } = parseDataUrl(dataUrl)
            if (!base64) return undefined
            return { imageBytes: base64, mimeType: mediaType || 'image/png' }
        } catch (e) {
            warn(`[Google:${this.instanceKey}] dataUrlToImageBytes failed: ${e}`)
            return undefined
        }
    }

    // Returns MP4 bytes for a VEO Video object. The Gemini API normally returns
    // a `uri` (the file is hosted) — the SDK's files.download writes to disk, so
    // we download to a temp file and read it back. Some responses inline
    // `videoBytes` (base64); use that directly when present.
    private async fetchVideoBytes(video: { uri?: string; videoBytes?: string; mimeType?: string }): Promise<Buffer> {
        if (video.videoBytes) {
            return Buffer.from(video.videoBytes, 'base64')
        }
        if (!video.uri) {
            throw new Error('VEO: generated video has neither videoBytes nor uri')
        }
        let dir: string | undefined
        try {
            dir = await mkdtemp(join(tmpdir(), 'veo-dl-'))
            const outPath = join(dir, 'video.mp4')
            await this.client.files.download({
                file: video as any,
                downloadPath: outPath,
            } as any)
            return await readFile(outPath)
        } finally {
            if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
        }
    }
}
