import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import {
    checkMarkIcon,
    pauseIcon,
    refreshIcon,
} from '@lixpi/ui-kit/svg'

export type BranchMarkerActionsOptions = {
    document: Document
    key: string
    active: boolean
    hasReviewOutputs: boolean
    canAcceptAll: boolean
    onStop: () => void
    onAcceptAll: () => void
    onRegenerate: (mode: 'existing-prompt' | 'regenerate-prompt') => void
}

export class BranchMarkerActions {
    readonly stopControl: HTMLButtonElement | null
    readonly reviewControls: HTMLDivElement | null
    private readonly lifetime = new Lifetime()

    constructor(private readonly options: BranchMarkerActionsOptions) {
        this.stopControl = null
        this.reviewControls = null

        try {
            if (options.active)
                this.stopControl = this.createStopControl()
            else if (options.hasReviewOutputs)
                this.reviewControls = this.createReviewControls()
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private listen(
        element: HTMLElement,
        type: string,
        action?: () => void,
    ): void {
        const listener = (event: Event) => {
            event.preventDefault()
            event.stopPropagation()

            if (!this.lifetime.signal.aborted)
                action?.()
        }
        element.addEventListener(type, listener)
        this.lifetime.own(() => element.removeEventListener(type, listener))
    }

    private createStopControl(): HTMLButtonElement {
        const html = createDocumentHtml(this.options.document)
        const button = html`
            <button
                type="button"
                className="workspace-branch-marker-stop-control nopan"
                data=${{ branchStopKey: this.options.key }}
                aria-label="Stop all branch generations"
                data-help-tooltip="aria-label"
            >
                <span
                    className="workspace-branch-marker-stop-icon"
                    innerHTML=${pauseIcon}
                    aria-hidden="true"
                ></span>
                </button>
        ` as HTMLButtonElement
        this.lifetime.own(() => button.remove())

        for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) this.listen(button, type)

        this.listen(
            button,
            'click',
            this.options.onStop,
        )

        return button
    }

    private createReviewControls(): HTMLDivElement {
        const { options } = this
        const html = createDocumentHtml(options.document)
        const waitLabel = 'Wait for every variant history to finish sealing'
        const controls = html`
            <div className="workspace-branch-marker-review-controls nopan">
                <button
                    type="button"
                    className="workspace-branch-marker-review-action is-accept"
                    aria-label=${options.canAcceptAll ? 'Accept all generated variants' : waitLabel}
                    data-help-tooltip="aria-label"
                >
                    <span
                        className="workspace-branch-marker-review-action-icon"
                        innerHTML=${checkMarkIcon}
                        aria-hidden="true"
                    ></span>
                    </button>
                    <div
                        className="canvas-node-footer-separator"
                        aria-hidden="true"
                    ></div>
                </div>
        ` as HTMLDivElement
        this.lifetime.own(() => controls.remove())
        const acceptButton = controls.querySelector<HTMLButtonElement>('button')!
        acceptButton.disabled = !options.canAcceptAll
        this.listen(acceptButton, 'pointerdown')
        this.listen(
            acceptButton,
            'click',
            () => {
                if (options.canAcceptAll)
                    options.onAcceptAll()
            },
        )
        const selection = { title: '' }
        const dropdown = createPureDropdown({
            id: `branch-regeneration-${crypto.randomUUID()}`,
            selectedValue: selection,
            options: [
                {
                    title: 'Regenerate variants',
                    mode: 'existing-prompt' as const,
                },
                {
                    title: 'Regenerate prompt',
                    mode: 'regenerate-prompt' as const,
                },
            ],
            buttonIcon: refreshIcon,
            theme: 'dark',
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            renderTitleForSelectedValue: false,
            mountToBody: true,
            disableTriggerHover: true,
            onSelect: option => {
                if (
                    this.lifetime.signal.aborted
                    || !options.canAcceptAll
                )
                    return

                dropdown.update(selection)
                options.onRegenerate(option.mode)
            },
        })
        this.lifetime.own(() => dropdown.destroy())
        dropdown.dom.classList.add('workspace-branch-marker-regeneration-dropdown')
        const trigger = dropdown.dom.querySelector<HTMLButtonElement>('button')!
        trigger.disabled = !options.canAcceptAll
        trigger.ariaLabel = options.canAcceptAll ? 'Choose how to regenerate branch outputs' : waitLabel
        trigger.dataset.helpTooltip = 'aria-label'
        controls.appendChild(dropdown.dom)

        return controls
    }

    setZoomScale(scale: number): void {
        this.reviewControls?.style.setProperty(
            '--workspace-branch-marker-review-zoom-scale',
            String(scale),
        )
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
