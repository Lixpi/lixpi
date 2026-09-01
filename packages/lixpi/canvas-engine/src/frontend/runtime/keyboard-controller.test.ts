// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { CanvasKeyboardController } from './keyboard-controller.ts'

afterEach(() => document.body.replaceChildren())

describe('CanvasKeyboardController', () => {
    it('dispatches deletion only to the canvas that owns focus or the latest background interaction', () => {
        const first = document.createElement('div')
        const second = document.createElement('div')
        document.body.append(first, second)
        const aDelete = vi.fn(() => true)
        const bDelete = vi.fn(() => true)
        const a = new CanvasKeyboardController({ root: first, onEscape: vi.fn(), onDelete: aDelete })
        const b = new CanvasKeyboardController({ root: second, onEscape: vi.fn(), onDelete: bDelete })
        first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
        expect(aDelete).toHaveBeenCalledOnce()
        expect(bDelete).not.toHaveBeenCalled()
        second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
        expect(aDelete).toHaveBeenCalledOnce()
        expect(bDelete).toHaveBeenCalledOnce()
        a.destroy()
        b.destroy()
    })

    it('leaves editable content and handled keys alone and removes listeners on disposal', () => {
        const root = document.createElement('div')
        const editor = document.createElement('div')
        editor.contentEditable = 'true'
        const text = document.createElement('span')
        editor.append(text)
        root.append(editor)
        document.body.append(root)
        const onDelete = vi.fn(() => true)
        const onEscape = vi.fn()
        const controller = new CanvasKeyboardController({ root, onDelete, onEscape })
        text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
        expect(onDelete).not.toHaveBeenCalled()
        const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        handled.preventDefault()
        root.dispatchEvent(handled)
        expect(onEscape).not.toHaveBeenCalled()
        controller.destroy()
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        expect(onEscape).not.toHaveBeenCalled()
    })
})
