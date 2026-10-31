import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type ConversationModelPreferences,
} from '@lixpi/constants'
import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror/shared/model-selection-attrs'
import { aiPromptInputNodeType } from '@lixpi/prosemirror/shared/node-specs'
import {
    createAiPromptComposer,
    type AiPromptComposerConfig,
    type AiPromptComposerInstance,
} from './ai-prompt-composer.ts'

export type WorkspacePromptComposerOptions = Pick<AiPromptComposerConfig, 'document' | 'appearance' | 'mountEditor' | 'onSubmit'> & {
    workspaceId: string
    userId?: string
    conversationAssetId?: string
    storage: Pick<Storage, 'getItem' | 'setItem'>
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

    constructor(private readonly options: WorkspacePromptComposerOptions) {
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

        const current = this.input.editorView?.state.doc.toJSON()

        if (current)
            this.writeDraft(current)

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

        if (Object.keys(draft).length)
            this.input.restoreContent(draft)
        else if (this.input.editorView) {
            const doc = this.input.editorView.state.schema.topNodeType.createAndFill()

            if (doc)
                this.input.restoreContent(
                    doc.toJSON(),
                )
        }

        const view = this.input.editorView

        if (
            !hasSavedDraft
            && view
            && models?.reasoningModelIds.length
        ) {
            let transaction = view.state.tr
            view.state.doc.descendants((node, position) => {
                if (node.type.name !== aiPromptInputNodeType)
                    return

                transaction = transaction.setNodeMarkup(
                    position,
                    undefined,
                    {
                        ...node.attrs,
                        aiReasoningModels: serializeAiModelSelectionAttr(models.reasoningModelIds),
                        aiImageModels: serializeAiModelSelectionAttr(models.imageModelIds),
                        aiVideoModels: serializeAiModelSelectionAttr(models.videoModelIds),
                        reasoningGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(models.reasoningOptions?.configGroups ?? []),
                        imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(models.imageOptions?.configGroups ?? []),
                        videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(models.videoOptions?.configGroups ?? []),
                        imageGenerationSize: models.imageOptions?.imageSize ?? node.attrs.imageGenerationSize,
                        videoAspectRatio: models.videoOptions?.aspectRatio ?? node.attrs.videoAspectRatio,
                        videoResolution: models.videoOptions?.resolution ?? node.attrs.videoResolution,
                        videoDuration: models.videoOptions?.duration ?? node.attrs.videoDuration,
                    },
                )

                return false
            })

            if (transaction.docChanged)
                view.dispatch(transaction)
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
