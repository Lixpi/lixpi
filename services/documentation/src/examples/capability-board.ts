import {
    applyNodeGeometry,
    type CanvasEngineRect,
    type BoundedZoomScalingOptions,
    type CanvasIntent,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    CanvasController,
    NodeRegistry,
    type CanvasConnectionControls,
    type CanvasConnectionOptions,
} from '@lixpi/canvas-engine/frontend/runtime'
import { DiagramNodeView } from '@lixpi/canvas-components/diagram'
import { createLibraryDiagramAppearance } from '@lixpi/canvas-components/library'
import { ExampleFrame } from './example-frame.ts'
import {
    mergeCanvasTheme,
    canvasThemeConnectorSettings,
    type CanvasTheme,
    type CanvasThemeSource,
    type CanvasThemePatch,
} from '@lixpi/canvas-components/theme'
import {
    type ConnectionSettings,
} from '@lixpi/canvas-engine/frontend/connectors'

export type CapabilityNodeData = {
    title: string
    lines: string[]
    tag?: string
    treeParent?: string | null
}

export const capabilityPorts = (
    width: number,
    height: number,
): EngineNode['ports'] => [
    {
        id: 'left',
        role: 'input',
        direction: 'left',
        anchor: {
            x: 0,
            y: height / 2,
        },
    },
    {
        id: 'right',
        role: 'output',
        direction: 'right',
        anchor: {
            x: width,
            y: height / 2,
        },
    },
    {
        id: 'top',
        role: 'input',
        direction: 'top',
        anchor: {
            x: width / 2,
            y: 0,
        },
    },
    {
        id: 'bottom',
        role: 'output',
        direction: 'bottom',
        anchor: {
            x: width / 2,
            y: height,
        },
    },
]

export const capabilityNode = (
    nodeId: string,
    title: string,
    x: number,
    y: number,
    width = 180,
    height = 84,
    data: Partial<CapabilityNodeData> = {},
): EngineNode<CapabilityNodeData> => ({
    nodeId,
    type: 'diagram',
    position: {
        x,
        y,
    },
    dimensions: {
        width,
        height,
    },
    ports: capabilityPorts(width, height),
    data: {
        title,
        lines: [],
        ...data,
    },
})

const geometry = (movable: boolean): NodeGeometryPolicy<CapabilityNodeData> => ({
    measure: node => {
        const bounds = {
            ...node.position,
            ...node.dimensions,
        }

        return {
            visualBounds: bounds,
            hitBounds: bounds,
            selectionBounds: bounds,
            collisionBounds: bounds,
            connectorBounds: bounds,
        }
    },
    movable,
    resize: {
        min: {
            width: 100,
            height: 64,
        },
        preserveAspectRatio: false,
    },
})

type CapabilityBoardOptions = {
    scene: SceneSnapshot<CapabilityNodeData>
    instructions: string
    connectors?: CanvasConnectionOptions
    customDrag?: boolean
    theme?: CanvasThemeSource
    onGeometry?: () => void
    onChange?: (intent: CanvasIntent) => void
    onDrag?: (
        nodeId: string,
        bounds: CanvasEngineRect,
    ) => void
    onDrop?: (
        nodeId: string,
        moved: boolean,
    ) => void
}

export class CapabilityBoard {
    readonly frame: ExampleFrame
    readonly canvas: CanvasController
    readonly connections: CanvasConnectionControls | null
    readonly theme: CanvasThemeSource
    scene: SceneSnapshot<CapabilityNodeData>
    private revision = 0
    private destroyed = false
    private zoomInput: HTMLInputElement | null = null
    private connectorOverrides: CanvasThemePatch<ConnectionSettings> = {}
    private readonly connectorZoomScaling: BoundedZoomScalingOptions = { minZoom: 0.4 }

