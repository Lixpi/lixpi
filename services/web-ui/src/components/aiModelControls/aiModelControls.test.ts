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
        render: ReturnType<typeof vi.fn>
        setValue: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
    }>,
    slidingSwitchConfigs: [] as any[],
    slidingSwitchInstances: [] as Array<{
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
    helpTooltipConfigs: [] as any[],
}))

const aiModelsStoreState = vi.hoisted(() => ({
    data: [] as any[],
    defaultModels: {
        reasoning: '',
        image: '',
        video: '',
    } as Record<'reasoning' | 'image' | 'video', string>,
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
            render: vi.fn(),
            setValue: vi.fn(),
            destroy: vi.fn(),
        }
        mockState.slidingDropdownConfigs.push(config)
        mockState.slidingDropdownInstances.push(instance)
        return instance
    }),
}))

vi.mock('@lixpi/ui-kit/components/sliding-switch', () => ({
    createSlidingSwitch: vi.fn((_parent: any, config: any) => {
        const instance = {
            setValue: vi.fn(),
            destroy: vi.fn(),
        }
        mockState.slidingSwitchConfigs.push(config)
        mockState.slidingSwitchInstances.push(instance)
        return instance
    }),
}))

vi.mock('@lixpi/ui-kit/components/help-tooltip', () => ({
    createHelpTooltip: vi.fn((config: any) => {
        const dom = document.createElement('span')
        dom.className = 'mock-help-tooltip'
        mockState.helpTooltipConfigs.push(config)
        return {
            dom,
            destroy: vi.fn(() => dom.remove()),
        }
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
                aiModelsStoreState.defaultModels = catalog.defaultModels ?? {
                    reasoning: '',
                    image: '',
                    video: '',
                }
                aiModelsStoreState.mediaGenerationConfigMatrix = catalog.mediaGenerationConfigMatrix
                notify()
            },
            resetStore: () => {
                aiModelsStoreState.data = []
                aiModelsStoreState.defaultModels = {
                    reasoning: '',
                    image: '',
                    video: '',
                }
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
            getDefaultModelId: (capability: 'reasoning' | 'image' | 'video') => (
                aiModelsStoreState.defaultModels[capability]
            ),
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
    values: Partial<Record<
        'imageSize' | 'aspectRatio' | 'resolution' | 'duration' | 'outputFormat' | 'generateAudio' | 'watermark',
        string
    >>
}

function resetMocks(): void {
    mockState.dropdownConfigs.length = 0
    mockState.dropdownInstances.length = 0
    mockState.slidingDropdownConfigs.length = 0
    mockState.slidingDropdownInstances.length = 0
    mockState.slidingSwitchConfigs.length = 0
    mockState.slidingSwitchInstances.length = 0
    mockState.tagPillConfigs.length = 0
    mockState.tagPillDestroyFns.length = 0
    mockState.toggleSwitchConfigs.length = 0
    mockState.toggleSwitchInstances.length = 0
    mockState.helpTooltipConfigs.length = 0
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

function latestSlidingDropdownConfig(predicate: (config: any) => boolean): any {
    return [...mockState.slidingDropdownConfigs].reverse().find(predicate)
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
            getSelectedModelIds: vi.fn(() => controls.selectedModelIds),
            setSelectedModelIds: vi.fn((modelIds: string[]) => {
                controls.selectedModelIds = modelIds
            }),
            getConfigGroups: vi.fn(() => controls.configGroups),
            setConfigGroups: vi.fn((groups: MediaGenerationConfigSelectionGroup[]) => {
                controls.configGroups = groups
            }),
            createModelDropdown: vi.fn(() => {
                const dom = document.createElement('div')
                return {
                    dom,
                    update: vi.fn(),
                    destroy: vi.fn(),
                }
            }),
        }
        return controls
    }

    it('renders one independently configured group for every selected image model', () => {
        const controls = createControls()
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        expect(view.dom.dataset.visible).toBe('true')
        expect(view.dom.querySelectorAll('.ai-media-config-group')).toHaveLength(2)
        expect(Array.from(view.dom.querySelectorAll('.ai-media-config-group')).map((group) => (
            group.getAttribute('data-model-id')
        ))).toEqual(['google:imagen-4', 'openai:gpt-image-1'])
        const imageSizeDropdowns = mockState.slidingDropdownConfigs.filter((config) => (
            config.id.endsWith(':imageSize')
        ))
        expect(new Set(imageSizeDropdowns.map(config => config.id))).toEqual(new Set([
            'image:google/openai:google:imagen-4:imageSize',
            'image:google/openai:openai:gpt-image-1:imageSize',
        ]))
        expect(mockState.dropdownConfigs).toHaveLength(0)

        const imageSizeDropdown = latestSlidingDropdownConfig((config) => (
            config.id === 'image:google/openai:google:imagen-4:imageSize'
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

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([
            {
                groupId: 'image:google/openai',
                modelIds: ['google:imagen-4'],
                values: { imageSize: '16:9' },
            },
            {
                groupId: 'image:google/openai',
                modelIds: ['openai:gpt-image-1'],
                values: { imageSize: '1:1' },
            },
        ])

        view.destroy()
    })

    it('keeps wide dimension glyphs inside the left padding and separates their labels', () => {
        const controls = createControls()
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const imageSizeDropdown = latestSlidingDropdownConfig((config) => (
            config.id === 'image:google/openai:google:imagen-4:imageSize'
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

    it('persists dimension values separately for every model configuration row', () => {
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

        const imageSizeDropdown = latestSlidingDropdownConfig((config) => (
            config.id === 'image:google/openai:google:imagen-4:imageSize'
        ))
        expect(imageSizeDropdown.options).toEqual([
            { value: '1024x1024', label: '1:1' },
            { value: '1536x1024', label: '3:2' },
        ])
        expect(imageSizeDropdown.selectedValue).toBe('1536x1024')

        imageSizeDropdown.onChange('1024x1024', 'image:google/openai:imageSize')

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([
            {
                groupId: 'image:google/openai',
                modelIds: ['google:imagen-4'],
                values: { imageSize: '1024x1024' },
            },
            {
                groupId: 'image:google/openai',
                modelIds: ['openai:gpt-image-1'],
                values: { imageSize: '1536x1024' },
            },
        ])

        view.destroy()
    })

    it('renders block-level remove buttons only when another model remains', () => {
        const controls = createControls({
            selectedModelIds: ['google:imagen-4', 'openai:gpt-image-1'],
        })
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const firstGroup = view.dom.querySelector('[data-model-id="google:imagen-4"]') as HTMLElement
        const removeButton = firstGroup.querySelector('.ai-model-config-remove') as HTMLButtonElement
        const primaryRow = firstGroup.querySelector('.ai-model-config-primary-row') as HTMLElement
        expect(firstGroup.classList.contains('ai-model-config-row')).toBe(true)
        expect(firstGroup.querySelector('.ai-model-config-model-column')).not.toBeNull()
        expect(removeButton).not.toBeNull()
        expect(removeButton.parentElement).toBe(primaryRow)
        expect(primaryRow.lastElementChild).toBe(removeButton)
        expect(removeButton.getAttribute('aria-label')).toBe('Remove model')
        expect(removeButton.getAttribute('data-help-tooltip')).toBe('aria-label')
        expect(removeButton.getAttribute('title')).toBeNull()
        removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect(controls.setSelectedModelIds).toHaveBeenLastCalledWith(['openai:gpt-image-1'])

        expect(view.dom.dataset.visible).toBe('true')
        expect(view.dom.querySelectorAll('.ai-media-config-group')).toHaveLength(1)
        expect(view.dom.querySelector('.ai-model-config-remove')).toBeNull()

        view.destroy()
    })

    it('puts toggle help in a label tooltip instead of rendering text below the field', () => {
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
                key: 'watermark',
                kind: 'toggle',
                label: 'Watermark',
                defaultValue: 'false',
                options: [
                    { value: 'false', label: 'Off' },
                    { value: 'true', label: 'On' },
                ],
            },
        ]
        const controls = createControls({
            selectedModelIds: ['google:imagen-4'],
            configGroups: [{
                groupId: 'image:google/openai',
                modelIds: ['google:imagen-4'],
                values: { imageSize: '1:1', watermark: 'false' },
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
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(toggleControl.querySelector('.ai-prompt-model-menu-control-label')?.textContent).toBe('Watermark')
        expect(toggleControl.querySelector('.mock-help-tooltip')).not.toBeNull()
        expect(toggleControl.querySelector('.ai-media-config-description')).toBeNull()
        expect(mockState.helpTooltipConfigs.at(-1)).toMatchObject({
            label: 'Watermark details',
            text: expect.any(String),
        })
        expect(toggleConfig).toEqual(expect.objectContaining({
            id: 'image:google/openai:google:imagen-4:watermark',
            width: 30,
            height: 18,
            checked: false,
        }))

        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'image:google/openai',
            modelIds: ['google:imagen-4'],
            values: { imageSize: '1:1', watermark: 'true' },
        }])
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        expect(mockState.toggleSwitchInstances.at(-1)?.setChecked).toHaveBeenCalledWith(true)

        view.destroy()
        expect(mockState.toggleSwitchInstances.at(-1)?.destroy).toHaveBeenCalledOnce()
    })

    it('renders Google video option help on the dropdown option instead of below the control', () => {
        const videoGroup = aiModelsStoreState.mediaGenerationConfigMatrix.groups.find(group => (
            group.groupId === 'video:google'
        ))
        videoGroup.controls = [{
            key: 'resolution',
            label: 'Resolution',
            kind: 'segmented',
            defaultValue: '720p',
            options: [
                { value: '720p', label: '720p' },
                { value: '1080p', label: '1080p', description: '1080p requires an 8 second duration.' },
            ],
        }]
        const controls = createControls({
            mediaType: 'video',
            selectedModelIds: ['google:veo-3'],
            configGroups: [{
                groupId: 'video:google',
                modelIds: ['google:veo-3'],
                values: { resolution: '1080p' },
            }],
        })
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const resolutionDropdown = mockState.slidingDropdownConfigs.find((config) => (
            config.id.endsWith(':resolution')
        ))
        const resolutionControl = view.dom.querySelector('[data-control-key="resolution"]') as HTMLElement
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        resolutionDropdown.renderOption(select(svg).append('g'), {
            id: 'video-resolution',
            option: { value: '1080p', label: '1080p' },
            index: 1,
            x: 0,
            y: 0,
            width: 80,
            height: 38,
            selected: true,
            hovered: false,
            disabled: false,
            closable: false,
            onClose: () => undefined,
        })

        expect(svg.querySelector('.ai-media-config-text-dropdown-option')).not.toBeNull()
        expect(svg.querySelector('.ai-media-config-dimensions-dropdown-glyph')).toBeNull()
        expect(resolutionControl.querySelector('.ai-media-config-description')).toBeNull()
        expect(mockState.helpTooltipConfigs.at(-1)).toMatchObject({
            label: '1080p details',
            text: '1080p requires an 8 second duration.',
        })

        view.destroy()
    })

    it('renders and persists the approved Seedance output format and audio controls', () => {
        const videoGroup = aiModelsStoreState.mediaGenerationConfigMatrix.groups.find(group => (
            group.groupId === 'video:bytedance'
        ))
        videoGroup.controls = [
            {
                key: 'outputFormat',
                label: 'Output format',
                kind: 'segmented',
                defaultValue: 'mov',
                options: [
                    { value: 'mp4', label: 'MP4' },
                    { value: 'mov', label: 'MOV' },
                ],
            },
            {
                key: 'generateAudio',
                label: 'Generate audio',
                kind: 'toggle',
                defaultValue: 'true',
                options: [
                    { value: 'true', label: 'On' },
                    { value: 'false', label: 'Off' },
                ],
            },
        ]
        const controls = createControls({
            mediaType: 'video',
            selectedModelIds: ['bytedance:seedance'],
            configGroups: [{
                groupId: 'video:bytedance',
                modelIds: ['bytedance:seedance'],
                values: { generateAudio: 'false' },
            }],
        })
        const view = createMediaGenerationConfigMatrixView(controls)

        document.body.appendChild(view.dom)
        view.update()

        const outputFormatDropdown = mockState.slidingDropdownConfigs.find(config => config.id.endsWith(':outputFormat'))
        const audioToggle = view.dom.querySelector('[data-control-key="generateAudio"] .ai-media-config-toggle') as HTMLButtonElement

        expect(outputFormatDropdown.selectedValue).toBe('mov')
        expect(outputFormatDropdown.options).toEqual([
            { value: 'mp4', label: 'MP4' },
            { value: 'mov', label: 'MOV' },
        ])
        expect(mockState.slidingSwitchConfigs.some(config => config.id.endsWith(':outputFormat'))).toBe(false)
        expect(audioToggle.getAttribute('aria-pressed')).toBe('false')

        outputFormatDropdown.onChange('mp4')
        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'video:bytedance',
            modelIds: ['bytedance:seedance'],
            values: { outputFormat: 'mp4', generateAudio: 'false' },
        }])

        audioToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        expect(controls.setConfigGroups).toHaveBeenLastCalledWith([{
            groupId: 'video:bytedance',
            modelIds: ['bytedance:seedance'],
            values: { outputFormat: 'mp4', generateAudio: 'true' },
        }])

        view.destroy()
    })
})

// =============================================================================
// MODEL SELECTOR POPOVERS
// =============================================================================

describe('model selector popovers', () => {
    it('uses sliding dropdowns for every model selector', () => {
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

        const selectorConfigs = mockState.slidingDropdownConfigs.filter((config) => (
            ['reasoning-selector', 'image-selector', 'video-selector'].includes(config.id)
        ))

        expect(selectorConfigs).toHaveLength(3)
        for (const config of selectorConfigs) {
            expect(config).toEqual(expect.objectContaining({
                observeParentResize: false,
                renderOption: expect.any(Function),
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
