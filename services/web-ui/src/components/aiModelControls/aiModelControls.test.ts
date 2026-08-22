import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    dropdownConfigs: [] as any[],
    dropdownInstances: [] as Array<{
        dom: HTMLDivElement
        update: ReturnType<typeof vi.fn>
        setOptions: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
    }>,
    slidingDropdownConfigs: [] as any[],
    slidingDropdownInstances: [] as Array<{
        setValue: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
    }>,
    tagPillConfigs: [] as any[],
    tagPillDestroyFns: [] as Array<ReturnType<typeof vi.fn>>,
}))

const aiModelsStoreState = vi.hoisted(() => ({
    data: [] as any[],
    mediaGenerationConfigMatrix: {
        version: 'media-generation-config-matrix-v1',
        groups: [] as any[],
    },
    subscribers: new Set<(state: any) => void>(),
}))

vi.mock('@lixpi/ui-kit/components/dropdown', () => ({
    createPureDropdown: vi.fn((config: any) => {
        const instance = {
            dom: document.createElement('div'),
            update: vi.fn(),
            setOptions: vi.fn(),
            destroy: vi.fn(),
        }
        mockState.dropdownConfigs.push(config)
        mockState.dropdownInstances.push(instance)
        return instance
    }),
}))

vi.mock('@lixpi/ui-kit/components/tag-pill', () => ({
    createTagPill: vi.fn((parent: any, config: any) => {
        const group = parent.append('g')
            .attr('data-test-tag-pill-id', config.id)
        const destroy = vi.fn(() => {
            group.remove()
        })
        mockState.tagPillConfigs.push(config)
        mockState.tagPillDestroyFns.push(destroy)
        return {
            render: vi.fn(),
            resize: vi.fn(),
            setSelected: vi.fn(),
            destroy,
        }
    }),
}))

vi.mock('@lixpi/ui-kit/components/sliding-dropdown', () => ({
    createSlidingDropdown: vi.fn((_parent: any, config: any) => {
        const instance = {
            setValue: vi.fn(),
            destroy: vi.fn(),
        }
        mockState.slidingDropdownConfigs.push(config)
        mockState.slidingDropdownInstances.push(instance)
        return instance
    }),
}))

vi.mock('$src/stores/aiModelsStore.ts', () => {
    const notify = (): void => {
        const state = {
            data: aiModelsStoreState.data,
            mediaGenerationConfigMatrix: aiModelsStoreState.mediaGenerationConfigMatrix,
        }
        for (const subscriber of aiModelsStoreState.subscribers) subscriber(state)
    }

    return {
        aiModelsStore: {
            getData: () => aiModelsStoreState.data,
            getMediaGenerationConfigMatrix: () => aiModelsStoreState.mediaGenerationConfigMatrix,
            setAiModelsCatalog: (catalog: any) => {
                aiModelsStoreState.data = catalog.models
                aiModelsStoreState.mediaGenerationConfigMatrix = catalog.mediaGenerationConfigMatrix
                notify()
            },
            resetStore: () => {
                aiModelsStoreState.data = []
                aiModelsStoreState.mediaGenerationConfigMatrix = {
                    version: 'media-generation-config-matrix-v1',
                    groups: [],
                }
                notify()
            },
            subscribe: (subscriber: (state: any) => void) => {
                aiModelsStoreState.subscribers.add(subscriber)
                subscriber({
                    data: aiModelsStoreState.data,
                    mediaGenerationConfigMatrix: aiModelsStoreState.mediaGenerationConfigMatrix,
                })
                return () => {
                    aiModelsStoreState.subscribers.delete(subscriber)
                }
            },
        },
    }
})

import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    createGenericVideoAspectDropdown,
    createMediaGenerationConfigMatrixView,
    type MediaGenerationConfigMatrixControls,
} from '$src/components/aiModelControls/aiModelControls.ts'

