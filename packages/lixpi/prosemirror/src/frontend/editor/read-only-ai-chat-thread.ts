import {
    type DocumentKindRegistry,
} from '@lixpi/prosemirror/shared/document-kind'
import {
    type DocumentEditorHandle,
} from '@lixpi/prosemirror/frontend/document-editor'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type EditorPromptReferencePreviewRenderer,
} from './editor-host-ports.ts'
import {
    type AiMediaGenerationProgressRenderer,
} from '../plugins/ai-chat-thread/ai-media-generation-progress-node.ts'
import {
    type AiUserMessageContextPreviewRenderer,
} from '../plugins/ai-chat-thread/ai-user-message-node.ts'
import {
    type ImageGenerationTraceDetailsOptions,
} from '../plugins/ai-chat-thread/image-generation-trace-details.ts'
import {
    type EditorServices,
} from './editor-services.ts'
import {
    editorDocumentViews,
    mountEditorDocument,
} from './editor-views.ts'

export type ReadOnlyAiChatThreadRenderOptions = {
    registry: DocumentKindRegistry
    services: EditorServices
    mount: HTMLElement
    content: ProseMirrorJsonNode
    threadId: string
    documentType?: 'assetConversation' | 'assetProvenance'
    className?: string
    traceDetailsOptions?: ImageGenerationTraceDetailsOptions
    contextPreview?: AiUserMessageContextPreviewRenderer
    promptReferencePreviewRenderer?: EditorPromptReferencePreviewRenderer
    mediaGenerationProgress?: AiMediaGenerationProgressRenderer
}

export type ReadOnlyAiChatThreadRendererInstance = {
    editor: DocumentEditorHandle
    destroy: () => void
}

class ReadOnlyAiChatThreadRenderer implements ReadOnlyAiChatThreadRendererInstance {
    readonly editor: DocumentEditorHandle

    private readonly host: HTMLElement

    constructor(options: ReadOnlyAiChatThreadRenderOptions) {
        const className = [
            'ai-chat-thread-node-editor',
            'read-only-ai-chat-thread-projection',
            options.className,
        ].filter(Boolean).join(' ')
        this.host = html`<div className=${className}></div>` as HTMLElement
        options.mount.appendChild(this.host)

        this.editor = mountEditorDocument({
            registry: options.registry,
            definition: editorDocumentViews[options.documentType ?? 'assetProvenance']!,
            container: this.host,
            document: options.content,
            readOnly: true,
            context: {
                services: options.services,
                promptReferences: { previewRenderer: options.promptReferencePreviewRenderer },
                chat: {
                    threadId: options.threadId,
                    onSubmit: () => undefined,
                    onStop: () => undefined,
                    renderContext: {
                        readOnly: true,
                        traceDetailsOptions: options.traceDetailsOptions,
                        contextPreview: options.contextPreview,
                        mediaGenerationProgress: options.mediaGenerationProgress,
                    },
                },
            },
        })
    }

    destroy(): void {
        this.editor.destroy()
        this.host.remove()
    }
}

export const mountReadOnlyAiChatThreadProjection = (options: ReadOnlyAiChatThreadRenderOptions): ReadOnlyAiChatThreadRendererInstance =>
    new ReadOnlyAiChatThreadRenderer(options)
