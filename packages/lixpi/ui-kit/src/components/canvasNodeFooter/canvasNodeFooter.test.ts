// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { createCanvasNodeFooter } from './index.ts'
import { createSidePanel } from '../sidePanel/sidePanel.ts'

const icons = {
    info: '<span>i</span>',
    progress: {
        viewBox: {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        },
        paths: ['M0 0 H10 V10 Z', 'M0 0 H10 V10 Z', 'M0 0 H10 V10 Z'] as const,
    },
}

afterEach(() => void vi.useRealTimers())

describe('canvas node footer', () => {
    it('renders info, active progress, and separated caller sections in order', () => {
        vi.useFakeTimers()
        const model = document.createElement('div')
        model.className = 'test-model'
        const review = document.createElement('button')
        review.className = 'test-review'
        const footer = createCanvasNodeFooter({
            icons,
            infoLabel: 'Artifact details and generation history',
            progressActive: true,
            selected: false,
            sections: [
                {
                    elements: [model],
                    separated: true,
                },
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
        expect(footer.element.querySelector('.canvas-node-footer-info-button')?.getAttribute('data-help-tooltip'))
            .toBe('aria-label')
        expect(footer.element.querySelector('.canvas-node-footer-progress-button')?.getAttribute('data-help-tooltip'))
            .toBe('Generation details')
        expect(vi.getTimerCount()).toBeGreaterThan(0)
        footer.destroy()
    })

    it('opens the same details entry point from info and progress without bubbling to the canvas', () => {
        vi.useFakeTimers()
        const onOpenDetails = vi.fn()
        const onParentClick = vi.fn()
        const parent = document.createElement('div')
        const footer = createCanvasNodeFooter({
            icons,
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

    it('routes details controls past an open side panel while ordinary outside clicks still close it', () => {
        vi.useFakeTimers()
        const onOpenDetails = vi.fn()
        const onOpenChange = vi.fn()
        const panelElement = document.createElement('aside')
        const outside = document.createElement('div')
        const sidePanel = createSidePanel({
            side: 'right',
            offset: 0,
            grabWidth: 20,
            minWidth: 320,
            defaultWidth: 380,
            getMaxWidth: () => 900,
            onResize: vi.fn(),
            overlay: { enabled: false },
            onOpenChange,
        })
        const footer = createCanvasNodeFooter({
            icons,
            infoLabel: 'Media details',
            progressActive: true,
            selected: false,
            onOpenDetails,
        })
        document.body.append(panelElement, outside, footer.element)
        sidePanel.mountOpen(panelElement)

        try {
            footer.element.querySelector<HTMLButtonElement>('.canvas-node-footer-info-button')!.click()
            footer.element.querySelector<HTMLButtonElement>('.canvas-node-footer-progress-button')!.click()

            expect(onOpenDetails).toHaveBeenCalledTimes(2)
            expect(onOpenChange).not.toHaveBeenCalled()
            outside.click()
            expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
        } finally {
            footer.destroy()
            sidePanel.destroy()
            panelElement.remove()
            outside.remove()
        }
    })

    it('hides terminal progress and reflects details selection on both entry controls', () => {
        vi.useFakeTimers()
        const footer = createCanvasNodeFooter({
            icons,
            infoLabel: 'Generation history',
            progressActive: true,
            selected: false,
            onOpenDetails: vi.fn(),
        })

        footer.update({
            progressActive: false,
            selected: true,
        })

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
            icons,
            infoLabel: 'Generation history',
            progressActive: true,
            selected: false,
            sections: [{
                elements: [null, undefined],
                separated: true,
            }],
            onOpenDetails: vi.fn(),
        })
        document.body.appendChild(footer.element)

        expect(footer.element.querySelector('.canvas-node-footer-separator')).toBeNull()
        footer.destroy()

        expect(document.body.contains(footer.element)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })
})
