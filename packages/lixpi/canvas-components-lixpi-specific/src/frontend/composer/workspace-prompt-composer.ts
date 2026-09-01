import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    createAiPromptComposer,
    type AiPromptComposerConfig,
    type AiPromptComposerInstance,
} from './ai-prompt-composer.ts'

export type WorkspacePromptComposerOptions = Pick<AiPromptComposerConfig, 'document' | 'appearance' | 'mountEditor' | 'onSubmit'> & {
    workspaceId: string
    storage: Pick<Storage, 'getItem' | 'setItem'>
    mountContextTray: () => { element: HTMLElement; destroy: () => void }
}

export class WorkspacePromptComposer {
    readonly element: HTMLDivElement
    readonly input: AiPromptComposerInstance
    private readonly lifetime = new Lifetime()
    private readonly draftKey: string

    constructor(private readonly options: WorkspacePromptComposerOptions) {
        this.draftKey = `lixpi:canvas-global-composer-draft:${options.workspaceId}`
        const html = createDocumentHtml(options.document)
        this.element = html`<div className="workspace-canvas-global-composer-host nopan"></div>` as HTMLDivElement
        this.lifetime.own(() => this.element.remove())
        try {
            const tray = options.mountContextTray()
            this.lifetime.own(() => tray.destroy())
            this.input = createAiPromptComposer({
                document: options.document,
                appearance: options.appearance,
                mountEditor: options.mountEditor,
                className: 'workspace-canvas-global-composer',
                initialContent: this.readDraft(),
                onContentChange: content => this.writeDraft(content),
                onSubmit: options.onSubmit,
            })
            this.lifetime.own(() => this.input.destroy())
            this.element.append(tray.element, this.input.element)
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    private readDraft(): object {
        try {
            const raw = this.options.storage.getItem(this.draftKey)
            const parsed = raw ? JSON.parse(raw) : {}
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch {
            return {}
        }
    }

    private writeDraft(content: object): void {
        // Draft persistence must not submit a canvas save or overwrite its viewport.
        try {
            this.options.storage.setItem(this.draftKey, JSON.stringify(content))
        } catch {}
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
