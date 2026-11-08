import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { CanvasNodeShell } from '@lixpi/canvas-components/nodes/shell'
import {
    createCanvasNodeFooter,
    type CanvasNodeFooterInstance,
    type CanvasNodeFooterState,
} from '@lixpi/ui-kit/components/canvas-node-footer'
import {
    checkMarkIcon,
    refreshIcon,
    trashBinIcon,
    infoLetterIcon,
    progressRippleArtwork,
} from '@lixpi/ui-kit/svg'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type BoundedZoomScalingOptions,
    type CanvasEngineRect,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'

export type GeneratedOutputChromeState = CanvasNodeFooterState & {
    pendingBeforeFrame: boolean
    generated: boolean
    hasAsset: boolean
    accepted: boolean
    superseded: boolean
    reviewReady: boolean
    rejectable: boolean
    analyzing: boolean
}

export type GeneratedOutputNodeChromeOptions = {
    document: Document
    nodeId: string
    kind: 'media' | 'artifact'
    state: GeneratedOutputChromeState
    modelBadge: HTMLElement | null
    settings: {
        gap: number
        zoomScaling: BoundedZoomScalingOptions
    }
    mountTitle: (host: HTMLElement) => () => void
    onOpenDetails: () => void
    onAccept: () => void
    onReject: () => void
    onRegenerate: () => void
}

// Product review actions and title placement compose UI-kit's shared footer.
export class GeneratedOutputNodeChrome {
    readonly element: HTMLElement
    private readonly shell: CanvasNodeShell
    private readonly footer: CanvasNodeFooterInstance
    private readonly lifetime = new Lifetime()

    constructor(private readonly options: GeneratedOutputNodeChromeOptions) {
        try {
            const html = createDocumentHtml(options.document)
            const {
                state,
                kind,
            } = options
            const pending = kind === 'media' && state.pendingBeforeFrame
            const canReview = !pending
                && state.generated
                && !state.accepted
                && !state.superseded
                && (kind === 'media' || state.hasAsset)
            const accept = canReview ? this.button(
                'accept',
                state.reviewReady
                    ? kind === 'artifact'
                        ? 'Accept generated Artifact'
                        : 'Accept generated output'
                    : 'Generation history is still being sealed',
                checkMarkIcon,
                options.onAccept,
                !state.reviewReady,
            ) : null
            const reject = !pending
                && kind === 'media'
                && state.rejectable
                ? this.button(
                    'reject',
                    state.reviewReady ? 'Reject and delete generated output' : 'Cancel generation and delete output',
                    trashBinIcon,
                    options.onReject,
                )
                : null
            const regeneration = canReview ? (html`
                <div className="media-regeneration-controls nopan">${this.button(
                    'regenerate',
                    kind === 'artifact' ? 'Regenerate Artifact' : 'Regenerate with existing media prompt',
                    refreshIcon,
                    options.onRegenerate,
                    !state.reviewReady,
                )}</div>
            ` as HTMLElement) : null
            const infoLabel = kind === 'artifact'
                ? 'Artifact details and generation history'
                : state.analyzing
                    ? 'Analyzing media — generating a description…'
                    : state.generated
                        ? 'Media details and generation history'
                        : 'Media details'
            this.footer = createCanvasNodeFooter({
                document: options.document,
                icons: {
                    info: infoLetterIcon,
                    progress: progressRippleArtwork,
                },
                infoLabel,
                infoButtonClassName: state.analyzing
                    && kind === 'media'
                    ? 'is-analyzing'
                    : undefined,
                progressActive: state.progressActive,
                selected: state.selected,
                onOpenDetails: options.onOpenDetails,
                sections: [
                    {
                        elements: [pending ? null : options.modelBadge],
                        separated: true,
                    },
                    { elements: [accept, reject] },
                    {
                        elements: [regeneration],
                        separated: Boolean((accept || reject) && regeneration),
                    },
                ],
            })
            this.lifetime.own(() => this.footer.destroy())
            this.shell = new CanvasNodeShell({
                document: options.document,
                getSettings: () => options.settings,
                mountTitle: host => {
                    host.classList.add(
                        'workspace-generated-media-title',
                        'canvas-asset-metadata-editor',
                        'is-node',
                        'nopan',
                    )

                    return options.mountTitle(host)
                },
                mountActions: host => {
                    host.append(this.footer.element)

                    return () => this.footer.element.remove()
                },
            })
            this.lifetime.own(() => this.shell.destroy())
            this.element = this.shell.element
            this.element.classList.add('workspace-generated-media-chrome')
            this.element.dataset.mediaChromeNodeId = options.nodeId
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private button(
        action: string,
        label: string,
        icon: string,
        invoke: () => void,
        disabled = false,
    ): HTMLButtonElement {
        const html = createDocumentHtml(this.options.document)
        const button = html`
            <button
                className=${`media-review-action media-review-${action} nopan`}
                type="button"
                aria-label=${label}
                data-help-tooltip="aria-label"
            >
            <span
                className="media-review-action-icon"
                innerHTML=${icon}
                aria-hidden="true"
            ></span>
        </button>
        ` as HTMLButtonElement
        button.disabled = disabled
        const click = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()

            if (
                !this.lifetime.signal.aborted
                && !button.disabled
            )
                invoke()
        }
        button.addEventListener('click', click)
        this.lifetime.own(() => button.removeEventListener('click', click))

        return button
    }

    update(state: CanvasNodeFooterState): void {
        if (!this.lifetime.signal.aborted)
            this.footer.update(state)
    }

    setGeometry(
        bounds: CanvasEngineRect,
        viewport: CanvasViewport,
        extraTopOffsetScreen = 0,
    ): void {
        if (this.lifetime.signal.aborted)
            return

        this.shell.setGeometry(
            bounds,
            viewport,
            extraTopOffsetScreen,
        )
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
