import { keymap } from 'prosemirror-keymap'
import {
    aiChatThreadNodeType,
    DOCUMENT_TYPE,
} from '@lixpi/prosemirror'
import { codeBlockFeature } from '@lixpi/prosemirror/frontend/code-block'
import {
    baseKeymapFeature,
    dropCursorFeature,
    gapCursorFeature,
    historyFeature,
} from '@lixpi/prosemirror/frontend/core-features'
import {
    documentEditableFeature,
    documentFocusFeature,
    documentSyncFeature,
    mountDocumentEditor,
    type DocumentEditorContext,
    type DocumentEditorHandle,
    type MountDocumentEditorOptions,
} from '@lixpi/prosemirror/frontend/document-editor'
import {
    type DocumentViewDefinition,
    type DocumentViewFeature,
} from '@lixpi/prosemirror/frontend/document-view'
import {
    bubbleMenuFeature,
    imageSelectionFeature,
    inputRulesFeature,
    linkTooltipFeature,
    richKeymapFeature,
    type RichEditingContext,
} from '@lixpi/prosemirror/frontend/rich-editing'

import {
    type EditorPromptReferencePreviewRenderer,
} from './editor-host-ports.ts'
import {
    type WorkspacePromptCatalog,
} from './workspace-prompt-catalog.ts'
import {
    createAiChatThreadPlugin,
    type AiChatStreamObserver,
    type AiChatThreadRenderContext,
    type SendAiRequestHandler,
    type StopAiRequestHandler,
} from '../plugins/ai-chat-thread/ai-chat-thread-plugin.ts'
import { insertAiChatThread } from '../plugins/ai-chat-thread/insert-ai-chat-thread.ts'
import {
    createAiPromptInputPlugin,
    type AiPromptInputPluginOptions,
} from '../plugins/ai-prompt-input/ai-prompt-input-plugin.ts'
import {
    richEditingPortsFrom,
    type EditorServices,
} from './editor-services.ts'
import { createPromptReferenceNodeViewPlugin } from '../plugins/prompt-reference/prompt-reference-node-view.ts'
import {
    createAtPromptReferencePickerPlugin,
    createSlashCapabilityModulePickerPlugin,
} from '../plugins/prompt-reference/prompt-reference-picker-plugin.ts'

export type EditorChatOptions = {
    threadId?: string | null
    onSubmit: SendAiRequestHandler
    onStop: StopAiRequestHandler
    onStreamEvent?: AiChatStreamObserver
    onReceivingStateChange?: (
        threadId: string,
        receiving: boolean,
    ) => void
    renderContext?: AiChatThreadRenderContext
}

// The prompt input's model, size, submit and Capability controls, which the
// host builds from its own components.
export type PromptControlFactories = Omit<AiPromptInputPluginOptions, 'services' | 'onSubmit' | 'submitOnEnter' | 'placeholderText'>

export type EditorPromptOptions = {
    onSubmit: AiPromptInputPluginOptions['onSubmit']
    submitOnEnter?: boolean
    controls: PromptControlFactories
    placeholderText?: string
}

export type EditorPromptReferenceOptions = {
    // Without a catalog the `@` and `/` pickers stay off.
    catalog?: WorkspacePromptCatalog
    previewRenderer?: EditorPromptReferencePreviewRenderer
}

// What every editor view reads: the shared session and rich-editing ports,
// the application's services, and the options for the features a kind runs.
export type EditorViewContext = DocumentEditorContext & RichEditingContext & {
    services: EditorServices
    promptReferences: EditorPromptReferenceOptions
    chat?: EditorChatOptions
    prompt?: EditorPromptOptions
}

export const promptReferenceNodeViewFeature: DocumentViewFeature<EditorViewContext> = {
    id: 'prompt-reference-node-view',
    create: ({ context }) => ({
        plugins: [createPromptReferenceNodeViewPlugin(
            context.services.capabilityArtifacts,
            context.services.previews,
            context.promptReferences.previewRenderer,
        )],
    }),
}

export const promptReferencePickerFeature: DocumentViewFeature<EditorViewContext> = {
    id: 'prompt-reference-picker',
    create: ({ context }) => ({
        plugins: context.promptReferences.catalog
            ? [createAtPromptReferencePickerPlugin(context.services, context.promptReferences.catalog)]
            : [],
    }),
}

export const capabilityModulePickerFeature: DocumentViewFeature<EditorViewContext> = {
    id: 'capability-module-picker',
    create: ({ context }) => ({
        plugins: context.promptReferences.catalog
            ? [createSlashCapabilityModulePickerPlugin(context.services, context.promptReferences.catalog)]
            : [],
    }),
}

export const aiChatThreadFeature: DocumentViewFeature<EditorViewContext> = {
    id: 'ai-chat-thread',
    create: ({ context }) => {
        const chat = context.chat

        if (!chat)
            throw new Error('AI_CHAT_THREAD_OPTIONS_REQUIRED')

        return {
            plugins: [
                createAiChatThreadPlugin({
                    services: context.services,
                    sendAiRequestHandler: async request => {
                        // The server reads the thread, so local edits go out first.
                        await context.session.authority?.flushPendingSteps()
                        await chat.onSubmit(request)
                    },
                    stopAiRequestHandler: request => chat.onStop(request),
                    onStreamEvent: chat.onStreamEvent,
                    onReceivingStateChange: chat.onReceivingStateChange,
                    renderContext: {
                        ...chat.renderContext,
                        promptReferencePreviewRenderer: context.promptReferences.previewRenderer,
                    },
                }),
            ],
        }
    },
}

