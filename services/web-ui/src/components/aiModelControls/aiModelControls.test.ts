import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { select } from 'd3-selection'

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
    toggleSwitchConfigs: [] as any[],
    toggleSwitchInstances: [] as Array<{
        getChecked: ReturnType<typeof vi.fn>
        setChecked: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
    }>,
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

vi.mock('@lixpi/ui-kit/components/toggle-switch', () => ({
    createToggleSwitch: vi.fn((_parent: any, config: any) => {
        let checked = config.checked ?? false
        const instance = {
            getChecked: vi.fn(() => checked),
            setChecked: vi.fn((nextChecked: boolean) => {
                checked = nextChecked
            }),
            destroy: vi.fn(),
        }
        mockState.toggleSwitchConfigs.push(config)
        mockState.toggleSwitchInstances.push(instance)
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
import { settings } from '$src/settings.ts'
import {
    createGenericAiModelDropdown,
    createGenericImageModelDropdown,
    createGenericVideoModelDropdown,
    createGenericVideoAspectDropdown,
    createMediaGenerationConfigMatrixView,
    type MediaGenerationConfigMatrixControls,
} from '$src/components/aiModelControls/aiModelControls.ts'

type MediaGenerationConfigSelectionGroup = {
    groupId: string
    modelIds: string[]
    values: Partial<Record<'imageSize' | 'aspectRatio' | 'resolution' | 'duration' | 'cameraFixed', string>>
}

function resetMocks(): void {
    mockState.dropdownConfigs.length = 0
    mockState.dropdownInstances.length = 0
    mockState.slidingDropdownConfigs.length = 0
    mockState.slidingDropdownInstances.length = 0
    mockState.tagPillConfigs.length = 0
    mockState.tagPillDestroyFns.length = 0
    mockState.toggleSwitchConfigs.length = 0
    mockState.toggleSwitchInstances.length = 0
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
        mediaType?: 'image' | 'video'
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
            mediaType: overrides.mediaType ?? 'image',
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
            { value: '1:1', label: 'Square' },
            { value: '16:9', label: 'Wide' },
        ])
        expect(imageSizeDropdown?.renderOption).toEqual(expect.any(Function))
        expect(imageSizeDropdown?.optionHorizontalPadding).toBe(
            settings.aiModelControls.styles.dimensionsDropdown.horizontalPadding,
        )
        expect(settings.slidingDropdown.styles.indicator.closedBorderWidth).toBe(0)

        imageSizeDropdown.onChange('16:9', 'image:google/openai:imageSize')

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'image:google/openai',
            modelIds: ['google:imagen-4', 'openai:gpt-image-1'],
            values: { imageSize: '16:9' },
        }])

        view.destroy()
    })

    it('keeps wide dimension glyphs inside the left padding and separates their labels', () => {
        const controls = createControls()
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const imageSizeDropdown = mockState.slidingDropdownConfigs.find((config) => (
            config.id.endsWith(':imageSize')
        ))
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        const optionState = {
            id: 'wide-dimension',
            option: { label: '21:9', value: '21:9' },
            index: 0,
            x: 2.75,
            y: 2,
            width: 64,
            height: settings.aiModelControls.styles.dimensionsDropdown.height - 4,
            selected: true,
            hovered: false,
            disabled: false,
            closable: false,
            onClose: () => undefined,
        }
        const renderer = imageSizeDropdown.renderOption(select(svg).append('g'), optionState)
        const glyph = svg.querySelector('.ai-media-config-dimensions-dropdown-glyph') as SVGRectElement
        const label = svg.querySelector('.ai-media-config-dimensions-dropdown-label') as SVGTextElement
        const dropdownStyles = settings.aiModelControls.styles.dimensionsDropdown
        const glyphStrokeInset = settings.aiModelControls.styles.dimensionsGlyph.strokeWidth / 2
        const glyphColumnStartX = optionState.x + dropdownStyles.horizontalPadding + glyphStrokeInset
        const glyphColumnEndX = glyphColumnStartX + dropdownStyles.glyphColumnWidth

        expect(renderer).toBeDefined()
        expect(Number(glyph.getAttribute('x')) - glyphStrokeInset).toBeGreaterThanOrEqual(
            optionState.x + dropdownStyles.horizontalPadding,
        )
        expect(Number(label.getAttribute('x')) - (glyphColumnEndX + glyphStrokeInset)).toBe(
            dropdownStyles.glyphValueGap,
        )

        view.destroy()
    })

    it('renders persisted aspect-ratio labels without replacing provider resolution values', () => {
        const imageGroup = aiModelsStoreState.mediaGenerationConfigMatrix.groups.find(group => (
            group.groupId === 'image:google/openai'
        ))
        imageGroup.controls = [{
            key: 'imageSize',
            label: 'Resolution',
            kind: 'segmented',
            defaultValue: '1024x1024',
            options: [
                { value: '1024x1024', label: '1:1' },
                { value: '1536x1024', label: '3:2' },
            ],
        }]
        const controls = createControls({
            configGroups: [{
                groupId: 'image:google/openai',
                modelIds: ['google:imagen-4', 'openai:gpt-image-1'],
                values: { imageSize: '1536x1024' },
            }],
        })
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const imageSizeDropdown = mockState.slidingDropdownConfigs.find((config) => (
            config.id.endsWith(':imageSize')
        ))
        expect(imageSizeDropdown.options).toEqual([
            { value: '1024x1024', label: '1:1' },
            { value: '1536x1024', label: '3:2' },
        ])
        expect(imageSizeDropdown.selectedValue).toBe('1536x1024')

        imageSizeDropdown.onChange('1024x1024', 'image:google/openai:imageSize')

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'image:google/openai',
            modelIds: ['google:imagen-4', 'openai:gpt-image-1'],
            values: { imageSize: '1024x1024' },
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

        expect(view.dom.dataset.visible).toBe('true')
        expect(view.dom.querySelectorAll('.ai-media-config-group')).toHaveLength(1)
        expect(view.dom.textContent).toContain('Image generators')

        view.destroy()
        expect(mockState.dropdownInstances.every((instance) => instance.destroy.mock.calls.length > 0)).toBe(true)
        expect(mockState.slidingDropdownInstances.every((instance) => instance.destroy.mock.calls.length > 0)).toBe(true)
        expect(mockState.tagPillDestroyFns.every((destroy) => destroy.mock.calls.length > 0)).toBe(true)
    })

    it('renders a selected media group and its inline toggle when multiple-model mode is disabled', () => {
        const imageGroup = aiModelsStoreState.mediaGenerationConfigMatrix.groups.find(group => (
            group.groupId === 'image:google/openai'
        ))
        imageGroup.controls = [
            {
                key: 'imageSize',
                label: 'Aspect ratio',
                defaultValue: '1:1',
                options: [
                    { value: '1:1', label: 'Square' },
                    { value: '16:9', label: 'Wide' },
                ],
            },
            {
                key: 'cameraFixed',
                kind: 'toggle',
                label: 'Fixed camera',
                defaultValue: 'false',
                options: [
                    { value: 'false', label: 'Off' },
                    { value: 'true', label: 'On' },
                ],
            },
        ]
        const controls = createControls({
            useMultipleModels: false,
            selectedModelIds: ['google:imagen-4'],
            configGroups: [{
                groupId: 'image:google/openai',
                modelIds: ['google:imagen-4'],
                values: { imageSize: '1:1', cameraFixed: 'false' },
            }],
        })
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const toggle = view.dom.querySelector('.ai-media-config-toggle') as HTMLButtonElement
        const toggleControl = toggle.closest('.ai-media-config-control') as HTMLElement
        const toggleConfig = mockState.toggleSwitchConfigs.at(-1)

        expect(view.dom.dataset.visible).toBe('true')
        expect(view.dom.querySelectorAll('.ai-media-config-group')).toHaveLength(1)
        expect(mockState.tagPillConfigs.at(-1)?.label).toBe('Imagen 4')
        expect(toggle.textContent).toBe('Fixed camera')
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(toggleControl.querySelector('.ai-prompt-model-menu-control-label')).toBeNull()
        expect(toggleConfig).toEqual(expect.objectContaining({
            id: 'image:google/openai:cameraFixed',
            width: 30,
            height: 18,
            checked: false,
        }))

        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'image:google/openai',
            modelIds: ['google:imagen-4'],
            values: { imageSize: '1:1', cameraFixed: 'true' },
        }])
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        expect(mockState.toggleSwitchInstances.at(-1)?.setChecked).toHaveBeenCalledWith(true)

        view.destroy()
        expect(mockState.toggleSwitchInstances.at(-1)?.destroy).toHaveBeenCalledOnce()
    })
})

