// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createContextPreviewPopover } from './contextPreviewPopover.ts'

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
})

function fixture() {
    const root = document.createElement('div')
    document.body.append(root)
    let scale = 1.5
    const instance = createContextPreviewPopover({
        accessibleLabel: 'Preview',
        content: document.createElement('div'),
        contentClassName: 'example-preview',
        triggerContent: document.createElement('span'),
        inlinePopover: true,
        getPortal: () => ({ root, scale }),
    })
    root.append(instance.dom)
    const content = instance.dom.querySelector('.context-preview-inline-popover') as HTMLElement
    return {
        root,
        instance,
        content,
        setScale: (value: number) => {
            scale = value
        },
    }
}

describe('Context preview surface', () => {
    it('projects to the supplied root, follows scale changes and cancels work on disposal', () => {
        const { root, instance, content, setScale } = fixture()
        instance.dom.dispatchEvent(new PointerEvent('pointerenter'))
        expect(content.parentElement).toBe(root)
        expect(content.style.transform).toContain('scale(1.5)')
        setScale(2)
        vi.advanceTimersByTime(20)
        expect(content.style.transform).toContain('scale(2)')
        instance.destroy()
        expect(root.children).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('preserves another surface when content changes and one view is destroyed', () => {
        const first = fixture()
        const second = fixture()
        first.instance.dom.dispatchEvent(new PointerEvent('pointerenter'))
        second.instance.dom.dispatchEvent(new PointerEvent('pointerenter'))
        const content = document.createElement('span')
        content.textContent = 'Updated'
        second.instance.updateContent({ accessibleLabel: 'Updated preview', content, contentClassName: 'updated-preview' })
        first.instance.destroy()
        expect(second.content.parentElement).toBe(second.root)
        expect(second.content.textContent).toBe('Updated')
        expect(second.content.classList.contains('is-open')).toBe(true)
        second.instance.destroy()
        expect(vi.getTimerCount()).toBe(0)
    })
})