    constructor(
        host: HTMLElement,
        private readonly options: CapabilityBoardOptions,
    ) {
        this.frame = new ExampleFrame(
            host,
            options.instructions,
            options.theme,
        )
        this.scene = options.scene
        this.theme = this.frame.theme
        const registry = new NodeRegistry()

        for (const type of ['diagram', 'fixed'])
            registry.register<CapabilityNodeData>({
                type,
                geometry: geometry(type !== 'fixed'),
                mount: (node, context) => new DiagramNodeView(
                    node,
                    context,
                    {
                        getContent: current => current.data,
                        getAppearance: current => createLibraryDiagramAppearance(this.theme.value, { raised: current.type === 'fixed' }),
                    },
                ),
            })

        this.canvas = new CanvasController({
            root: this.frame.stage,
            registry,
            scene: this.scene,
            viewport: {
                x: 24,
                y: 24,
                zoom: 1,
            },
            connectors: false,
            interaction: {
                isInteractiveTarget: element => Boolean(options.customDrag && element.closest('[data-canvas-node-id]')),
                viewport: options.customDrag ? { config: { panOnDrag: false } } : undefined,
            },
            onIntent: this.accept,
            onError: this.frame.error,
        })

        if (options.connectors)
            options.connectors.renderer = {
                ...options.connectors.renderer,
                zoomScaling: this.connectorZoomScaling,
            }

        this.connections = options.connectors ? this.canvas.installConnections(options.connectors) : null
        this.frame.onThemeChange(this.refreshTheme)

        if (options.customDrag)
            this.frame.stage.addEventListener(
                'mousedown',
                this.startDrag,
                true,
            )

        this.frame.button('Refit', this.fit)
        this.zoomInput = this.frame.number(
            'Zoom',
            {
                value: 1,
            },
            value => void this.canvas.setViewport({
                ...this.canvas.scene.viewport,
                zoom: value,
            }),
        )
        void this.initialize()
    }

    overrideConnectors(patch: CanvasThemePatch<ConnectionSettings>): void {
        this.connectorOverrides = mergeCanvasTheme(this.connectorOverrides, patch as CanvasThemePatch<typeof this.connectorOverrides>)
        this.refreshTheme(this.theme.value)
    }

    private refreshTheme = (theme: CanvasTheme): void => {
        if (this.options.connectors) {
            const settings = mergeCanvasTheme(
                canvasThemeConnectorSettings(theme),
                this.connectorOverrides,
            )

            for (const key of Object.keys(settings) as Array<keyof ConnectionSettings>)
                Reflect.set(
                    this.options.connectors.settings,
                    key,
                    settings[key],
                )

            this.connectorZoomScaling.minZoom = settings.scaling.zoomScaling.minZoom
            this.connectorZoomScaling.lowZoomPower = settings.scaling.zoomScaling.lowZoomPower
            this.options.connectors.settings.scaling.zoomScaling = this.connectorZoomScaling
            this.canvas.setConnectionSettings(this.options.connectors.settings)
            this.scene = {
                ...this.scene,
                edges: this.scene.edges.map(
                    edge => ({
                        ...edge,
                        path: settings.lineCurve,
                    }),
                ),
            }
        }

        this.publish()
    }

    private async initialize(): Promise<void> {
        const ready = await this.canvas.ready

        if (
            ready
            && !this.destroyed
        )
            this.fit()
    }

    private startDrag = (event: MouseEvent): void => {
        if (
            event.button !== 0
            || event.defaultPrevented
        )
            return

        const target = event.target as Element

        if (target.closest('button, input, textarea, select, a, .nopan'))
            return

        const nodeId = target.closest('[data-canvas-node-id]')?.getAttribute('data-canvas-node-id')
        const node = this.scene.nodes.find(candidate => candidate.nodeId === nodeId)

        if (
            !node
            || node.type === 'fixed'
        )
            return

        event.preventDefault()
        event.stopPropagation()
        this.canvas.setSelected([node.nodeId])
        this.canvas.startNodeDrag({
            event,
            targets: [{
                nodeId: node.nodeId,
                bounds: {
                    ...node.position,
                    ...node.dimensions,
                },
            }],
            threshold: 3,
            onChange: bounds => {
                const current = bounds.get(node.nodeId)

                if (current)
                    this.options.onDrag?.(node.nodeId, current)
            },
            onEnd: (
                _event,
                bounds,
                moved,
            ) => {
                if (moved) {
                    const current = bounds.get(node.nodeId)

                    if (current) {
                        this.scene = {
                            ...this.scene,
                            nodes: this.scene.nodes.map(
                                value => value.nodeId === node.nodeId ? {
                                    ...value,
                                    position: {
                                        x: current.x,
                                        y: current.y,
                                    },
                                } : value,
                            ),
                        }
                        this.publish()
                        this.options.onDrag?.(node.nodeId, current)
                    }
                }

                this.options.onDrop?.(node.nodeId, moved)
            },
            onCancel: () => this.connections?.cancelTransientConnection(),
        })
    }

