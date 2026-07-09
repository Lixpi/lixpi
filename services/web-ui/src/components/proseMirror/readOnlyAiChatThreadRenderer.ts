import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import type { ProseMirrorJsonNode } from '@lixpi/prosemirror/shared/thread-doc'
import type { ImageGenerationTraceDetailsOptions } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import type { AiUserMessageContextPreviewRenderer } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import { html } from '$src/utils/domTemplates.ts'

export type ReadOnlyAiChatThreadRenderOptions = {
    mount: HTMLElement
    content: ProseMirrorJsonNode
    threadId: string
    className?: string
    traceDetailsOptions?: ImageGenerationTraceDetailsOptions
    contextPreview?: AiUserMessageContextPreviewRenderer
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
            documentType: 'aiChatThread',
            threadId: options.threadId,
            aiChatThreadRenderContext: {
                readOnly: true,
                traceDetailsOptions: options.traceDetailsOptions,
                contextPreview: options.contextPreview,
            },
            onEditorChange: () => {},
            onProjectTitleChange: () => {},
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
