import {
    type Asset,
    type AssetDocumentRole,
    type CanvasCollaborationChanges,
    type CanvasCollaborationLease,
    type CanvasCollaborationPresence,
    type CanvasCollaborationSnapshot,
    type CanvasNode,
    type CanvasNodeDimensions,
    type CanvasNodePosition,
    type CanvasState,
    type CanvasViewport,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    type HeadlessProseMirrorEngine,
} from '@lixpi/prosemirror/backend/headless-engine'
import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'

export type CanvasAgentDocumentRole = Extract<AssetDocumentRole, 'content' | 'capabilityArtifact'>

export type CanvasAgentDocument = {
    version: number
    doc: object
}

export type CanvasAgentDocumentEdit =
    | { stepJson: string }
    | {
        text: string
        from: number
        to: number
    }
    | { contentJson: string }

export type CanvasAgentPreparedStep = {
    step: object
    before: object
    after: object
}

export type CanvasAgentAsset = Pick<Asset, 'assetId' | 'title' | 'revision' | 'documents' | 'artifact' | 'media'>

type CanvasAgentPlacementMutation = {
    node: CanvasNode
    state: CanvasState
    revision: number
    leases: CanvasCollaborationLease[]
}

export type CanvasAgentSession = {
    requestId: string
    importPublicMedia: (url: string) => Promise<{ assetId: string }>
    signal: AbortSignal
    inspect: () => Promise<CanvasCollaborationSnapshot>
    updatePresence: (presence: CanvasCollaborationPresence) => Promise<CanvasCollaborationSnapshot>
    follow: (actorId: string | null) => Promise<CanvasCollaborationSnapshot>
    acquire: (target: string) => Promise<CanvasCollaborationLease>
    release: (lease: CanvasCollaborationLease) => Promise<void>
    commit: (
        revision: number,
        changes: CanvasCollaborationChanges,
        leases: CanvasCollaborationLease[],
    ) => Promise<CanvasCollaborationSnapshot>
    createDocument: (
        mutation: CanvasAgentPlacementMutation,
        title: string,
        doc: object,
    ) => Promise<void>
    resolvePlacement: (
        state: CanvasState,
        node: CanvasNode,
    ) => CanvasNodePosition
    prepareManagedRemoval: (
        state: CanvasState,
        node: CanvasNode,
    ) => Promise<{
        targets: string[]
        execute: (leases: CanvasCollaborationLease[]) => Promise<boolean>
    } | undefined>
    attachAsset: (mutation: CanvasAgentPlacementMutation) => Promise<void>
    detachAsset: (mutation: CanvasAgentPlacementMutation) => Promise<void>
    replaceAsset: (mutation: {
        nodeId: string
        previousAssetId: string
        assetId: string
        revision: number
        leases: CanvasCollaborationLease[]
    }) => Promise<void>
    readAsset: (assetId: string) => Promise<CanvasAgentAsset>
    renameAsset: (
        assetId: string,
        title: string,
        expectedRevision: number,
        lease: CanvasCollaborationLease,
    ) => Promise<CanvasAgentAsset>
    readDocument: (
        assetId: string,
        role: CanvasAgentDocumentRole,
    ) => Promise<CanvasAgentDocument>
    editDocument: (
        assetId: string,
        role: CanvasAgentDocumentRole,
        expectedVersion: number,
        prepare: (engine: HeadlessProseMirrorEngine) => CanvasAgentPreparedStep | undefined,
        lease: CanvasCollaborationLease,
    ) => Promise<CanvasAgentDocument>
}

export type CanvasAgentAccess = (context: CapabilityActionAuthorizationContext) => Promise<CanvasAgentSession>

export type CanvasNodePatch = {
    nodeId: string
    position?: CanvasNodePosition
    offset?: CanvasNodePosition
    dimensions?: CanvasNodeDimensions
    parentId?: string | null
}

export type CanvasConnectionEdit = {
    action: 'connect' | 'update' | 'disconnect'
    edgeId?: string
    sourceNodeId?: string
    targetNodeId?: string
    sourceHandle?: string
    targetHandle?: string
    sourceT?: number
    targetT?: number
    pathType?: WorkspaceEdge['pathType']
}

export type CanvasCameraEdit = {
    center?: CanvasNodePosition
    offset?: CanvasNodePosition
    zoom?: CanvasViewport['zoom']
    focusNodeId?: string
}

export type CanvasPlacement = {
    position?: CanvasNodePosition
    dimensions?: CanvasNodeDimensions
    parentId?: string
    avoidOverlap?: boolean
}
