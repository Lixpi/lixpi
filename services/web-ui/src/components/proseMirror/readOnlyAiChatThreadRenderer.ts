import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type ImageGenerationTraceDetailsOptions,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import {
    type AiUserMessageContextPreviewRenderer,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import {
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    type AiMediaGenerationProgressRenderer,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiMediaGenerationProgressNode.ts'
import { html } from '@lixpi/ui-primitives/dom'

export type ReadOnlyAiChatThreadRenderOptions = {
    mount: HTMLElement
    content: ProseMirrorJsonNode
    threadId: string
    documentType?: 'assetConversation' | 'assetProvenance'
    className?: string
    traceDetailsOptions?: ImageGenerationTraceDetailsOptions
    contextPreview?: AiUserMessageContextPreviewRenderer
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
    mediaGenerationProgress?: AiMediaGenerationProgressRenderer
}

export type ReadOnlyAiChatThreadRendererInstance = {
    editor: ProseMirrorEditor
    destroy: () => void
}

class ReadOnlyAiChatThreadRenderer implements ReadOnlyAiChatThreadRendererInstance {
    readonly editor: ProseMirrorEditor

    private readonly host: HTMLElement

    constructor(private readonly options: ReadOnlyAiChatThreadRenderOptions) {
        const className = [
            'ai-chat-thread-node-editor',
            'read-only-ai-chat-thread-projection',
            options.className,
        ].filter(Boolean).join(' ')
        this.host = html`<div className=${className}></div>` as HTMLElement
        options.mount.appendChild(this.host)

        this.editor = new ProseMirrorEditor({
            editorMountElement: this.host,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: options.content,
            isDisabled: false,
            readOnly: true,
            documentType: options.documentType ?? 'assetProvenance',
            threadId: options.threadId,
            aiChatThreadRenderContext: {
                readOnly: true,
                traceDetailsOptions: options.traceDetailsOptions,
                contextPreview: options.contextPreview,
                mediaGenerationProgress: options.mediaGenerationProgress,
            },
            promptReferencePreviewRenderer: options.promptReferencePreviewRenderer,
            onEditorChange: () => {},
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
        })
    }

    destroy(): void {
        this.editor.destroy()
        this.host.remove()
    }
}

export function mountReadOnlyAiChatThreadProjection(
    options: ReadOnlyAiChatThreadRenderOptions,
): ReadOnlyAiChatThreadRendererInstance {
    return new ReadOnlyAiChatThreadRenderer(options)
}
