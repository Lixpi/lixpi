import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type AiModelInferenceCapabilities,
    type ImageReferenceCapabilities,
} from '@lixpi/constants'

import {
    appendOpenAIImageGenerationReferences,
    OpenAIProvider,
} from './openai-provider.ts'
import {
    type BaseProviderDeps,
} from './base-provider.ts'
import { CURRENT_MEDIA_PROVIDER_DEFINITIONS } from './current-media-provider-definitions.ts'

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
        organizationId: 'organization-1',
        url: '/api/images/workspace-1/asset-1',
    })),
}))

vi.mock('../../services/generated-asset-storage.ts', () => assetStorage)
vi.mock('../../services/asset-provenance-materializer.ts', () => ({
    materializeAssetProvenance: vi.fn(async () => undefined),
}))
vi.mock('../../services/asset-maintenance-queue.ts', () => ({
    enqueueProvenanceRebuild: vi.fn(async () => undefined),
}))

const ORIGINAL_SOURCE_BYTES = Buffer.from('authoritative-original-source')
const FACE_CROP_BYTES = Buffer.from('authoritative-face-crop')
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

const OPENAI_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: true,
    supportedInputKinds: ['image', 'video-frame', 'document-text'],
}

const capabilities = (inputFidelity: ImageReferenceCapabilities['inputFidelity']): ImageReferenceCapabilities => ({
    maxReferenceImages: 16,
    maxIdentityReferenceImages: 5,
    conditioningModes: ['edit', 'identity', 'style'],
    inputFidelity,
    supportsIterativeEdit: true,
    supportsMask: true,
    supportsStructureControl: false,
    supportsPoseControl: false,
    supportsDeterministicSeed: false,
    maxOutputPixels: 1572864,
    supportedAspectRatios: ['1:1', '3:2', '2:3'],
})

type CapturedOpenAIRequest = {
    request: Request
    formData: FormData
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
    mediaProviderDefinition: CURRENT_MEDIA_PROVIDER_DEFINITIONS.OpenAI,
})

const getUploadedFiles = (formData: FormData): File[] => {
    const values = [
        ...formData.getAll('image[]'),
        ...formData.getAll('image'),
    ]
    return values.filter((value): value is File => value instanceof File)
}

