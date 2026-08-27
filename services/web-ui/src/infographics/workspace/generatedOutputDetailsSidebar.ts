import { xCircleIcon } from '@lixpi/ui-kit/svg'

import { html } from '$src/utils/domTemplates.ts'

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

    private readonly content?: GeneratedOutputDetailsSidebarContent

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
        this.element.querySelector('.workspace-media-generation-trace-panel-close')?.addEventListener('click', onClose)
        this.content = renderContent(this.body) ?? undefined
    }

    destroy(): void {
        this.content?.destroy?.()
        this.element.remove()
    }
}

export function createGeneratedOutputDetailsSidebar(
    options: GeneratedOutputDetailsSidebarOptions,
): GeneratedOutputDetailsSidebarInstance {
    return new GeneratedOutputDetailsSidebar(options)
}
