import {
    afterEach,
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'
import { select } from 'd3-selection'

import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

vi.mock('@lixpi/ui-kit/components/dropdown', () => ({
    createPureDropdown: vi.fn(),
}))

const slidingDropdownConfigs = vi.hoisted(() => [] as any[])

vi.mock('@lixpi/ui-kit/components/sliding-dropdown', () => ({
    createSlidingDropdown: vi.fn((_parent: any, config: any) => {
        slidingDropdownConfigs.push(config)
        return {
            render: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
        }
    }),
}))

import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import { createSlidingDropdown } from '@lixpi/ui-kit/components/sliding-dropdown'
import {
    transformModelsToOptions,
    createGenericAiModelDropdown,
    createGenericImageSizeDropdown,
    createGenericImageModelDropdown,
    createGenericVideoModelDropdown,
} from '$src/components/aiModelControls/index.ts'

type DropdownInstance = {
    dom: HTMLDivElement
    update: ReturnType<typeof vi.fn>
    setOptions: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}

const createPureDropdownMock = vi.mocked(createPureDropdown)
const createSlidingDropdownMock = vi.mocked(createSlidingDropdown)
let lastConfig: Parameters<typeof createPureDropdown>[0] | null = null

function lastModelConfig(): any {
    return slidingDropdownConfigs.at(-1)
}

function resetMockDropdown() {
    createPureDropdownMock.mockReset()
    createPureDropdownMock.mockImplementation((config) => {
        lastConfig = config
        return createMockDropdown()
    })
    slidingDropdownConfigs.length = 0
    createSlidingDropdownMock.mockClear()
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

describe('createGenericAiModelDropdown', () => {
    beforeEach(() => {
        resetMockDropdown()
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'anthropic',
                model: 'haiku-4-5',
                shortTitle: 'Haiku 4.5',
                iconName: 'claude',
                modalities: [{ modality: 'text_generation' }],
            } as any],
            defaultModels: {
                reasoning: 'anthropic:haiku-4-5',
                image: '',
                video: '',
            } as any,
        })
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        aiModelsStore.resetStore()
    })

    it('re-commits the displayed default when restored prompt attrs become empty', () => {
        let currentModel = ''
        const controls = {
            getCurrentAiModel: vi.fn(() => currentModel),
            setAiModel: vi.fn((modelId: string) => {
                currentModel = modelId
            }),
        }
        const dropdown = createGenericAiModelDropdown(controls, 'reasoning-model')

        vi.runAllTimers()
        expect(currentModel).toBe('anthropic:haiku-4-5')

        currentModel = ''
        controls.setAiModel.mockClear()
        dropdown.update()
        vi.runAllTimers()

        expect(controls.setAiModel).toHaveBeenCalledWith('anthropic:haiku-4-5')
        expect(currentModel).toBe('anthropic:haiku-4-5')
        dropdown.destroy()
    })

    it('uses sliding dropdown options that join provider and model names with a colon', () => {
        const controls = {
            getCurrentAiModel: vi.fn(() => 'anthropic:haiku-4-5'),
            setAiModel: vi.fn(),
        }

        const dropdown = createGenericAiModelDropdown(controls, 'reasoning-model-placement')

        expect(lastModelConfig()).toMatchObject({
            id: 'reasoning-model-placement',
            selectedValue: 'anthropic:haiku-4-5',
            options: [{
                label: 'anthropic: Haiku 4.5',
                value: 'anthropic:haiku-4-5',
                ariaLabel: 'anthropic: Haiku 4.5',
            }],
            renderOption: expect.any(Function),
        })
        dropdown.destroy()
    })

    it('does not paint the default over an unavailable persisted selection', () => {
        const controls = {
            getCurrentAiModel: vi.fn(() => 'anthropic:removed-model'),
            setAiModel: vi.fn(),
        }

        const dropdown = createGenericAiModelDropdown(controls, 'reasoning-model')

        expect(lastModelConfig()?.selectedValue).toBe('')
        expect(lastModelConfig()?.options[0]).toMatchObject({
            label: 'Select model',
            value: '',
        })
        expect(controls.setAiModel).not.toHaveBeenCalled()
        dropdown.destroy()
    })

    it('renders a provider icon and separate provider and model text in every model option', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'openai',
                providerTitle: 'OpenAI',
                model: 'gpt-5-4',
                shortTitle: 'GPT 5.4',
                iconName: 'gptAvatarIcon',
                modalities: [{ modality: 'text_generation' }],
            } as any],
            defaultModels: {
                reasoning: 'openai:gpt-5-4',
                image: '',
                video: '',
            } as any,
        })
        const dropdown = createGenericAiModelDropdown({
            getCurrentAiModel: () => 'openai:gpt-5-4',
            setAiModel: vi.fn(),
        }, 'reasoning-model-icon')
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        const config = lastModelConfig()

        config.renderOption(select(svg).append('g'), {
            id: 'openai-option',
            option: config.options[0],
            index: 0,
            x: 0,
            y: 0,
            width: 190,
            height: 38,
            selected: true,
            hovered: false,
            disabled: false,
            closable: false,
            onClose: () => undefined,
        })

        expect(svg.querySelector('.ai-model-sliding-dropdown-option-icon path')).not.toBeNull()
        expect(svg.querySelector('.ai-model-sliding-dropdown-option-provider')?.textContent).toBe('OpenAI:')
        expect(svg.querySelector('.ai-model-sliding-dropdown-option-model')?.textContent).toBe(' GPT 5.4')

        dropdown.destroy()
    })
})

