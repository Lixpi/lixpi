import {
    type CanvasPanZoomConfig,
} from '@lixpi/canvas-engine/frontend/viewport'
import {
    type CanvasScrollCapture,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasFitOptions,
    type ViewportSnapshot as Viewport,
} from '@lixpi/canvas-engine/shared'
import {
    type AudioCanvasNode,
    type CanvasCollaborationPresence,
    type CanvasState,
    type ConversationFileUploadCoordinate,
    type CapabilityArtifactCanvasNode,
    type DocumentCanvasNode,
    type DocumentMediaCanvasNode,
    type ImageCanvasNode,
    type OperationStatusCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    type WorkspaceCanvasConversation,
    type WorkspaceCanvasDocument,
} from './workspace-canvas-surface.ts'

export type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export type BranchMarkerDimensionOptions = {
    responseLine?: boolean
    responseText?: string
}

export type DragStartOptions = {
    onClick?: () => void
    suppressPaneClick?: boolean
    allowSelection?: boolean
}

export type WorkspaceCanvasCallbacks = {
    onViewportChange?: (viewport: Viewport) => void
    onPresenceChange?: (presence: CanvasCollaborationPresence) => void
    onConnectionDraft?: (connector: CanvasCollaborationPresence['connector']) => void
    onComposerPresence?: (draft: CanvasCollaborationPresence['composer']) => void
    onPlaybackPresence?: (
        playback: CanvasCollaborationPresence['playback'],
        terminal: boolean,
    ) => void
    onGeometryPreview?: (geometry: NonNullable<CanvasCollaborationPresence['geometry']>) => void
    onGeometryFinish?: (
        nodeIds: readonly string[],
        committed: boolean,
    ) => void
    onCanvasStateChange?: (state: CanvasState) => void
    onAuthoritativeCanvasStateChange?: (params: {
        canvasState: CanvasState
        layoutRevision: number
    }) => void
    onDocumentContentChange?: (params: {
        documentId: string
        title?: string
        content: any
    }) => void
    onAiChatThreadContentChange?: (params: {
        workspaceId: string
        threadId: string
        content: any
    }) => void
    onAssetDetach?: (params: {
        assetId: string
        nodeId: string
        removedNodeIds: string[]
        canvasState: CanvasState
    }) => Promise<CanvasState>
    onAssetAttach?: (params: {
        assetId: string
        nodeId: string
        canvasState: CanvasState
    }) => Promise<CanvasState>
}

export type WorkspaceCanvasNodeInsertion =
    | Omit<DocumentCanvasNode, 'position'>
    | Omit<DocumentMediaCanvasNode, 'position'>
    | Omit<ImageCanvasNode, 'position'>
    | Omit<VideoCanvasNode, 'position'>
    | Omit<AudioCanvasNode, 'position'>
    | Omit<CapabilityArtifactCanvasNode, 'position'>
    | Omit<OperationStatusCanvasNode, 'position'>

export type WorkspaceCanvasInsertionStatePatch = Omit<Partial<CanvasState>, 'nodes' | 'edges' | 'viewport'>

export type WorkspaceCanvasOptions = {
    composer?: boolean
    conversationPanel?: boolean
    uploadConversationFile?: (
        file: File,
        conversationFile: ConversationFileUploadCoordinate,
    ) => Promise<{ assetId: string }>
    sidePanel?: boolean
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    mediaModeSwitchMountEl: HTMLDivElement
    modelMenuControlMountEl: HTMLDivElement
    conversationControls?: {
        left: HTMLElement
        right: HTMLElement
    }
    workspaceId: string
    canvasState: CanvasState | null
    documents: WorkspaceCanvasDocument[]
    aiChatThreads: WorkspaceCanvasConversation[]
    panZoomConfig?: Partial<CanvasPanZoomConfig>
    // The same presentation flags as the engine canvas. Locked content keeps
    // pan, zoom and node content but rejects moving, resizing, connecting,
    // selecting and deleting nodes and connectors.
    locked?: boolean
    autoFit?: boolean
    fit?: CanvasFitOptions
    scrollCapture?: CanvasScrollCapture
} & WorkspaceCanvasCallbacks
