import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    createActionPanel,
    type ActionPanelInstance,
} from '@lixpi/ui-kit/components/action-panel'

export type WorkspacePromptControlRailOptions = {
    document: Document
    modelMenuHoverBackground?: string
}

// The editor owns its native controls. This owner supplies their production
// layout mounts inside the shared action panel without creating or destroying
// editor/control instances.
export class WorkspacePromptControlRail {
    readonly element: HTMLDivElement
    readonly mediaModeSwitchMount: HTMLDivElement
    readonly modelMenuControlMount: HTMLDivElement
    private readonly panel: ActionPanelInstance
    private destroyed = false

    constructor(options: WorkspacePromptControlRailOptions) {
        const html = createDocumentHtml(options.document)
        this.mediaModeSwitchMount = html`<div className="workspace-canvas-media-mode-panel"></div>` as HTMLDivElement
        this.modelMenuControlMount = html`<div className="workspace-canvas-model-menu-panel"></div>` as HTMLDivElement
        this.panel = createActionPanel({
            document: options.document,
            className: 'workspace-canvas-right-control-rail',
            children: [
                html`
                    <div
                        className="workspace-canvas-model-menu-hover-background"
                        aria-hidden="true"
                    ></div>
                ` as HTMLDivElement,
                this.mediaModeSwitchMount,
                this.modelMenuControlMount,
            ],
        })
        this.element = this.panel.element

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
        this.panel.destroy()
    }
}
