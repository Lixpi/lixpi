'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultPromptControlFactories, createAiPromptComposer } from '$src/components/proseMirror/aiPromptComposer.ts'

type MockEditorInstance = {
    options: Record<string, any>
    destroy: ReturnType<typeof vi.fn>
    editorView: { focus: ReturnType<typeof vi.fn> }
}

const editorInstances: MockEditorInstance[] = []
const createEditorInstance = (options: Record<string, any>): MockEditorInstance => {
    return {
        options,
        editorView: { focus: vi.fn() },
        destroy: vi.fn(),
    }
}

const createShiftingGradientBackgroundMock = vi.fn()
const mockGradient = {
    triggerAnimation: vi.fn(),
    destroy: vi.fn(),
}

vi.mock('$src/components/proseMirror/components/editor.ts', () => ({
    ProseMirrorEditor: class {
        options: Record<string, any>
        destroy: ReturnType<typeof vi.fn>
        editorView: { focus: ReturnType<typeof vi.fn> }

        constructor(options: Record<string, any>) {
            const instance = createEditorInstance(options)
            this.options = instance.options
            this.destroy = instance.destroy
            this.editorView = instance.editorView
            editorInstances.push(this as unknown as MockEditorInstance)
        }
    },
}))

vi.mock('$src/utils/animations/gradients/shiftingGradientRenderer.ts', () => ({
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
} from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'

const getLastEditor = (): MockEditorInstance => editorInstances.at(-1) as MockEditorInstance

const createComposer = (overrides: Record<string, any> = {}) => createAiPromptComposer({
    isReceiving: () => false,
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onContentChange: vi.fn(),
    ...overrides,
})

const baseSubmitPayload = {
    contentJSON: [],
    aiModel: 'Anthropic:claude-sonnet-4-6',
    aiModels: [],
    useMultipleModels: false,
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
        expect(editor.options.promptControlFactories.createModelDropdown).toBe(createGenericAiModelDropdown)
        expect(editor.options.promptControlFactories.createModelMultiSelect).toBe(createGenericAiModelMultiSelect)
        expect(editor.options.promptControlFactories.createImageModelDropdown).toBe(createGenericImageModelDropdown)
        expect(editor.options.promptControlFactories.createImageModelMultiSelect).toBe(createGenericImageModelMultiSelect)
        expect(editor.options.promptControlFactories.createImageSizeDropdown).toBe(createGenericImageSizeDropdown)
        expect(editor.options.promptControlFactories.createVideoModelDropdown).toBe(createGenericVideoModelDropdown)
        expect(editor.options.promptControlFactories.createVideoModelMultiSelect).toBe(createGenericVideoModelMultiSelect)
        expect(editor.options.promptControlFactories.createVideoAspectDropdown).toBe(createGenericVideoAspectDropdown)
        expect(editor.options.promptControlFactories.createVideoResolutionDropdown).toBe(createGenericVideoResolutionDropdown)
        expect(editor.options.promptControlFactories.createVideoDurationDropdown).toBe(createGenericVideoDurationDropdown)
        expect(editor.options.promptControlFactories.createSubmitButton).toBe(createGenericSubmitButton)
    })

    it('allows overriding all control factories via config', () => {
        const customFactories = {
            createContextTray: vi.fn(),
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
        expect(editor.options.promptControlFactories).toEqual(customFactories)
    })

    it('forwards editor callbacks to composer submit/stop handlers', () => {
        const onSubmit = vi.fn()
        const onStop = vi.fn()

        createComposer({
            onSubmit,
            onStop,
        })

        const editor = getLastEditor()
        editor.options.onPromptSubmit(baseSubmitPayload)
        editor.options.onPromptStop()
        editor.options.onEditorChange?.(baseSubmitPayload)
        expect(onSubmit).toHaveBeenCalledOnce()
        expect(onSubmit).toHaveBeenCalledWith(baseSubmitPayload)
        expect(onStop).toHaveBeenCalledOnce()
    })

    it('forwards prompt content and thread receiving-state changes', () => {
        const onContentChange = vi.fn()
        const onReceivingStateChange = vi.fn()
        const onSubmit = vi.fn()
        const onStop = vi.fn()

        createComposer({
            onSubmit,
            onStop,
            onContentChange,
            onReceivingStateChange,
        })

        const editor = getLastEditor()
        const content = { type: 'doc', content: [] }
        editor.options.onEditorChange?.(content)
        editor.options.onReceivingStateChange('thread-1', true)

        expect(onContentChange).toHaveBeenCalledWith(content)
        expect(onReceivingStateChange).toHaveBeenCalledWith('thread-1', true)
    })

    it('creates gradient by default and suppresses it when useGradient is false', () => {
        const originalGradientSetting = settings.aiPromptInput.useShiftingGradientBackground
        try {
            settings.aiPromptInput.useShiftingGradientBackground = false
            const composerWithoutGradient = createComposer({ onSubmit: vi.fn(), onStop: vi.fn() })
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
        const composer = createComposer({ onSubmit, onStop, threadId: 'thread-1' })
        const editor = getLastEditor()
        const host = document.createElement('div')
        host.appendChild(composer.element)

        composer.focus()
        expect(editor.editorView.focus).toHaveBeenCalledTimes(1)

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
            createSubmitButton: createGenericSubmitButton,
        })
    })
})
