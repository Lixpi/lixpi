import { describe, it, expect, beforeEach, vi } from 'vitest'

import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

vi.mock('$src/components/dropdown/index.ts', () => ({
    createPureDropdown: vi.fn(),
}))

import { createPureDropdown } from '$src/components/dropdown/index.ts'
import { transformModelsToOptions } from '$src/components/proseMirror/plugins/primitives/aiControls/aiControls.ts'
import {
    createGenericImageSizeDropdown,
    createGenericImageModelDropdown,
    createGenericVideoModelDropdown,
} from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'

type DropdownInstance = {
    dom: HTMLDivElement
    update: ReturnType<typeof vi.fn>
    setOptions: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}

const createPureDropdownMock = vi.mocked(createPureDropdown)
let lastConfig: Parameters<typeof createPureDropdown>[0] | null = null

function resetMockDropdown() {
    createPureDropdownMock.mockReset()
    createPureDropdownMock.mockImplementation((config) => {
        lastConfig = config
        return createMockDropdown()
    })
}

function createMockDropdown(): DropdownInstance {
    return {
        dom: document.createElement('div'),
        update: vi.fn(),
        setOptions: vi.fn(),
        destroy: vi.fn(),
    }
}

function createControls(overrides: {
    currentImageModel?: string
    provider?: string
    currentImageGenerationSize?: string
} = {}) {
    return {
        getImageGenerationSize: vi.fn(() => overrides.currentImageGenerationSize ?? 'auto'),
        setImageGenerationSize: vi.fn(),
        getCurrentImageModel: vi.fn(() => overrides.currentImageModel),
        getProvider: vi.fn(() => overrides.provider),
    }
}

describe('createGenericImageSizeDropdown', () => {
    beforeEach(() => {
        aiModelsStore.setAiModels([])
        resetMockDropdown()
    })

    it('uses Resolution label and size list when model emits WxH values', () => {
        aiModelsStore.setAiModels([
            {
                provider: 'provider-a',
                model: 'size-literal',
                iconName: 'gpt',
                modalities: [],
                imageSizes: [
                    { value: '1024x1024', label: '1024x1024' },
                    { value: '1536x1024', label: '1536x1024' },
                ],
            },
        ] as any)

        const controls = createControls({
            currentImageModel: 'provider-a:size-literal',
            currentImageGenerationSize: '1536x1024',
        })

        const dropdown = createGenericImageSizeDropdown(controls, 'image-size')

        expect(dropdown.getControlLabel?.()).toBe('Resolution')
        expect(lastConfig?.id).toBe('image-size')
        expect(lastConfig?.options).toEqual([
            { title: '1024x1024', value: '1024x1024' },
            { title: '1536x1024', value: '1536x1024' },
        ])

        dropdown.destroy()
    })

    it('uses Aspect ratio label for aspect-style image size values', () => {
        aiModelsStore.setAiModels([
            {
                provider: 'provider-b',
                model: 'ratio-model',
                iconName: 'gpt',
                modalities: [],
                imageSizes: [
                    { value: '16:9', label: '16:9' },
                    { value: '4:3', label: '4:3' },
                ],
            },
        ] as any)

        const controls = createControls({
            provider: 'provider-b',
            currentImageGenerationSize: '16:9',
        })

        const dropdown = createGenericImageSizeDropdown(controls, 'image-size')

        expect(dropdown.getControlLabel?.()).toBe('Aspect ratio')
        expect(lastConfig?.options).toEqual([
            { title: '16:9', value: '16:9' },
            { title: '4:3', value: '4:3' },
        ])

        dropdown.destroy()
    })

    it('uses Image option label when model exposes non-resolution values', () => {
        aiModelsStore.setAiModels([
            {
                provider: 'provider-c',
                model: 'label-mode',
                iconName: 'gpt',
                modalities: [],
                imageSizes: [
                    { value: 'small', label: 'Small' },
                    { value: 'large', label: 'Large' },
                ],
            },
        ] as any)

        const controls = createControls({
            provider: 'provider-c',
            currentImageGenerationSize: 'small',
        })

        const dropdown = createGenericImageSizeDropdown(controls, 'image-size')

        expect(dropdown.getControlLabel?.()).toBe('Image option')
        expect(lastConfig?.options).toEqual([
            { title: 'Small', value: 'small' },
            { title: 'Large', value: 'large' },
        ])

        dropdown.destroy()
    })

    it('revalidates current size on dropdown update and normalizes to first option', () => {
        const currentImageModel = 'provider-d:normalize-size'
        aiModelsStore.setAiModels([
            {
                provider: 'provider-d',
                model: 'normalize-size',
                iconName: 'gpt',
                modalities: [],
                imageSizes: [
                    { value: 'small', label: 'Small' },
                    { value: 'large', label: 'Large' },
                ],
            },
        ] as any)

        const controls = {
            getImageGenerationSize: vi.fn(() => 'invalid-size'),
            setImageGenerationSize: vi.fn(),
            getCurrentImageModel: vi.fn(() => currentImageModel),
            getProvider: vi.fn(),
        }

        const dropdown = createGenericImageSizeDropdown(controls, 'image-size')

        aiModelsStore.setAiModels([
            {
                provider: 'provider-d',
                model: 'normalize-size',
                iconName: 'gpt',
                modalities: [],
                imageSizes: [
                    { value: 'tiny', label: 'Tiny' },
                    { value: 'small', label: 'Small' },
                ],
            },
        ] as any)

        dropdown.update()

        expect(controls.setImageGenerationSize).toHaveBeenCalledWith('tiny')

        dropdown.destroy()
    })
})

