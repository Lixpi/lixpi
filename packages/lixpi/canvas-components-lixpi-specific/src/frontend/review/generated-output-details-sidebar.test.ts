// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { createGeneratedOutputDetailsSidebar } from './generated-output-details-sidebar.ts'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('createGeneratedOutputDetailsSidebar', () => {
    it('owns the single scroll body and delegates all item content to one renderer', () => {
        const destroyContent = vi.fn()
        const panel = createGeneratedOutputDetailsSidebar({
            onClose: vi.fn(),
            renderContent: (body) => {
                body.append('Unified item metadata and history')
                return { destroy: destroyContent }
            },
        })

        expect(panel.element.getAttribute('aria-label')).toBe('Item details')
        expect(panel.body.classList.contains('workspace-generated-output-details-content')).toBe(true)
        expect(panel.body.textContent).toBe('Unified item metadata and history')

        panel.destroy()
        panel.destroy()
        expect(destroyContent).toHaveBeenCalledOnce()
    })

    it('uses the item-details close control without adding a generation-only heading', () => {
        const onClose = vi.fn()
        const panel = createGeneratedOutputDetailsSidebar({
            onClose,
            renderContent: () => undefined,
        })
        document.body.appendChild(panel.element)

        const closeButton = panel.element.querySelector<HTMLButtonElement>('[aria-label="Close item details"]')!
        expect(closeButton.dataset.helpTooltip).toBe('aria-label')
        expect(closeButton.getAttribute('title')).toBeNull()
        closeButton.click()

        expect(onClose).toHaveBeenCalledOnce()
        expect(panel.element.textContent).not.toContain('Generation details')
        panel.destroy()
        closeButton.click()
        expect(onClose).toHaveBeenCalledOnce()
    })
})
