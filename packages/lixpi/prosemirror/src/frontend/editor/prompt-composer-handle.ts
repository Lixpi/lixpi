import {
    type ConversationModelPreferences,
} from '@lixpi/constants'
import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror/shared/model-selection-attrs'
import { aiPromptInputNodeType } from '@lixpi/prosemirror/shared/node-specs'
import {
    type DocumentEditorHandle,
} from '@lixpi/prosemirror/frontend/document-editor'

export type PromptComposerHandle = {
    readContent: () => object | null
    emptyContent: () => object | null
    restoreContent: (content: object) => void
    applyModelPreferences: (models: ConversationModelPreferences) => void
    insertCapabilityReference: (reference: {
        kind: string
        capabilityId: string
        displayName: string
    }) => void
    focus: () => void
    destroy: () => void
}

class DocumentPromptComposerHandle implements PromptComposerHandle {
    private destroyed = false

    constructor(private readonly editor: DocumentEditorHandle) {}

    readContent(): object | null {
        return this.destroyed ? null : this.editor.view.state.doc.toJSON()
    }

    emptyContent(): object | null {
        if (this.destroyed)
            return null

        return this.editor.view.state.schema.topNodeType.createAndFill()?.toJSON() ?? null
    }

    restoreContent(content: object): void {
        if (this.destroyed)
            throw new Error('AI_PROMPT_COMPOSER_NOT_READY')

        const view = this.editor.view
        const restored = view.state.schema.nodeFromJSON(content)
        restored.check()
        view.dispatch(
            view.state.tr.replaceWith(
                0,
                view.state.doc.content.size,
                restored.content,
            ),
        )
        view.focus()
    }

    applyModelPreferences(models: ConversationModelPreferences): void {
        if (this.destroyed)
            return

        const view = this.editor.view
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

    insertCapabilityReference(reference: {
        kind: string
        capabilityId: string
        displayName: string
    }): void {
        if (this.destroyed)
            return

        const view = this.editor.view
        const nodeType = view.state.schema.nodes.prompt_reference

        if (!nodeType)
            return

        const atom = nodeType.create({
            referenceType: reference.kind,
            capabilityId: reference.capabilityId,
            displayName: reference.displayName,
        })
        view.dispatch(
            view.state.tr.replaceSelectionWith(atom).insertText(' ').scrollIntoView(),
        )
        view.focus()
    }

    focus(): void {
        if (!this.destroyed)
            this.editor.view.focus()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.editor.destroy()
    }
}

export const createPromptComposerHandle = (editor: DocumentEditorHandle): PromptComposerHandle => new DocumentPromptComposerHandle(editor)