type MediaGenerationConfigSelectionGroup = {
    groupId: string
    modelIds: string[]
    values: Partial<Record<'imageSize' | 'aspectRatio' | 'resolution' | 'duration', string>>
}

function resetMocks(): void {
    mockState.dropdownConfigs.length = 0
    mockState.dropdownInstances.length = 0
    mockState.slidingDropdownConfigs.length = 0
    mockState.slidingDropdownInstances.length = 0
    mockState.tagPillConfigs.length = 0
    mockState.tagPillDestroyFns.length = 0
}

function model(provider: string, modelId: string, shortTitle: string, modality: string): any {
    return {
        provider,
        model: modelId,
        shortTitle,
        iconName: 'gpt',
        modalities: [{ modality, shortTitle: modality }],
    }
}

function latestDropdownConfig(predicate: (config: any) => boolean): any {
    return [...mockState.dropdownConfigs].reverse().find(predicate)
}

beforeEach(() => {
    resetMocks()
    aiModelsStore.setAiModelsCatalog({
        models: [
            model('google', 'imagen-4', 'Imagen 4', 'image_generation'),
            model('openai', 'gpt-image-1', 'GPT Image', 'image_generation'),
            model('google', 'veo-3', 'Veo 3', 'video_generation'),
            model('bytedance', 'seedance', 'Seedance', 'video_generation'),
        ],
        mediaGenerationConfigMatrix: {
            version: 'media-generation-config-matrix-v1',
            groups: [
                {
                    groupId: 'image:google/openai',
                    mediaType: 'image',
                    provider: 'google',
                    title: 'Image generators',
                    modelIds: ['google:imagen-4', 'openai:gpt-image-1'],
                    controls: [{
                        key: 'imageSize',
                        label: 'Aspect ratio',
                        defaultValue: '1:1',
                        options: [
                            { value: '1:1', label: 'Square' },
                            { value: '16:9', label: 'Wide' },
                        ],
                    }],
                },
                {
                    groupId: 'video:google',
                    mediaType: 'video',
                    provider: 'google',
                    title: 'Google video',
                    modelIds: ['google:veo-3'],
                    controls: [{
                        key: 'aspectRatio',
                        label: 'Aspect ratio',
                        options: [
                            { value: '16:9', label: 'Wide' },
                            { value: '4:3', label: 'Classic' },
                        ],
                    }],
                },
                {
                    groupId: 'video:bytedance',
                    mediaType: 'video',
                    provider: 'bytedance',
                    title: 'ByteDance video',
                    modelIds: ['bytedance:seedance'],
                    controls: [{
                        key: 'aspectRatio',
                        label: 'Aspect ratio',
                        defaultValue: '9:16',
                        options: [
                            { value: '9:16', label: 'Vertical' },
                            { value: '1:1', label: 'Square' },
                        ],
                    }],
                },
            ],
        },
    })
})

