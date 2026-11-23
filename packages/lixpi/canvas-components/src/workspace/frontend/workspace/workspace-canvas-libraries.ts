import {
    type AssetMeta,
    type CanvasGeometryUpdate,
    type CanvasCollaborationPresence,
    type CanvasRightSidePanelMode,
    type CanvasState,
} from '@lixpi/constants'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type WorkspacePromptComposer,
} from '@lixpi/canvas-components/workspace/composer'
import {
    createArtifactLibraryPanel,
    createCapabilityLibraryPanel,
    createMediaLibraryPanel,
    type ArtifactLibraryPanelInstance,
    type CapabilityLibraryPanelInstance,
    type MediaLibraryPanelInstance,
    type WorkspaceLibraryPorts,
} from '@lixpi/canvas-components/workspace/library'
import {
    type WorkspaceAssetDetailsPorts,
} from '@lixpi/canvas-components/workspace/review'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspaceCanvasNodeInsertion,
} from './workspace-canvas-contracts.ts'

type LibraryView = NonNullable<CanvasCollaborationPresence['library']>

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
    onViewChange?: (view: CanvasCollaborationPresence['library']) => void
}

export class WorkspaceCanvasLibraries {
    private media: MediaLibraryPanelInstance | null = null
    private artifact: ArtifactLibraryPanelInstance | null = null
    private capability: CapabilityLibraryPanelInstance | null = null
    private generation = 0
    private following = false
    private followed: LibraryView | null = null
    private readonly localViews = new Map<LibraryView['kind'], LibraryView>()
    private mounted: {
        kind: LibraryView['kind']
        element: HTMLElement
    } | null = null
    private displayedSelection: string | null | undefined

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
                this.observeView(
                    'capabilities',
                    library.element,
                    lifetime,
                )
            } else if (mode === 'artifacts') {
                const library = this.ensureArtifact()
                lifetime.own(() => library.unmount())
                library.mountInto(host)
                this.observeView(
                    'artifacts',
                    library.rootEl,
                    lifetime,
                )
            } else if (mode === 'media') {
                const library = this.ensureMedia()
                lifetime.own(() => library.unmount())
                library.mountInto(host)
                this.observeView(
                    'media',
                    library.rootEl,
                    lifetime,
                )
            } else
                return null
        } catch (error) {
            lifetime.destroy()

            throw error
        }

        return () => lifetime.destroy()
    }

    setFollowedView(
        following: boolean,
        view: CanvasCollaborationPresence['library'],
    ): void {
        const changed = following !== this.following
        this.following = following
        this.followed = view ?? null

        if (
            following
            || changed
        )
            this.reflectView()
    }

    private readView(kind: LibraryView['kind']): LibraryView {
        const source = this.following ? this.followed : this.localViews.get(kind)

        return source?.kind === kind ? source : {
            kind,
            selectedId: null,
        }
    }

    private scrollElement(view: LibraryView): HTMLElement | null {
        return this.mounted?.element.querySelector<HTMLElement>(view.selectedId ? '.media-library-inspector' : '.media-library-browser') ?? null
    }

    private rememberSelection(
        kind: LibraryView['kind'],
        selectedId: string | null,
    ): void {
        if (this.following)
            return

        this.displayedSelection = selectedId
        const view = {
            kind,
            selectedId,
            scrollTop: 0,
        }
        this.localViews.set(kind, view)

        if (kind === this.mounted?.kind)
            this.ports.onViewChange?.(view)
    }

    private observeView(
        kind: LibraryView['kind'],
        element: HTMLElement,
        lifetime: Lifetime,
    ): void {
        if (!this.ports.onViewChange)
            return

        const mounted = {
            kind,
            element,
        }
        this.mounted = mounted
        this.displayedSelection = undefined
        const scroll = (event: Event) => {
            if (
                this.following
                || this.mounted !== mounted
            )
                return

            const current = this.readView(kind)
            const target = this.scrollElement(current)

            if (
                !target
                || event.target !== target
            )
                return

            const view = {
                ...current,
                scrollTop: target.scrollTop,
            }
            this.localViews.set(kind, view)
            this.ports.onViewChange?.(view)
        }
        const observer = new MutationObserver(() => {
            if (
                this.following
                && this.mounted === mounted
            )
                this.reflectScroll(
                    this.readView(kind),
                )
        })
        observer.observe(
            element,
            {
                childList: true,
                subtree: true,
            },
        )
        element.addEventListener(
            'scroll',
            scroll,
            true,
        )
        lifetime.own(() => {
            observer.disconnect()
            element.removeEventListener(
                'scroll',
                scroll,
                true,
            )

            if (this.mounted !== mounted)
                return

            this.mounted = null

            if (!this.following)
                this.ports.onViewChange?.(null)
        })

        this.reflectView()

        if (!this.following)
            this.ports.onViewChange(
                this.readView(kind),
            )
    }

    private reflectView(): void {
        const kind = this.mounted?.kind

        if (!kind)
            return

        const view = this.readView(kind)

        if (view.selectedId !== this.displayedSelection) {
            this.displayedSelection = view.selectedId

            switch (kind) {
                case 'media':
                    this.media?.showAsset(view.selectedId)

                    break
                case 'artifacts':
                    this.artifact?.showAsset(view.selectedId)

                    break
                case 'capabilities':
                    this.capability?.showCapability(view.selectedId)

                    break
            }
        }

        this.reflectScroll(view)
    }

    private reflectScroll(view: LibraryView): void {
        const element = this.scrollElement(view)

        if (
            element
            && view.scrollTop !== undefined
            && Math.abs(element.scrollTop - view.scrollTop) > 1
        )
            element.scrollTop = view.scrollTop
    }

    showMediaAsset(assetId: string): void {
        this.ensureMedia().showAsset(assetId)
    }

    showArtifactAsset(assetId: string): void {
        this.ensureArtifact().showAsset(assetId)
    }

    release(): void {
        this.generation++
        this.localViews.clear()
        this.displayedSelection = undefined
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
            const generation = this.generation
            const workspaceId = this.ports.getWorkspaceId()
            this.media = createMediaLibraryPanel({
                ...this.ports.createLibraryPorts(),
                tooltipHideDelayMs: this.ports.host.settings.helpTooltip.interactiveHideDelayMs,
                onSelectionChange: assetId => this.rememberSelection('media', assetId),
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
                    const current = this.captureActionAdmission(workspaceId, generation)

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
            const generation = this.generation
            const workspaceId = this.ports.getWorkspaceId()
            this.artifact = createArtifactLibraryPanel({
                ...this.ports.createLibraryPorts(),
                frontendRegistry: this.ports.host.capabilities.frontend,
                onSelectionChange: assetId => this.rememberSelection('artifacts', assetId),
                sharedRegistry: this.ports.host.capabilities.shared,
                ensureStyles: this.ports.host.capabilities.ensureStyles,
                onInsertAsset: async (item: AssetMeta) => {
                    const current = this.captureActionAdmission(workspaceId, generation)

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
                    const current = this.captureActionAdmission(workspaceId, generation)

                    if (!current())
                        return false

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
            const generation = this.generation
            const workspaceId = this.ports.getWorkspaceId()
            this.capability = createCapabilityLibraryPanel({
                onSelectionChange: capabilityId => this.rememberSelection('capabilities', capabilityId),
                document: this.ports.document,
                client: this.ports.host.capabilities.catalog(
                    this.ports.getWorkspaceId(),
                    this.ports.host.workspace.organizationId() as string,
                ),
                onAttach: reference => {
                    const current = this.captureActionAdmission(workspaceId, generation)

                    if (!current())
                        return

                    const composer = this.ports.getComposer()
                    composer?.input.insertCapabilityReference(reference)
                    composer?.input.triggerGradientAnimation()
                },
            })
        }

        return this.capability
    }

    private captureActionAdmission(
        workspaceId: string,
        generation: number,
    ): () => boolean {
        const current = this.ports.captureAdmission()

        return () => generation === this.generation
            && workspaceId === this.ports.getWorkspaceId()
            && current()
    }

    private destroyCapability(): void {
        this.capability?.destroy()
        this.capability = null
    }
}
