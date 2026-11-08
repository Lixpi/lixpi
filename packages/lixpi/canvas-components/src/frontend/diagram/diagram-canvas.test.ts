// @vitest-environment happy-dom

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { type CanvasEngineRect, type CanvasEnginePoint, type SceneSnapshot, type CanvasViewport } from '@lixpi/canvas-engine/shared'
import { createDiagramConnectorSettings } from '../connectors/connector-settings.ts'
import {
    CanvasThemeStore,
    createCanvasTheme,
} from '../theme/canvas-theme.ts'

type DiagramNodeData = {
    label: string
}

type MockCanvasOptions = {
    root: HTMLElement
    scene: SceneSnapshot<DiagramNodeData>
    viewport: CanvasViewport
    connectors?: unknown
}

const canvasMocks = vi.hoisted(() => {
    const instances: unknown[] = []

    class CanvasControllerMock {
        readonly ready = Promise.resolve(true)
        readonly scene: {
            scene: SceneSnapshot<DiagramNodeData>
            viewport: CanvasViewport
            getNodeGeometry: (nodeId: string) => { hitBounds: CanvasEngineRect } | undefined
        }
        readonly installViewport = vi.fn((_options: unknown) => {})
        readonly setScene = vi.fn((scene: SceneSnapshot<DiagramNodeData>) => void (this.scene.scene = scene))
        readonly setViewport = vi.fn((viewport: CanvasViewport) => void (this.scene.viewport = viewport))
        readonly setConnectionSettings = vi.fn()
        readonly resize = vi.fn()
        readonly destroy = vi.fn()
        readonly clientToWorld = vi.fn((point: CanvasEnginePoint): CanvasEnginePoint => {
            const bounds = this.options.root.getBoundingClientRect()
            const viewport = this.scene.viewport

            return {
                x: (point.x - bounds.left - viewport.x) / viewport.zoom,
                y: (point.y - bounds.top - viewport.y) / viewport.zoom,
            }
        })

        constructor(readonly options: MockCanvasOptions) {
            this.scene = {
                scene: options.scene,
                viewport: options.viewport,
                getNodeGeometry: nodeId => {
                    const node = this.scene.scene.nodes.find(candidate => candidate.nodeId === nodeId)

                    if (!node)
                        return undefined

                    return {
                        hitBounds: {
                            ...node.position,
                            ...node.dimensions,
                        },
                    }
                },
            }
            instances.push(this)
        }
    }

    return {
        instances,
        CanvasControllerMock,
    }
})

vi.mock('@lixpi/canvas-engine/frontend/runtime', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-engine/frontend/runtime')>()

    return {
        ...actual,
        CanvasController: canvasMocks.CanvasControllerMock,
    }
})

import {
    createDiagramCanvas,
} from './diagram-canvas.ts'

class ResizeObserverMock {
    static readonly instances: ResizeObserverMock[] = []
    private readonly callback: ResizeObserverCallback
    readonly observe = vi.fn()
    readonly disconnect = vi.fn()

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        ResizeObserverMock.instances.push(this)
    }

    trigger(): void {
        this.callback(
            [],
            this as unknown as ResizeObserver,
        )
    }
}

const pointerEvent = (
    type: string,
    x: number,
    y: number,
): Event => {
    const event = new Event(type, { bubbles: true })

    Object.defineProperties(event, {
        button: { value: 0 },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        clientX: { value: x },
        clientY: { value: y },
    })

    return event
}

