import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror/shared/model-selection-attrs'
import {
    type AiInteractionMediaGenerationRequest,
    type CanvasNode,
    type CanvasState,
    type OperationStatusCanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    OperationStatusNode,
    type WorkspaceNodeShells,
} from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import {
    type MediaGenerationOperationRecoveryResult,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspacePromptComposer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/composer'

export type WorkspaceOperationStatusNodesPorts = {
    host: WorkspaceCanvasHost
    shells: WorkspaceNodeShells
    getWorkspaceId: () => string
    getState: () => CanvasState | null
    replaceState: (state: CanvasState) => void
    captureAdmission: () => () => boolean
    commit: (state: CanvasState) => void
    commitTransient: (state: CanvasState) => void
    removeSelection: (nodeId: string) => void
    rebalance: (nodes: CanvasNode[], edges: WorkspaceEdge[]) => CanvasNode[]
    removeNodes: (nodeIds: Iterable<string>) => void
    pruneTrackers: (nodeIds: Iterable<string>) => void
    clearTransientImage: (nodeId: string) => void
    syncNode: (node: OperationStatusCanvasNode) => void
    syncGeometry: (nodes: CanvasNode[]) => void
    syncMedia: (state: CanvasState) => void
    syncChrome: () => void
    syncMarkers: () => void
    syncConnections: () => void
    syncProgress: (state: CanvasState) => void
    ensureRecovery: (node: OperationStatusCanvasNode) => void
    addContext: (nodeIds: Iterable<string>) => void
    getComposer: () => WorkspacePromptComposer | null
}

export class WorkspaceOperationStatusNodes {
    constructor(private readonly ports: WorkspaceOperationStatusNodesPorts) {}

    create = (node: OperationStatusCanvasNode): HTMLElement => {
        this.ports.ensureRecovery(node)
        return new OperationStatusNode(node, this.ports.shells, {
            verify: async (operation, signal) => {
                const current = this.ports.captureAdmission()
                if (signal.aborted || !current()) return
                const session = await this.ports.host.generation.startVerification({
                    generationRequestId: operation.generationRequestId!,
                    workspaceId: this.ports.getWorkspaceId(),
                    requestRevision: operation.requestRevision!,
                    generationRun: operation.generationRun!,
                    assetId: operation.verificationAssetId!,
                })
                if (!signal.aborted && current()) this.ports.host.openExternalUrl(session.verificationUrl)
            },
            cancel: async (operation, signal) => {
                const current = this.ports.captureAdmission()
                if (signal.aborted || !current()) return
                await this.ports.host.generation.cancel({
                    generationRequestId: operation.generationRequestId!,
                    workspaceId: this.ports.getWorkspaceId(),
                    requestRevision: operation.requestRevision!,
                })
                if (!signal.aborted && current()) this.remove(operation.nodeId, 'media-generation')
            },
            edit: this.edit,
            dismissUpload: operation => this.remove(operation.nodeId, operation.operation),
        }).element
    }

    remove = (nodeId: string, operation?: OperationStatusCanvasNode['operation']): CanvasState | null => {
        const state = this.ports.getState()
        if (!state) return null
        const exists = state.nodes.some(candidate => (
            candidate.type === 'operationStatus'
            && (!operation || candidate.operation === operation)
            && candidate.nodeId === nodeId
        ))
        if (!exists) return null

        const nextState = {
            ...state,
            nodes: state.nodes.filter(candidate => candidate.nodeId !== nodeId),
            edges: state.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
        }
        this.ports.commit(nextState)
        this.ports.removeSelection(nodeId)
        return nextState
    }

    applyRecovery = (result: MediaGenerationOperationRecoveryResult): void => {
        const state = this.ports.getState()
        if (!result.changed || !state) return
        const replacedGeneratedMediaNodeIds = result.updatedNodeIds.filter(nodeId => {
            const previousNode = state.nodes.find(node => node.nodeId === nodeId)
            const updatedNode = result.state.nodes.find(node => node.nodeId === nodeId)
            return (previousNode?.type === 'image' || previousNode?.type === 'video')
                && updatedNode?.type === 'operationStatus'
        })
        const nodes = result.removedNodeIds.length > 0 || replacedGeneratedMediaNodeIds.length > 0
            ? this.ports.rebalance(result.state.nodes, result.state.edges)
            : result.state.nodes
        const changedGeometryNodeIds = nodes.flatMap(node => {
            const previous = result.state.nodes.find(candidate => candidate.nodeId === node.nodeId)
            return previous
                    && previous.position.x === node.position.x
                    && previous.position.y === node.position.y
                    && previous.dimensions.width === node.dimensions.width
                    && previous.dimensions.height === node.dimensions.height
                ? []
                : [node.nodeId]
        })
        this.ports.commitTransient({ ...result.state, nodes })
        this.ports.removeNodes(result.removedNodeIds)
        this.ports.pruneTrackers([...result.removedNodeIds, ...replacedGeneratedMediaNodeIds])

        for (const nodeId of result.removedNodeIds) {
            this.ports.clearTransientImage(nodeId)
            this.ports.removeSelection(nodeId)
        }
        const currentState = this.ports.getState()
        if (!currentState) return
        for (const nodeId of result.updatedNodeIds) {
            const updatedNode = currentState.nodes.find(candidate => candidate.nodeId === nodeId)
            if (updatedNode?.type === 'operationStatus') this.ports.syncNode(updatedNode)
        }
        if (changedGeometryNodeIds.length > 0) {
            this.ports.syncGeometry(currentState.nodes.filter(node => changedGeometryNodeIds.includes(node.nodeId)))
        }
        this.ports.syncMedia(currentState)
        this.ports.syncChrome()
        this.ports.syncMarkers()
        this.ports.syncConnections()
    }

    applyProgress = (result: MediaGenerationOperationRecoveryResult): void => {
        if (!result.changed || !this.ports.getState()) return
        this.ports.replaceState(result.state)
        this.ports.syncProgress(result.state)
    }

    private edit = async (node: OperationStatusCanvasNode, signal: AbortSignal): Promise<void> => {
        const current = this.ports.captureAdmission()
        if (signal.aborted || !current()) return
        const response = await this.ports.host.generation.get({
            generationRequestId: node.generationRequestId!,
            workspaceId: this.ports.getWorkspaceId(),
        })
        if (signal.aborted || !current()) return
        if (!response.checkpoint) throw new Error('Media request checkpoint is no longer available.')
        const promptDocument = response.checkpoint.promptDocument as { content?: unknown[] }
        const selection = response.checkpoint.modelSelection as { reasoningModelIds?: string[]; mediaModelIds?: string[] }
        const generation = (response.checkpoint.configuration as { generation?: AiInteractionMediaGenerationRequest }).generation
        const state = this.ports.getState()
        const restoredContextNodeIds = response.checkpoint.selectedReferences.flatMap(reference => {
            const explicitNode = reference.nodeId
                ? state?.nodes.find(candidate => candidate.nodeId === reference.nodeId)
                : undefined
            const assetNode = state?.nodes.find(candidate => 'assetId' in candidate && candidate.assetId === reference.assetId)
            const nodeId = explicitNode?.nodeId ?? assetNode?.nodeId
            return nodeId ? [nodeId] : []
        })
        this.ports.addContext(restoredContextNodeIds)
        const imageModelIds = generation?.imageModelIds ?? selection.mediaModelIds?.filter(modelId => !modelId.toLocaleLowerCase().includes('video')) ?? []
        const videoModelIds = generation?.videoModelIds ?? selection.mediaModelIds?.filter(modelId => modelId.toLocaleLowerCase().includes('video')) ?? []
        this.ports.getComposer()?.input.restoreContent({
            type: 'doc',
            content: [{
                type: 'aiPromptInput',
                attrs: {
                    mediaGenerationMode: generation?.mediaGenerationMode ?? (generation?.outputMediaTypes?.includes('video') ? 'video' : 'image'),
                    aiReasoningModels: serializeAiModelSelectionAttr(selection.reasoningModelIds ?? []),
                    reasoningGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(generation?.reasoningOptions?.configGroups ?? []),
                    useMultipleReasoningModels: (selection.reasoningModelIds?.length ?? 0) > 1,
                    useMultipleImageModels: imageModelIds.length > 1,
                    useMultipleVideoModels: videoModelIds.length > 1,
                    aiImageModels: serializeAiModelSelectionAttr(imageModelIds),
                    imageGenerationSize: generation?.imageOptions?.imageSize ?? 'auto',
                    imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(generation?.imageOptions?.configGroups ?? []),
                    aiVideoModels: serializeAiModelSelectionAttr(videoModelIds),
                    videoAspectRatio: generation?.videoOptions?.aspectRatio ?? '',
                    videoResolution: generation?.videoOptions?.resolution ?? '',
                    videoDuration: generation?.videoOptions?.duration ?? '',
                    videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(generation?.videoOptions?.configGroups ?? []),
                    capabilityInputs: '',
                },
                content: promptDocument.content ?? [{ type: 'paragraph' }],
            }],
        })
    }
}
