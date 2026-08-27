'use strict'

import type { EditorView } from 'prosemirror-view'
import type {
    CapabilityJsonValue,
    MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'
import type { PromptReferenceCatalogClient } from '$src/services/prompt-reference-catalog-client.ts'
import type { PromptReferencePreviewRenderer } from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

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
} from '$src/components/aiModelControls/index.ts'
import { createShiftingGradientBackground } from '@lixpi/canvas-engine'
import { html } from '$src/utils/domTemplates.ts'
import { settings } from '$src/settings.ts'
import { createInstalledCapabilityControls } from '$src/installed-capabilities.ts'

// The single payload the prompt input plugin emits on submit. Mirrors the
// SubmitHandler shape in aiPromptInputPlugin.ts so every host consumes one type.
export type AiPromptComposerSubmitData = {
    contentJSON: any[]
    mediaGenerationMode: 'image' | 'video'
    aiReasoningModels: string[]
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    imageOptions?: {
        aiImageModels: string[]
        imageGenerationSize: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
        aiVideoModels: string[]
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    capabilityInputs: Record<string, Record<string, CapabilityJsonValue>>
}

// The control-factory bundle the prompt input node view expects. Derived from
// the node view options so the contract stays in sync with the single source.
type NodeViewOptions = Parameters<typeof createAiPromptInputNodeView>[0]
export type PromptControlFactories = {
    createContextTray?: NodeViewOptions['createContextTray']
    mountMediaModeSwitch?: NodeViewOptions['mountMediaModeSwitch']
    mountModelMenuControl?: NodeViewOptions['mountModelMenuControl']
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
    createCapabilityControls?: NodeViewOptions['createCapabilityControls']
}

export type AiPromptComposerConfig = {
    // Persisted prompt draft to restore, if any.
    initialContent?: object
    // Thread the composer is bound to when the host needs thread-scoped editor identity.
    // Null/undefined means the composer is not bound to a chat thread.
    threadId?: string | null
    // Extra class names appended to the wrapper (e.g. panel/persistent variants).
    className?: string
    // Render a shifting gradient background behind the input.
    useGradient?: boolean
    placeholderText?: string
    promptReferenceCatalog?: PromptReferenceCatalogClient
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
    controlFactories?: PromptControlFactories
    onSubmit: (data: AiPromptComposerSubmitData) => void | Promise<void>
    onContentChange?: (value: object) => void
}

export type AiPromptComposerInstance = {
    readonly element: HTMLElement
    readonly editorContainer: HTMLElement
    readonly editorView: EditorView | null
    triggerGradientAnimation: () => void
    focus: () => void
    restoreContent: (content: object) => void
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
        createCapabilityControls: createInstalledCapabilityControls,
    }
}

// Owns one prompt input editor instance, its wrapper element, optional gradient
// background, and the submit wiring. Hosts (chat panel, canvas) own where
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
            this.gradient = createShiftingGradientBackground(this.element, {
                colors: settings.gradient.styles.shiftingColors,
            })
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
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
            onPromptSubmit: (data: AiPromptComposerSubmitData) => config.onSubmit(data),
            promptControlFactories: controlFactories,
            promptReferenceCatalog: config.promptReferenceCatalog,
            promptReferencePreviewRenderer: config.promptReferencePreviewRenderer,
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

    restoreContent(content: object): void {
        const view = this.editor?.editorView
        if (!view) throw new Error('AI_PROMPT_COMPOSER_NOT_READY')
        const restored = view.state.schema.nodeFromJSON(content)
        restored.check()
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, restored.content))
        view.focus()
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
