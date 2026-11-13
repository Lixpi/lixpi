import {
    type AiPromptComposerConfig,
    type PromptComposerEditorRequest,
    type PromptComposerEditor,
} from '@lixpi/canvas-components/workspace/composer'
import {
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components/workspace/context'
import {
    editorDocumentViews,
    mountEditorDocument,
    createPromptComposerHandle,
    type PromptComposerHandle,
    type WorkspacePromptCatalog,
} from '@lixpi/prosemirror/frontend/editor'
import {
    createDefaultPromptControlFactories,
    type PromptControlFactories,
} from '$src/editor/prompt-control-factories.ts'
import {
    type WebUiEditorEnvironment,
} from '$src/editor/web-ui-editor.ts'
import { toEditorPromptReferencePreview } from '$src/editor/editor-services.ts'

export type PromptComposerEditorOptions = {
    environment: WebUiEditorEnvironment
    submitOnEnter?: boolean
    controlFactories?: PromptControlFactories
    promptReferenceCatalog?: WorkspacePromptCatalog
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
}

class PromptComposerEditorAdapter implements PromptComposerEditor {
    private readonly handle: PromptComposerHandle

    constructor(
        request: PromptComposerEditorRequest,
        options: PromptComposerEditorOptions,
    ) {
        const { environment } = options
        this.handle = createPromptComposerHandle(
            mountEditorDocument({
                registry: environment.registry,
                definition: editorDocumentViews.aiPromptInput!,
                container: request.host,
                document: request.initialContent,
                onChange: request.onContentChange,
                onInvalidDocument: error => console.warn('Invalid AI prompt draft; starting a fresh input:', error),
                context: {
                    services: environment.services,
                    promptReferences: {
                        catalog: options.promptReferenceCatalog,
                        previewRenderer: toEditorPromptReferencePreview(options.promptReferencePreviewRenderer),
                    },
                    prompt: {
                        onSubmit: request.onSubmit,
                        submitOnEnter: options.submitOnEnter,
                        controls: options.controlFactories ?? createDefaultPromptControlFactories(),
                    },
                },
            }),
        )
    }

    readContent(): object | null {
        return this.handle.readContent()
    }

    emptyContent(): object | null {
        return this.handle.emptyContent()
    }

    restoreContent(content: object): void {
        this.handle.restoreContent(content)
    }

    applyModelPreferences(models: Parameters<PromptComposerHandle['applyModelPreferences']>[0]): void {
        this.handle.applyModelPreferences(models)
    }

    insertCapabilityReference(reference: Parameters<PromptComposerHandle['insertCapabilityReference']>[0]): void {
        this.handle.insertCapabilityReference(reference)
    }

    focus(): void {
        this.handle.focus()
    }

    destroy(): void {
        this.handle.destroy()
    }
}

export const createPromptComposerEditorPort = (options: PromptComposerEditorOptions): AiPromptComposerConfig['mountEditor'] =>
    request => new PromptComposerEditorAdapter(request, options)
