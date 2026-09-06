import {
    type CanvasAiChatPanelState,
    type CanvasNode,
    type CanvasState,
    type MediaPromptReference,
} from '@lixpi/constants'
import {
    createMediaPromptReferencePreview,
    WorkspaceContextTrays,
    type CapabilityModulePromiseCache,
    type ContextPreviewEnvironment,
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspacePromptCatalog,
} from './workspace-canvas-editors.ts'
import {
    type WorkspaceCanvasConversation,
    type WorkspaceCanvasDocument,
} from './workspace-canvas-surface.ts'

export type WorkspaceCanvasContextPorts = {
    host: WorkspaceCanvasHost
    document: Document
    window: Window
    capabilityModuleCache: CapabilityModulePromiseCache
    getPromptCatalog: () => WorkspacePromptCatalog
    getDocuments: () => WorkspaceCanvasDocument[]
    getThreads: () => WorkspaceCanvasConversation[]
    getState: () => CanvasState | null
    getPanelState: () => CanvasAiChatPanelState
    persistPanelState: (state: CanvasAiChatPanelState) => void
    applyLocalPanelState: (state: CanvasAiChatPanelState) => void
    findNode: (nodeId: string | undefined) => CanvasNode | undefined
    getPreviewNode: (reference: MediaPromptReference) => CanvasNode | undefined
}

export class WorkspaceCanvasContext {
    private readonly trays: WorkspaceContextTrays

    constructor(private readonly ports: WorkspaceCanvasContextPorts) {
        this.trays = new WorkspaceContextTrays({
            document: ports.document,
            getNode: ports.findNode,
            getContextNodeIds: () => ports.getPanelState().contextChips,
            getEnvironment: this.getPreviewEnvironment,
            onRemove: this.remove,
            requestFrame: callback => ports.window.requestAnimationFrame(callback),
            cancelFrame: frame => ports.window.cancelAnimationFrame(frame),
        })
    }

    getPreviewEnvironment = (): ContextPreviewEnvironment => {
        return this.ports.host.contextEnvironment({
            document: this.ports.document,
            getDocuments: this.ports.getDocuments,
            getThreads: this.ports.getThreads,
            getAsset: assetId => this.ports.host.assets.read(assetId),
        })
    }

    getPromptReferencePreviewRenderer = (options: Pick<PromptReferencePreviewRenderer, 'inlinePopover' | 'preferredPlacement'> = {}): PromptReferencePreviewRenderer => {
        return {
            getNode: this.ports.getPreviewNode,
            environment: this.getPreviewEnvironment(),
            getCapabilityModule: async moduleId => (await this.ports.getPromptCatalog().getModule(moduleId)).meta,
            capabilityModuleCache: this.ports.capabilityModuleCache,
            ...options,
        }
    }

    getExecutionTraceTimelineDetail = () => {
        return this.ports.host.traceDetail({
            previewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }),
            inlinePopover: true,
            preferredPlacement: 'top',
        })
    }

    createArtifactAssetReferenceView = ({
        assetId,
        displayName,
        variant,
    }: {
        assetId: string
        displayName?: string
        variant: 'inline' | 'thumbnail'
    }) => {
        const asset = this.ports.host.assets.read(assetId)
        const mediaKind = asset?.media?.kind

        if (!mediaKind)
            return undefined

        return (
            createMediaPromptReferencePreview(
                {
                    referenceType: 'media',
                    assetId,
                    mediaKind,
                    displayName: asset.title.trim() || displayName?.trim() || assetId,
                },
                this.getPromptReferencePreviewRenderer({ inlinePopover: true }),
                {
                    variant,
                    preferredPlacement: 'top',
                },
            ) ?? undefined
        )
    }

    getAiUserMessagePreviewRenderer = (options: { inlinePopover?: boolean } = {}) => {
        return {
            getNodeById: this.ports.findNode,
            environment: this.getPreviewEnvironment(),
            inlinePopover: options.inlinePopover,
        }
    }

    createTray = (scope: 'chat' | 'canvas'): HTMLDivElement => this.trays.create(scope)

    releaseTray = (element: HTMLDivElement): void => void this.trays.release(element)

    add = (nodeIds: Iterable<string>): void => {
        const state = this.ports.getState()

        if (!state)
            return

        const eligibleNodeIds = new Set(
            state.nodes.filter(
                node => (
                        node.type === 'image'
                        || node.type === 'video'
                        || node.type === 'document'
                        || node.type === 'capabilityArtifact'
                    ),
            ).map(node => node.nodeId),
        )
        const panelState = this.ports.getPanelState()
        const chipNodeIds = new Set(panelState.contextChips)
        const nextChips = [...panelState.contextChips]

        for (const nodeId of nodeIds) {
            if (
                !nodeId
                || chipNodeIds.has(nodeId)
                || !eligibleNodeIds.has(nodeId)
            )
                continue

            chipNodeIds.add(nodeId)
            nextChips.push(nodeId)
        }

        if (nextChips.length === panelState.contextChips.length)
            return

        this.ports.persistPanelState({
            ...panelState,
            contextChips: nextChips,
        })
        this.refresh()
    }

    remove = (nodeId: string): void => {
        const panelState = this.ports.getPanelState()

        if (!panelState.contextChips.includes(nodeId))
            return

        this.ports.persistPanelState({
            ...panelState,
            contextChips: panelState.contextChips.filter(id => id !== nodeId),
        })
        this.refresh()
    }

    clear = (): void => {
        const panelState = this.ports.getPanelState()

        if (panelState.contextChips.length === 0)
            return

        this.ports.persistPanelState({
            ...panelState,
            contextChips: [],
        })
        this.refresh()
    }

    removeLocal = (removedNodeIds: readonly string[]): void => {
        if (removedNodeIds.length === 0)
            return

        const removedNodeIdSet = new Set(removedNodeIds)
        const panelState = this.ports.getPanelState()
        const contextChips = panelState.contextChips.filter(nodeId => !removedNodeIdSet.has(nodeId))

        if (contextChips.length === panelState.contextChips.length)
            return

        this.ports.applyLocalPanelState({
            ...panelState,
            contextChips,
        })
        this.refresh()
    }

    refresh = (): void => void this.trays.refresh()

    destroy(): void {
        this.trays.destroy()
    }
}