describe('transformModelsToOptions', () => {
    beforeEach(() => {
        resetMockDropdown()
        aiModelsStore.setAiModels([])
    })

    it('maps model records into dropdown-ready dropdown options', () => {
        const options = transformModelsToOptions([
            {
                provider: 'openai',
                model: 'gpt-4o',
                iconName: 'gpt',
                modalities: [],
                shortTitle: 'GPT-4o',
            },
            {
                provider: 'google',
                model: 'gemini',
                iconName: 'gemini',
                modalities: [],
                shortTitle: 'Gemini',
            },
        ])

        expect(options[0].aiModel).toBe('openai:gpt-4o')
        expect(options[0].title).toBe('GPT-4o')
        expect(options[1].aiModel).toBe('google:gemini')
        expect(options[1].title).toBe('Gemini')
        expect(options[0].tags).toEqual([])
        expect(options[1].tags).toEqual([])
    })
})

describe('createGenericImageModelDropdown', () => {
    beforeEach(() => {
        resetMockDropdown()
    })

    it('auto-selects first image model when current model is empty', () => {
        aiModelsStore.setAiModels([
            {
                provider: 'google',
                model: 'imagen-3',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [],
            },
        ] as any)

        const controls = {
            getCurrentImageModel: vi.fn(() => ''),
            setImageModel: vi.fn(),
        }

        vi.useFakeTimers()
        const dropdown = createGenericImageModelDropdown(controls, 'image-model')
        vi.advanceTimersToNextTimer()
        vi.useRealTimers()

        expect(controls.setImageModel).toHaveBeenCalledWith('google:imagen-3')
        dropdown.destroy()
    })
})

describe('createGenericVideoModelDropdown', () => {
    beforeEach(() => {
        resetMockDropdown()
    })

    it('filters to video-generation models only', () => {
        aiModelsStore.setAiModels([
            {
                provider: 'google',
                model: 'veo',
                iconName: 'gpt',
                shortTitle: 'Veo',
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9', label: '16:9' }],
                videoResolutions: [{ value: '1080p', label: '1080p' }],
                videoDurations: [{ value: '30s', label: '30s' }],
            },
            {
                provider: 'openai',
                model: 'gpt-4',
                modalities: [{ modality: 'text_generation' }],
                imageSizes: [],
            },
        ] as any)

        const controls = {
            getCurrentVideoModel: vi.fn(() => ''),
            setVideoModel: vi.fn(),
        }

        const dropdown = createGenericVideoModelDropdown(controls, 'video-model')
        expect(lastConfig?.options).toEqual([
            expect.objectContaining({
                title: 'Veo',
                aiModel: 'google:veo',
                provider: 'google',
                model: 'veo',
            }),
        ])

        dropdown.update()
        dropdown.destroy()
    })
})
