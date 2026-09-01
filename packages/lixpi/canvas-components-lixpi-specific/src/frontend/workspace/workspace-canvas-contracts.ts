import {
    type CanvasPanZoomConfig,
} from '@lixpi/canvas-engine/frontend/viewport'
import {
    type ViewportSnapshot as Viewport,
} from '@lixpi/canvas-engine/shared'
import {
    type AudioCanvasNode,
    type CanvasState,
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
    onCanvasStateChange?: (state: CanvasState) => void
    onAuthoritativeCanvasStateChange?: (params: { canvasState: CanvasState; layoutRevision: number }) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; content: any }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
    onAssetDetach?: (params: {
        assetId: string
        nodeId: string
        removedNodeIds: string[]
        canvasState: CanvasState
    }) => Promise<CanvasState>
    onAssetAttach?: (params: { assetId: string; nodeId: string; canvasState: CanvasState }) => Promise<CanvasState>
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
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    mediaModeSwitchMountEl: HTMLDivElement
    modelMenuControlMountEl: HTMLDivElement
    glassTargets?: readonly { id: string; element: HTMLElement }[]
    workspaceId: string
    canvasState: CanvasState | null
    documents: WorkspaceCanvasDocument[]
    aiChatThreads: WorkspaceCanvasConversation[]
    panZoomConfig?: Partial<CanvasPanZoomConfig>
} & WorkspaceCanvasCallbacks
