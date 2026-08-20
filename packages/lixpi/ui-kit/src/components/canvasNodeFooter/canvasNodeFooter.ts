import { html } from '../../dom/domTemplates.ts'
import { infoLetterIcon } from '../../svg/svgIcons.ts'
import {
    createProgressRippleIcon,
    type ProgressRippleIconInstance,
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
    readonly element: HTMLDivElement

    private readonly infoButton: HTMLButtonElement
    private readonly progressButton: HTMLButtonElement
    private readonly progressRipple: ProgressRippleIconInstance
    private progressActive = false

    constructor(config: CanvasNodeFooterConfig) {
        this.progressRipple = createProgressRippleIcon({
            className: 'canvas-node-footer-progress-ripple',
        })
        this.infoButton = html`
            <button
                className=${`canvas-node-footer-info-button nopan${config.infoButtonClassName ? ` ${config.infoButtonClassName}` : ''}`}
                type="button"
                aria-label=${config.infoLabel}
                title=${config.infoTitle ?? config.infoLabel}
            >
                <span className="canvas-node-footer-info-icon" innerHTML=${infoLetterIcon}></span>
            </button>
        ` as HTMLButtonElement
        this.progressButton = html`
            <button
                className="canvas-node-footer-progress-button nopan"
                type="button"
                aria-label=${config.progressLabel ?? 'Open generation details'}
                title=${config.progressTitle ?? 'Generation details'}
            >${this.progressRipple.element}</button>
        ` as HTMLButtonElement
        this.element = html`
            <div className=${`canvas-node-footer${config.className ? ` ${config.className}` : ''}`}>
                ${this.infoButton}
                ${this.progressButton}
            </div>
        ` as HTMLDivElement

        const openDetails = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            config.onOpenDetails()
        }
        this.infoButton.addEventListener('click', openDetails)
        this.progressButton.addEventListener('click', openDetails)
        this.appendSections(config.sections ?? [])
        this.update(config)
    }

    update(state: CanvasNodeFooterState): void {
        const becameActive = state.progressActive && !this.progressActive
        this.progressActive = state.progressActive
        this.infoButton.classList.toggle('is-selected', state.selected)
        this.progressButton.classList.toggle('is-selected', state.selected)
        this.infoButton.setAttribute('aria-expanded', String(state.selected))
        this.progressButton.setAttribute('aria-expanded', String(state.selected))
        this.progressButton.hidden = !state.progressActive
        if (becameActive) this.progressRipple.syncActive()
        if (!state.progressActive) this.progressRipple.reset()
    }

    destroy(): void {
        this.progressRipple.destroy()
        this.element.remove()
    }

    private appendSections(sections: readonly CanvasNodeFooterSection[]): void {
        for (const section of sections) {
            const elements = section.elements.filter((element): element is HTMLElement => Boolean(element))
            if (elements.length === 0) continue
            if (section.separated) {
                this.element.appendChild(html`
                    <div className="canvas-node-footer-separator" aria-hidden="true"></div>
                ` as HTMLDivElement)
            }
            this.element.append(...elements)
        }
    }
}

export function createCanvasNodeFooter(config: CanvasNodeFooterConfig): CanvasNodeFooterInstance {
    return new CanvasNodeFooter(config)
}
