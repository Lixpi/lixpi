import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlockCardTilesList } from './blockCardTilesList.ts'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('createBlockCardTilesList', () => {
    it('renders a titled list and delegates card selection and actions', () => {
        const onSelect = vi.fn()
        const onAction = vi.fn()
        const list = createBlockCardTilesList({
            title: 'Blocks',
            items: [{
                id: 'block-1',
                title: 'First block',
                primaryMeta: 'Today',
                secondaryMeta: 'Ready',
                action: { ariaLabel: 'Block action', iconSvg: '<svg></svg>' },
            }],
            onSelect,
            onAction,
        })

        expect(list.element.querySelector('.block-card-tiles-list-title')?.textContent).toBe('Blocks')
        expect(list.element.querySelectorAll('.block-card-tile')).toHaveLength(1)
        list.element.querySelector<HTMLButtonElement>('.block-card-tile-open')?.click()
        list.element.querySelector<HTMLButtonElement>('.block-card-tile-action')?.click()
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-1' }))
        expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-1' }))
    })

    it('replaces cards and exposes an optional empty state', () => {
        const list = createBlockCardTilesList({
            title: 'Blocks',
            emptyText: 'No blocks',
            items: [{ id: 'block-1', title: 'First', primaryMeta: 'Today', secondaryMeta: 'Ready' }],
        })

        list.setItems([])

        expect(list.element.querySelectorAll('.block-card-tile')).toHaveLength(0)
        expect(list.element.querySelector<HTMLElement>('.block-card-tiles-list-empty')?.hidden).toBe(false)
        expect(list.element.querySelector('.block-card-tiles-list-empty')?.textContent).toBe('No blocks')
    })
})
