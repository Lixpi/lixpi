import { describe, it, expect, beforeEach, vi } from 'vitest'

import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

vi.mock('$src/components/dropdown/index.ts', () => ({
    createPureDropdown: vi.fn(),
}))

import { createPureDropdown } from '$src/components/dropdown/index.ts'
import { createGenericImageSizeDropdown } from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'

type DropdownInstance = {
    dom: HTMLDivElement
    update: ReturnType<typeof vi.fn>
    setOptions: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}

const createPureDropdownMock = vi.mocked(createPureDropdown)

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
    let lastConfig: Parameters<typeof createPureDropdown>[0] | null = null

    beforeEach(() => {
        aiModelsStore.setAiModels([])
        createPureDropdownMock.mockReset()
        createPureDropdownMock.mockImplementation((config) => {
            lastConfig = config
            return createMockDropdown()
        })
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