    private accept = (intent: CanvasIntent): void => {
        if (
            this.destroyed
            || intent.sceneKey !== this.scene.sceneKey
        )
            return

        if (intent.kind === 'viewport') {
            if (this.zoomInput)
                this.zoomInput.value = String(intent.viewport.zoom)

            this.options.onChange?.(intent)

            return
        }

        if (intent.kind === 'geometry') {
            const changes = new Map(
                intent.changes.map(change => [change.nodeId, change]),
            )
            this.scene = {
                ...this.scene,
                nodes: this.scene.nodes.map(node => {
                    const change = changes.get(node.nodeId)

                    if (!change)
                        return node

                    const updated = applyNodeGeometry(node, change).node

                    return {
                        ...updated,
                        ports: capabilityPorts(updated.dimensions.width, updated.dimensions.height),
                    }
                }),
            }
            this.options.onGeometry?.()
        } else if (intent.kind === 'connect')
            this.scene = {
                ...this.scene,
                edges: [...this.scene.edges, {
                    edgeId: crypto.randomUUID(),
                    source: intent.source,
                    target: intent.target,
                    path: this.options.connectors?.settings.lineCurve ?? 'bezier',
                    data: null,
                }],
            }
        else if (intent.kind === 'reconnect')
            this.scene = {
                ...this.scene,
                edges: this.scene.edges.map(
                    edge => edge.edgeId === intent.edgeId ? {
                        ...edge,
                        source: intent.source,
                        target: intent.target,
                    } : edge,
                ),
            }
        else if (intent.kind === 'delete') {
            const deleted = new Set(intent.nodeIds)
            this.scene = {
                ...this.scene,
                nodes: this.scene.nodes.filter(node => !deleted.has(node.nodeId)),
                edges: this.scene.edges.filter(
                    edge => !intent.edgeIds.includes(edge.edgeId) && !deleted.has(edge.source.nodeId) && !deleted.has(edge.target.nodeId),
                ),
            }
        }

        this.publish()
        this.options.onChange?.(intent)
    }

    publish(): void {
        if (this.destroyed)
            return

        this.scene = {
            ...this.scene,
            revision: String(++this.revision),
        }
        this.canvas.setScene(this.scene)
    }

    fit = (): void => {
        if (!this.scene.nodes.length)
            return

        const left = Math.min(...this.scene.nodes.map(node => node.position.x))
        const top = Math.min(...this.scene.nodes.map(node => node.position.y))
        const right = Math.max(...this.scene.nodes.map(node => node.position.x + node.dimensions.width))
        const bottom = Math.max(...this.scene.nodes.map(node => node.position.y + node.dimensions.height))
        const zoom = Math.max(
            0.15,
            Math.min(
                1,
                (this.frame.stage.clientWidth - 64) / (right - left),
                (this.frame.stage.clientHeight - 64) / (bottom - top),
            ),
        )
        this.canvas.setViewport({
            x: 32 - left * zoom,
            y: 32 - top * zoom,
            zoom,
        })

        if (this.zoomInput)
            this.zoomInput.value = String(zoom)
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.frame.stage.removeEventListener(
            'mousedown',
            this.startDrag,
            true,
        )
        this.canvas.destroy()
        this.frame.destroy()
    }
}
