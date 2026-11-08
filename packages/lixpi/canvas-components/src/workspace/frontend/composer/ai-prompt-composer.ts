import {
    type EditorView,
} from 'prosemirror-view'
import {
    type AiPromptComposerSubmitData,
} from '../../shared/composer/canvas-conversation-content.ts'
export type { AiPromptComposerSubmitData } from '../../shared/composer/canvas-conversation-content.ts'
import { createShiftingGradientBackground } from '@lixpi/ui-primitives/gradients'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export type PromptComposerEditor = {
    readonly editorView: EditorView | null
    restoreContent: (content: object) => void
    destroy: () => void
}

export type PromptComposerEditorRequest = {
    host: HTMLElement
    initialContent: object
    threadId: string | null
    signal: AbortSignal
    onSubmit: (data: AiPromptComposerSubmitData) => void | Promise<void>
    onContentChange: (content: object) => void
}

export type AiPromptComposerConfig = {
    document: Document
    appearance: {
        popoverBoxShadow: string
        useShiftingGradientBackground: boolean
        gradientColors: string[]
    }
    mountEditor: (request: PromptComposerEditorRequest) => PromptComposerEditor
    initialContent?: object
    threadId?: string | null
    className?: string
    useGradient?: boolean
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

class AiPromptComposer implements AiPromptComposerInstance {
    readonly element: HTMLDivElement
    readonly editorContainer: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private editor: PromptComposerEditor | null = null
    private gradient: ReturnType<typeof createShiftingGradientBackground> | null = null

    constructor(config: AiPromptComposerConfig) {
        const html = createDocumentHtml(config.document)
        const className = ['ai-prompt-input-floating', 'nopan', config.className].filter(Boolean).join(' ')
        this.element = html`<div className=${className}></div>` as HTMLDivElement
        this.element.style.setProperty('--dropdown-popover-box-shadow', config.appearance.popoverBoxShadow)
        this.lifetime.own(() => this.element.remove())
        this.editorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        this.element.appendChild(this.editorContainer)

        try {
            if (
                config.useGradient
                ?? config.appearance.useShiftingGradientBackground
            ) {
                const colors = config.appearance.gradientColors

                if (colors.length !== 4)
                    throw new Error('Composer gradient requires four colors')

                const gradient = createShiftingGradientBackground(this.element, { colors: [colors[0], colors[1], colors[2], colors[3]] })
                this.gradient = gradient
                this.lifetime.own(() => {
                    this.gradient = null
                    gradient.destroy()
                })
            }

            const editor = config.mountEditor({
                host: this.editorContainer,
                initialContent: config.initialContent ?? {},
                threadId: config.threadId ?? null,
                signal: this.lifetime.signal,
                onContentChange: value => {
                    if (!this.lifetime.signal.aborted)
                        config.onContentChange?.(value)
                },
                onSubmit: data => {
                    if (!this.lifetime.signal.aborted)
                        return config.onSubmit(data)
                },
            })
            this.editor = editor
            this.lifetime.own(() => {
                this.editor = null
                editor.destroy()
            })
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    get editorView(): EditorView | null {
        return this.editor?.editorView ?? null
    }

    triggerGradientAnimation = (): void => void this.gradient?.triggerAnimation()
    focus = (): void => void this.editor?.editorView?.focus()

    restoreContent = (content: object): void => {
        if (!this.editor?.editorView)
            throw new Error('AI_PROMPT_COMPOSER_NOT_READY')

        this.editor.restoreContent(content)
    }

    destroy = (): void => void this.lifetime.destroy()
}

export const createAiPromptComposer = (config: AiPromptComposerConfig): AiPromptComposerInstance => new AiPromptComposer(config)
