'use strict'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StabilityProvider } from './stability-provider.ts'
import type { BaseProviderDeps } from './base-provider.ts'

const debugTools = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => debugTools)

const assetStorage = vi.hoisted(() => ({
    attachGeneratedAssetNode: vi.fn(async () => ({
        layoutRevision: 1,
        nodes: [],
    })),
    settleGeneratedAssetOriginal: vi.fn(async () => ({
        assetId: 'asset-1',
        organizationId: 'org-1',
        url: '/api/images/ws-1/asset-1',
    })),
}))

vi.mock('../../services/generated-asset-storage.ts', () => assetStorage)
vi.mock('../../services/asset-provenance-materializer.ts', () => ({
    materializeAssetProvenance: vi.fn(async () => undefined),
}))
vi.mock('../../services/asset-maintenance-queue.ts', () => ({
    enqueueProvenanceRebuild: vi.fn(async () => undefined),
}))

const MAX_STABILITY_REFERENCE_PIXELS = 9_437_184
const OVERSIZED_WIDTH = 5000
const OVERSIZED_HEIGHT = 3500
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`

type CapturedRequest = {
    url: string
    init: RequestInit
}

const createOversizedJpegDataUrl = async (background: string): Promise<string> => {
    const bytes = await sharp({
        create: {
            width: OVERSIZED_WIDTH,
            height: OVERSIZED_HEIGHT,
            channels: 3,
            background,
        },
    })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer()

    return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

const getFormData = (request: CapturedRequest): FormData => {
    const body = request.init.body
    if (!(body instanceof FormData)) throw new Error('Expected Stability request body to be FormData')
    return body
}

const getUploadedBlob = (formData: FormData, fieldName: string): Blob => {
    const value = formData.get(fieldName)
    if (!(value instanceof Blob)) throw new Error(`Expected ${fieldName} to be a Blob`)
    return value
}

const expectUploadedImageWithinStabilityLimit = async (formData: FormData, fieldName: string): Promise<void> => {
    const blob = getUploadedBlob(formData, fieldName)
    const bytes = Buffer.from(await blob.arrayBuffer())
    const metadata = await sharp(bytes).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0

    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(width * height).toBeLessThanOrEqual(MAX_STABILITY_REFERENCE_PIXELS)
    expect(width).toBeLessThan(OVERSIZED_WIDTH)
    expect(height).toBeLessThan(OVERSIZED_HEIGHT)
}

const makeDeps = (): BaseProviderDeps => ({
    natsService: {
        publish: vi.fn(),
    } as any,
    usageReporter: {
        reportTokensUsage: vi.fn(),
        reportImageUsage: vi.fn(),
        reportVideoUsage: vi.fn(),
    } as any,
    runImageRouter: vi.fn(),
    runVideoRouter: vi.fn(),
})

const processWithMessages = async (overrides: Record<string, any> = {}): Promise<CapturedRequest> => {
    let capturedRequest: CapturedRequest | undefined
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedRequest = { url: String(url), init: init ?? {} }
        return new Response(
            JSON.stringify({ image: TINY_PNG_BASE64, finish_reason: 'SUCCESS' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        )
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new StabilityProvider('ws-1:thread-1:image-1', makeDeps())
    const result = await provider.process({
        workspaceId: 'ws-1',
        aiChatThreadId: 'thread-1',
        enableImageGeneration: true,
        preflightResolved: true,
        imageSize: '1:1',
        aiModelMetaInfo: {
            provider: 'Stability',
            model: 'sd3.5-large',
            modelVersion: 'sd3.5-large',
        },
        messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
        generationRun: {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Stability:sd3.5-large',
            reasoningIndex: 0,
            lineageAssignment: {
                assetId: 'asset-1',
                generationRequestId: 'request-1',
            },
        },
        ...overrides,
    })

    expect(result.error).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    if (!capturedRequest) throw new Error('Expected Stability fetch request to be captured')
    return capturedRequest
}

const processWithReferences = async (references: string[]): Promise<CapturedRequest> => {
    return processWithMessages({
        messages: [{
            role: 'user',
            content: [
                { type: 'input_text', text: 'Use the provided reference image as the primary visual source and paint it in oils.' },
                ...references.map(imageUrl => ({ type: 'input_image', image_url: imageUrl, detail: 'high' })),
            ],
        }],
    })
}

describe('StabilityProvider text-to-image routing', () => {
    const previousApiKey = process.env.STABLE_DIFFUSION_API_KEY

    beforeEach(() => {
        process.env.STABLE_DIFFUSION_API_KEY = 'test-key'
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        if (previousApiKey === undefined) delete process.env.STABLE_DIFFUSION_API_KEY
        else process.env.STABLE_DIFFUSION_API_KEY = previousApiKey
    })

    it('uses SD3 endpoint and model id when no reference images are provided', async () => {
        const request = await processWithMessages({
            imageSize: '16:9',
            aiModelMetaInfo: {
                provider: 'Stability',
                model: 'sd3.5-large',
                modelVersion: 'sd3.5-large',
            },
            messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
        })
        const formData = getFormData(request)

        expect(request.url).toBe('https://api.stability.ai/v2beta/stable-image/generate/sd3')
        expect(formData.get('aspect_ratio')).toBe('16:9')
        expect(formData.get('model')).toBe('sd3.5-large')
        expect(formData.get('output_format')).toBe('png')
        expect(formData.get('prompt')).toBe('Paint a red cat in a field.')
    })

    it('uses stability-ultra endpoint for non-sd3 models', async () => {
        const request = await processWithMessages({
            aiModelMetaInfo: {
                provider: 'Stability',
                model: 'stability-ultra',
                modelVersion: 'stability-ultra',
            },
            imageSize: '4:3',
            messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
        })
        const formData = getFormData(request)

        expect(request.url).toBe('https://api.stability.ai/v2beta/stable-image/generate/ultra')
        expect(formData.get('aspect_ratio')).toBe('4:3')
        expect(formData.get('model')).toBeNull()
    })
})

describe('StabilityProvider reference image ingestion', () => {
    const previousApiKey = process.env.STABLE_DIFFUSION_API_KEY

    beforeEach(() => {
        process.env.STABLE_DIFFUSION_API_KEY = 'test-key'
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        if (previousApiKey === undefined) delete process.env.STABLE_DIFFUSION_API_KEY
        else process.env.STABLE_DIFFUSION_API_KEY = previousApiKey
    })

    it('uses the style endpoint and includes fidelity for a single oversized reference image', async () => {
        const reference = await createOversizedJpegDataUrl('#d8d8d8')
        const request = await processWithReferences([reference])
        const formData = getFormData(request)

        expect(request.url).toBe('https://api.stability.ai/v2beta/stable-image/control/style')
        expect(formData.get('aspect_ratio')).toBe('1:1')
        expect(formData.get('fidelity')).toBe('0.7')
        await expectUploadedImageWithinStabilityLimit(formData, 'image')
    })

    it('uses the style-transfer endpoint with two different reference image block formats', async () => {
        const largeJpegDataUrl = await createOversizedJpegDataUrl('#d8d8d8')

        const request = await processWithMessages({
            messages: [{
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Blend the source and style images.' },
                    { type: 'image', source: { type: 'base64', data: TINY_PNG_BASE64, media_type: 'image/png' } },
                    { type: 'inline_data', data: TINY_PNG_BASE64, mime_type: 'image/jpeg' },
                    { type: 'input_image', image_url: largeJpegDataUrl, detail: 'high' },
                ],
            }],
            imageSize: '3:2',
        })
        const formData = getFormData(request)

        expect(request.url).toBe('https://api.stability.ai/v2beta/stable-image/control/style-transfer')
        expect(formData.get('aspect_ratio')).toBeNull()
        expect(formData.get('fidelity')).toBeNull()
        expect(formData.has('init_image')).toBe(true)
        expect(formData.has('style_image')).toBe(true)
        // References are sorted by size descending: largest (the oversized JPEG) becomes init_image,
        // smallest (the first tiny image, PNG) becomes style_image.
        expect(getUploadedBlob(formData, 'init_image').type).toBe('image/jpeg')
        expect(getUploadedBlob(formData, 'style_image').type).toBe('image/png')
    })

    it('resizes oversized style-control reference before upload', async () => {
        const reference = await createOversizedJpegDataUrl('#d8d8d8')
        const request = await processWithReferences([reference])
        const formData = getFormData(request)

        await expectUploadedImageWithinStabilityLimit(formData, 'image')
    })

    it('resizes oversized style-transfer references before upload', async () => {
        const primaryReference = await createOversizedJpegDataUrl('#d8d8d8')
        const styleReference = await createOversizedJpegDataUrl('#b8c8d8')
        const request = await processWithReferences([primaryReference, styleReference])
        const formData = getFormData(request)

        await expectUploadedImageWithinStabilityLimit(formData, 'init_image')
        await expectUploadedImageWithinStabilityLimit(formData, 'style_image')
    })
})

describe('StabilityProvider stream validation', () => {
    const previousApiKey = process.env.STABLE_DIFFUSION_API_KEY

    beforeEach(() => {
        process.env.STABLE_DIFFUSION_API_KEY = 'test-key'
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        if (previousApiKey === undefined) delete process.env.STABLE_DIFFUSION_API_KEY
        else process.env.STABLE_DIFFUSION_API_KEY = previousApiKey
    })

    it('reports a provider-configuration error when the API key is missing', async () => {
        const providerDeps = makeDeps()
        const provider = new StabilityProvider('ws-1:thread-1', providerDeps)
        const previousApiKey = process.env.STABLE_DIFFUSION_API_KEY
        delete process.env.STABLE_DIFFUSION_API_KEY

        try {
            const result = await provider.process({
                workspaceId: 'ws-1',
                aiChatThreadId: 'thread-1',
                enableImageGeneration: true,
                aiModelMetaInfo: { provider: 'Stability', model: 'sd3.5-large', modelVersion: 'sd3.5-large' },
                messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
            })
            expect(result.error).toBe('STABLE_DIFFUSION_API_KEY is not configured')
        } finally {
            if (previousApiKey === undefined) {
                delete process.env.STABLE_DIFFUSION_API_KEY
            } else {
                process.env.STABLE_DIFFUSION_API_KEY = previousApiKey
            }
        }
    })

    it('returns unknown-model errors for unsupported Stability models', async () => {
        const providerDeps = makeDeps()
        const provider = new StabilityProvider('ws-1:thread-1', providerDeps)
        vi.stubGlobal('fetch', vi.fn())

        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            enableImageGeneration: true,
            aiModelMetaInfo: { provider: 'Stability', model: 'unsupported', modelVersion: 'unsupported' },
            messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Stability:sd3.5-large',
                reasoningIndex: 0,
                lineageAssignment: {
                    assetId: 'asset-1',
                    generationRequestId: 'request-1',
                },
            },
        })

        expect(result.error).toBe('Unknown Stability model: unsupported')
    })

    it('returns missing-prompt error when no user prompt text exists', async () => {
        const providerDeps = makeDeps()
        const provider = new StabilityProvider('ws-1:thread-1', providerDeps)

        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            enableImageGeneration: true,
            aiModelMetaInfo: { provider: 'Stability', model: 'stability-ultra', modelVersion: 'stability-ultra' },
            messages: [{ role: 'assistant', content: [{ type: 'text', text: 'I can help' }] }],
        })

        expect(result.error).toBe('No prompt found in messages')
    })

    it('returns stability API error details when request status is not successful', async () => {
        const providerDeps = makeDeps()
        const provider = new StabilityProvider('ws-1:thread-1', providerDeps)
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ name: 'invalid_request', errors: ['Missing prompt field'] }),
            { status: 400, headers: { 'content-type': 'application/json' } },
        )))

        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            enableImageGeneration: true,
            aiModelMetaInfo: { provider: 'Stability', model: 'sd3.5-large', modelVersion: 'sd3.5-large' },
            messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Stability:sd3.5-large',
                reasoningIndex: 0,
                lineageAssignment: {
                    assetId: 'asset-1',
                    generationRequestId: 'request-1',
                },
            },
        })

        expect(result.error).toBe('Stability API error (invalid_request): Missing prompt field')
    })

    it('returns stability API error when image is filtered by content policy', async () => {
        const providerDeps = makeDeps()
        const provider = new StabilityProvider('ws-1:thread-1', providerDeps)
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ image: TINY_PNG_BASE64, finish_reason: 'CONTENT_FILTERED' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        )))

        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            enableImageGeneration: true,
            preflightResolved: true,
            aiModelMetaInfo: { provider: 'Stability', model: 'sd3.5-large', modelVersion: 'sd3.5-large' },
            messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Stability:sd3.5-large',
                reasoningIndex: 0,
                lineageAssignment: {
                    assetId: 'asset-1',
                    generationRequestId: 'request-1',
                },
            },
        })

        expect(result.error).toBe(
            'Image was filtered by Stability AI content moderation. Please try a different prompt.',
        )
    })

    it('returns stability API error when the response image payload is empty', async () => {
        const providerDeps = makeDeps()
        const provider = new StabilityProvider('ws-1:thread-1', providerDeps)
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ image: '', finish_reason: 'SUCCESS' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        )))

        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            enableImageGeneration: true,
            preflightResolved: true,
            aiModelMetaInfo: { provider: 'Stability', model: 'sd3.5-large', modelVersion: 'sd3.5-large' },
            messages: [{ role: 'user', content: 'Paint a red cat in a field.' }],
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Stability:sd3.5-large',
                reasoningIndex: 0,
                lineageAssignment: {
                    assetId: 'asset-1',
                    generationRequestId: 'request-1',
                },
            },
        })

        expect(result.error).toBe('Stability API returned empty image data')
    })
})
