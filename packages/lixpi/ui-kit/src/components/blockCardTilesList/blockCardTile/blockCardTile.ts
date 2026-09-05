import { html } from '@lixpi/ui-primitives/dom'

export type BlockCardTileAction = {
    ariaLabel: string
    iconSvg: string
}

export type BlockCardTileItem = {
    id: string
    title: string
    primaryMeta: string
    secondaryMeta: string
    selected?: boolean
    markerAriaLabel?: string
    action?: BlockCardTileAction
}

export type BlockCardTileOptions = {
    item: BlockCardTileItem
    onSelect?: (item: BlockCardTileItem) => void
    onAction?: (item: BlockCardTileItem) => void
}

export type BlockCardTileInstance = {
    element: HTMLDivElement
    update: (item: BlockCardTileItem) => void
    destroy: () => void
}

class BlockCardTile implements BlockCardTileInstance {
    readonly element: HTMLDivElement
    private item: BlockCardTileItem
    private readonly openButton: HTMLButtonElement
    private readonly marker: HTMLSpanElement
    private readonly title: HTMLSpanElement
    private readonly primaryMeta: HTMLSpanElement
    private readonly secondaryMeta: HTMLSpanElement
    private readonly actionButton: HTMLButtonElement

    constructor(private readonly options: BlockCardTileOptions) {
        this.item = options.item
        this.element = html`
            <div className="block-card-tile">
                <button
                    type="button"
                    className="block-card-tile-open"
                >
                    <span
                        className="block-card-tile-marker"
                        aria-hidden="true"
                    ></span>
                    <span className="block-card-tile-content">
                        <span className="block-card-tile-title"></span>
                        <span className="block-card-tile-primary-meta"></span>
                        <span className="block-card-tile-secondary-meta"></span>
                    </span>
                </button>
                <button
                    type="button"
                    className="block-card-tile-action"
                ></button>
            </div>
        ` as HTMLDivElement
        this.openButton = this.element.querySelector<HTMLButtonElement>('.block-card-tile-open')!
        this.marker = this.element.querySelector<HTMLSpanElement>('.block-card-tile-marker')!
        this.title = this.element.querySelector<HTMLSpanElement>('.block-card-tile-title')!
        this.primaryMeta = this.element.querySelector<HTMLSpanElement>('.block-card-tile-primary-meta')!
        this.secondaryMeta = this.element.querySelector<HTMLSpanElement>('.block-card-tile-secondary-meta')!
        this.actionButton = this.element.querySelector<HTMLButtonElement>('.block-card-tile-action')!
        this.openButton.addEventListener('click', this.handleSelect)
        this.actionButton.addEventListener('click', this.handleAction)
        this.render()
    }

    private readonly handleSelect = (): void => void this.options.onSelect?.(this.item)
    private readonly handleAction = (): void => void this.options.onAction?.(this.item)

    private render(): void {
        this.element.dataset.itemId = this.item.id
        this.element.classList.toggle('block-card-tile-selected', this.item.selected === true)
        this.openButton.setAttribute(
            'aria-pressed',
            String(this.item.selected === true),
        )
        this.marker.setAttribute('aria-label', this.item.markerAriaLabel ?? '')
        this.marker.setAttribute(
            'aria-hidden',
            String(!this.item.markerAriaLabel),
        )
        this.title.textContent = this.item.title
        this.primaryMeta.textContent = this.item.primaryMeta
        this.secondaryMeta.textContent = this.item.secondaryMeta
        this.actionButton.hidden = !this.item.action
        this.actionButton.setAttribute('aria-label', this.item.action?.ariaLabel ?? '')
        this.actionButton.innerHTML = this.item.action?.iconSvg ?? ''
    }

    update(item: BlockCardTileItem): void {
        this.item = item
        this.render()
    }

    destroy(): void {
        this.openButton.removeEventListener('click', this.handleSelect)
        this.actionButton.removeEventListener('click', this.handleAction)
        this.element.remove()
    }
}

export const createBlockCardTile = (options: BlockCardTileOptions): BlockCardTileInstance => new BlockCardTile(options)
