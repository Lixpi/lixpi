import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

// The prompt editor owns document state. This component owns its shared DOM slots.
//
// The editable content never scrolls itself. `scroller` wraps it and carries
// the overflow, so the shared overlay scrollbar adds its elements to a node the
// NodeView ignores instead of to ProseMirror content.
export class PromptInputSurface {
    readonly dom: HTMLDivElement
    readonly scroller: HTMLDivElement
    readonly contentDOM: HTMLDivElement
    readonly controls: HTMLDivElement

    constructor(
        document: Document,
        placeholder = '',
        controls?: HTMLDivElement,
    ) {
        const html = createDocumentHtml(document)
        this.contentDOM = html`
            <div
                className="ai-prompt-input-content"
                data-scrollbars="off"
            ></div>
        ` as HTMLDivElement
        this.contentDOM.dataset.placeholder = placeholder
        this.scroller = html`
            <div
                className="ai-prompt-input-scroll"
                data-scrollbars="auto"
            >
                ${this.contentDOM}
            </div>
        ` as HTMLDivElement
        this.controls = controls ?? (html`
            <div
                className="ai-prompt-input-controls"
                contenteditable="false"
            ></div>
        ` as HTMLDivElement)
        this.dom = html`
            <div className="ai-prompt-input-wrapper">
                ${this.scroller}
                ${this.controls}
            </div>
        ` as HTMLDivElement
    }

    // True for mutations the editor must ignore: the scroller itself and the
    // scrollbar elements it hosts beside the editable content.
    ownsMutationTarget(target: Node): boolean {
        return target === this.scroller || (this.scroller.contains(target) && !this.contentDOM.contains(target))
    }

    setEmpty(empty: boolean): void {
        this.dom.dataset.empty = String(empty)
    }

    destroy(): void {
        this.dom.remove()
    }
}
