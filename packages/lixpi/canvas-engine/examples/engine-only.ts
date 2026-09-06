import {
    applyNodeGeometry,
    type CanvasEngineRect,
    type CanvasIntent,
    type CanvasViewport,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    CanvasController,
    NodeRegistry,
    Lifetime,
    type ComponentContext,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type ConnectionSettings,
} from '@lixpi/canvas-engine/frontend/connectors'
import '@lixpi/canvas-engine/styles/interaction'

type BoxData = {
    label: string
    color: string
}

const geometry: NodeGeometryPolicy<BoxData> = {
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
    resize: {
        min: {
            width: 120,
            height: 80,
        },
        preserveAspectRatio: false,
    },
    movable: true,
}

const ports = (
    width: number,
    height: number,
): EngineNode['ports'] => {
    return [
        {
            id: 'in',
            role: 'input',
            direction: 'left',
            anchor: {
                x: 0,
                y: height / 2,
            },
        },
        {
            id: 'out',
            role: 'output',
            direction: 'right',
            anchor: {
                x: width,
                y: height / 2,
            },
        },
    ]
}

// This appearance belongs to the example. Engine registrations have no required node skin.
class BoxView implements NodeView<BoxData> {
    private readonly lifetime = new Lifetime()
    private readonly group
    private readonly path
    private readonly label: HTMLDivElement
    private bounds: CanvasEngineRect
    private selected = false

