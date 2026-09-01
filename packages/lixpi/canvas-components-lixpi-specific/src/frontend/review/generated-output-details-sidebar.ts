import { xCircleIcon } from '@lixpi/ui-kit/svg'

import { html } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export type GeneratedOutputDetailsSidebarContent = {
    destroy?: () => void
}

export type GeneratedOutputDetailsSidebarInstance = {
    readonly element: HTMLElement
    readonly body: HTMLElement
    destroy: () => void
}

export type GeneratedOutputDetailsSidebarOptions = {
    onClose: () => void
    renderContent: (body: HTMLElement) => GeneratedOutputDetailsSidebarContent | void
}

class GeneratedOutputDetailsSidebar implements GeneratedOutputDetailsSidebarInstance {
    readonly element: HTMLElement
    readonly body: HTMLElement
    private readonly lifetime = new Lifetime()

    constructor({ onClose, renderContent }: GeneratedOutputDetailsSidebarOptions) {
        this.element = html`
            <section
                className="workspace-media-generation-trace-panel workspace-generated-output-details-panel"
                aria-label="Item details"
            >
                <header className="workspace-media-generation-trace-panel-header workspace-generated-output-details-panel-header">
                    <button
                        type="button"
                        className="workspace-media-generation-trace-panel-close"
                        aria-label="Close item details"
                        data-help-tooltip="aria-label"
                        innerHTML=${xCircleIcon}
                    ></button>
                </header>
                <div className="workspace-media-generation-trace-panel-body workspace-generated-output-details-panel-body workspace-generated-output-details-content"></div>
            </section>
        ` as HTMLElement
        this.body = this.element.querySelector('.workspace-generated-output-details-panel-body') as HTMLElement
        this.lifetime.own(() => this.element.remove())
        const close = this.element.querySelector('.workspace-media-generation-trace-panel-close')!
        try {
            this.lifetime.own(() => close.removeEventListener('click', onClose))
            close.addEventListener('click', onClose)
            const content = renderContent(this.body)
            if (content?.destroy) this.lifetime.own(() => content.destroy!())
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

export function createGeneratedOutputDetailsSidebar(
    options: GeneratedOutputDetailsSidebarOptions,
): GeneratedOutputDetailsSidebarInstance {
    return new GeneratedOutputDetailsSidebar(options)
}
