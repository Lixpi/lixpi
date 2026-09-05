import {
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type CapabilityArtifactCanvasNode,
    type MediaDescriptor,
    type MediaGenerationProgressState,
} from '@lixpi/constants'
import {
    type CapabilityArtifactFrontendDefinition,
} from '@lixpi/capability-system/frontend'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type BranchMarkerNode,
    type GeneratedOutputCanvasNode,
    type WorkspaceMediaHistoryTarget,
    type WorkspaceBranchHistoryTarget,
} from '../../shared/index.ts'
export type {
    WorkspaceMediaHistoryTarget,
    WorkspaceBranchHistoryTarget,
} from '../../shared/review/workspace-history.ts'
import { WorkspaceAssetMetadataEditor } from './workspace-asset-editors.ts'
import {
    WorkspaceAssetDetails,
    type WorkspaceAssetDetailsPorts,
} from './workspace-asset-details.ts'
import {
    createMediaGenerationProgress,
    type MediaGenerationProgressInstance,
    type MediaGenerationProgressOptions,
} from '../progress/index.ts'

export type WorkspaceHistoryMount = {
    host: HTMLElement
    signal: AbortSignal
}
export type WorkspaceHistoryView = { destroy: () => void }

export type WorkspaceOutputDetailsPorts = {
    assets: WorkspaceAssetDetailsPorts
    getDescriptor: (node: ImageCanvasNode | VideoCanvasNode) => MediaDescriptor | undefined
    getArtifactDefinition: (artifactTypeId: string) => Pick<CapabilityArtifactFrontendDefinition, 'createGeneratedOutputInfoView'>
    getArtifactDocument: (assetId: string) => object | undefined
    getBranchMediaTarget: (node: BranchMarkerNode) => WorkspaceMediaHistoryTarget | null
    getMediaBranchTarget: (node: ImageCanvasNode | VideoCanvasNode) => WorkspaceBranchHistoryTarget | null
    mountMediaHistory: (request: WorkspaceHistoryMount & {
        target: WorkspaceMediaHistoryTarget
        onProgress: (progress: MediaGenerationProgressInstance) => void
    }) => WorkspaceHistoryView | null
    mountBranchHistory: (request: WorkspaceHistoryMount & { target: WorkspaceBranchHistoryTarget }) => WorkspaceHistoryView | null
    mountArtifactHistory: (request: WorkspaceHistoryMount & { node: CapabilityArtifactCanvasNode }) => WorkspaceHistoryView | null
    getProgress: (node: ImageCanvasNode | VideoCanvasNode) => MediaGenerationProgressState | null
    progressDetails: Pick<MediaGenerationProgressOptions, 'renderItemDetail' | 'getItemDetailKey'>
    now: () => number
}

const isMarker = (node: GeneratedOutputCanvasNode | BranchMarkerNode): node is BranchMarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const descriptorSpinnerPeriodMs = 800

// One selected output owns its metadata, registered Artifact view and history.
export class WorkspaceOutputDetails {
    private readonly lifetime = new Lifetime()
    private progress: MediaGenerationProgressInstance | null = null
    private progressNodeId: string | null = null
    private history: HTMLElement | null = null
    private projection: WorkspaceHistoryView | null = null

    constructor(
        private readonly body: HTMLElement,
        node: GeneratedOutputCanvasNode | BranchMarkerNode,
        private readonly ports: WorkspaceOutputDetailsPorts,
    ) {
        try {
            let progressNode: ImageCanvasNode | VideoCanvasNode | null = null

            if (isMarker(node)) {
                const media = ports.getBranchMediaTarget(node)
                progressNode = media?.node ?? null
                this.appendHistory()

                if (media)
                    this.mountMedia(media)

                if (!this.projection) {
                    this.mountBranch({
                        marker: node,
                        lineageProjectionScope: node.type === 'branchOrigin'
                            ? 'branch-origin'
                            : node.type === 'branchFork'
                                ? 'branch-fork'
                                : 'media-run',
                    })
                }
            } else if (
                node.type === 'image'
                || node.type === 'video'
            ) {
                progressNode = node
                this.appendMetadata(node)
                const branch = ports.getMediaBranchTarget(node)

                if (
                    node.generatedBy
                    || branch
                )
                    this.appendHistory()

                if (node.generatedBy)
                    this.mountMedia({
                        node,
                        lineageProjectionScope: 'media-run',
                        limitProjectionToSelectedMedia: true,
                    })

                if (
                    !this.projection
                    && branch
                )
                    this.mountBranch(branch)
            } else {
                this.appendMetadata(node)

                if (node.generatedBy) {
                    this.appendHistory()
                    this.adoptProjection(
                        ports.mountArtifactHistory({
                            host: this.history!,
                            node,
                            signal: this.lifetime.signal,
                        }),
                    )
                }
            }

            let fallback: MediaGenerationProgressInstance | null = null

            if (
                progressNode
                && !this.progress
            ) {
                const state = ports.getProgress(progressNode)

                if (state) {
                    this.appendHistory()
                    fallback = createMediaGenerationProgress({
                        id: `sidebar:${progressNode.nodeId}`,
                        state,
                        className: 'workspace-media-generation-sidebar-progress',
                        defaultExpanded: true,
                        ...ports.progressDetails,
                    })
                    this.lifetime.own(() => fallback!.destroy())
                    this.progress = fallback
                    this.progressNodeId = progressNode.nodeId
                    this.history!.appendChild(fallback.element)
                }
            }

            if (
                this.history
                && !this.projection
                && !fallback
            )
                this.history.remove()
        } catch (error) {
            try {
                this.lifetime.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Output details mounting failed')
            }

            throw error
        }
    }