const processWithCharacterReferences = async (
    modelVersion: string,
    inputFidelity: ImageReferenceCapabilities['inputFidelity'],
): Promise<CapturedOpenAIRequest> => {
    const capturedRequests: CapturedOpenAIRequest[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request
            ? input.clone()
            : new Request(input, init)
        capturedRequests.push({
            request,
            formData: await request.clone().formData(),
        })
        return new Response(
            [
                'event: image_edit.completed',
                `data: ${
                    JSON.stringify({
                        type: 'image_edit.completed',
                        b64_json: TINY_PNG_BASE64,
                    })
                }`,
                '',
                '',
            ].join('\n'),
            {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
            },
        )
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OpenAIProvider('workspace-1:thread-1:image-1', makeDeps())
    const result = await provider.process({
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        organizationId: 'organization-1',
        eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
        enableImageGeneration: true,
        preflightResolved: true,
        imageSize: '1536x1024',
        imageGenerationConfig: {
            imageSize: '1536x1024',
            quality: 'high',
            background: 'transparent',
        },
        aiModelMetaInfo: {
            provider: 'OpenAI',
            model: modelVersion,
            modelVersion,
            inferenceCapabilities: OPENAI_INFERENCE_CAPABILITIES,
            imageReferenceCapabilities: capabilities(inputFidelity),
        },
        messages: [{
            role: 'user',
            content: 'Render a front portrait using the authoritative source and face crop.',
        }],
        imageGenerationReferences: [
            {
                url: `data:image/png;base64,${ORIGINAL_SOURCE_BYTES.toString('base64')}`,
                role: 'original-source',
                fileName: 'original-source-1',
            },
            {
                url: `data:image/png;base64,${FACE_CROP_BYTES.toString('base64')}`,
                role: 'face-crop',
                fileName: 'face-crop-1',
            },
        ],
        generationRun: {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            mediaRunId: 'reasoning-1:image:0',
            mediaModelId: `OpenAI:${modelVersion}`,
            mediaType: 'image',
            mediaIndex: 0,
            lineageAssignment: {
                assetId: 'asset-1',
                generationRequestId: 'request-1',
            },
        },
    })

    expect(result.error).toBeUndefined()
    expect(fetchMock).toHaveBeenCalled()
    const editRequests = capturedRequests.filter(captured => captured.request.url.endsWith('/v1/images/edits'))
    expect(editRequests).toHaveLength(1)
    return editRequests[0]!
}

describe('OpenAIProvider panel-reference ingestion', () => {
    const previousApiKey = process.env.OPENAI_API_KEY
    let consoleLogSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        process.env.OPENAI_API_KEY = 'test-key'
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleLogSpy?.mockRestore()
        consoleLogSpy = null
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY
        else process.env.OPENAI_API_KEY = previousApiKey
    })

    it('uploads prioritized panel references to the image-edit endpoint', async () => {
        const captured = await processWithCharacterReferences('gpt-image-2', 'provider-managed')
        const files = getUploadedFiles(captured.formData)
        const prompt = String(captured.formData.get('prompt'))

        expect(captured.request.url).toBe('https://api.openai.com/v1/images/edits')
        expect(captured.formData.get('model')).toBe('gpt-image-2')
        expect(captured.formData.get('quality')).toBe('high')
        expect(captured.formData.get('background')).toBe('transparent')
        expect(captured.formData.get('output_format')).toBe('png')
        expect(prompt).toContain('INPUT IMAGE ORDER')
        expect(prompt).toContain('INPUT IMAGE 1 — AUTHORITATIVE ORIGINAL SOURCE')
        expect(prompt).toContain('INPUT IMAGE 2 — FACE IDENTITY CROP')
        expect(prompt).toContain('Render a front portrait using the authoritative source and face crop.')
        expect(files.map(file => ({
            name: file.name,
            type: file.type,
        }))).toEqual([
            { name: 'original-source-1.png', type: 'image/png' },
            { name: 'face-crop-1.png', type: 'image/png' },
        ])
        await expect(files[0]?.arrayBuffer()).resolves.toEqual(
            ORIGINAL_SOURCE_BYTES.buffer.slice(
                ORIGINAL_SOURCE_BYTES.byteOffset,
                ORIGINAL_SOURCE_BYTES.byteOffset + ORIGINAL_SOURCE_BYTES.byteLength,
            ),
        )
        await expect(files[1]?.arrayBuffer()).resolves.toEqual(
            FACE_CROP_BYTES.buffer.slice(
                FACE_CROP_BYTES.byteOffset,
                FACE_CROP_BYTES.byteOffset + FACE_CROP_BYTES.byteLength,
            ),
        )
        expect(captured.formData.get('input_fidelity')).toBeNull()
    })

    it('serializes the same scoped role state for the Responses image path', () => {
        const referenceBytes = Buffer.from('approved-face-construction')
        const messages: Array<{ role: string; content: any }> = [{
            role: 'user',
            content: 'Rebuild the clothing from the original drawing.',
        }]

        appendOpenAIImageGenerationReferences(messages, [{
            url: 'identity-crop-url',
            role: 'edit-target-identity',
            fileName: 'EDIT_TARGET_IDENTITY_FACE.png',
            bytes: referenceBytes,
            dataUrl: `data:image/png;base64,${referenceBytes.toString('base64')}`,
            mediaType: 'image/png',
            byteLength: referenceBytes.byteLength,
            sha256: 'a'.repeat(64),
        }])

        expect(messages[0]?.content).toEqual([
            expect.objectContaining({
                type: 'input_text',
                text: expect.stringContaining('INPUT IMAGE 1 — EDIT-TARGET IDENTITY CROP ONLY'),
            }),
            {
                type: 'input_image',
                image_url: `data:image/png;base64,${referenceBytes.toString('base64')}`,
                detail: 'high',
            },
        ])
        expect(messages[0]?.content[0]?.text).toContain(
            'Rebuild the clothing from the original drawing.',
        )
    })

    it('applies high-fidelity request metadata from synchronized capabilities', async () => {
        const captured = await processWithCharacterReferences('gpt-image-high-fidelity-fixture', 'high')
        expect(captured.formData.get('input_fidelity')).toBe('high')
    })

    it('does not infer an input-fidelity request from the model name', async () => {
        const captured = await processWithCharacterReferences('gpt-image-2', 'provider-managed')

        expect(captured.formData.get('input_fidelity')).toBeNull()
    })

    it('forwards synchronized reasoning controls to the Responses API', async () => {
        const provider = new OpenAIProvider('workspace-1:thread-1:reasoning-1', makeDeps())
        const create = vi.fn(async () => ({
            [Symbol.asyncIterator]: async function*() {
                yield {
                    type: 'response.completed',
                    response: { id: 'response-1', output: [] },
                }
            },
        }))
        ;(provider as any).client.responses.create = create
        ;(provider as any).abortController = new AbortController()

        await (provider as any).generateViaResponsesApi({
            state: {
                aiModelMetaInfo: {
                    provider: 'OpenAI',
                    model: 'gpt-5.6-sol',
                    modelVersion: 'gpt-5.6-sol',
                    inferenceCapabilities: {
                        ...OPENAI_INFERENCE_CAPABILITIES,
                        supportsTemperature: false,
                    },
                },
                reasoningGenerationConfig: {
                    reasoningEffort: 'max',
                    reasoningMode: 'pro',
                    reasoningVerbosity: 'high',
                },
            },
            inputMessages: [{ role: 'user', content: 'Solve this.' }],
            modelVersion: 'gpt-5.6-sol',
            instructions: undefined,
            temperature: 0.7,
            maxTokens: 4096,
            tools: undefined,
            hasImageModel: false,
            hasVideoModel: false,
            enableImageGeneration: false,
            enableVideoGeneration: false,
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
        })

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-5.6-sol',
                reasoning: { effort: 'max', mode: 'pro' },
                text: { verbosity: 'high' },
                max_output_tokens: 4096,
            }),
            expect.any(Object),
        )
        expect(create.mock.calls[0]?.[0]).not.toHaveProperty('temperature')
    })
})
