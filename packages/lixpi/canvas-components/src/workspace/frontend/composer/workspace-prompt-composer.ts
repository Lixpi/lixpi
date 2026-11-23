import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type ConversationModelPreferences,
    type CanvasCollaborationPresence,
} from '@lixpi/constants'
import {
    createAiPromptComposer,
    type AiPromptComposerConfig,
    type AiPromptComposerInstance,
} from './ai-prompt-composer.ts'

export type WorkspacePromptComposerOptions = Pick<AiPromptComposerConfig, 'document' | 'appearance' | 'mountEditor' | 'onSubmit' | 'onSubmitError'> & {
    workspaceId: string
    userId?: string
    conversationAssetId?: string
    storage: Pick<Storage, 'getItem' | 'setItem'>
    onDraftChange?: (draft: CanvasCollaborationPresence['composer']) => void
    mountContextTray: () => {
        element: HTMLElement
        destroy: () => void
    }
}

export class WorkspacePromptComposer {
    readonly element: HTMLDivElement
    readonly input: AiPromptComposerInstance
    private readonly lifetime = new Lifetime()
    private draftKey: string
    private initialSelection = true
    private conversationAssetId: string | null
    private previewing = false
    private ownContent: object | null = null
    private previewKey = ''
    private conversationMount: { element: HTMLElement } | null = null

    constructor(private readonly options: WorkspacePromptComposerOptions) {
        this.conversationAssetId = options.conversationAssetId ?? null
        this.draftKey = options.userId
            ? `lixpi:conversation-draft:${options.userId}:${options.workspaceId}:${options.conversationAssetId ?? 'new'}`
            : `lixpi:canvas-global-composer-draft:${options.workspaceId}`

        if (options.userId) {
            try {
                const migrationKey = `lixpi:conversation-draft-migrated:${options.userId}:${options.workspaceId}`

                if (!options.storage.getItem(migrationKey)) {
                    const previous = options.storage.getItem(`lixpi:canvas-global-composer-draft:${options.workspaceId}`)

                    if (
                        previous
                        && !options.storage.getItem(this.draftKey)
                    )
                        options.storage.setItem(this.draftKey, previous)

                    options.storage.setItem(migrationKey, 'true')
                }
            } catch {}
        }

        const html = createDocumentHtml(options.document)
        this.element = html`<div className="workspace-canvas-global-composer-host nopan"></div>` as HTMLDivElement
        this.lifetime.own(() => this.element.remove())
        this.lifetime.own(() => this.unmountConversation())

        try {
            const tray = options.mountContextTray()
            this.lifetime.own(() => tray.destroy())
            this.input = createAiPromptComposer({
                document: options.document,
                appearance: options.appearance,
                mountEditor: options.mountEditor,
                className: 'workspace-canvas-global-composer',
                initialContent: this.readDraft(),
                onContentChange: content => {
                    if (this.previewing)
                        return

                    this.writeDraft(content)
                    options.onDraftChange?.({
                        conversationAssetId: this.conversationAssetId,
                        content,
                    })
                },
                onSubmit: data => {
                    if (!this.previewing)
                        return options.onSubmit(data)
                },
                onSubmitError: options.onSubmitError,
            })
            this.lifetime.own(() => this.input.destroy())
            this.element.append(tray.element, this.input.element)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    getDraft(): CanvasCollaborationPresence['composer'] {
        const content = this.previewing ? this.ownContent : this.input.readContent()

        return content ? {
            conversationAssetId: this.conversationAssetId,
            content,
        } : null
    }

    setFollowedDraft(
        following: boolean,
        draft: CanvasCollaborationPresence['composer'],
    ): void {
        if (
            following
            && !this.previewing
        )
            this.ownContent = this.input.readContent()

        if (
            !following
            && !this.previewing
        )
            return

        const content = following ? draft?.content : this.ownContent
        const key = JSON.stringify(content) ?? ''
        const changed = following !== this.previewing || key !== this.previewKey
        this.previewKey = key
        this.previewing = following

        if (!changed)
            return

        try {
            const next = content
                && Object.keys(content).length
                ? content
                : this.input.emptyContent()

            if (next)
                this.input.restoreContent(next)
        } catch {
            // A draft from another editor schema cannot replace this preview.
        } finally {
            if (!following)
                this.ownContent = null
        }
    }

    mountConversation(element: HTMLElement): () => void {
        if (this.lifetime.signal.aborted)
            throw new Error('Workspace prompt composer is disposed')

        this.unmountConversation()
        const mount = { element }
        this.conversationMount = mount
        this.element.prepend(element)
        this.element.classList.add('has-conversation')

        return () => {
            if (this.conversationMount === mount)
                this.unmountConversation()
        }
    }

    unmountConversation(): void {
        this.conversationMount?.element.remove()
        this.conversationMount = null
        this.element.classList.remove('has-conversation')
    }

    private readDraft(): object {
        try {
            const raw = this.options.storage.getItem(this.draftKey)
            const parsed = raw ? JSON.parse(raw) : {}

            return parsed
                && typeof parsed === 'object'
                && !Array.isArray(parsed)
                ? parsed
                : {}
        } catch {
            return {}
        }
    }

    private writeDraft(content: object): void {
        // Draft persistence must not submit a canvas save or overwrite its viewport.
        try {
            this.options.storage.setItem(
                this.draftKey,
                JSON.stringify(content),
            )
        } catch {}
    }

    selectConversation(
        conversationAssetId: string,
        models?: ConversationModelPreferences,
    ): void {
        if (!this.options.userId)
            return

        const current = this.previewing ? this.ownContent : this.input.readContent()

        if (current)
            this.writeDraft(current)

        this.conversationAssetId = conversationAssetId || null
        this.draftKey = `lixpi:conversation-draft:${this.options.userId}:${this.options.workspaceId}:${conversationAssetId || 'new'}`
        let draft = this.readDraft()
        const hasSavedDraft = Object.keys(draft).length > 0

        if (
            this.initialSelection
            && !Object.keys(draft).length
            && current
        ) {
            draft = current
            this.writeDraft(draft)
        }

        this.initialSelection = false

        if (this.previewing) {
            this.ownContent = draft

            return
        }

        if (Object.keys(draft).length)
            this.input.restoreContent(draft)
        else {
            const doc = this.input.emptyContent()

            if (doc)
                this.input.restoreContent(doc)
        }

        if (
            !hasSavedDraft
            && models?.reasoningModelIds.length
        )
            this.input.applyModelPreferences(models)

        this.options.onDraftChange?.(
            this.getDraft(),
        )
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
