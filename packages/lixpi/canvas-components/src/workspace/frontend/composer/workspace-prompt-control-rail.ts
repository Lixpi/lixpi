import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

export type WorkspacePromptControlRailOptions = {
    document: Document
    modelMenuHoverBackground?: string
}

// The editor owns its native controls. This owner supplies their production
// layout mounts without creating or destroying editor/control instances.
export class WorkspacePromptControlRail {
    readonly element: HTMLDivElement
    readonly mediaModeSwitchMount: HTMLDivElement
    readonly modelMenuControlMount: HTMLDivElement
    private destroyed = false

    constructor(options: WorkspacePromptControlRailOptions) {
        const html = createDocumentHtml(options.document)
        this.mediaModeSwitchMount = html`<div className="workspace-canvas-media-mode-panel"></div>` as HTMLDivElement
        this.modelMenuControlMount = html`<div className="workspace-canvas-model-menu-panel"></div>` as HTMLDivElement
        this.element = html`
            <div className="workspace-canvas-action-panel workspace-canvas-right-control-rail">
                <div
                    className="workspace-canvas-model-menu-hover-background"
                    aria-hidden="true"
                ></div>
                ${this.mediaModeSwitchMount}
                ${this.modelMenuControlMount}
            </div>
        ` as HTMLDivElement

        if (options.modelMenuHoverBackground)
            this.element.style.setProperty('--ai-prompt-model-menu-trigger-active-background', options.modelMenuHoverBackground)
    }

    mountMediaModeSwitch = (element: HTMLElement): void => {
        if (!this.destroyed)
            this.mediaModeSwitchMount.replaceChildren(element)
    }

    mountModelMenuControl = (element: HTMLElement): void => {
        if (!this.destroyed)
            this.modelMenuControlMount.replaceChildren(element)
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.element.remove()
    }
}
