import type {
    Asset,
    AssetDocumentRole,
    CanvasGeometryUpdate,
    LoadingStatus,
    MediaGenerationRequest,
} from '@lixpi/constants'
import type {
    CapabilityArtifactFrontendRegistry,
    CapabilityCatalogClient,
} from '@lixpi/capability-system/frontend'
import type { CapabilityArtifactSharedRegistry } from '@lixpi/capability-system/shared'
import type { LixpiCanvasSettings } from '../settings/index.ts'
import type {
    WorkspaceCanvasEditors,
    WorkspacePromptCatalog,
} from './workspace-canvas-editors.ts'
import type { WorkspaceRightPanelOptions } from './workspace-right-panel.ts'
import type { CanvasConversationRunPorts } from './canvas-conversation-run.ts'
import type { WorkspaceCanvasConversation } from './workspace-canvas-surface.ts'
import type {
    WorkspaceMediaSourcePorts,
    WorkspaceVideoControlsSettings,
} from '../media/index.ts'
import type {
    ContextPreviewEnvironment,
    PromptReferencePreviewRenderer,
} from '../context/index.ts'
import type {
    WorkspaceAssetDetailsPorts,
    WorkspaceOutputReviewPorts,
    WorkspaceGenerationHistoryPorts,
} from '../review/index.ts'
import type { LibraryAssetPorts } from '../library/index.ts'
import type {
    WorkspaceConversationProjectionPorts,
    WorkspaceMediaOperationRecoveryPorts,
    WorkspaceMediaAnalysisPorts,
    CanvasGenerationSubmissionPorts,
} from '../../shared/index.ts'

export type WorkspaceCanvasAppearance = LixpiCanvasSettings & {
    aiChatThread: {
        styles: { nodeBorder: string; nodeBoxShadow: string; panelSectionDividerBorder: string }
        contextPreview: { styles: Readonly<Record<string, string>> }
        panelSwitch: WorkspaceRightPanelOptions['switchSettings']
    }
    rightSidePanel: WorkspaceRightPanelOptions['settings']
    videoControls: WorkspaceVideoControlsSettings
    helpTooltip: { interactiveHideDelayMs: number }
    dropdown: { styles: { popoverBoxShadow: string } }
    aiPromptInput: { useShiftingGradientBackground: boolean }
    gradient: { styles: { shiftingColors: string[] } }
}

export type WorkspaceCanvasAssetPorts = {
    read: (assetId: string) => Asset | undefined
    upsert: (asset: Asset) => void
    subscribe: (changed: (snapshot: { items: ReadonlyMap<string, Asset> }) => void) => () => void
    readDocument: (assetId: string, role: AssetDocumentRole) => { doc: object; version: number } | undefined
    create: (request: Parameters<CanvasGenerationSubmissionPorts['createConversation']>[0] & { primaryCategory: 'conversation' }) => Promise<Asset>
    get: (assetId: string, workspaceId?: string) => Promise<Asset | { error: string }>
    refresh: (assetId: string, workspaceId?: string) => Promise<Asset | { error: string }>
    loadWorkspaceAssets: (workspaceId: string) => Promise<Asset[]>
    ensureAssetsLoaded: (assetIds: readonly string[]) => Promise<Asset[]>
    updateMetadata: WorkspaceAssetDetailsPorts['updateMetadata']
    changeScope: WorkspaceAssetDetailsPorts['changeScope']
    attestSubjectIdentity: WorkspaceAssetDetailsPorts['attestSubjectIdentity']
    reviewGeneratedOutput: WorkspaceOutputReviewPorts['review']
    list: LibraryAssetPorts['list']
    resumeDocument: LibraryAssetPorts['resumeDocument']
    detach: (request: { assetId: string; referenceType: 'catalog' }) => Promise<unknown>
}

export type WorkspaceCanvasModelEntry = {
    provider?: string
    model?: string
    title?: string
    shortTitle?: string
    iconName?: string
    color?: string
}

