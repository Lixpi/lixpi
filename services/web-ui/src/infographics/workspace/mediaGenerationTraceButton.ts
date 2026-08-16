import type { MediaGenerationRunStatus } from '@lixpi/constants'
import {
    createProgressRippleIcon,
    type ProgressRippleIconInstance,
} from '@lixpi/ui-kit/components/progress-timeline'

import { html } from '$src/utils/domTemplates.ts'

export type MediaGenerationTraceButtonInstance = {
    readonly element: HTMLButtonElement
    update: (status: MediaGenerationRunStatus, selected: boolean) => void
    destroy: () => void
}

export function isMediaGenerationTraceActive(status: MediaGenerationRunStatus): boolean {
    return status === 'pending'
        || status === 'running'
        || status === 'awaiting-provider-verification'
}

class MediaGenerationTraceButton implements MediaGenerationTraceButtonInstance {
    readonly element: HTMLButtonElement

    private readonly rippleIcon: ProgressRippleIconInstance
    private status: MediaGenerationRunStatus

    constructor({
        status,
        selected,
        onClick,
    }: {
        status: MediaGenerationRunStatus
        selected: boolean
        onClick: () => void
    }) {
        this.status = status
        this.rippleIcon = createProgressRippleIcon({
            className: 'media-generation-trace-button-ripple',
        })
        this.element = html`
            <button
                type="button"
                className="media-generation-trace-button nopan"
                aria-label="Open generation trace"
                title="Generation trace"
            >${this.rippleIcon.element}</button>
        ` as HTMLButtonElement
        this.element.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            onClick()
        })
        this.update(status, selected)
    }

    update(status: MediaGenerationRunStatus, selected: boolean): void {
        const wasActive = isMediaGenerationTraceActive(this.status)
        const active = isMediaGenerationTraceActive(status)
        this.status = status
        this.element.dataset.status = status
        this.element.classList.toggle('is-active', active)
        this.element.classList.toggle('is-selected', selected)
        this.element.classList.toggle('is-static', !active)
        this.element.setAttribute('aria-expanded', String(selected))
        if (active && !wasActive) this.rippleIcon.syncActive()
        if (!active) this.rippleIcon.reset()
    }

    destroy(): void {
        this.rippleIcon.destroy()
        this.element.remove()
    }
}

export function createMediaGenerationTraceButton(options: {
    status: MediaGenerationRunStatus
    selected: boolean
    onClick: () => void
}): MediaGenerationTraceButtonInstance {
    return new MediaGenerationTraceButton(options)
}