afterEach(() => {
    aiModelsStore.resetStore()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

// =============================================================================
// MEDIA GENERATION CONFIG MATRIX
// =============================================================================

describe('createMediaGenerationConfigMatrixView', () => {
    function createControls(overrides: {
        useMultipleModels?: boolean
        selectedModelIds?: string[]
        configGroups?: MediaGenerationConfigSelectionGroup[]
    } = {}): MediaGenerationConfigMatrixControls & {
        selectedModelIds: string[]
        configGroups: MediaGenerationConfigSelectionGroup[]
        setSelectedModelIds: ReturnType<typeof vi.fn>
        setConfigGroups: ReturnType<typeof vi.fn>
    } {
        const controls = {
            selectedModelIds: overrides.selectedModelIds ?? ['google:imagen-4', 'openai:gpt-image-1', 'google:veo-3'],
            configGroups: overrides.configGroups ?? [{
                groupId: 'image:google/openai',
                modelIds: ['google:imagen-4'],
                values: { imageSize: 'stale-size' },
            }],
            mediaType: 'image' as const,
            getUseMultipleModels: vi.fn(() => overrides.useMultipleModels ?? true),
            getSelectedModelIds: vi.fn(() => controls.selectedModelIds),
            setSelectedModelIds: vi.fn((modelIds: string[]) => {
                controls.selectedModelIds = modelIds
            }),
            getConfigGroups: vi.fn(() => controls.configGroups),
            setConfigGroups: vi.fn((groups: MediaGenerationConfigSelectionGroup[]) => {
                controls.configGroups = groups
            }),
        }
        return controls
    }

    it('renders only selected groups for the requested media type and writes normalized config on dropdown changes', () => {
        const controls = createControls()
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        expect(view.dom.dataset.visible).toBe('true')
        expect(view.dom.querySelectorAll('.ai-media-config-group')).toHaveLength(1)
        expect(view.dom.textContent).toContain('Image generators')
        expect(view.dom.textContent).not.toContain('Google video')

        const tagLabels = mockState.tagPillConfigs.slice(-2).map((config) => config.label)
        expect(tagLabels).toEqual(['Imagen 4', 'GPT Image'])

        const imageSizeDropdown = mockState.slidingDropdownConfigs.find((config) => (
            config.id.endsWith(':imageSize')
        ))
        expect(imageSizeDropdown?.selectedValue).toBe('1:1')
        expect(imageSizeDropdown?.options).toEqual([
            { value: '1:1', label: '1:1' },
            { value: '16:9', label: '16:9' },
        ])
        expect(imageSizeDropdown?.renderOption).toEqual(expect.any(Function))

        imageSizeDropdown.onChange('16:9', 'image:google/openai:imageSize')

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'image:google/openai',
            modelIds: ['google:imagen-4', 'openai:gpt-image-1'],
            values: { imageSize: '16:9' },
        }])

        view.destroy()
    })

    it('removes a selected model from the matrix tag close action', () => {
        const controls = createControls()
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const imagenTag = [...mockState.tagPillConfigs].reverse()
            .find((config) => config.id === 'google:imagen-4')
        imagenTag.onClose('google:imagen-4', new MouseEvent('click'))

        expect(controls.setSelectedModelIds).toHaveBeenLastCalledWith([
            'openai:gpt-image-1',
            'google:veo-3',
        ])
        expect(view.dom.textContent).toContain('Image generators')

        vi.mocked(controls.getUseMultipleModels).mockReturnValue(false)
        view.update()

        expect(view.dom.dataset.visible).toBe('false')
        expect(view.dom.children).toHaveLength(0)

        view.destroy()
        expect(mockState.dropdownInstances.every((instance) => instance.destroy.mock.calls.length > 0)).toBe(true)
        expect(mockState.slidingDropdownInstances.every((instance) => instance.destroy.mock.calls.length > 0)).toBe(true)
        expect(mockState.tagPillDestroyFns.every((destroy) => destroy.mock.calls.length > 0)).toBe(true)
    })
})

// =============================================================================
// VIDEO OPTION DROPDOWNS
// =============================================================================

describe('createGenericVideoAspectDropdown', () => {
    it('replaces stale aspect-ratio options and normalizes the selected value when the video model changes', () => {
        let selectedVideoModel = 'google:veo-3'
        let aspectRatio = '16:9'
        const setValue = vi.fn((value: string) => {
            aspectRatio = value
        })

        const dropdown = createGenericVideoAspectDropdown({
            getValue: () => aspectRatio,
            setValue,
            getCurrentVideoModel: () => selectedVideoModel,
        }, 'video-aspect')

        selectedVideoModel = 'bytedance:seedance'
        dropdown.update()

        const instance = mockState.dropdownInstances.at(-1)
        expect(setValue).toHaveBeenLastCalledWith('9:16')
        expect(instance?.setOptions).toHaveBeenLastCalledWith({
            options: [
                { title: 'Vertical', value: '9:16' },
                { title: 'Square', value: '1:1' },
            ],
            selectedValue: { title: 'Vertical', value: '9:16' },
        })

        dropdown.destroy()
    })
})
