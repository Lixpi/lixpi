import {
    type AssetMeta,
    type CanvasGeometryUpdate,
    type CanvasRightSidePanelMode,
    type CanvasState,
} from '@lixpi/constants'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type WorkspacePromptComposer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/composer'
import {
    createArtifactLibraryPanel,
    createCapabilityLibraryPanel,
    createMediaLibraryPanel,
    type ArtifactLibraryPanelInstance,
    type CapabilityLibraryPanelInstance,
    type MediaLibraryPanelInstance,
    type WorkspaceLibraryPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/library'
import {
    type WorkspaceAssetDetailsPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspaceCanvasNodeInsertion,
} from './workspace-canvas-contracts.ts'

export type WorkspaceCanvasLibrariesPorts = {
    host: WorkspaceCanvasHost
    document: Document
    getWorkspaceId: () => string
    getCanvasState: () => CanvasState | null
    getComposer: () => WorkspacePromptComposer | null
    captureAdmission: () => () => boolean
    createLibraryPorts: () => WorkspaceLibraryPorts
    createAssetViewPorts: () => WorkspaceAssetDetailsPorts
    insertNode: (node: WorkspaceCanvasNodeInsertion) => CanvasState
    attachAsset?: (request: {
        assetId: string
        nodeId: string
        canvasState: CanvasState
    }) => Promise<CanvasState>
    commit: (state: CanvasState) => void
    applyGeometry: (geometry: CanvasGeometryUpdate) => void
}

export class WorkspaceCanvasLibraries {
    private media: MediaLibraryPanelInstance | null = null
    private artifact: ArtifactLibraryPanelInstance | null = null
    private capability: CapabilityLibraryPanelInstance | null = null

    constructor(private readonly ports: WorkspaceCanvasLibrariesPorts) {}

    mount(
        host: HTMLElement,
        mode: CanvasRightSidePanelMode,
    ): (() => void) | null {
        const lifetime = new Lifetime()

        try {
            if (mode === 'capabilities') {
                const library = this.ensureCapability()
                lifetime.own(() => this.destroyCapability())
                host.appendChild(library.element)
                void library.load()
            } else if (mode === 'artifacts') {
                const library = this.ensureArtifact()
                lifetime.own(() => library.unmount())
                library.mountInto(host)
            } else if (mode === 'media') {
                const library = this.ensureMedia()
                lifetime.own(() => library.unmount())
                library.mountInto(host)
            } else
                return null
        } catch (error) {
            lifetime.destroy()

            throw error
        }

        return () => lifetime.destroy()
    }

    showMediaAsset(assetId: string): void {
        this.ensureMedia().showAsset(assetId)
    }

    release(): void {
        const cleanup = new Lifetime()
        const media = this.media
        const artifact = this.artifact
        const capability = this.capability
        this.media = null
        this.artifact = null
        this.capability = null
        cleanup.own(() => media?.destroy())
        cleanup.own(() => artifact?.destroy())
        cleanup.own(() => capability?.destroy())
        cleanup.destroy()
    }

    destroy(): void {
        this.release()
    }

    private ensureMedia(): MediaLibraryPanelInstance {
        if (!this.media) {
            const current = this.ports.captureAdmission()
            this.media = createMediaLibraryPanel({
                ...this.ports.createLibraryPorts(),
                tooltipHideDelayMs: this.ports.host.settings.helpTooltip.interactiveHideDelayMs,
                mountEditor: this.ports.createAssetViewPorts().mountEditor,
                attestSubjectIdentity: (
                    assetId,
                    revision,
                    classification,
                ) => this.ports.host.assets.attestSubjectIdentity(
                    assetId,
                    revision,
                    classification,
                ),
                removeFromLibrary: async assetId => await this.ports.host.assets.detach({
                    assetId,
                    referenceType: 'catalog',
                }) as { error?: string },
                prepareRenditionUrls: this.ports.host.media.prepareRenditionUrls,
                onInsertAsset: async (item: AssetMeta) => {
                    if (
                        !this.ports.attachAsset
                        || !current()
                    )
                        return false

                    const nodeId = `node-${this.ports.host.createId()}`
                    const width = this.ports.host.settings.mediaNode.image.defaultInsertionWidth
                    const aspectRatio = item.aspectRatio
                        && item.aspectRatio > 0
                        ? item.aspectRatio
                        : 1
                    const type = item.primaryCategory === 'document' ? 'mediaDocument' : item.primaryCategory

                    if (type === 'conversation')
                        return false

                    const insertion = {
                        nodeId,
                        type,
                        assetId: item.assetId,
                        dimensions: type === 'audio' ? {
                            width: 360,
                            height: 96,
                        } : {
                            width,
                            height: width / aspectRatio,
                        },
                    } as WorkspaceCanvasNodeInsertion
                    const nextState = this.ports.insertNode(insertion)
                    const committedState = await this.ports.attachAsset({
                        assetId: item.assetId,
                        nodeId,
                        canvasState: nextState,
                    })

                    if (!current())
                        return false

                    this.ports.commit(committedState)

                    return true
                },
            })
        }

        return this.media
    }

    private ensureArtifact(): ArtifactLibraryPanelInstance {
        if (!this.artifact) {
            const current = this.ports.captureAdmission()
            this.artifact = createArtifactLibraryPanel({
                ...this.ports.createLibraryPorts(),
                frontendRegistry: this.ports.host.capabilities.frontend,
                sharedRegistry: this.ports.host.capabilities.shared,
                ensureStyles: this.ports.host.capabilities.ensureStyles,
                onInsertAsset: async (item: AssetMeta) => {
                    if (
                        !this.ports.attachAsset
                        || !item.artifactTypeId
                        || !current()
                    )
                        return false

                    const nodeId = `node-${this.ports.host.createId()}`
                    const insertion: WorkspaceCanvasNodeInsertion = {
                        nodeId,
                        type: 'capabilityArtifact',
                        artifactTypeId: item.artifactTypeId,
                        assetId: item.assetId,
                        dimensions: { ...this.ports.host.capabilities.frontend.require(item.artifactTypeId).initialCanvasDimensions },
                    }
                    const nextState = this.ports.insertNode(insertion)
                    const committedState = await this.ports.attachAsset({
                        assetId: item.assetId,
                        nodeId,
                        canvasState: nextState,
                    })

                    if (!current())
                        return false

                    this.ports.commit(committedState)

                    return true
                },
                onAcceptAsset: async asset => {
                    if (!current())
                        return false

                    const workspaceId = this.ports.getWorkspaceId()
                    const node = this.ports.getCanvasState()?.nodes.find(
                        candidate => (
                            candidate.type === 'capabilityArtifact' && candidate.assetId === asset.assetId
                        ),
                    )

                    if (!node)
                        return false

                    const result = await this.ports.host.assets.reviewGeneratedOutput({
                        workspaceId,
                        scope: 'output-node',
                        action: 'accept',
                        nodeId: node.nodeId,
                    })

                    if (
                        'error' in result
                        || !current()
                        || result.workspaceId !== this.ports.getWorkspaceId()
                    )
                        return false

                    this.ports.applyGeometry(result.canvasGeometry)

                    return true
                },
            })
        }

        return this.artifact
    }

    private ensureCapability(): CapabilityLibraryPanelInstance {
        if (!this.capability) {
            const current = this.ports.captureAdmission()
            this.capability = createCapabilityLibraryPanel({
                document: this.ports.document,
                client: this.ports.host.capabilities.catalog(
                    this.ports.getWorkspaceId(),
                    this.ports.host.workspace.organizationId() as string,
                ),
                onAttach: reference => {
                    if (!current())
                        return

                    const composer = this.ports.getComposer()
                    const view = composer?.input.editorView
                    const nodeType = view?.state.schema.nodes.prompt_reference

                    if (
                        !view
                        || !nodeType
                    )
                        return

                    const atom = nodeType.create({
                        referenceType: reference.kind,
                        capabilityId: reference.capabilityId,
                        displayName: reference.displayName,
                    })
                    const transaction = view.state.tr.replaceSelectionWith(atom).insertText(' ').scrollIntoView()
                    view.dispatch(transaction)
                    view.focus()
                    composer?.input.triggerGradientAnimation()
                },
            })
        }

        return this.capability
    }

    private destroyCapability(): void {
        this.capability?.destroy()
        this.capability = null
    }
}
