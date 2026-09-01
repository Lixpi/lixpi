import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createBlockCardTile } from './blockCardTile.ts'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('createBlockCardTile', () => {
    it('renders the preserved marker, title, metadata, selection, and action layout', () => {
        const card = createBlockCardTile({
            item: {
                id: 'item-1',
                title: 'Character Creator request',
                primaryMeta: 'Aug 14, 7:56 PM · 1 day ago',
                secondaryMeta: '2 messages · Completed',
                selected: true,
                action: { ariaLabel: 'Remove item', iconSvg: '<svg><path /></svg>' },
            },
        })

        expect(card.element.dataset.itemId).toBe('item-1')
        expect(card.element.classList.contains('block-card-tile-selected')).toBe(true)
        expect(card.element.querySelector('.block-card-tile-marker')).not.toBeNull()
        expect(card.element.querySelector('.block-card-tile-title')?.textContent).toBe('Character Creator request')
        expect(card.element.querySelector('.block-card-tile-primary-meta')?.textContent).toBe('Aug 14, 7:56 PM · 1 day ago')
        expect(card.element.querySelector('.block-card-tile-secondary-meta')?.textContent).toBe('2 messages · Completed')
        expect(card.element.querySelector('.block-card-tile-action svg')).not.toBeNull()
    })

    it('emits the current item and updates content without replacing the card element', () => {
        const onSelect = vi.fn()
        const onAction = vi.fn()
        const card = createBlockCardTile({
            item: {
                id: 'item-1',
                title: 'First',
                primaryMeta: 'Earlier',
                secondaryMeta: 'Pending',
                action: { ariaLabel: 'Open action', iconSvg: '<svg></svg>' },
            },
            onSelect,
            onAction,
        })
        const element = card.element

        card.update({
            id: 'item-2',
            title: 'Second',
            primaryMeta: 'Now',
            secondaryMeta: 'Ready',
            selected: true,
            action: { ariaLabel: 'Open updated action', iconSvg: '<svg></svg>' },
        })
        card.element.querySelector<HTMLButtonElement>('.block-card-tile-open')?.click()
        card.element.querySelector<HTMLButtonElement>('.block-card-tile-action')?.click()

        expect(card.element).toBe(element)
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-2' }))
        expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-2' }))
    })
})
