import { html } from '@lixpi/ui-primitives/dom'

// The preview is display-only. ProseMirror retains the source DOM and document
// until a guarded move is dispatched on release.
export class NestedListDragPreview {
    private readonly portal: HTMLDivElement
    private readonly offsetX: number
    private readonly offsetY: number

    constructor(
        private readonly source: HTMLElement,
        editor: HTMLElement,
        startX: number,
        startY: number,
        x: number,
        y: number,
    ) {
        const document = source.ownerDocument
        const window = document.defaultView!
        const root = editor.closest<HTMLElement>('.nested-list') ?? editor
        const rootStyle = window.getComputedStyle(root)
        const sourceStyle = window.getComputedStyle(source)
        const rect = source.getBoundingClientRect()
        this.offsetX = startX - rect.left
        this.offsetY = startY - rect.top
        this.portal = html`
            <div
                className="nested-list nested-list-drag-preview"
                aria-hidden="true"
                contenteditable="false"
                inert=""
            ></div>
        ` as HTMLDivElement
        this.portal.dataset.mode = root.dataset.mode ?? 'view'
        this.portal.dataset.navigation = root.dataset.navigation ?? 'false'
        this.portal.style.width = `${rect.width}px`
        this.portal.style.fontFamily = rootStyle.fontFamily
        this.portal.style.fontSize = rootStyle.fontSize
        this.portal.style.fontWeight = rootStyle.fontWeight
        this.portal.style.lineHeight = rootStyle.lineHeight
        this.portal.style.color = rootStyle.color
        this.portal.style.direction = rootStyle.direction

        for (let index = 0; index < rootStyle.length; index += 1) {
            const property = rootStyle.item(index)

            if (property.startsWith('--'))
                this.portal.style.setProperty(property, rootStyle.getPropertyValue(property))
        }

        const content = html`<div className="ProseMirror nested-list-document"></div>` as HTMLDivElement
        const clone = source.cloneNode(true) as HTMLElement

        for (const element of [clone, ...clone.querySelectorAll('*')]) {
            element.removeAttribute('id')
            element.removeAttribute('tabindex')
            element.removeAttribute('data-entry-id')
            element.removeAttribute('data-nested-list-drop')
            element.removeAttribute('data-nested-list-drag-source')
            element.removeAttribute('data-nested-list-hover')
        }

        if (source.matches('li.nested-list-item')) {
            const list = html`<ul></ul>` as HTMLUListElement
            list.style.setProperty('--nested-list-depth-indent', sourceStyle.getPropertyValue('--nested-list-row-indent'))
            list.append(clone)
            content.append(list)
        } else {
            clone.style.fontFamily = sourceStyle.fontFamily
            clone.style.fontSize = sourceStyle.fontSize
            clone.style.fontWeight = sourceStyle.fontWeight
            clone.style.lineHeight = sourceStyle.lineHeight
            clone.style.letterSpacing = sourceStyle.letterSpacing
            clone.style.textTransform = sourceStyle.textTransform
            clone.style.color = sourceStyle.color
            clone.style.padding = sourceStyle.padding
            clone.style.margin = '0'
            content.append(clone)
        }

        this.portal.append(content)
        document.body.append(this.portal)
        this.update(x, y)
        source.dataset.nestedListDragSource = 'true'
    }

    update(x: number, y: number): void {
        this.portal.style.transform = `translate3d(${x - this.offsetX}px, ${y - this.offsetY}px, 0)`
    }

    destroy(): void {
        this.source.removeAttribute('data-nested-list-drag-source')
        this.portal.remove()
    }
}
