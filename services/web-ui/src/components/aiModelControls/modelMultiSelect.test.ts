import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
} from 'vitest'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    createGenericAiModelMultiSelect,
    createGenericImageModelMultiSelect,
    createGenericVideoModelMultiSelect,
} from '$src/components/aiModelControls/modelMultiSelect.ts'
import { createInfoBubble } from '@lixpi/ui-kit/components/info-bubble'

vi.mock('@lixpi/ui-kit/components/info-bubble', () => ({
    createInfoBubble: vi.fn((config: any) => {
        const dom = document.createElement('div')
        dom.appendChild(config.bodyContent)
        return {
            dom,
            open: vi.fn(),
            close: vi.fn(),
            toggle: vi.fn(),
            isOpen: vi.fn(() => false),
            destroy: vi.fn(),
        }
    }),
}))

const createInfoBubbleMock = vi.mocked(createInfoBubble)

const reasoningModels = [
    {
        provider: 'openai',
        model: 'reasoning-a',
        shortTitle: 'Reasoning A',
        iconName: 'gpt',
        modalities: [{ modality: 'text_generation' }],
        imageSizes: [],
    },
    {
        provider: 'openai',
        model: 'reasoning-b',
        shortTitle: 'Reasoning B',
        iconName: 'gpt',
        modalities: [{ modality: 'text_generation' }],
        imageSizes: [],
    },
]

const imageModels = [
    {
        provider: 'google',
        model: 'imagen',
        shortTitle: 'Image One',
        iconName: 'gpt',
        modalities: [{ modality: 'image_generation' }],
        imageSizes: [{ value: '1024x1024', label: '1024x1024' }],
    },
]

const videoModels = [
    {
        provider: 'google',
        model: 'veo',
        shortTitle: 'Video One',
        iconName: 'gpt',
        modalities: [{ modality: 'video_generation' }],
        imageSizes: [],
        videoAspectRatios: [{ value: '16:9', label: '16:9' }],
        videoResolutions: [{ value: '1080p', label: '1080p' }],
        videoDurations: [{ value: '30s', label: '30s' }],
    },
]

const createAiModelControls = (seedModels: string[] = []) => {
    const selectedModels: string[] = [...seedModels]
    return {
        selectedModels,
        getCurrentAiModel: vi.fn(() => selectedModels[0] ?? ''),
        setAiModel: vi.fn((id: string) => {
            if (id && !selectedModels.includes(id)) selectedModels.push(id)
        }),
        getCurrentAiModels: vi.fn(() => selectedModels),
        setAiModels: vi.fn((models: string[]) => {
            selectedModels.length = 0
            selectedModels.push(...models)
        }),
    }
}

const createImageControls = (getCurrentImageModel: () => string, setImageModel: (id: string) => void) => ({
    getCurrentImageModel,
    setImageModel,
})

const createVideoControls = (getCurrentVideoModel: () => string, setVideoModel: (id: string) => void) => ({
    getCurrentVideoModel,
    setVideoModel,
})

