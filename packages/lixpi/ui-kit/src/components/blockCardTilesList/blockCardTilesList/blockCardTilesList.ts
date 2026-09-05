import { html } from '@lixpi/ui-primitives/dom'
import {
    createBlockCardTile,
    type BlockCardTileInstance,
    type BlockCardTileItem,
} from '../blockCardTile/index.ts'

export type BlockCardTilesListOptions = {
    title: string
    items: BlockCardTileItem[]
    emptyText?: string
    onSelect?: (item: BlockCardTileItem) => void
    onAction?: (item: BlockCardTileItem) => void
}

export type BlockCardTilesListInstance = {
    element: HTMLDivElement
    setItems: (items: BlockCardTileItem[]) => void
    destroy: () => void
}

class BlockCardTilesList implements BlockCardTilesListInstance {
    readonly element: HTMLDivElement
    private readonly itemsHost: HTMLDivElement
    private readonly empty: HTMLDivElement
    private readonly tiles = new Map<string, BlockCardTileInstance>()

    constructor(private readonly options: BlockCardTilesListOptions) {
        this.element = html`
            <div className="block-card-tiles-list">
                <div className="block-card-tiles-list-title"></div>
                <div className="block-card-tiles-list-items"></div>
                <div className="block-card-tiles-list-empty"></div>
            </div>
        ` as HTMLDivElement
        const title = this.element.querySelector<HTMLDivElement>('.block-card-tiles-list-title')!
        this.itemsHost = this.element.querySelector<HTMLDivElement>('.block-card-tiles-list-items')!
        this.empty = this.element.querySelector<HTMLDivElement>('.block-card-tiles-list-empty')!
        title.textContent = options.title
        this.empty.textContent = options.emptyText ?? ''
        this.setItems(options.items)
    }

    setItems(items: BlockCardTileItem[]): void {
        for (const tile of this.tiles.values()) tile.destroy()

        this.tiles.clear()
        this.itemsHost.replaceChildren()
        this.empty.hidden = items.length > 0 || !this.options.emptyText

        for (const item of items) {
            const tile = createBlockCardTile({
                item,
                onSelect: this.options.onSelect,
                onAction: this.options.onAction,
            })
            this.tiles.set(item.id, tile)
            this.itemsHost.appendChild(tile.element)
        }
    }

    destroy(): void {
        for (const tile of this.tiles.values()) tile.destroy()

        this.tiles.clear()
        this.element.remove()
    }
}

export const createBlockCardTilesList = (options: BlockCardTilesListOptions): BlockCardTilesListInstance => new BlockCardTilesList(options)