    sync(state: CanvasState): void {
        if (
            this.lifetime.signal.aborted
            || !this.progressNodeId
        )
            return

        const node = state.nodes.find(candidate => candidate.nodeId === this.progressNodeId)

        if (
            !node
            || (node.type !== 'image' && node.type !== 'video')
        )
            return

        const progress = this.ports.getProgress(node)

        if (progress)
            this.progress?.update(progress)
    }

    destroy = (): void => {
        this.progress = null
        this.progressNodeId = null
        this.lifetime.destroy()
    }

    private append(element: HTMLElement): void {
        this.lifetime.own(() => element.remove())
        this.body.appendChild(element)
    }

    private appendHistory(): void {
        if (this.history)
            return

        const html = createDocumentHtml(this.body.ownerDocument)
        this.history = html`
            <section className="canvas-generated-media-history-section workspace-generated-output-details-history">
                <span className="workspace-generated-output-details-history-heading">Generation details</span>
            </section>
        ` as HTMLElement
        this.append(this.history)
    }

    private adoptProjection(projection: WorkspaceHistoryView | null): void {
        this.projection = projection

        if (projection)
            this.lifetime.own(() => projection.destroy())
    }

    private mountMedia(target: WorkspaceMediaHistoryTarget): void {
        this.adoptProjection(
            this.ports.mountMediaHistory({
                host: this.history!,
                signal: this.lifetime.signal,
                target,
                onProgress: progress => {
                    if (this.lifetime.signal.aborted)
                        return

                    this.progress = progress
                    this.progressNodeId = target.node.nodeId
                },
            }),
        )
    }

    private mountBranch(target: WorkspaceBranchHistoryTarget): void {
        this.adoptProjection(
            this.ports.mountBranchHistory({
                host: this.history!,
                signal: this.lifetime.signal,
                target,
            }),
        )
    }

    private appendMetadata(node: GeneratedOutputCanvasNode): void {
        const html = createDocumentHtml(this.body.ownerDocument)
        const definition = node.type === 'capabilityArtifact' ? this.ports.getArtifactDefinition(node.artifactTypeId) : null
        const title = html`<div className="canvas-asset-metadata-editor is-details nopan"></div>` as HTMLElement
        this.append(title)
        const asset = this.ports.assets.getAsset(node.assetId)

        if (asset) {
            const editor = new WorkspaceAssetMetadataEditor(
                node.assetId,
                title,
                'details',
                this.ports.assets,
            )
            this.lifetime.own(() => editor.destroy())
        }

        if (definition) {
            const document = this.ports.getArtifactDocument(node.assetId)

            if (document) {
                const host = html`<section className="canvas-capability-artifact-details"></section>` as HTMLElement
                this.append(host)
                const view = definition.createGeneratedOutputInfoView({
                    container: host,
                    document,
                })
                this.lifetime.own(() => view.destroy())
            }
        } else if (
            node.type === 'image'
            || node.type === 'video'
        ) {
            const descriptor = this.descriptor(
                this.ports.getDescriptor(node),
            )

            if (descriptor)
                this.append(descriptor)
        }

        if (asset) {
            const details = new WorkspaceAssetDetails(
                asset,
                node.type === 'capabilityArtifact',
                this.ports.assets,
            )
            this.lifetime.own(() => details.destroy())
            this.append(details.element)
        }
    }

    private descriptor(descriptor: MediaDescriptor | undefined): HTMLElement | null {
        if (
            !descriptor
            || descriptor.source !== 'analysis'
        )
            return null

        const html = createDocumentHtml(this.body.ownerDocument)

        if (descriptor.status === 'analyzing') {
            const spinnerStyle = { animationDelay: `${-(this.ports.now() % descriptorSpinnerPeriodMs)}ms` }

            return html`
                <div className="canvas-media-descriptor is-analyzing">
                    <div className="canvas-media-descriptor-loading">
                        <span
                            className="workspace-branch-marker-spinner canvas-media-descriptor-spinner"
                            style=${spinnerStyle}
                            aria-hidden="true"
                        ></span>
                        <span className="canvas-media-descriptor-label">Analyzing media…</span>
                    </div>
                    <p className="canvas-media-descriptor-summary">Generating a short description of this media. It runs once and is reused later.</p>
                </div>
            ` as HTMLElement
        }

        if (
            descriptor.status === 'failed'
            || !descriptor.summary
        ) {
            return html`
                <div className="canvas-media-descriptor is-failed">
                    <span className="canvas-media-descriptor-label">Description unavailable</span>
                    <p className="canvas-media-descriptor-summary">Media analysis did not return a usable description.</p>
                </div>
            ` as HTMLElement
        }

        const tags = [...descriptor.entityTags, ...descriptor.styleTags]

        return html`
            <div className="canvas-media-descriptor">
                ${tags.length
            ? html`
                <div className="canvas-media-descriptor-tags">
                      ${tags.map(tag => html`<span className="canvas-media-descriptor-tag">${tag}</span>`)}
                  </div>
            `
            : ''}
        </div>
        ` as HTMLElement
    }
}