describe('createGenericImageSizeDropdown', () => {
    beforeEach(() => {
        resetMockDropdown()
        aiModelsStore.setAiModels([])
    })

    it('uses matrix-driven label and options for image-size controls', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'provider-a',
                model: 'size-literal',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
            } as any],
            mediaGenerationConfigMatrix: {
                version: 'media-generation-config-matrix-v1',
                groups: [{
                    groupId: 'image:provider-a',
                    mediaType: 'image',
                    provider: 'provider-a',
                    title: 'Provider A',
                    modelIds: ['provider-a:size-literal'],
                    controls: [{
                        key: 'imageSize',
                        label: 'Resolution',
                        options: [
                            { value: '1024x1024', label: '1024x1024' },
                            { value: '1536x1024', label: '1536x1024' },
                        ],
                    }],
                }],
            },
        })
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

    it('uses matrix-driven Aspect ratio label when matrix defines it', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'provider-b',
                model: 'ratio-model',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
            } as any],
            mediaGenerationConfigMatrix: {
                version: 'media-generation-config-matrix-v1',
                groups: [{
                    groupId: 'image:provider-b',
                    mediaType: 'image',
                    provider: 'provider-b',
                    title: 'Provider B',
                    modelIds: ['provider-b:ratio-model'],
                    controls: [{
                        key: 'imageSize',
                        label: 'Aspect ratio',
                        options: [
                            { value: '16:9', label: '16:9' },
                            { value: '4:3', label: '4:3' },
                        ],
                    }],
                }],
            },
        })
        const controls = createControls({
            currentImageModel: 'provider-b:ratio-model',
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

    it('uses matrix-driven generic label when matrix marks control as an image option', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'provider-c',
                model: 'label-mode',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
            } as any],
            mediaGenerationConfigMatrix: {
                version: 'media-generation-config-matrix-v1',
                groups: [{
                    groupId: 'image:provider-c',
                    mediaType: 'image',
                    provider: 'provider-c',
                    title: 'Provider C',
                    modelIds: ['provider-c:label-mode'],
                    controls: [{
                        key: 'imageSize',
                        label: 'Image option',
                        options: [
                            { value: 'small', label: 'Small' },
                            { value: 'large', label: 'Large' },
                        ],
                    }],
                }],
            },
        })
        const controls = createControls({
            currentImageModel: 'provider-c:label-mode',
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
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'provider-d',
                model: 'normalize-size',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
            } as any],
            mediaGenerationConfigMatrix: {
                version: 'media-generation-config-matrix-v1',
                groups: [{
                    groupId: 'image:provider-d',
                    mediaType: 'image',
                    provider: 'provider-d',
                    title: 'Provider D',
                    modelIds: ['provider-d:normalize-size'],
                    controls: [{
                        key: 'imageSize',
                        label: 'Image option',
                        options: [
                            { value: 'auto', label: 'Auto' },
                        ],
                    }],
                }],
            },
        })

        const controls = {
            getImageGenerationSize: vi.fn(() => 'invalid-size'),
            setImageGenerationSize: vi.fn(),
            getCurrentImageModel: vi.fn(() => currentImageModel),
            getProvider: vi.fn(),
        }

        const dropdown = createGenericImageSizeDropdown(controls, 'image-size')

        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'provider-d',
                model: 'normalize-size',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
            } as any],
            mediaGenerationConfigMatrix: {
                version: 'media-generation-config-matrix-v1',
                groups: [{
                    groupId: 'image:provider-d',
                    mediaType: 'image',
                    provider: 'provider-d',
                    title: 'Provider D',
                    modelIds: ['provider-d:normalize-size'],
                    controls: [{
                        key: 'imageSize',
                        label: 'Image option',
                        options: [
                            { value: 'tiny', label: 'Tiny' },
                            { value: 'small', label: 'Small' },
                        ],
                    }],
                }],
            },
        })

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

    it('auto-selects configured default image model when current model is empty', () => {
        const imageModels = [
            {
                provider: 'google',
                model: 'imagen-3',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [],
            } as any,
            {
                provider: 'google',
                model: 'imagen-lite',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [],
            } as any,
        ]

        aiModelsStore.setAiModelsCatalog({
            models: imageModels,
            defaultModels: {
                reasoning: '',
                image: 'google:imagen-3',
                video: '',
            } as any,
        } as any)

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

    it('uses the model sliding dropdown for image models', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'google',
                model: 'imagen-3',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [],
            } as any],
            defaultModels: {
                reasoning: '',
                image: 'google:imagen-3',
                video: '',
            } as any,
        } as any)

        const dropdown = createGenericImageModelDropdown({
            getCurrentImageModel: vi.fn(() => 'google:imagen-3'),
            setImageModel: vi.fn(),
        }, 'image-model-placement')

        expect(lastModelConfig()).toMatchObject({
            id: 'image-model-placement',
            selectedValue: 'google:imagen-3',
            renderOption: expect.any(Function),
        })
        dropdown.destroy()
    })

    it('does not auto-select when default image model is unavailable', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [{
                provider: 'google',
                model: 'imagen-3',
                iconName: 'gpt',
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [],
            } as any],
            defaultModels: {
                reasoning: '',
                image: 'google:imagen-missing',
                video: '',
            } as any,
        } as any)

        const controls = {
            getCurrentImageModel: vi.fn(() => ''),
            setImageModel: vi.fn(),
        }

        vi.useFakeTimers()
        const dropdown = createGenericImageModelDropdown(controls, 'image-model')
        vi.advanceTimersToNextTimer()
        vi.useRealTimers()

        expect(controls.setImageModel).not.toHaveBeenCalled()
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
        expect(lastModelConfig()?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({
                label: 'google: Veo',
                value: 'google:veo',
            }),
        ]))

        dropdown.update()
        dropdown.destroy()
    })

    it('uses the model sliding dropdown for video models', () => {
        aiModelsStore.setAiModels([{
            provider: 'google',
            model: 'veo',
            iconName: 'gpt',
            shortTitle: 'Veo',
            modalities: [{ modality: 'video_generation' }],
            videoAspectRatios: [{ value: '16:9', label: '16:9' }],
            videoResolutions: [{ value: '1080p', label: '1080p' }],
            videoDurations: [{ value: '30s', label: '30s' }],
        }] as any)

        const dropdown = createGenericVideoModelDropdown({
            getCurrentVideoModel: vi.fn(() => 'google:veo'),
            setVideoModel: vi.fn(),
        }, 'video-model-placement')

        expect(lastModelConfig()).toMatchObject({
            id: 'video-model-placement',
            selectedValue: 'google:veo',
            renderOption: expect.any(Function),
        })
        dropdown.destroy()
    })
})
