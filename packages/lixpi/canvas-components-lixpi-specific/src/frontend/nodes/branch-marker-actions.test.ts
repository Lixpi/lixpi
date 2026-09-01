// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    BranchMarkerActions,
    type BranchMarkerActionsOptions,
} from './branch-marker-actions.ts'

const views: BranchMarkerActions[] = []
afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    document.body.replaceChildren()
})

function mount(overrides: Partial<BranchMarkerActionsOptions> = {}) {
    const onStop = vi.fn(), onAcceptAll = vi.fn(), onRegenerate = vi.fn()
    const view = new BranchMarkerActions({ document, key: 'same-node:same-run', active: false, hasReviewOutputs: true, canAcceptAll: true, onStop, onAcceptAll, onRegenerate, ...overrides })
    views.push(view)
    const host = document.createElement('div')
    if (view.stopControl) host.appendChild(view.stopControl)
    if (view.reviewControls) host.appendChild(view.reviewControls)
    document.body.appendChild(host)
    return { view, host, onStop, onAcceptAll, onRegenerate }
}

describe('BranchMarkerActions', () => {
    it('shows stop while active and prevents control events from reaching the canvas', () => {
        const test = mount({ active: true })
        const canvasClick = vi.fn(), canvasPointerDown = vi.fn()
        test.host.addEventListener('click', canvasClick)
        test.host.addEventListener('pointerdown', canvasPointerDown)
        const button = test.view.stopControl!
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        button.click()
        expect(test.onStop).toHaveBeenCalledOnce()
        expect(canvasClick).not.toHaveBeenCalled()
        expect(canvasPointerDown).not.toHaveBeenCalled()
        expect(test.view.reviewControls).toBeNull()
        test.view.destroy()
        button.click()
        expect(test.onStop).toHaveBeenCalledOnce()
    })

    it('keeps review actions disabled until every output is ready', () => {
        const test = mount({ canAcceptAll: false })
        const buttons = test.host.querySelectorAll<HTMLButtonElement>('button')
        expect(buttons.length).toBe(2)
        for (const button of buttons) {
            expect(button.disabled).toBe(true)
            button.click()
        }
        expect(test.onAcceptAll).not.toHaveBeenCalled()
        expect(test.onRegenerate).not.toHaveBeenCalled()
        expect(test.view.stopControl).toBeNull()
    })

    it('passes review choices through ports and isolates dropdowns for repeated node IDs', () => {
        const a = mount(), b = mount()
        const dropdownA = a.host.querySelector('[data-dropdown-id]')!, dropdownB = b.host.querySelector('[data-dropdown-id]')!
        expect(dropdownA.getAttribute('data-dropdown-id')).not.toBe(dropdownB.getAttribute('data-dropdown-id'))
        a.host.querySelector<HTMLButtonElement>('.is-accept')!.click()
        expect(a.onAcceptAll).toHaveBeenCalledOnce()
        const trigger = dropdownA.querySelector<HTMLButtonElement>('button')!
        trigger.click()
        const firstChoice = document.body.querySelector<HTMLElement>('.dropdown-option-item')!
        firstChoice.click()
        trigger.click()
        document.body.querySelectorAll<HTMLElement>('.dropdown-option-item')[1]!.click()
        expect(a.onRegenerate.mock.calls).toEqual([['existing-prompt'], ['regenerate-prompt']])
        a.view.setZoomScale(1.5)
        expect(a.view.reviewControls?.style.getPropertyValue('--workspace-branch-marker-review-zoom-scale')).toBe('1.5')
        a.view.destroy()
        firstChoice.click()
        expect(a.onRegenerate).toHaveBeenCalledTimes(2)
        expect(b.view.reviewControls?.isConnected).toBe(true)
        expect(b.onRegenerate).not.toHaveBeenCalled()
    })

    it('renders no actions when an inactive branch has no unaccepted outputs', () => {
        const test = mount({ hasReviewOutputs: false })
        expect(test.view.reviewControls).toBeNull()
        expect(test.view.stopControl).toBeNull()
    })
})
