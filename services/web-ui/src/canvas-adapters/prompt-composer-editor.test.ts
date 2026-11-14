import {
    beforeEach,
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { createDefaultPromptControlFactories } from '$src/editor/prompt-control-factories.ts'
import { createAiPromptComposer } from '@lixpi/canvas-components/workspace/composer'
import { createPromptComposerEditorPort } from './prompt-composer-editor.ts'

type MockEditorInstance = {
    options: Record<string, any>
    destroy: ReturnType<typeof vi.fn>
    view: { focus: ReturnType<typeof vi.fn> }
}

const editorInstances: MockEditorInstance[] = []
const environment = {
    registry: {} as never,
    services: {} as never,
    authorityTransport: {} as never,
}

const createShiftingGradientBackgroundMock = vi.fn()
const mockGradient = {
    triggerAnimation: vi.fn(),
    destroy: vi.fn(),
}

vi.mock('@lixpi/prosemirror/frontend/editor', async importOriginal => ({
    ...await importOriginal<typeof import('@lixpi/prosemirror/frontend/editor')>(),
    mountEditorDocument: (options: Record<string, any>) => {
        const instance: MockEditorInstance = {
            options,
            view: { focus: vi.fn() },
            destroy: vi.fn(),
        }
        editorInstances.push(instance)

        return instance
    },
}))

vi.mock('@lixpi/ui-primitives/gradients', () => ({
    createShiftingGradientBackground: (...args: unknown[]) => {
        createShiftingGradientBackgroundMock(...args)

        return mockGradient
    },
}))

import { settings } from '$src/settings.ts'
import {
    createGenericAiModelDropdown,
    createGenericAiModelMultiSelect,
    createGenericSubmitButton,
    createGenericImageSizeDropdown,
    createGenericImageModelDropdown,
    createGenericImageModelMultiSelect,
    createGenericVideoModelDropdown,
    createGenericVideoModelMultiSelect,
    createGenericVideoAspectDropdown,
    createGenericVideoResolutionDropdown,
    createGenericVideoDurationDropdown,
} from '$src/components/aiModelControls/index.ts'
import { createInstalledCapabilityControls } from '$src/installed-capabilities.ts'

const getLastEditor = (): MockEditorInstance => editorInstances.at(-1) as MockEditorInstance

const composers: ReturnType<typeof createAiPromptComposer>[] = []
afterEach(() => {
    for (const composer of composers.splice(0)) composer.destroy()
})
const createComposer = (overrides: Record<string, any> = {}) => {
    const composer = createAiPromptComposer({
        document,
        appearance: {
            popoverBoxShadow: settings.dropdown.styles.popoverBoxShadow,
            useShiftingGradientBackground: settings.aiPromptInput.useShiftingGradientBackground,
            gradientColors: settings.gradient.styles.shiftingColors,
        },
        mountEditor: createPromptComposerEditorPort({
            environment,
            ...overrides,
        }),
        onSubmit: vi.fn(),
        onContentChange: vi.fn(),
        ...overrides,
    })
    composers.push(composer)

    return composer
}

const baseSubmitPayload = {
    contentJSON: [],
    aiReasoningModels: ['Anthropic:claude-sonnet-4-6'],
    useMultipleReasoningModels: false,
    useMultipleImageModels: false,
    useMultipleVideoModels: false,
}

beforeEach(() => {
    editorInstances.length = 0
    createShiftingGradientBackgroundMock.mockReset()
    mockGradient.triggerAnimation.mockReset()
    mockGradient.destroy.mockReset()
})

describe('createAiPromptComposer', () => {
    it('forwards submission errors without changing the input surface', () => {
        const onSubmitError = vi.fn()
        const composer = createComposer({ onSubmitError })
        const report = getLastEditor().options.context.prompt.onSubmitError
        const error = new Error('Choose a reasoning model before sending.')
        report(error)
        expect(onSubmitError).toHaveBeenCalledWith(error)
        composer.destroy()
        report(error)
        expect(onSubmitError).toHaveBeenCalledOnce()
    })

    it('enables Enter submission only when the workspace requests conversation behavior', () => {
        createComposer({
            submitOnEnter: true,
            requireReasoningModel: false,
        })
        expect(getLastEditor().options.context.prompt.submitOnEnter).toBe(true)
        expect(getLastEditor().options.context.prompt.requireReasoningModel).toBe(false)
        createComposer()
        expect(getLastEditor().options.context.prompt.submitOnEnter).toBeUndefined()
    })

    it('forwards the prompt-reference catalog to the editor plugin boundary', () => {
        const promptReferenceCatalog = {
            list: vi.fn(),
            listModules: vi.fn(),
            getModule: vi.fn(),
        }
        createComposer({ promptReferenceCatalog })
        expect(getLastEditor().options.context.promptReferences.catalog).toBe(promptReferenceCatalog)
    })

    it('forwards the prompt-reference preview renderer to the editor plugin boundary', () => {
        const promptReferencePreviewRenderer = {
            getNode: vi.fn(),
            environment: {
                getDocuments: vi.fn(() => []),
                getThreads: vi.fn(() => []),
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        }

        createComposer({ promptReferencePreviewRenderer })

        expect(getLastEditor().options.context.promptReferences.previewRenderer).toMatchObject({
            document,
            resolveMediaKind: expect.any(Function),
            createMediaPreview: expect.any(Function),
        })
    })

    it('builds host and mount elements with expected base and custom classes', () => {
        const composer = createComposer({
            className: 'my-composer',
            onSubmit: vi.fn(),
            onStop: vi.fn(),
        })

        expect(composer.element.className).toContain('ai-prompt-input-floating')
        expect(composer.element.className).toContain('nopan')
        expect(composer.element.className).toContain('my-composer')
        expect(composer.editorContainer.className).toBe('floating-input-editor nopan')
    })

    it('applies default control factory set when no factories are provided', () => {
        createComposer({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
        })

        const editor = getLastEditor()
        expect(editor.options.context.prompt.controls.createModelDropdown).toBe(createGenericAiModelDropdown)
        expect(editor.options.context.prompt.controls.createModelMultiSelect).toBe(createGenericAiModelMultiSelect)
        expect(editor.options.context.prompt.controls.createImageModelDropdown).toBe(createGenericImageModelDropdown)
        expect(editor.options.context.prompt.controls.createImageModelMultiSelect).toBe(createGenericImageModelMultiSelect)
        expect(editor.options.context.prompt.controls.createImageSizeDropdown).toBe(createGenericImageSizeDropdown)
        expect(editor.options.context.prompt.controls.createVideoModelDropdown).toBe(createGenericVideoModelDropdown)
        expect(editor.options.context.prompt.controls.createVideoModelMultiSelect).toBe(createGenericVideoModelMultiSelect)
        expect(editor.options.context.prompt.controls.createVideoAspectDropdown).toBe(createGenericVideoAspectDropdown)
        expect(editor.options.context.prompt.controls.createVideoResolutionDropdown).toBe(createGenericVideoResolutionDropdown)
        expect(editor.options.context.prompt.controls.createVideoDurationDropdown).toBe(createGenericVideoDurationDropdown)
        expect(editor.options.context.prompt.controls.createSubmitButton).toBe(createGenericSubmitButton)
    })

    it('allows overriding all control factories via config', () => {
        const customFactories = {
            createContextTray: vi.fn(),
            mountMediaModeSwitch: vi.fn(),
            mountModelMenuControl: vi.fn(),
            createModelDropdown: vi.fn(),
            createImageModelDropdown: vi.fn(),
            createSubmitButton: vi.fn(),
        }

        createComposer({
            controlFactories: customFactories,
            onSubmit: vi.fn(),
            onStop: vi.fn(),
        })

        const editor = getLastEditor()
        expect(editor.options.context.prompt.controls).toEqual(customFactories)
    })

    it('forwards editor submit callback to the composer onSubmit handler', () => {
        // The composer no longer wires an onPromptStop/onReceivingStateChange
        // editor option — aiPromptInput is a standalone floating input, and
        // stop/receiving-state tracking lives only in aiChatThreadPlugin now.
        const onSubmit = vi.fn()

        createComposer({
            onSubmit,
        })

        const editor = getLastEditor()
        editor.options.context.prompt.onSubmit(baseSubmitPayload)

        expect(onSubmit).toHaveBeenCalledOnce()
        expect(onSubmit).toHaveBeenCalledWith(baseSubmitPayload)
        expect(editor.options.context.chat).toBeUndefined()
    })

    it('forwards prompt content changes to onContentChange', () => {
        const onContentChange = vi.fn()
        const onSubmit = vi.fn()

        createComposer({
            onSubmit,
            onContentChange,
        })

        const editor = getLastEditor()
        const content = {
            type: 'doc',
            content: [],
        }
        editor.options.onChange?.(content)

        expect(onContentChange).toHaveBeenCalledWith(content)
    })

    it('creates gradient by default and suppresses it when useGradient is false', () => {
        const originalGradientSetting = settings.aiPromptInput.useShiftingGradientBackground

        try {
            settings.aiPromptInput.useShiftingGradientBackground = false
            const composerWithoutGradient = createComposer({
                onSubmit: vi.fn(),
                onStop: vi.fn(),
            })
            composerWithoutGradient.triggerGradientAnimation()
            expect(createShiftingGradientBackgroundMock).not.toHaveBeenCalled()
            expect(mockGradient.triggerAnimation).not.toHaveBeenCalled()

            settings.aiPromptInput.useShiftingGradientBackground = true
            const composerWithGradient = createComposer({
                useGradient: true,
                onSubmit: vi.fn(),
                onStop: vi.fn(),
            })
            composerWithGradient.triggerGradientAnimation()
            expect(createShiftingGradientBackgroundMock).toHaveBeenCalledTimes(1)
            expect(mockGradient.triggerAnimation).toHaveBeenCalledTimes(1)
        } finally {
            settings.aiPromptInput.useShiftingGradientBackground = originalGradientSetting
        }
    })

    it('focuses editor view and tears down node on destroy', () => {
        const onSubmit = vi.fn()
        const onStop = vi.fn()
        const originalGradientSetting = settings.aiPromptInput.useShiftingGradientBackground
        settings.aiPromptInput.useShiftingGradientBackground = true
        const composer = createComposer({
            onSubmit,
            onStop,
            threadId: 'thread-1',
        })
        const editor = getLastEditor()
        const host = document.createElement('div')
        host.appendChild(composer.element)

        composer.focus()
        expect(editor.view.focus).toHaveBeenCalledTimes(1)

        composer.destroy()
        expect(editor.destroy).toHaveBeenCalledTimes(1)
        expect(mockGradient.destroy).toHaveBeenCalledTimes(1)
        expect(host.contains(composer.element)).toBe(false)
        settings.aiPromptInput.useShiftingGradientBackground = originalGradientSetting
    })
})

describe('createDefaultPromptControlFactories', () => {
    it('includes the default generic prompt-control entrypoints', () => {
        const factories = createDefaultPromptControlFactories()

        expect(factories).toEqual({
            createModelDropdown: createGenericAiModelDropdown,
            createModelMultiSelect: createGenericAiModelMultiSelect,
            createImageModelDropdown: createGenericImageModelDropdown,
            createImageModelMultiSelect: createGenericImageModelMultiSelect,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createVideoModelDropdown: createGenericVideoModelDropdown,
            createVideoModelMultiSelect: createGenericVideoModelMultiSelect,
            createVideoAspectDropdown: createGenericVideoAspectDropdown,
            createVideoResolutionDropdown: createGenericVideoResolutionDropdown,
            createVideoDurationDropdown: createGenericVideoDurationDropdown,
            createCapabilityControls: createInstalledCapabilityControls,
            createSubmitButton: createGenericSubmitButton,
        })
    })
})