// =============================================================================
// MODEL SELECTOR POPOVERS
// =============================================================================

describe('model selector popovers', () => {
    it('portal every model selector above the scrollable settings surface', () => {
        const reasoningSelector = createGenericAiModelDropdown({
            getCurrentAiModel: () => 'google:imagen-4',
            setAiModel: vi.fn(),
        }, 'reasoning-selector')
        const imageSelector = createGenericImageModelDropdown({
            getCurrentImageModel: () => 'google:imagen-4',
            setImageModel: vi.fn(),
        }, 'image-selector')
        const videoSelector = createGenericVideoModelDropdown({
            getCurrentVideoModel: () => 'google:veo-3',
            setVideoModel: vi.fn(),
        }, 'video-selector')

        const selectorConfigs = [
            latestDropdownConfig(config => config.id === 'reasoning-selector'),
            latestDropdownConfig(config => config.id === 'image-selector'),
            latestDropdownConfig(config => config.id === 'video-selector'),
        ]

        expect(selectorConfigs).toHaveLength(3)
        for (const config of selectorConfigs) {
            expect(config).toEqual(expect.objectContaining({
                mountToBody: true,
                disableAutoPositioning: false,
                popoverClassName: 'ai-prompt-model-selector-popover',
            }))
        }

        reasoningSelector.destroy()
        imageSelector.destroy()
        videoSelector.destroy()
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
