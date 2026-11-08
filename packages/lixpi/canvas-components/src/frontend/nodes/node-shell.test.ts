// @vitest-environment happy-dom

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type ComponentContext,
    type NodeRegistration,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import { withNodeShell } from './node-shell.ts'

type NodeData = { title: string }

const createNode = (title: string): EngineNode<NodeData> => ({
    nodeId: 'node-1',
    type: 'example',
    data: { title },
    position: {
        x: 12,
        y: 24,
    },
    dimensions: {
        width: 160,
        height: 90,
    },
    ports: [],
})

const bounds: CanvasEngineRect = {
    x: 12,
    y: 24,
    width: 160,
    height: 90,
}

const viewport: CanvasViewport = {
    x: 0,
    y: 0,
    zoom: 1,
}

const createContext = (signal = new AbortController().signal) => {
    const overlayRoot = document.createElement('div')
    const releaseOverlay = vi.fn(() => void overlayRoot.replaceChildren())
    const context = {
        contentRoot: document.createElement('div'),
        resources: {},
        media: {},
        layers: {},
        signal,
        requestFrame: vi.fn(() => vi.fn()),
        invalidate: vi.fn(),
        subscribeScene: vi.fn(() => vi.fn()),
        subscribeView: vi.fn(() => vi.fn()),
        mountOverlay: vi.fn((element: HTMLElement, _space: 'world' | 'screen') => {
            overlayRoot.append(element)

            return releaseOverlay
        }),
    } as unknown as ComponentContext

    return {
        context,
        overlayRoot,
        releaseOverlay,
    }
}

const createRegistration = (
    view: ReturnType<typeof createContentView>,
): NodeRegistration<NodeData> => ({
    type: 'example',
    geometry: {
        measure: node => {
            const nodeBounds = {
                x: node.position.x,
                y: node.position.y,
                width: node.dimensions.width,
                height: node.dimensions.height,
            }

            return {
                visualBounds: nodeBounds,
                hitBounds: nodeBounds,
                selectionBounds: nodeBounds,
                collisionBounds: nodeBounds,
                connectorBounds: nodeBounds,
            }
        },
        resize: {
            min: {
                width: 1,
                height: 1,
            },
            preserveAspectRatio: false,
        },
        movable: true,
    },
    mount: vi.fn(() => view),
})

const createContentView = () => ({
    update: vi.fn(),
    setGeometry: vi.fn(),
    setSelected: vi.fn(),
    setVisible: vi.fn(),
    prefetch: vi.fn(async () => {}),
    destroy: vi.fn(),
})

