import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    createProgressRippleIcon,
    type ProgressRippleIconInstance,
    type ProgressRippleArtwork,
} from '../progressTimeline/progressRippleIcon.ts'

export type CanvasNodeFooterSection = {
    elements: ReadonlyArray<HTMLElement | null | undefined>
    separated?: boolean
}

export type CanvasNodeFooterState = {
    progressActive: boolean
    selected: boolean
}

export type CanvasNodeFooterConfig = CanvasNodeFooterState & {
    document?: Document
    icons: {
        info: string
        progress: ProgressRippleArtwork
    }
    infoLabel: string
    infoTitle?: string
    progressLabel?: string
    progressTitle?: string
    className?: string
    infoButtonClassName?: string
    sections?: readonly CanvasNodeFooterSection[]
    onOpenDetails: () => void
}

export type CanvasNodeFooterInstance = {
    readonly element: HTMLDivElement
    update: (state: CanvasNodeFooterState) => void
    destroy: () => void
}

class CanvasNodeFooter implements CanvasNodeFooterInstance {
    private readonly html: ReturnType<typeof createDocumentHtml>
    readonly element: HTMLDivElement

    private readonly infoButton: HTMLButtonElement
    private readonly progressButton: HTMLButtonElement
    private readonly progressRipple: ProgressRippleIconInstance
    private progressActive = false

    constructor(private readonly config: CanvasNodeFooterConfig) {
        const html = (this.html = createDocumentHtml(config.document ?? document))
        this.progressRipple = createProgressRippleIcon({
            document: config.document,
            artwork: config.icons.progress,
            className: 'canvas-node-footer-progress-ripple',
        })
        this.infoButton = html`
            <button
                className=${`canvas-node-footer-info-button nopan${config.infoButtonClassName ? ` ${config.infoButtonClassName}` : ''}`}
                type="button"
                aria-label=${config.infoLabel}
                data-help-tooltip=${config.infoTitle ?? 'aria-label'}
            >
                <span
                    className="canvas-node-footer-info-icon"
                    innerHTML=${config.icons.info}
                ></span>
            </button>
        ` as HTMLButtonElement
        this.progressButton = html`
            <button
                className="canvas-node-footer-progress-button nopan"
                type="button"
                aria-label=${config.progressLabel ?? 'Open generation details'}
                data-help-tooltip=${config.progressTitle ?? 'Generation details'}
            >${this.progressRipple.element}</button>
        ` as HTMLButtonElement
        this.element = html`
            <div className=${`canvas-node-footer${config.className ? ` ${config.className}` : ''}`}>
                ${this.infoButton}
                ${this.progressButton}
            </div>
        ` as HTMLDivElement

        this.infoButton.addEventListener('click', this.openDetails)
        this.progressButton.addEventListener('click', this.openDetails)
        this.appendSections(config.sections ?? [])
        this.update(config)
    }

    update(state: CanvasNodeFooterState): void {
        const becameActive = state.progressActive && !this.progressActive
        this.progressActive = state.progressActive
        this.infoButton.classList.toggle('is-selected', state.selected)
        this.progressButton.classList.toggle('is-selected', state.selected)
        this.infoButton.setAttribute(
            'aria-expanded',
            String(state.selected),
        )
        this.progressButton.setAttribute(
            'aria-expanded',
            String(state.selected),
        )
        this.progressButton.hidden = !state.progressActive

        if (becameActive)
            this.progressRipple.syncActive()

        if (!state.progressActive)
            this.progressRipple.reset()
    }

    destroy(): void {
        this.infoButton.removeEventListener('click', this.openDetails)
        this.progressButton.removeEventListener('click', this.openDetails)
        this.progressRipple.destroy()
        this.element.remove()
    }

    private appendSections(sections: readonly CanvasNodeFooterSection[]): void {
        const html = this.html

        for (const section of sections) {
            const elements = section.elements.filter((element): element is HTMLElement => Boolean(element))

            if (elements.length === 0)
                continue

            if (section.separated) {
                this.element.appendChild(html`<div
                        className="canvas-node-footer-separator"
                        aria-hidden="true"
                    ></div>` as HTMLDivElement)
            }

            this.element.append(...elements)
        }
    }

    private openDetails = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        this.config.onOpenDetails()
    }
}

export const createCanvasNodeFooter = (config: CanvasNodeFooterConfig): CanvasNodeFooterInstance => new CanvasNodeFooter(config)
