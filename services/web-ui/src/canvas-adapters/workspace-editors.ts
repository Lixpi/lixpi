import {
    type WorkspaceCanvasEditors,
} from '@lixpi/canvas-components/workspace'
import {
    capabilityArtifactEditorView,
    editorDocumentViews,
    mountEditorDocument,
    mountReadOnlyAiChatThreadProjection,
} from '@lixpi/prosemirror/frontend/editor'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'

import { createDefaultPromptControlFactories } from '$src/editor/prompt-control-factories.ts'
import { createWebUiEditorEnvironment } from '$src/editor/web-ui-editor.ts'
import {
    toEditorContextPreview,
    toEditorPromptReferencePreview,
} from '$src/editor/editor-services.ts'
import {
    type AssetService,
} from '$src/services/asset-service.ts'
import { createCanvasConversationEditorPort } from './conversation-editor.ts'
import { createPromptComposerEditorPort } from './prompt-composer-editor.ts'

export type WorkspaceCanvasEditorsConfig = {
    assetService: AssetService
    auth: AuthClientInstance
}

const documentVersion = (version: unknown): number => (typeof version === 'number'
    && Number.isInteger(version)
    && version >= 0
    ? version
    : 0)

export const createWorkspaceCanvasEditors = ({
    assetService,
    auth,
}: WorkspaceCanvasEditorsConfig): WorkspaceCanvasEditors => {
    const environment = createWebUiEditorEnvironment(assetService, auth)

    return {
        createConversation: integration =>
            createCanvasConversationEditorPort({
                environment,
                promptReferencePreviewRenderer: integration.promptReferencePreviewRenderer,
                aiChatThreadRenderContext: { contextPreview: toEditorContextPreview(integration.contextPreview) },
            }),
        createPrompt: integration =>
            createPromptComposerEditorPort({
                environment,
                submitOnEnter: integration.submitOnEnter,
                controlFactories: {
                    ...createDefaultPromptControlFactories(),
                    mountMediaModeSwitch: integration.mountMediaModeSwitch,
                    mountModelMenuControl: integration.mountModelMenuControl,
                },
                promptReferenceCatalog: integration.promptReferenceCatalog,
                promptReferencePreviewRenderer: integration.promptReferencePreviewRenderer,
            }),
        mountAsset: request => mountEditorDocument({
            registry: environment.registry,
            definition: editorDocumentViews[request.documentType]!,
            container: request.host,
            document: request.content,
            onChange: request.onChange as (content: object) => void,
            authority: request.authority
                ? {
                    ...request.authority,
                    transport: environment.authorityTransport,
                }
                : undefined,
            context: {
                services: environment.services,
                promptReferences: {},
            },
        }),
        mountDocument: ({
            node,
            document,
            container,
            signal,
            onLeaseStateChange,
            workspaceId,
            onChange,
        }) => mountEditorDocument({
            registry: environment.registry,
            definition: editorDocumentViews.assetContent!,
            container,
            document: document.content,
            authority: {
                transport: environment.authorityTransport,
                organizationId: document.organizationId,
                workspaceId,
                assetId: node.assetId,
                role: 'content',
                baseVersion: documentVersion(document.proseMirrorVersion),
                onLeaseStateChange,
            },
            onChange: value => {
                if (!signal.aborted)
                    onChange(value)
            },
            context: {
                services: environment.services,
                promptReferences: {},
            },
        }),
        mountCapability: ({
            container,
            document,
            documentView,
            node,
            asset,
            version,
            signal,
            onLeaseStateChange,
            onContentChange,
            workspaceId,
            promptReferenceCatalog,
            promptReferencePreviewRenderer,
        }) => {
            const editor = mountEditorDocument({
                registry: environment.registry,
                definition: capabilityArtifactEditorView(documentView),
                container,
                document,
                authority: {
                    transport: environment.authorityTransport,
                    organizationId: asset.organizationId,
                    workspaceId,
                    assetId: node.assetId,
                    role: 'capabilityArtifact',
                    baseVersion: version,
                    onLeaseStateChange,
                },
                onChange: () =>
                    queueMicrotask(() => {
                        if (!signal.aborted)
                            onContentChange()
                    }),
                context: {
                    services: environment.services,
                    promptReferences: {
                        catalog: promptReferenceCatalog,
                        previewRenderer: toEditorPromptReferencePreview(promptReferencePreviewRenderer),
                    },
                },
            })

            return {
                updateDocument: value => editor.replaceDocument(value),
                destroy: () => editor.destroy(),
            }
        },
        mountHistory: request => mountReadOnlyAiChatThreadProjection({
            ...request,
            contextPreview: toEditorContextPreview(request.contextPreview),
            promptReferencePreviewRenderer: toEditorPromptReferencePreview(request.promptReferencePreviewRenderer),
            registry: environment.registry,
            services: environment.services,
        }),
    }
}