    constructor(
        private node: EngineNode<BoxData>,
        private readonly context: ComponentContext,
    ) {
        this.bounds = {
            ...node.position,
            ...node.dimensions,
        }
        this.group = context.resources.createGroup({
            space: 'world',
            layer: context.layers.media,
        })
        this.lifetime.own(() => context.resources.release(this.group))

        try {
            this.path = context.resources.createPath(this.group, [])
            this.label = context.contentRoot.ownerDocument.createElement('div')
            this.label.style.padding = '16px'
            this.label.style.color = '#17202a'
            this.label.style.pointerEvents = 'none'
            context.contentRoot.append(this.label)
            this.lifetime.own(() => this.label.remove())
            this.update(node)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    update(node: EngineNode<BoxData>): void {
        this.node = node
        this.label.textContent = node.data.label
        this.paint()
    }
    setGeometry(
        bounds: CanvasEngineRect,
        _viewport: CanvasViewport,
    ): void {
        this.bounds = bounds
        this.paint()
    }
    setSelected(selected: boolean): void {
        this.selected = selected
        this.paint()
    }
    setVisible(visible: boolean): void {
        this.context.resources.setVisible(this.group, visible)
    }
    destroy = (): void => void this.lifetime.destroy()

    private paint(): void {
        const {
            x,
            y,
            width,
            height,
        } = this.bounds
        this.context.resources.updateGroup(
            this.group,
            { position: {
                x,
                y,
            } },
        )
        this.context.resources.updatePath(
            this.path,
            [{
                path: `M0 0 H${width} V${height} H0 Z`,
                fill: { color: this.node.data.color },
                stroke: {
                    color: this.selected ? '#1565c0' : '#546e7a',
                    width: this.selected ? 3 : 1,
                },
            }],
        )
    }
}

const connectionSettings: ConnectionSettings = {
    lineCurve: 'bezier',
    useZoomCompensatedScaling: true,
    scaling: {
        strokeWidth: 2,
        markerSize: 8,
        markerOffset: {
            source: 0,
            target: 0,
        },
        clickAreaWidth: 16,
        zoomScaling: { minZoom: 0.25 },
    },
    proximityConnectThreshold: 24,
    menuConnectionSnapRadius: 24,
    autoAlign: {
        minSlideHeight: 200,
        edgeMargin: 0.1,
    },
    styles: {
        lineDefaultColor: '#546e7a',
        lineFocusColor: '#1565c0',
    },
}

export class EngineOnlyExample {
    readonly canvas: CanvasController
    private snapshot: SceneSnapshot<BoxData> = {
        sceneKey: crypto.randomUUID(),
        revision: '0',
        nodes: [
            {
                nodeId: 'first',
                type: 'box',
                position: {
                    x: 50,
                    y: 70,
                },
                dimensions: {
                    width: 180,
                    height: 100,
                },
                data: {
                    label: 'Drag or resize me',
                    color: '#e1f5fe',
                },
                ports: ports(180, 100),
            },
            {
                nodeId: 'second',
                type: 'box',
                position: {
                    x: 350,
                    y: 190,
                },
                dimensions: {
                    width: 180,
                    height: 100,
                },
                data: {
                    label: 'Connect named ports',
                    color: '#fff3e0',
                },
                ports: ports(180, 100),
            },
        ],
        edges: [{
            edgeId: 'first-second',
            source: {
                nodeId: 'first',
                portId: 'out',
            },
            target: {
                nodeId: 'second',
                portId: 'in',
            },
            path: 'bezier',
            data: null,
        }],
    }
    private revision = 0
    private closed = false

    // Give root position: relative and an explicit width/height in the host page.
    constructor(
        root: HTMLElement,
        onError: (error: unknown) => void,
    ) {
        const registry = new NodeRegistry().register<BoxData>({
            type: 'box',
            geometry,
            mount: (node, context) => new BoxView(node, context),
        })
        this.canvas = new CanvasController({
            root,
            scene: this.snapshot,
            collisions: { margin: 24 },
            viewport: {
                x: 0,
                y: 0,
                zoom: 1,
            },
            registry,
            connectors: {
                settings: connectionSettings,
                policy: { targetMarker: () => 'none' },
            },
            onIntent: this.accept,
            onError,
        })
    }

    getSnapshot(): SceneSnapshot<BoxData> {
        return structuredClone(this.snapshot)
    }
    destroy(): void {
        this.closed = true
        this.canvas.destroy()
    }

    private accept = (intent: CanvasIntent): void => {
        if (
            this.closed
            || intent.sceneKey !== this.snapshot.sceneKey
            || intent.kind === 'viewport'
        )
            return

        if (intent.kind === 'geometry') {
            const updates = new Map(
                intent.changes.map(change => [change.nodeId, change]),
            )
            this.snapshot = {
                ...this.snapshot,
                nodes: this.snapshot.nodes.map(node => {
                    const update = updates.get(node.nodeId)

                    if (!update)
                        return node

                    const updated = applyNodeGeometry(node, update).node

                    return {
                        ...updated,
                        ports: ports(updated.dimensions.width, updated.dimensions.height),
                    }
                }),
            }
        } else if (intent.kind === 'delete') {
            const removed = new Set(intent.nodeIds)
            this.snapshot = {
                ...this.snapshot,
                nodes: this.snapshot.nodes.filter(node => !removed.has(node.nodeId)),
                edges: this.snapshot.edges.filter(
                    edge => !intent.edgeIds.includes(edge.edgeId) && !removed.has(edge.source.nodeId) && !removed.has(edge.target.nodeId),
                ),
            }
        } else if (intent.kind === 'connect')
            this.snapshot = {
                ...this.snapshot,
                edges: [...this.snapshot.edges, {
                    edgeId: crypto.randomUUID(),
                    source: intent.source,
                    target: intent.target,
                    path: 'bezier',
                    data: null,
                }],
            }
        else if (intent.kind === 'reconnect')
            this.snapshot = {
                ...this.snapshot,
                edges: this.snapshot.edges.map(
                    edge => (edge.edgeId === intent.edgeId ? {
                        ...edge,
                        source: intent.source,
                        target: intent.target,
                    } : edge),
                ),
            }

        this.snapshot = {
            ...this.snapshot,
            revision: String(++this.revision),
        }
        this.canvas.setScene(this.snapshot)
    }
}