describe('DiagramCanvas', () => {
    beforeEach(() => {
        document.body.replaceChildren()
        canvasMocks.instances.length = 0
        ResizeObserverMock.instances.length = 0
        vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    })

    afterEach(() => void vi.unstubAllGlobals())

    it('forwards native marker artwork and body length with the supplied connection policy', () => {
        const marker = {
            paths: ['M0 0'],
            width: 256,
            reference: {
                x: 48,
                y: 128,
            },
            bodyLengthFraction: (228.992 - 48) / 256,
        } as const
        const targetMarker = vi.fn(() => 'arrowhead' as const)
        const canvas = createDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            registerNodes: () => {},
            connectionMarker: marker,
            connectionPolicy: { targetMarker },
            onError: vi.fn(),
        })
        document.body.append(canvas.el)
        canvas.mount()

        const controller = canvasMocks.instances[0] as InstanceType<typeof canvasMocks.CanvasControllerMock>
        const connectors = controller.options.connectors as {
            settings?: { scaling: { zoomScaling: { minZoom: number } } }
            renderer?: {
                marker?: typeof marker
                zoomScaling?: { minZoom: number }
            }
            markerBodyLengthFraction?: number
            policy?: { targetMarker?: typeof targetMarker }
        }
        expect(marker.paths.length).toBeGreaterThan(0)
        expect(connectors.renderer?.marker).toBe(marker)
        expect(connectors.renderer?.zoomScaling).toBe(connectors.settings?.scaling.zoomScaling)
        expect(connectors.markerBodyLengthFraction).toBe(marker.bodyLengthFraction)
        expect(connectors.policy?.targetMarker).toBe(targetMarker)

        canvas.destroy()
    })


    it('forwards shared theme connector updates to the mounted engine', () => {
        const theme = new CanvasThemeStore(createCanvasTheme())
        const canvas = createDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            registerNodes: () => {},
            theme,
            onError: vi.fn(),
        })
        document.body.append(canvas.el)
        canvas.mount()

        const controller = canvasMocks.instances[0] as InstanceType<typeof canvasMocks.CanvasControllerMock>
        const updateCount = controller.setConnectionSettings.mock.calls.length

        theme.update({
            connectors: {
                scaling: {
                    strokeWidth: 9,
                },
            },
        })

        expect(controller.setConnectionSettings).toHaveBeenCalledTimes(updateCount + 1)
        expect(controller.setConnectionSettings).toHaveBeenLastCalledWith(expect.objectContaining({
            scaling: expect.objectContaining({
                strokeWidth: 9,
            }),
        }))
        canvas.destroy()
    })

    it('forwards custom arrowless scientific zoom scaling to the renderer', () => {
        const settings = createDiagramConnectorSettings()
        const canvas = createDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            registerNodes: () => {},
            connectionSettings: settings,
            onError: vi.fn(),
        })
        document.body.append(canvas.el)
        canvas.mount()

        const controller = canvasMocks.instances[0] as InstanceType<typeof canvasMocks.CanvasControllerMock>
        const connectors = controller.options.connectors as {
            settings?: typeof settings
            renderer?: {
                marker?: unknown
                zoomScaling?: typeof settings.scaling.zoomScaling
            }
        }
        expect(connectors.settings).toBe(settings)
        expect(connectors.renderer?.zoomScaling).toBe(settings.scaling.zoomScaling)
        expect(connectors.renderer?.marker).toBeUndefined()

        canvas.destroy()
    })

    it('keeps oversized diagrams inside the minimum zoom and aligns overflowing axes to the start', async () => {
        const canvas = createDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            registerNodes: () => {},
            connectionSettings: false,
            fitPadding: 32,
            minFitZoom: 0.7,
            fitAlignment: 'start',
            onError: vi.fn(),
        })
        document.body.append(canvas.el)
        Object.defineProperties(canvas.el, {
            clientWidth: {
                configurable: true,
                value: 200,
            },
            clientHeight: {
                configurable: true,
                value: 150,
            },
        })

        canvas.mount()
        canvas.setScene({
            sceneKey: 'research-flow',
            revision: 'step-1',
            nodes: [],
            edges: [],
        }, {
            size: {
                width: 300,
                height: 120,
            },
            fitKey: 'start',
        })
        await Promise.resolve()

        const controller = canvasMocks.instances[0] as InstanceType<typeof canvasMocks.CanvasControllerMock>
        expect(controller.setViewport).toHaveBeenLastCalledWith({
            x: 32,
            y: 33,
            zoom: 0.7,
        })
        canvas.destroy()
    })


    it('fits snapshots, reports node clicks, and releases input and observer owners', async () => {
        const onNodeClick = vi.fn()
        const onError = vi.fn()
        const canvas = createDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            registerNodes: () => {},
            connectionSettings: false,
            appearance: {
                background: '#101820',
                accentColor: '#ff8800',
                lineColor: '#778899',
            },
            onNodeClick,
            onError,
        })
        let width = 400
        let height = 300
        document.body.append(canvas.el)
        Object.defineProperties(canvas.el, {
            clientWidth: {
                configurable: true,
                get: () => width,
            },
            clientHeight: {
                configurable: true,
                get: () => height,
            },
            getBoundingClientRect: {
                configurable: true,
                value: () => ({
                    left: 10,
                    top: 20,
                    right: 10 + width,
                    bottom: 20 + height,
                    width,
                    height,
                    x: 10,
                    y: 20,
                    toJSON: () => ({}),
                }),
            },
        })

        canvas.mount()
        canvas.setScene(
            {
                sceneKey: 'research-flow',
                revision: 'step-1',
                nodes: [{
                    nodeId: 'node-1',
                    type: 'research-step',
                    data: { label: 'Start' },
                    position: {
                        x: 100,
                        y: 50,
                    },
                    dimensions: {
                        width: 80,
                        height: 40,
                    },
                    ports: [],
                }],
                edges: [],
            },
            {
                size: {
                    width: 200,
                    height: 100,
                },
                fitKey: 'start',
            },
        )
        await Promise.resolve()

        const controller = canvasMocks.instances[0] as InstanceType<typeof canvasMocks.CanvasControllerMock>
        expect(controller.setViewport).toHaveBeenLastCalledWith({
            x: 80,
            y: 90,
            zoom: 1.2,
        })
        expect(canvas.el.style.getPropertyValue('--connector-line-default-color')).toBe('#778899')
        expect(controller.setScene).toHaveBeenLastCalledWith(expect.objectContaining({
            revision: 'step-1:0',
        }))

        canvas.el.dispatchEvent(pointerEvent('pointerdown', 222, 182))
        canvas.el.dispatchEvent(pointerEvent('pointerup', 222, 182))
        expect(onNodeClick).toHaveBeenCalledWith('node-1')
        expect(controller.clientToWorld).toHaveBeenCalledWith({
            x: 222,
            y: 182,
        })
        expect(canvas.el.dataset.armed).toBe('true')
        expect(canvas.el.classList.contains('nowheel')).toBe(false)

        canvas.el.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
        }))
        expect(canvas.el.dataset.armed).toBe('false')
        expect(canvas.el.classList.contains('nowheel')).toBe(true)

        canvas.refresh()
        expect(canvas.el.style.getPropertyValue('--diagram-canvas-accent')).toBe('#ff8800')
        expect(controller.setScene).toHaveBeenLastCalledWith(expect.objectContaining({
            revision: 'step-1:1',
        }))

        width = 500
        height = 400
        ResizeObserverMock.instances[0].trigger()
        expect(controller.resize).toHaveBeenCalledOnce()
        expect(controller.setViewport).toHaveBeenLastCalledWith({
            x: 130,
            y: 140,
            zoom: 1.2,
        })

        const hint = document.querySelector('.diagram-canvas-hint')
        expect(hint).not.toBeNull()
        canvas.destroy()
        canvas.destroy()
        expect(controller.destroy).toHaveBeenCalledOnce()
        expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce()
        expect(hint?.isConnected).toBe(false)
        expect(canvas.el.isConnected).toBe(false)

        canvas.el.dispatchEvent(pointerEvent('pointerdown', 222, 182))
        expect(canvas.el.dataset.armed).toBeUndefined()
        expect(onNodeClick).toHaveBeenCalledOnce()
    })
})
