import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCanvasNodeFooter } from './index.ts'

afterEach(() => {
    vi.useRealTimers()
})

describe('canvas node footer', () => {
    it('renders info, active progress, and separated caller sections in order', () => {
        vi.useFakeTimers()
        const model = document.createElement('div')
        model.className = 'test-model'
        const review = document.createElement('button')
        review.className = 'test-review'
        const footer = createCanvasNodeFooter({
            infoLabel: 'Artifact details and generation history',
            progressActive: true,
            selected: false,
            sections: [
                { elements: [model], separated: true },
                { elements: [null, review] },
            ],
            onOpenDetails: vi.fn(),
        })

        expect([...footer.element.children].map(element => element.className)).toEqual([
            'canvas-node-footer-info-button nopan',
            'canvas-node-footer-progress-button nopan',
            'canvas-node-footer-separator',
            'test-model',
            'test-review',
        ])
        expect(footer.element.querySelector('.progress-ripple-icon-svg')).not.toBeNull()
        expect(vi.getTimerCount()).toBeGreaterThan(0)
        footer.destroy()
    })

    it('opens the same details entry point from info and progress without bubbling to the canvas', () => {
        vi.useFakeTimers()
        const onOpenDetails = vi.fn()
        const onParentClick = vi.fn()
        const parent = document.createElement('div')
        const footer = createCanvasNodeFooter({
            infoLabel: 'Generation history',
            progressActive: true,
            selected: false,
            onOpenDetails,
        })
        parent.addEventListener('click', onParentClick)
        parent.appendChild(footer.element)

        footer.element.querySelector<HTMLButtonElement>('.canvas-node-footer-info-button')!.click()
        footer.element.querySelector<HTMLButtonElement>('.canvas-node-footer-progress-button')!.click()

        expect(onOpenDetails).toHaveBeenCalledTimes(2)
        expect(onParentClick).not.toHaveBeenCalled()
        footer.destroy()
    })

    it('hides terminal progress and reflects details selection on both entry controls', () => {
        vi.useFakeTimers()
        const footer = createCanvasNodeFooter({
            infoLabel: 'Generation history',
            progressActive: true,
            selected: false,
            onOpenDetails: vi.fn(),
        })

        footer.update({ progressActive: false, selected: true })

        const info = footer.element.querySelector<HTMLButtonElement>('.canvas-node-footer-info-button')!
        const progress = footer.element.querySelector<HTMLButtonElement>('.canvas-node-footer-progress-button')!
        expect(info.classList.contains('is-selected')).toBe(true)
        expect(progress.classList.contains('is-selected')).toBe(true)
        expect(info.getAttribute('aria-expanded')).toBe('true')
        expect(progress.getAttribute('aria-expanded')).toBe('true')
        expect(progress.hidden).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
        footer.destroy()
    })

    it('omits separators for empty sections and destroys its animation and DOM', () => {
        vi.useFakeTimers()
        const footer = createCanvasNodeFooter({
            infoLabel: 'Generation history',
            progressActive: true,
            selected: false,
            sections: [{ elements: [null, undefined], separated: true }],
            onOpenDetails: vi.fn(),
        })
        document.body.appendChild(footer.element)

        expect(footer.element.querySelector('.canvas-node-footer-separator')).toBeNull()
        footer.destroy()

        expect(document.body.contains(footer.element)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })
})