describe('createGenericAiModelMultiSelect', () => {
    let addListenerSpy: ReturnType<typeof vi.spyOn>
    let removeListenerSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        createInfoBubbleMock.mockClear()
        aiModelsStore.setAiModelsCatalog({
            models: [...reasoningModels, ...imageModels, ...videoModels],
            defaultModels: {
                reasoning: 'openai:reasoning-a',
                image: '',
                video: '',
            } as any,
        })
        addListenerSpy = vi.spyOn(document, 'addEventListener')
        removeListenerSpy = vi.spyOn(document, 'removeEventListener')
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        aiModelsStore.resetStore()
    })

    it('uses the shared dropdown trigger alignment classes', () => {
        const controls = createAiModelControls()
        const control = createGenericAiModelMultiSelect(controls, 'reasoning-multi-select-alignment')
        const button = control.dom.querySelector('button')!
        const stateIndicator = control.dom.querySelector('.state-indicator')!

        expect(button.classList.contains('dropdown-trigger-button')).toBe(true)
        expect(stateIndicator.classList.contains('dropdown-trigger-state-indicator')).toBe(true)

        control.destroy()
    })

    it('portals the regular menu without disabling viewport positioning and lets overflowing options scroll internally', () => {
        const controls = createAiModelControls()
        const control = createGenericAiModelMultiSelect(controls, 'reasoning-multi-select-placement')
        const infoBubbleConfig = createInfoBubbleMock.mock.calls.at(-1)?.[0]
        const infoBubble = createInfoBubbleMock.mock.results.at(-1)?.value
        const optionList = infoBubble?.dom.querySelector('.ai-model-multi-select-list') as HTMLUListElement
        const wheelEvent = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: 120,
        })
        const stopSpy = vi.spyOn(wheelEvent, 'stopPropagation')

        Object.defineProperty(optionList, 'clientHeight', { configurable: true, value: 100 })
        Object.defineProperty(optionList, 'scrollHeight', { configurable: true, value: 400 })

        optionList.dispatchEvent(wheelEvent)

        expect(infoBubbleConfig?.disableAutoPositioning).toBe(false)
        expect(infoBubbleConfig?.className).toContain('ai-prompt-model-selector-popover')
        expect(infoBubble?.dom.parentElement).toBe(document.body)
        expect(wheelEvent.defaultPrevented).toBe(false)
        expect(stopSpy).toHaveBeenCalledOnce()

        control.destroy()
    })

    it('auto-selects configured default reasoning model and updates title on multi-selection changes', () => {
        const controls = createAiModelControls()
        const control = createGenericAiModelMultiSelect(controls, 'reasoning-multi-select')

        vi.advanceTimersToNextTimer()

        expect(addListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), true)
        expect(controls.setAiModels).toHaveBeenCalledWith(['openai:reasoning-a'])
        expect(control.dom.querySelector('.title')?.textContent).toBe('1 model')

        controls.selectedModels.push('openai:reasoning-b')
        control.update()
        expect(controls.selectedModels).toEqual(['openai:reasoning-a', 'openai:reasoning-b'])
        expect(control.dom.querySelector('.title')?.textContent).toBe('2 models')

        control.destroy()
        expect(removeListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), true)
    })

    it('restores the required default after prompt attrs are replaced with an empty selection', () => {
        const controls = createAiModelControls()
        const control = createGenericAiModelMultiSelect(controls, 'reasoning-multi-select-restored')
        vi.runAllTimers()
        expect(controls.selectedModels).toEqual(['openai:reasoning-a'])

        controls.selectedModels.length = 0
        controls.setAiModels.mockClear()
        control.update()

        expect(controls.setAiModels).toHaveBeenCalledWith(['openai:reasoning-a'])
        expect(controls.selectedModels).toEqual(['openai:reasoning-a'])
        expect(control.dom.querySelector('.title')?.textContent).toBe('1 model')
        control.destroy()
    })

    it('does not auto-select when API default reasoning model is missing from available options', () => {
        aiModelsStore.setAiModelsCatalog({
            models: [...reasoningModels],
            defaultModels: {
                reasoning: 'openai:reasoning-missing',
                image: '',
                video: '',
            } as any,
        })

        const controls = createAiModelControls()
        const control = createGenericAiModelMultiSelect(controls, 'reasoning-multi-select-missing-default')

        vi.advanceTimersToNextTimer()

        expect(controls.setAiModels).not.toHaveBeenCalled()
        expect(control.dom.querySelector('.title')?.textContent).toBe('Select at least 1 model')

        control.destroy()
    })
})

describe('createGenericImageModelMultiSelect', () => {
    beforeEach(() => {
        aiModelsStore.setAiModelsCatalog({
            models: imageModels,
            defaultModels: {
                reasoning: '',
                image: 'google:imagen',
                video: '',
            } as any,
        })
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        aiModelsStore.resetStore()
    })

    it('auto-selects configured default image model when empty', () => {
        const setImageModel = vi.fn()
        const controls = createImageControls(() => '', setImageModel)
        const control = createGenericImageModelMultiSelect(controls, 'image-multi-select')

        vi.advanceTimersToNextTimer()

        expect(setImageModel).toHaveBeenCalledWith('google:imagen')
        expect(control.dom.querySelector('.title')?.textContent).toBe('1 model')
        control.destroy()
    })

    it('does not auto-select image model when default is unavailable', () => {
        aiModelsStore.setAiModelsCatalog({
            models: imageModels,
            defaultModels: {
                reasoning: '',
                image: 'google:imagen-missing',
                video: '',
            } as any,
        })

        const setImageModel = vi.fn()
        const controls = createImageControls(() => '', setImageModel)
        const control = createGenericImageModelMultiSelect(controls, 'image-multi-select-missing-default')

        vi.advanceTimersToNextTimer()

        expect(setImageModel).not.toHaveBeenCalled()
        expect(control.dom.querySelector('.title')?.textContent).toBe('Select at least 1 model')
        control.destroy()
    })

    it('shows image-model placeholder when no image models are available', () => {
        aiModelsStore.setAiModels([{
            provider: 'openai',
            model: 'reasoning-only',
            shortTitle: 'Reasoning Only',
            iconName: 'gpt',
            modalities: [{ modality: 'text_generation' }],
            imageSizes: [],
        } as any])

        const setImageModel = vi.fn()
        const control = createGenericImageModelMultiSelect(createImageControls(() => '', setImageModel), 'image-multi-select-empty')

        expect(setImageModel).not.toHaveBeenCalled()
        expect(control.dom.querySelector('.title')?.textContent).toBe('Image models')

        control.destroy()
    })
})

describe('createGenericVideoModelMultiSelect', () => {
    beforeEach(() => {
        aiModelsStore.setAiModels(videoModels)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        aiModelsStore.resetStore()
    })

    it('does not auto-select when no current video model exists', () => {
        const setVideoModel = vi.fn()
        const controls = createVideoControls(() => '', setVideoModel)
        const control = createGenericVideoModelMultiSelect(controls, 'video-multi-select')

        expect(setVideoModel).not.toHaveBeenCalled()
        expect(control.dom.querySelector('.title')?.textContent).toBe('Select at least 1 model')

        control.destroy()
    })
})