describe('withNodeShell', () => {
    it('forwards view lifecycle and mounts a screen overlay that it releases on destroy', async () => {
        const {
            context,
            overlayRoot,
            releaseOverlay,
        } = createContext()
        const content = createContentView()
        const titleUpdate = vi.fn()
        const titleDestroy = vi.fn()
        const registration = createRegistration(content)
        const wrapped = withNodeShell(registration, {
            getSettings: () => ({
                gap: 8,
                zoomScaling: { minZoom: 1 },
            }),
            title: (host, node) => {
                host.textContent = node.data.title

                return {
                    update: titleUpdate,
                    destroy: titleDestroy,
                }
            },
        })
        const view = wrapped.mount(createNode('Initial'), context)
        const updated = createNode('Updated')
        const overlay = overlayRoot.querySelector<HTMLElement>('.canvas-node-shell')

        expect(overlay).not.toBeNull()
        expect(context.mountOverlay).toHaveBeenCalledWith(overlay, 'screen')
        expect(overlay?.querySelector('.canvas-node-shell-title')?.textContent).toBe('Initial')
        expect(overlay?.querySelector('.canvas-node-shell-metadata')?.hidden).toBe(true)
        expect(overlay?.querySelector('.canvas-node-shell-actions')?.hidden).toBe(true)

        view.update(updated)
        view.setGeometry(bounds, viewport)
        view.setVisible(false)
        view.setSelected(true)
        await view.prefetch?.()

        expect(content.update).toHaveBeenCalledWith(updated)
        expect(titleUpdate).toHaveBeenCalledWith(updated)
        expect(content.setGeometry).toHaveBeenCalledWith(bounds, viewport)
        expect(overlay?.style.left).not.toBe('')
        expect(content.setVisible).toHaveBeenCalledWith(false)
        expect(overlay?.hidden).toBe(true)
        expect(content.setSelected).toHaveBeenCalledWith(true)
        expect(overlay?.dataset.selected).toBe('true')
        expect(content.prefetch).toHaveBeenCalledOnce()

        view.destroy()
        view.destroy()

        expect(releaseOverlay).toHaveBeenCalledOnce()
        expect(overlayRoot.children).toHaveLength(0)
        expect(content.destroy).toHaveBeenCalledOnce()
        expect(titleDestroy).toHaveBeenCalledOnce()
    })

    it('releases mounted content and earlier slots when a later slot fails to mount', () => {
        const { context } = createContext()
        const content = createContentView()
        const titleDestroy = vi.fn()
        const failure = new Error('metadata mount failed')
        const wrapped = withNodeShell(createRegistration(content), {
            getSettings: () => ({
                gap: 8,
                zoomScaling: { minZoom: 1 },
            }),
            title: () => ({
                destroy: titleDestroy,
            }),
            metadata: () => {
                throw failure
            },
        })

        expect(() => wrapped.mount(createNode('Partial'), context)).toThrow(failure)
        expect(content.destroy).toHaveBeenCalledOnce()
        expect(titleDestroy).toHaveBeenCalledOnce()
        expect(context.mountOverlay).not.toHaveBeenCalled()
    })

    it('releases the wrapped view and overlay when the drawing context aborts', () => {
        const controller = new AbortController()
        const {
            context,
            overlayRoot,
            releaseOverlay,
        } = createContext(controller.signal)
        const content = createContentView()
        const titleDestroy = vi.fn()
        const wrapped = withNodeShell(createRegistration(content), {
            getSettings: () => ({
                gap: 8,
                zoomScaling: { minZoom: 1 },
            }),
            title: () => ({
                destroy: titleDestroy,
            }),
        })

        wrapped.mount(createNode('Aborted'), context)
        controller.abort()

        expect(releaseOverlay).toHaveBeenCalledOnce()
        expect(overlayRoot.children).toHaveLength(0)
        expect(content.destroy).toHaveBeenCalledOnce()
        expect(titleDestroy).toHaveBeenCalledOnce()
    })

    it('does not mount a registration into an already aborted drawing context', () => {
        const controller = new AbortController()
        controller.abort()
        const { context } = createContext(controller.signal)
        const content = createContentView()
        const registration = createRegistration(content)
        const wrapped = withNodeShell(registration, {
            getSettings: () => ({
                gap: 8,
                zoomScaling: { minZoom: 1 },
            }),
        })

        expect(() => wrapped.mount(createNode('Aborted'), context)).toThrow()
        expect(registration.mount).not.toHaveBeenCalled()
    })
})


describe('withNodeShell conditional chrome and footer geometry', () => {
    it('toggles chrome for a node update without replacing its content view', () => {
        const {
            context,
            overlayRoot,
        } = createContext()
        const content = createContentView()
        const wrapped = withNodeShell(createRegistration(content), {
            getSettings: () => ({
                gap: 8,
                zoomScaling: { minZoom: 1 },
            }),
            enabled: node => node.data.title !== 'hidden',
        })
        const view = wrapped.mount(createNode('visible'), context)
        const overlay = overlayRoot.querySelector<HTMLElement>('.canvas-node-shell')

        view.setVisible(true)
        expect(overlay?.hidden).toBe(false)

        view.update(createNode('hidden'))
        expect(overlay?.hidden).toBe(true)
        expect(content.update).toHaveBeenCalledOnce()
        expect(content.destroy).not.toHaveBeenCalled()

        view.update(createNode('visible'))
        expect(overlay?.hidden).toBe(false)
        expect(content.update).toHaveBeenCalledTimes(2)

        view.destroy()
        expect(content.destroy).toHaveBeenCalledOnce()
    })

    it('offsets the footer while keeping the title anchored to the node', () => {
        const {
            context,
            overlayRoot,
        } = createContext()
        const content = createContentView()
        let footerOffset = 0
        const wrapped = withNodeShell(createRegistration(content), {
            getSettings: () => ({
                gap: 8,
                zoomScaling: { minZoom: 1 },
            }),
            getFooterOffsetScreen: () => footerOffset,
            title: host => {
                host.textContent = 'Title'

                return { destroy: vi.fn() }
            },
        })
        const view = wrapped.mount(createNode('node'), context)
        const overlay = overlayRoot.querySelector<HTMLElement>('.canvas-node-shell')
        const title = overlay?.querySelector<HTMLElement>('.canvas-node-shell-title')

        view.setGeometry(bounds, viewport)
        const initialTop = Number.parseFloat(overlay?.style.top ?? '0')
        const titleTop = title?.style.top

        footerOffset = 24
        view.setGeometry(bounds, viewport)

        expect(Number.parseFloat(overlay?.style.top ?? '0') - initialTop).toBe(24)
        expect(Number.parseFloat(title?.style.top ?? '0') - Number.parseFloat(titleTop ?? '0')).toBe(-24)
        expect(content.setGeometry).toHaveBeenCalledTimes(2)
        view.destroy()
    })
})
