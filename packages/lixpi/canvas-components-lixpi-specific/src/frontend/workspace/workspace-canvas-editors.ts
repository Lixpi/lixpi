import {
    type CapabilityModuleMeta,
    type CapabilityPromptReference,
    type PromptReferenceCatalogPage,
    type PromptReferenceCategory,
    type CanvasNode,
} from '@lixpi/constants'
import {
    type AiPromptComposerConfig,
} from '../composer/index.ts'
import {
    type ContextPreviewEnvironment,
    type PromptReferencePreviewRenderer,
} from '../context/index.ts'
import {
    type WorkspaceDocumentEditorOptions,
    type WorkspaceCapabilityEditorOptions,
    type WorkspaceCapabilityNodePorts,
} from '../nodes/index.ts'
import {
    type WorkspaceAssetDetailsPorts,
    type WorkspaceHistoryEditorRequest,
} from '../review/index.ts'
import {
    type CanvasConversationRunPorts,
} from './canvas-conversation-run.ts'

export type WorkspacePromptCatalog = {
    list: (query: {
        category: PromptReferenceCategory
        query?: string
        cursor?: string
        limit?: number
    }) => Promise<PromptReferenceCatalogPage>
    listModules: (query?: string) => Promise<CapabilityModuleMeta[]>
    getModule: (moduleId: string) => Promise<{
        meta: CapabilityModuleMeta
        entry: CapabilityPromptReference
    }>
}

export type WorkspaceContextPreview = {
    getNodeById: (nodeId: string) => CanvasNode | undefined
    environment: ContextPreviewEnvironment
    inlinePopover?: boolean
}

export type WorkspaceConversationEditorIntegration = {
    createContextTray: () => HTMLDivElement
    promptReferencePreviewRenderer: PromptReferencePreviewRenderer
    contextPreview: WorkspaceContextPreview
}

export type WorkspacePromptEditorIntegration = {
    mountMediaModeSwitch: (element: HTMLElement) => void
    mountModelMenuControl: (element: HTMLElement) => void
    promptReferenceCatalog: WorkspacePromptCatalog
    promptReferencePreviewRenderer: PromptReferencePreviewRenderer
}

export type WorkspaceCanvasEditors = {
    createConversation: (integration: WorkspaceConversationEditorIntegration) => CanvasConversationRunPorts['mountEditor']
    createPrompt: (integration: WorkspacePromptEditorIntegration) => AiPromptComposerConfig['mountEditor']
    mountAsset: WorkspaceAssetDetailsPorts['mountEditor']
    mountDocument: (
        request: WorkspaceDocumentEditorOptions & {
            workspaceId: string
            onChange: (content: object) => void
            createContextTray: () => HTMLDivElement
        },
    ) => { destroy: () => void }
    mountCapability: (
        request: WorkspaceCapabilityEditorOptions & {
            workspaceId: string
            promptReferenceCatalog: WorkspacePromptCatalog
            promptReferencePreviewRenderer: PromptReferencePreviewRenderer
        },
    ) => ReturnType<WorkspaceCapabilityNodePorts['mountEditor']>
    mountHistory: (
        request:
            & Pick<WorkspaceHistoryEditorRequest, 'mount' | 'content' | 'threadId'>
            & Partial<Omit<WorkspaceHistoryEditorRequest, 'mount' | 'content' | 'threadId'>>
            & {
                documentType?: 'assetConversation' | 'assetProvenance'
                contextPreview: WorkspaceContextPreview
                promptReferencePreviewRenderer: PromptReferencePreviewRenderer
            },
    ) => { destroy: () => void }
}
