import {
    type EditorView,
} from 'prosemirror-view'
import {
    type CanvasConversationEditor,
    type CanvasConversationEditorMount,
    type CanvasConversationRunPorts,
    type CanvasConversationTransport,
    type CanvasGenerationRequest,
    type WorkspaceConversationOutputPorts,
} from '@lixpi/canvas-components/workspace'
import {
    type ConversationOperationSummary,
} from '@lixpi/constants'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import {
    CapabilityChatRunProgressController,
    editorDocumentViews,
    mountEditorDocument,
    USE_AI_CHAT_META,
    type AiChatThreadRenderContext,
} from '@lixpi/prosemirror/frontend/editor'
import {
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components/workspace/context'
import {
    type DocumentEditorHandle,
} from '@lixpi/prosemirror/frontend/document-editor'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import {
    type WebUiEditorEnvironment,
} from '$src/editor/web-ui-editor.ts'
import { toEditorPromptReferencePreview } from '$src/editor/editor-services.ts'

export type CanvasConversationEditorIntegration = {
    environment: WebUiEditorEnvironment
    aiChatThreadRenderContext?: AiChatThreadRenderContext
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
    register?: (
        threadId: string,
        view: EditorView,
    ) => () => void
}

class CanvasConversationEditorAdapter implements CanvasConversationEditor {
    private readonly editor: DocumentEditorHandle
    private readonly progress: CapabilityChatRunProgressController
    private unregister: (() => void) | null = null
    private destroyed = false

    constructor(
        private readonly request: CanvasConversationEditorMount,
        private readonly integration: CanvasConversationEditorIntegration,
    ) {
        const version = request.thread.proseMirrorVersion
        const { environment } = integration
        this.progress = new CapabilityChatRunProgressController(
            environment.services.createCapabilityRunProgress,
            toEditorPromptReferencePreview(integration.promptReferencePreviewRenderer),
        )
        this.editor = mountEditorDocument({
            registry: environment.registry,
            definition: editorDocumentViews.assetConversation!,
            container: request.container,
            document: request.thread.content,
            readOnly: request.readOnly,
            authority: {
                transport: environment.authorityTransport,
                organizationId: request.thread.organizationId,
                workspaceId: request.workspaceId,
                assetId: request.thread.threadId,
                role: 'conversation',
                baseVersion: typeof version === 'number'
                    && Number.isInteger(version)
                    && version >= 0
                    ? version
                    : 0,
                receiveOnly: true,
            },
            onChange: request.onChange,
            onLiveChange: content => {
                if (this.editor)
                    this.progress.sync(this.editor.view)

                request.onStreaming(content)
            },
            onInvalidDocument: error => console.warn('Invalid conversation content; showing an empty thread:', error),
            context: {
                services: environment.services,
                promptReferences: { previewRenderer: toEditorPromptReferencePreview(integration.promptReferencePreviewRenderer) },
                chat: {
                    threadId: request.thread.threadId,
                    // The chat thread's submission is the canvas run's request
                    // under the thread plugin's own type.
                    onSubmit: data => request.onSubmit(data as unknown as Parameters<typeof request.onSubmit>[0]),
                    onStop: request.onStop,
                    onStreamEvent: request.onSegment,
                    onReceivingStateChange: request.onReceiving,
                    renderContext: {
                        ...integration.aiChatThreadRenderContext,
                        readOnly: request.readOnly,
                    },
                },
            },
        })
    }

    activate(): void {
        if (
            this.destroyed
            || this.unregister
            || !this.integration.register
        )
            return

        try {
            const unregister = this.integration.register(this.request.thread.threadId, this.editor.view)

            if (this.destroyed)
                unregister()
            else
                this.unregister = unregister
        } catch (error) {
            try {
                this.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Canvas editor registration failed')
            }

            throw error
        }
    }

    readContent(): object | undefined {
        return this.destroyed ? undefined : this.editor.view.state.doc.toJSON()
    }

    readDocumentVersion(): number | undefined {
        return this.destroyed ? undefined : this.editor.authority?.version
    }

    async recoverAuthority(): Promise<void> {
        if (!this.destroyed)
            await this.editor.authority?.recover()
    }

    submitPersisted(): void {
        if (
            this.destroyed
            || this.request.readOnly
        )
            return

        const view = this.editor.view

        if (!view)
            return

        const threadId = this.request.thread.threadId
        let nodePos: number | undefined
        view.state.doc.descendants((node, pos) => {
            if (
                node.type.name === 'aiChatThread'
                && node.attrs.threadId === threadId
            ) {
                nodePos = pos

                return false
            }

            return true
        })

        if (nodePos !== undefined)
            view.dispatch(
                view.state.tr.setMeta(
                    USE_AI_CHAT_META,
                    {
                        threadId,
                        nodePos,
                    },
                ),
            )
    }

    renderOperations(
        operations: ConversationOperationSummary[],
        outputPorts?: WorkspaceConversationOutputPorts,
    ): void {
        if (!this.destroyed)
            this.progress.renderOperations(
                this.editor.view,
                operations,
                outputPorts,
            )
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        const errors: unknown[] = []

        try {
            this.unregister?.()
        } catch (error) {
            errors.push(error)
        }

        try {
            this.progress.destroy()
            this.editor.destroy()
        } catch (error) {
            errors.push(error)
        }

        if (errors.length)
            throw new AggregateError(errors, 'Canvas conversation editor cleanup failed')
    }
}

class CanvasConversationTransportAdapter implements CanvasConversationTransport {
    private readonly service: AiInteractionService

    constructor(
        auth: AuthClientInstance,
        options: Parameters<CanvasConversationRunPorts['connect']>[0],
    ) {
        this.service = new AiInteractionService({
            auth,
            workspaceId: options.workspaceId,
            organizationId: options.thread.organizationId,
            conversationAssetId: options.thread.threadId,
            onError: options.onError,
            userStore: auth.userStore,
        })
    }

    async send(request: CanvasGenerationRequest): Promise<void> {
        await this.service.sendChatMessage(request)
    }
    async stop(): Promise<void> {
        await this.service.stopChatMessage()
    }
    disconnect(): void {
        this.service.disconnect()
    }
}

export const createCanvasConversationEditorPort = (integration: CanvasConversationEditorIntegration): CanvasConversationRunPorts['mountEditor'] =>
    request => new CanvasConversationEditorAdapter(request, integration)

export const createCanvasConversationTransport = (
    auth: AuthClientInstance,
    options: Parameters<CanvasConversationRunPorts['connect']>[0],
): CanvasConversationTransport => new CanvasConversationTransportAdapter(auth, options)
