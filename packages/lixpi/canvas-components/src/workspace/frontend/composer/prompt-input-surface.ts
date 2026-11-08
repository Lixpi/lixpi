import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

// The prompt editor owns document state. This component owns its shared DOM slots.
export class PromptInputSurface {
    readonly dom: HTMLDivElement
    readonly contentDOM: HTMLDivElement
    readonly controls: HTMLDivElement

    constructor(
        document: Document,
        placeholder = '',
        controls?: HTMLDivElement,
    ) {
        const html = createDocumentHtml(document)
        this.contentDOM = html`<div className="ai-prompt-input-content"></div>` as HTMLDivElement
        this.contentDOM.dataset.placeholder = placeholder
        this.controls = controls ?? (html`
            <div
                className="ai-prompt-input-controls"
                contenteditable="false"
            ></div>
        ` as HTMLDivElement)
        this.dom = html`
            <div className="ai-prompt-input-wrapper">
                ${this.contentDOM}
                ${this.controls}
            </div>
        ` as HTMLDivElement
    }

    setEmpty(empty: boolean): void {
        this.dom.dataset.empty = String(empty)
    }

    destroy(): void {
        this.dom.remove()
    }
}
