import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    type CapabilityArtifactAssetReferenceView,
    type CapabilityArtifactCanvasHost,
    type CapabilityArtifactFrontendDefinition,
} from '../../../frontend/capability-artifact-registry.ts'
import {
    MEDIA_PIPELINE_ARTIFACT_TYPE_ID,
    readMediaPipelineDocument,
} from '../shared/media-pipeline.ts'
import { mediaPipelineSettings } from '../settings.ts'

export type MediaPipelineFrontendOptions = {
    openPipeline?: (pipelineId: string) => void
}

const styles = `
.media-pipeline-artifact {
    box-sizing: border-box;
    padding: 16px;
    color: var(--workspace-node-text-color, #f8f9fb);
    background: var(--workspace-branch-origin-background-color, #5d656d);
    border-radius: 16px;
    font: 13px/1.5 system-ui, sans-serif;
    overflow-wrap: anywhere;
}
.media-pipeline-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
}
.media-pipeline-heading h3 { margin: 0; font-size: 15px; }
.media-pipeline-revision { opacity: 0.75; }
.media-pipeline-outcome { margin: 10px 0; }
.media-pipeline-constraints, .media-pipeline-nodes { margin: 10px 0; padding-left: 20px; }
.media-pipeline-node { margin: 8px 0; }
.media-pipeline-node-detail { display: block; opacity: 0.75; font-size: 12px; }
.media-pipeline-sources { display: flex; flex-wrap: wrap; gap: 8px; }
.media-pipeline-open { margin-top: 12px; font: inherit; }
.media-pipeline-library { display: flex; flex-direction: column; text-align: left; font: inherit; }
.media-pipeline-unavailable { margin: 0; }
`

class MediaPipelineArtifactView {
    private readonly root: HTMLElement
    private referenceViews: CapabilityArtifactAssetReferenceView[] = []

    constructor(
        private readonly host: CapabilityArtifactCanvasHost,
        private readonly options: MediaPipelineFrontendOptions,
    ) {
        installStyles(host.container.ownerDocument)
        const html = createDocumentHtml(host.container.ownerDocument)
        this.root = html`
            <section
                className="media-pipeline-artifact"
                aria-label="Media pipeline"
            ></section>
        ` as HTMLElement
        host.container.append(this.root)
        this.updateDocument(host.document)
    }

    updateDocument = (document: object): void => {
        this.clearReferences()
        this.root.replaceChildren()
        const html = createDocumentHtml(this.host.container.ownerDocument)

        try {
            const pipeline = readMediaPipelineDocument(document)
            this.root.append(
                html`
                    <header className="media-pipeline-heading">
                        <h3>${pipeline.name ?? 'Media pipeline'}</h3>
                        <span className="media-pipeline-revision">Revision ${pipeline.revision}</span>
                    </header>
                `,
            )
            this.root.append(html`<p className="media-pipeline-outcome">${pipeline.requestedOutcome}</p>`)

            if (pipeline.constraints.length) {
                const constraints = html`
                    <ul
                        className="media-pipeline-constraints"
                        aria-label="Constraints"
                    ></ul>
                ` as HTMLElement

                for (const constraint of pipeline.constraints)
                    constraints.append(html`<li>${constraint}</li>`)

                this.root.append(constraints)
            }

            const sources = html`
                <div
                    className="media-pipeline-sources"
                    aria-label="Source assets"
                ></div>
            ` as HTMLElement

            for (const source of pipeline.sources) {
                const view = this.host.createAssetReferenceView({
                    assetId: source.assetId,
                    variant: 'inline',
                })

                if (view) {
                    this.referenceViews.push(view)
                    sources.append(view.dom)
                }
            }

            this.root.append(sources)
            const nodes = html`
                <ol
                    className="media-pipeline-nodes"
                    aria-label="Pipeline operations"
                ></ol>
            ` as HTMLElement

            for (const node of pipeline.nodes) {
                const inputs = pipeline.edges.filter(edge => edge.to.nodeId === node.nodeId).map(
                    edge => ('sourceId' in edge.from ? edge.from.sourceId : `${edge.from.nodeId}.${edge.from.portId}`),
                )
                nodes.append(
                    html`
                        <li className="media-pipeline-node">
                            <strong>${node.nodeId}</strong> ${node.operationKey}
                            <span className="media-pipeline-node-detail">${inputs.length ? `Inputs: ${inputs.join(', ')}` : 'No source inputs'}${node.modelId ? ` · ${node.modelId}` : ''}</span>
                        </li>
                    `,
                )
            }

            this.root.append(nodes)

            if (this.options.openPipeline) {
                const open = html`
                    <button
                        className="media-pipeline-open"
                        type="button"
                    >Open pipeline</button>
                ` as HTMLButtonElement
                open.addEventListener('click', () => this.options.openPipeline?.(pipeline.pipelineId))
                this.root.append(open)
            }
        } catch {
            this.root.append(
                html`
                    <p
                        className="media-pipeline-unavailable"
                        role="status"
                    >This pipeline uses an unsupported or invalid document format. Its saved contents have been preserved.</p>
                `,
            )
        }

        this.host.onHeightChange(
            Math.max(mediaPipelineSettings.canvas.height, this.root.scrollHeight),
        )
    }

    destroy = (): void => {
        this.clearReferences()
        this.root.remove()
    }

    private clearReferences(): void {
        for (const view of this.referenceViews)
            view.destroy()

        this.referenceViews = []
    }
}

export const createMediaPipelineFrontendDefinition = (options: MediaPipelineFrontendOptions = {}): CapabilityArtifactFrontendDefinition => ({
    artifactTypeId: MEDIA_PIPELINE_ARTIFACT_TYPE_ID,
    iconId: 'ordered-list',
    initialCanvasDimensions: mediaPipelineSettings.canvas,
    createCanvasNodeView: host => new MediaPipelineArtifactView(host, options),
    createGeneratedOutputInfoView: host => {
        const html = createDocumentHtml(host.container.ownerDocument)
        let text: string

        try {
            const pipeline = readMediaPipelineDocument(host.document)
            text = `Revision ${pipeline.revision} · ${pipeline.nodes.length} operations · ${pipeline.sources.length} sources`
        } catch {
            text = 'Unsupported pipeline format'
        }

        const root = html`<p>${text}</p>` as HTMLElement
        host.container.append(root)

        return { destroy: () => root.remove() }
    },
    buildReplaySubmitData: () => {
        throw new Error('PIPELINE_EXPLICIT_SUBMISSION_REQUIRED')
    },
    createPromptReferenceView: host => {
        const html = createDocumentHtml(host.container.ownerDocument)
        const root = html`<span>${host.title} · ${host.displayMetadata.nodeCount ?? 0} operations</span>` as HTMLElement
        host.container.append(root)

        return { destroy: () => root.remove() }
    },
    createLibraryItemView: host => {
        installStyles(host.container.ownerDocument)
        const html = createDocumentHtml(host.container.ownerDocument)
        const root = html`
            <button
                type="button"
                className="media-pipeline-library"
            ><strong>${host.title}</strong><span>${host.displayMetadata.nodeCount ?? 0} operations · ${host.scope}</span></button>
        ` as HTMLButtonElement
        root.addEventListener('click', host.onAddToCanvas)
        host.container.append(root)

        return { destroy: () => root.remove() }
    },
})

const installStyles = (document: Document): void => {
    if (document.getElementById('media-pipeline-styles'))
        return

    const html = createDocumentHtml(document)
    const style = html`<style id="media-pipeline-styles"></style>` as HTMLStyleElement
    style.textContent = styles
    document.head.append(style)
}
