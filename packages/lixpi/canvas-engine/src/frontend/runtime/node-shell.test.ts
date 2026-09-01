// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { NodeShell } from './node-shell.ts'

afterEach(() => document.body.replaceChildren())

describe('NodeShell', () => {
    it('owns node input, custom handle content and zoom sizing without owning artwork', () => {
        const onClick = vi.fn()
        const onDragStart = vi.fn()
        const onResize = vi.fn()
        const releaseContent = vi.fn()
        const shell = new NodeShell({
            document,
            nodeId: 'node',
            bounds: { x: 20, y: 30, width: 200, height: 100 },
            layer: 12,
            zoom: 2,
            className: 'custom-node',
            dragClassName: 'custom-drag',
            onClick,
            onDragStart,
            resize: {
                handles: ['top-left', 'bottom-right'],
                measure: zoom => ({ size: 12 / zoom, offset: 6 / zoom }),
                onPointerDown: onResize,
                content: element => {
                    element.textContent = '+'
                    return releaseContent
                },
            },
        })
        document.body.appendChild(shell.element)
        expect(shell.element.style.left).toBe('20px')
        expect(shell.element.classList.contains('custom-node')).toBe(true)
        const handle = shell.element.querySelector('[data-corner="bottom-right"]') as HTMLElement
        expect(handle.style.width).toBe('6px')
        expect(handle.style.bottom).toBe('-3px')
        handle.dispatchEvent(new MouseEvent('mousedown'))
        expect(onResize).toHaveBeenCalledWith(expect.any(MouseEvent), 'bottom-right')
        shell.dragOverlay.dispatchEvent(new MouseEvent('mousedown'))
        expect(onDragStart).toHaveBeenCalledOnce()
        shell.setZoom(1)
        expect(handle.style.width).toBe('12px')
        expect(handle.style.bottom).toBe('-6px')
        shell.destroy()
        shell.destroy()
        handle.dispatchEvent(new MouseEvent('mousedown'))
        shell.dragOverlay.dispatchEvent(new MouseEvent('mousedown'))
        shell.element.dispatchEvent(new MouseEvent('click'))
        expect(onResize).toHaveBeenCalledOnce()
        expect(onDragStart).toHaveBeenCalledOnce()
        expect(onClick).not.toHaveBeenCalled()
        expect(releaseContent).toHaveBeenCalledTimes(2)
        expect(shell.element.isConnected).toBe(false)
    })

    it('releases earlier handles when a later content mount fails', () => {
        const dispose = vi.fn()
        expect(() =>
            new NodeShell({
                document,
                nodeId: 'node',
                bounds: { x: 0, y: 0, width: 20, height: 20 },
                layer: 1,
                zoom: 1,
                onClick: vi.fn(),
                onDragStart: vi.fn(),
                resize: {
                    handles: ['left', 'right'],
                    measure: () => ({ size: 10, offset: 5 }),
                    onPointerDown: vi.fn(),
                    content: (_element, corner) => {
                        if (corner === 'right') throw new Error('content failed')
                        return dispose
                    },
                },
            })
        ).toThrow('content failed')
        expect(dispose).toHaveBeenCalledOnce()
        expect(document.querySelector('.canvas-node-shell')).toBeNull()
    })
})
