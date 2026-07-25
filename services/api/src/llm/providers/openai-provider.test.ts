'use strict'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenAIProvider } from './openai-provider.ts'
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

const CHARACTER_SOURCE_BYTES = Buffer.from('authoritative-character-source')
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

const loadCharacterSheetExample = async (): Promise<Buffer> => await readFile(new URL(
    '../../capability-modules/character-creator/tools/resources/character-sheet-example.jpg',
    import.meta.url,
))

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
): Promise<CapturedOpenAIRequest> => {
    const layoutExampleBytes = await loadCharacterSheetExample()
    const capturedRequests: CapturedOpenAIRequest[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request
            ? input.clone()
            : new Request(input, init)
        capturedRequests.push({
            request,
            formData: await request.clone().formData(),
        })
        return new Response([
            'event: image_edit.completed',
            `data: ${JSON.stringify({
                type: 'image_edit.completed',
                b64_json: TINY_PNG_BASE64,
            })}`,
            '',
            '',
        ].join('\n'), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        })
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
        aiModelMetaInfo: {
            provider: 'OpenAI',
            model: modelVersion,
            modelVersion,
        },
        messages: [{
            role: 'user',
            content: 'Reproduce reference image 1 as the character. Use reference image 2 only as the sheet layout.',
        }],
        imageGenerationReferences: [
            {
                url: `data:image/png;base64,${CHARACTER_SOURCE_BYTES.toString('base64')}`,
                role: 'character-source',
                fileName: 'character-source-1',
            },
            {
                url: `data:image/jpeg;base64,${layoutExampleBytes.toString('base64')}`,
                role: 'character-layout-example',
                fileName: 'character-layout-example-1',
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

describe('OpenAIProvider character-reference ingestion', () => {
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

    it('uploads the authoritative character first and layout example second to the image-edit endpoint', async () => {
        const captured = await processWithCharacterReferences('gpt-image-2')
        const files = getUploadedFiles(captured.formData)
        const layoutExampleBytes = await loadCharacterSheetExample()

        expect(captured.request.url).toBe('https://api.openai.com/v1/images/edits')
        expect(captured.formData.get('model')).toBe('gpt-image-2')
        expect(captured.formData.get('prompt')).toBe(
            'Reproduce reference image 1 as the character. Use reference image 2 only as the sheet layout.',
        )
        expect(files.map(file => ({
            name: file.name,
            type: file.type,
        }))).toEqual([
            { name: 'character-source-1.png', type: 'image/png' },
            { name: 'character-layout-example-1.jpg', type: 'image/jpeg' },
        ])
        await expect(files[0]?.arrayBuffer()).resolves.toEqual(
            CHARACTER_SOURCE_BYTES.buffer.slice(
                CHARACTER_SOURCE_BYTES.byteOffset,
                CHARACTER_SOURCE_BYTES.byteOffset + CHARACTER_SOURCE_BYTES.byteLength,
            ),
        )
        await expect(files[1]?.arrayBuffer()).resolves.toEqual(
            layoutExampleBytes.buffer.slice(
                layoutExampleBytes.byteOffset,
                layoutExampleBytes.byteOffset + layoutExampleBytes.byteLength,
            ),
        )
        expect(layoutExampleBytes.byteLength).toBe(460_138)
        expect(createHash('sha256').update(layoutExampleBytes).digest('hex')).toBe(
            '388e3c7a398f43b3e2ad9cebf6019d16c95e4a17289fb5b77a94bf62e11acadd',
        )
        expect(captured.formData.get('input_fidelity')).toBeNull()
    })

    it.each(['gpt-image-1', 'gpt-image-1.5'])(
        'requests high input fidelity for %s',
        async modelVersion => {
            const captured = await processWithCharacterReferences(modelVersion)

            expect(captured.formData.get('input_fidelity')).toBe('high')
        },
    )
})