// Mod-Shift-I inserts a new chat thread.
export const aiChatThreadShortcutFeature: DocumentViewFeature<unknown> = {
    id: 'ai-chat-thread-shortcut',
    create: () => ({
        plugins: [
            keymap({
                'Mod-Shift-i': insertAiChatThread,
                'Mod-Shift-I': insertAiChatThread,
            }),
        ],
    }),
}

export const aiPromptInputFeature: DocumentViewFeature<EditorViewContext> = {
    id: 'ai-prompt-input',
    create: ({ context }) => {
        const prompt = context.prompt

        if (!prompt)
            throw new Error('AI_PROMPT_INPUT_OPTIONS_REQUIRED')

        return {
            plugins: [
                createAiPromptInputPlugin({
                    ...prompt.controls,
                    services: context.services,
                    onSubmit: prompt.onSubmit,
                    submitOnEnter: prompt.submitOnEnter,
                    placeholderText: prompt.placeholderText ?? 'Talk to me...',
                }),
            ],
        }
    },
}

const leadingFeatures: DocumentViewFeature<EditorViewContext>[] = [
    documentSyncFeature,
    documentFocusFeature,
    bubbleMenuFeature,
    linkTooltipFeature,
    imageSelectionFeature,
    promptReferenceNodeViewFeature,
    inputRulesFeature,
]

const trailingFeatures: DocumentViewFeature<EditorViewContext>[] = [
    richKeymapFeature,
    baseKeymapFeature,
    dropCursorFeature,
    gapCursorFeature,
    historyFeature,
    codeBlockFeature,
]

const richDocumentView = (kindId: string): DocumentViewDefinition<EditorViewContext> => ({
    kindId,
    features: [...leadingFeatures, ...trailingFeatures, documentEditableFeature],
})

const chatThreadView = (
    kindId: string,
    features: DocumentViewFeature<EditorViewContext>[],
): DocumentViewDefinition<EditorViewContext> => ({
    kindId,
    features,
    // A thread with no stored content starts as one empty thread with the
    // host's thread id.
    createInitialDocument: ({
        schema,
        context,
    }) => schema.nodes.doc!.create(
        null,
        [
            schema.nodes[aiChatThreadNodeType]!.createAndFill({ threadId: context.chat?.threadId ?? null })!,
        ],
    ),
})

// The view of each core document kind, with the features and order each has
// always run.
export const editorDocumentViews: Record<string, DocumentViewDefinition<EditorViewContext>> = {
    [DOCUMENT_TYPE.ASSET_CONTENT]: richDocumentView(DOCUMENT_TYPE.ASSET_CONTENT),
    [DOCUMENT_TYPE.ASSET_TITLE]: richDocumentView(DOCUMENT_TYPE.ASSET_TITLE),
    [DOCUMENT_TYPE.ASSET_METADATA]: richDocumentView(DOCUMENT_TYPE.ASSET_METADATA),
    [DOCUMENT_TYPE.ASSET_CONVERSATION]: chatThreadView(
        DOCUMENT_TYPE.ASSET_CONVERSATION,
        [
            ...leadingFeatures,
            aiChatThreadShortcutFeature,
            ...trailingFeatures,
            aiChatThreadFeature,
            documentEditableFeature,
        ],
    ),
    [DOCUMENT_TYPE.ASSET_PROVENANCE]: chatThreadView(
        DOCUMENT_TYPE.ASSET_PROVENANCE,
        [
            ...leadingFeatures,
            ...trailingFeatures,
            aiChatThreadFeature,
            documentEditableFeature,
        ],
    ),
    [DOCUMENT_TYPE.AI_PROMPT_INPUT]: {
        kindId: DOCUMENT_TYPE.AI_PROMPT_INPUT,
        features: [
            promptReferencePickerFeature,
            capabilityModulePickerFeature,
            aiPromptInputFeature,
            ...leadingFeatures,
            ...trailingFeatures,
            documentEditableFeature,
        ],
    },
}

// Wraps a Capability Artifact's own view in the editor session: sync, focus,
// prompt references and the `@` picker around the module's features.
export const capabilityArtifactEditorView = (artifactView: DocumentViewDefinition<unknown>): DocumentViewDefinition<EditorViewContext> => ({
    kindId: artifactView.kindId,
    features: [
        documentSyncFeature,
        documentFocusFeature,
        promptReferenceNodeViewFeature,
        ...artifactView.features,
        baseKeymapFeature,
        dropCursorFeature,
        gapCursorFeature,
        historyFeature,
        promptReferencePickerFeature,
        documentEditableFeature,
    ],
    ...(artifactView.createInitialDocument
        ? { createInitialDocument: artifactView.createInitialDocument }
        : {}),
})

export type MountEditorDocumentOptions = Omit<MountDocumentEditorOptions<EditorViewContext>, 'context'> & {
    context: Omit<EditorViewContext, 'session' | 'richEditing'>
}

// Mounts an editor view with the application's services. The rich-editing
// ports come from the same services.
export const mountEditorDocument = (options: MountEditorDocumentOptions): DocumentEditorHandle =>
    mountDocumentEditor<EditorViewContext>({
        ...options,
        context: {
            ...options.context,
            richEditing: richEditingPortsFrom(options.context.services),
        },
    })