type GenerationRequestCoordinate = { generationRequestId: string; workspaceId: string; requestRevision: number }
export type WorkspaceCanvasGenerationPorts = {
    connect: CanvasConversationRunPorts['connect']
    fetchConversation: WorkspaceConversationProjectionPorts<WorkspaceCanvasConversation>['fetchThread']
    subscribe: WorkspaceMediaOperationRecoveryPorts['subscribe']
    replay: WorkspaceMediaOperationRecoveryPorts['replay']
    get: (request: { workspaceId: string; generationRequestId: string; includeCheckpoint?: boolean }) => Promise<{
        request: MediaGenerationRequest
        liveSubject: string
        checkpoint?: { promptDocument: unknown; selectedReferences: Array<{ assetId: string; nodeId?: string }>; modelSelection: unknown; configuration: unknown }
    }>
    cancel: (request: GenerationRequestCoordinate) => Promise<unknown>
    resolveReference: (request: GenerationRequestCoordinate & { bindingId: string; assetId: string }) => Promise<unknown>
    startVerification: (request: GenerationRequestCoordinate & { generationRun: number; assetId: string }) => Promise<{ verificationUrl: string; expiresAt: number; requestRevision: number }>
    stopConversation: (request: { workspaceId: string; conversationAssetId: string; generationRequestId?: string }) => Promise<{ status: 'stopped'; generationRequestId?: string; canvasGeometry?: CanvasGeometryUpdate }>
    describeMedia: WorkspaceMediaAnalysisPorts['describe']
}

export type WorkspaceCanvasHost = {
    createId: () => string
    openExternalUrl: (url: string) => void
    onOpenCapabilityLibrary?: (callback: (workspaceId?: string) => void) => () => void
    settings: WorkspaceCanvasAppearance
    editors: WorkspaceCanvasEditors
    assets: WorkspaceCanvasAssetPorts
    generation: WorkspaceCanvasGenerationPorts
    workspace: {
        organizationId: () => string
        userId: () => string
        loadingStatus: () => LoadingStatus
        subscribe: (changed: (snapshot: { loadingStatus: LoadingStatus; error?: unknown }) => void) => () => void
        reload: (workspaceId: string) => Promise<unknown>
    }
    models: {
        read: () => readonly WorkspaceCanvasModelEntry[]
        subscribe: (changed: () => void) => () => void
        modelIcon: (name: string | null | undefined) => string | null
        providerIcon: (name: string | null | undefined) => string | null
        createBadge: (options: { modelId?: string | null; modelProvider?: string | null; iconOnly?: boolean; monochromeIcon?: boolean }) => HTMLElement | null
        styleBadge: (element: HTMLElement, options?: { scale?: number }) => void
    }
    capabilities: {
        frontend: Pick<CapabilityArtifactFrontendRegistry, 'get' | 'require'>
        shared: Pick<CapabilityArtifactSharedRegistry, 'get' | 'require'>
        ensureStyles: (document: Document) => void
        catalog: (workspaceId: string, organizationId: string) => Pick<CapabilityCatalogClient, 'list' | 'get' | 'invalidate'>
        promptCatalog: (workspaceId: string, organizationId: string) => WorkspacePromptCatalog
    }
    media: {
        sources: WorkspaceMediaSourcePorts
        renditionPath: (assetId: string, rendition: string) => string
        prepareRenditionUrls: () => Promise<(assetId: string, rendition: string) => string>
        download: (request: { assetId: string; rendition: string; attachment: boolean; document: Document; signal: AbortSignal }) => Promise<void>
        uploadReplacement: (request: { workspaceId: string; file: File; signal: AbortSignal; isCurrent: () => boolean }) => Promise<{ assetId?: string; kind?: string } | null>
    }
    contextEnvironment: (sources: Pick<ContextPreviewEnvironment, 'document' | 'getDocuments' | 'getThreads' | 'getAsset'>) => ContextPreviewEnvironment
    extractText: (content: unknown) => string
    traceDetail: (options: { previewRenderer: PromptReferencePreviewRenderer; inlinePopover?: boolean; preferredPlacement?: 'top' | 'bottom' | 'left' | 'right' }) => WorkspaceGenerationHistoryPorts['progressDetails']
    storage: Pick<Storage, 'getItem' | 'setItem'>
    debugEnabled: () => boolean
}
