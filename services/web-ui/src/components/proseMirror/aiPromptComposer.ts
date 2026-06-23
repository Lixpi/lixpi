'use strict'

import type { EditorView } from 'prosemirror-view'
import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'

import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import { createAiPromptInputNodeView } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
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
import { createShiftingGradientBackground } from '$src/utils/animations/gradients/shiftingGradientRenderer.ts'
import { html } from '$src/utils/domTemplates.ts'
import { settings } from '$src/settings.ts'

// The single payload the prompt input plugin emits on submit. Mirrors the
// SubmitHandler shape in aiPromptInputPlugin.ts so every host consumes one type.
export type AiPromptComposerSubmitData = {
    contentJSON: any[]
    aiModel: string
    aiModels: string[]
    useMultipleModels: boolean
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    imageOptions?: {
        aiImageModel?: string
        aiImageModels?: string[]
        imageGenerationSize: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
        aiVideoModel?: string
        aiVideoModels?: string[]
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
}

// The control-factory bundle the prompt input node view expects. Derived from
// the node view options so the contract stays in sync with the single source.
type NodeViewOptions = Parameters<typeof createAiPromptInputNodeView>[0]
export type PromptControlFactories = {
    createContextTray?: NodeViewOptions['createContextTray']
    createModelDropdown: NodeViewOptions['createModelDropdown']
    createModelMultiSelect?: NodeViewOptions['createModelMultiSelect']
    createImageModelDropdown: NodeViewOptions['createImageModelDropdown']
    createImageModelMultiSelect?: NodeViewOptions['createImageModelMultiSelect']
    createImageSizeDropdown: NodeViewOptions['createImageSizeDropdown']
    createVideoModelDropdown: NodeViewOptions['createVideoModelDropdown']
    createVideoModelMultiSelect?: NodeViewOptions['createVideoModelMultiSelect']
    createVideoAspectDropdown: NodeViewOptions['createVideoAspectDropdown']
    createVideoResolutionDropdown: NodeViewOptions['createVideoResolutionDropdown']
    createVideoDurationDropdown: NodeViewOptions['createVideoDurationDropdown']
    createSubmitButton: NodeViewOptions['createSubmitButton']
}

export type AiPromptComposerConfig = {
    // Persisted prompt draft to restore, if any.
    initialContent?: object
    // Thread the composer is bound to (drives draft keying / receiving state).
    // Null/undefined means the composer is not bound to a chat thread.
    threadId?: string | null
    // Extra class names appended to the wrapper (e.g. panel/persistent variants).
    className?: string
    // Render a shifting gradient background behind the input.
    useGradient?: boolean
    placeholderText?: string
    controlFactories?: PromptControlFactories
    onSubmit: (data: AiPromptComposerSubmitData) => void | Promise<void>
    onStop: () => void
    isReceiving: () => boolean
    onContentChange?: (value: object) => void
    onReceivingStateChange?: (threadId: string, receiving: boolean) => void
}

export type AiPromptComposerInstance = {
    readonly element: HTMLElement
    readonly editorContainer: HTMLElement
    readonly editorView: EditorView | null
    triggerGradientAnimation: () => void
    focus: () => void
    destroy: () => void
}

// The default (generic) control-factory bundle used by every non-panel host.
// The chat panel spreads this and overrides createContextTray.
export function createDefaultPromptControlFactories(): PromptControlFactories {
    return {
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
    }
}

// Owns one prompt input editor instance, its wrapper element, optional gradient
// background, and the submit/stop wiring. Hosts (chat panel, canvas) own where
// the element mounts and which submit strategy runs; this class stays ignorant
// of chat-thread vs canvas behavior.
class AiPromptComposer implements AiPromptComposerInstance {
    readonly element: HTMLDivElement
    readonly editorContainer: HTMLDivElement

    private editor: ProseMirrorEditor | null
    private gradient: { destroy: () => void; triggerAnimation: () => void } | null = null

    constructor(config: AiPromptComposerConfig) {
        const className = ['ai-prompt-input-floating', 'nopan', config.className].filter(Boolean).join(' ')
        this.element = html`<div className=${className}></div>` as HTMLDivElement
        this.element.style.setProperty('--dropdown-popover-box-shadow', settings.dropdown.styles.popoverBoxShadow)

        if (config.useGradient ?? settings.aiPromptInput.useShiftingGradientBackground) {
            this.gradient = createShiftingGradientBackground(this.element)
        }

        this.editorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        this.element.appendChild(this.editorContainer)

        const controlFactories = config.controlFactories ?? createDefaultPromptControlFactories()

        this.editor = new ProseMirrorEditor({
            editorMountElement: this.editorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: config.initialContent ?? {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            threadId: config.threadId ?? null,
            onEditorChange: (value: object) => config.onContentChange?.(value),
            onProjectTitleChange: () => {},
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
            onPromptSubmit: (data: AiPromptComposerSubmitData) => config.onSubmit(data),
            onPromptStop: () => config.onStop(),
            isPromptReceiving: () => config.isReceiving(),
            promptControlFactories: controlFactories,
            onReceivingStateChange: (threadId: string, receiving: boolean) =>
                config.onReceivingStateChange?.(threadId, receiving),
        })
    }

    get editorView(): EditorView | null {
        return this.editor?.editorView ?? null
    }

    triggerGradientAnimation(): void {
        this.gradient?.triggerAnimation()
    }

    focus(): void {
        this.editor?.editorView?.focus()
    }

    destroy(): void {
        this.editor?.destroy?.()
        this.editor = null
        this.gradient?.destroy()
        this.gradient = null
        this.element.remove()
    }
}

export function createAiPromptComposer(config: AiPromptComposerConfig): AiPromptComposerInstance {
    return new AiPromptComposer(config)
}
