import { getExampleTheme } from './example-theme.ts'
import { canvasThemeConnectorSettings } from '@lixpi/canvas-components/theme'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getOrthogonalRoutePoints,
    isOrthogonalRouteSimple,
    scaleCanvasChromeWorldSizeForZoom,
    type CanvasEnginePoint,
    type BoundedZoomScalingOptions,
} from '@lixpi/canvas-engine/shared'
import {
    ConnectorRenderer,
    computeConnectorDatum,
    computeConnectorEndpoints,
    type ConnectorDatumStyle,
    type ConnectorRenderDatum,
    type AnchorPosition,
    type EdgeConfig,
    type MarkerType,
    type NodeConfig,
    type PathType,
} from '@lixpi/canvas-engine/frontend/connectors'
import {
    createArrowRightMarker,
    arrowRightMarkerBodyLengthFraction,
} from '@lixpi/ui-kit/svg'
import {
    CapabilityBoard,
    capabilityNode,
} from './capability-board.ts'
import {
    type ExampleFrame,
} from './example-frame.ts'

const paths: Record<PathType, string> = {
    bezier: 'Bezier',
    straight: 'Straight',
    smoothstep: 'Smooth step',
    'horizontal-bezier': 'Horizontal Bezier',
    orthogonal: 'Orthogonal',
}
const markers: Record<MarkerType, string> = {
    arrowhead: 'Arrowhead',
    'arrowhead-muted': 'Muted arrowhead',
    'arrowhead-selected': 'Selected arrowhead',
    none: 'None',
}
const anchors: Record<AnchorPosition, string> = {
    left: 'Left',
    right: 'Right',
    top: 'Top',
    bottom: 'Bottom',
    center: 'Center',
}

const createWaypointGuide = (
    points: readonly CanvasEnginePoint[],
    edgeId: string,
): NodeConfig => {
    const segments = points.slice(1).map(
        (end, index) => ({
            start: points[index],
            end,
            length: Math.abs(end.x - points[index].x) + Math.abs(end.y - points[index].y),
        }),
    ).toSorted((first, second) => second.length - first.length)
    const segment = segments[0]

    if (
        !segment
        || segment.length <= 0
    )
        throw new Error('The route has no segment for an explicit waypoint detour.')

    const size = Math.min(48, segment.length / 3)

    return {
        id: `reserved-guide-${edgeId}`,
        shape: 'rect',
        x: (segment.start.x + segment.end.x - size) / 2,
        y: (segment.start.y + segment.end.y - size) / 2,
        width: size,
        height: size,
    }
}

export class ConnectorMatrixExample {
    readonly frame: ExampleFrame
    readonly board: CapabilityBoard
    private selected: PathType = 'bezier'
    private sourceAnchor: AnchorPosition = 'right'
    private targetAnchor: AnchorPosition = 'left'
    private marker: MarkerType = 'arrowhead'
    private markerStart: MarkerType = 'none'
    private curvature = 0.35
    private borderRadius = 24
    private strokeWidth = 3
    private markerSize = 16
    private sourceOffset = 15
    private targetOffset = 15
    private readonly themeInputs = new Map<string, HTMLInputElement>()
    private laneIndex = 0
    private laneCount = 1
    private bendPoints = false
    private readonly zoomScaling: BoundedZoomScalingOptions = { minZoom: 0.4 }
    private curvatureInput?: HTMLInputElement
    private routeRadiusInput?: HTMLInputElement
    private laneIndexInput?: HTMLInputElement
    private laneCountInput?: HTMLInputElement
    private bendToggle?: ReturnType<ExampleFrame["toggle"]>
    private sync = (): void => {}
    private routingStatus = ''

    constructor(host: HTMLElement) {
        const nodes = Object.entries(paths).flatMap(
            ([path, label], index) => [
                capabilityNode(
                    `${path}-source`,
                    label,
                    path === 'orthogonal' ? 80 : 20,
                    path === 'orthogonal' ? 850 : 40 + index * 160,
                    190,
                    64,
                ),
                capabilityNode(
                    `${path}-solid`,
                    'Solid',
                    420,
                    path === 'orthogonal' ? 730 : index * 160,
                    120,
                    64,
                ),
                capabilityNode(
                    `${path}-dashed`,
                    'Dashed',
                    420,
                    path === 'orthogonal' ? 990 : 80 + index * 160,
                    120,
                    64,
                ),
            ],
        )
        nodes.push(
            ...Object.entries(markers).flatMap(
                ([marker, label], index) => [
                    capabilityNode(
                        `marker-${marker}-source`,
                        label,
                        650,
                        20 + index * 160,
                        160,
                        64,
                    ),
                    capabilityNode(
                        `marker-${marker}-target`,
                        marker === 'none' ? 'No marker' : 'Target',
                        950,
                        80 + index * 160,
                        110,
                        64,
                    ),
                ],
            ),
        )
        this.board = new CapabilityBoard(
            host,
            {
                instructions: 'Each path is shown with a solid and a dashed line. The right column shows all target marker modes. Drag or resize nodes, then select a path to edit its anchors, markers, curve, corners, lanes and waypoints. Stroke width, marker size and endpoint gap apply to the whole matrix. Explicit waypoint detour reserves a host-planned guide region and passes the shared planner output as real bend points. Invalid geometry is reported per edge; other samples keep rendering.',
                scene: {
                    sceneKey: 'library-connector-matrix',
                    revision: '0',
                    nodes,
                    edges: [],
                },
            },
        )
        this.frame = this.board.frame
        this.board.canvas.installExtension({
            id: 'connector-matrix',
            mount: context => {
                const renderer = new ConnectorRenderer({
                    surface: context,
                    marker: createArrowRightMarker(),
                    dash: [8, 5],
                    zoomScaling: this.zoomScaling,
                })
                this.sync = () => this.render(renderer)
                const stopScene = context.subscribeScene(this.sync)
                const stopView = context.subscribeView(this.sync)
                const stopFrames = context.requestFrame(this.sync)
                this.sync()

                return () => {
                    stopFrames()
                    stopScene()
                    stopView()
                    renderer.destroy()
                }
            },
        })
        this.frame.select(
            'Edit path',
            this.selected,
            paths,
            value => {
                this.selected = value as PathType
                this.syncApplicability()
                this.sync()
            },
        )
        this.frame.select(
            'Source anchor',
            this.sourceAnchor,
            anchors,
            value => {
                this.sourceAnchor = value as AnchorPosition
                this.sync()
            },
        )
        this.frame.select(
            'Target anchor',
            this.targetAnchor,
            anchors,
            value => {
                this.targetAnchor = value as AnchorPosition
                this.sync()
            },
        )
        this.frame.select(
            'Target marker',
            this.marker,
            markers,
            value => {
                this.marker = value as MarkerType
                this.sync()
            },
        )
        this.frame.select(
            'Source marker',
            this.markerStart,
            markers,
            value => {
                this.markerStart = value as MarkerType
                this.sync()
            },
        )
        this.curvatureInput = this.frame.number(
            'Curvature (Bezier)',
            {
                value: this.curvature,
            },
            value => { this.curvature = value; this.sync() },
        )
        this.themeInputs.set(
            'borderRadius',
            this.frame.number(
                'Route corner radius',
                {
                    value: this.borderRadius,
                },
                value => { this.borderRadius = value; this.sync() },
            ),
        )
        this.themeInputs.set(
            'strokeWidth',
            this.frame.number(
                'Stroke width',
                {
                    value: this.strokeWidth,
                },
                value => getExampleTheme(this.frame.stage).update({ connectors: { scaling: { strokeWidth: value } } }),
            ),
        )
        this.themeInputs.set(
            'markerSize',
            this.frame.number(
                'Marker size',
                {
                    value: this.markerSize,
                },
                value => getExampleTheme(this.frame.stage).update({ connectors: { scaling: { markerSize: value } } }),
            ),
        )
        this.themeInputs.set(
            'sourceOffset',
            this.frame.number(
                'Source endpoint gap',
                {
                    value: this.sourceOffset,
                },
                value => getExampleTheme(this.frame.stage).update({ connectors: { scaling: { markerOffset: { source: value } } } }),
            ),
        )
        this.themeInputs.set(
            'targetOffset',
            this.frame.number(
                'Target endpoint gap',
                {
                    value: this.targetOffset,
                },
                value => getExampleTheme(this.frame.stage).update({ connectors: { scaling: { markerOffset: { target: value } } } }),
            ),
        )
        this.laneIndexInput = this.frame.number(
            'Lane index',
            {
                value: this.laneIndex,
            },
            value => { this.laneIndex = value; this.sync() },
        )
        this.laneCountInput = this.frame.number(
            'Lane count',
            {
                value: this.laneCount,
            },
            value => { this.laneCount = value; this.syncApplicability(); this.sync() },
        )
        this.bendToggle = this.frame.toggle(
            'Explicit waypoint detour',
            this.bendPoints,
            value => {
                this.bendPoints = value
                this.sync()
            },
        )
        this.routeRadiusInput = this.themeInputs.get('borderRadius')
        this.syncApplicability()
        this.frame.onThemeChange(() => {
            const theme = this.board.theme.value
            const defaults = {
                strokeWidth: theme.connectors.scaling.strokeWidth,
                markerSize: theme.connectors.scaling.markerSize,
                sourceOffset: theme.connectors.scaling.markerOffset.source,
                targetOffset: theme.connectors.scaling.markerOffset.target,
            }

            for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
                this[key] = defaults[key]
                const input = this.themeInputs.get(key)

                if (input)
                    input.value = String(defaults[key])
            }

            this.sync()
        })
        this.frame.code(() => this.sourceCode())
    }

    private worldNodes(): Map<string, NodeConfig> {
        return new Map<string, NodeConfig>(
            this.board.scene.nodes.map(node => {
                const bounds = this.board.canvas.scene.getNodeGeometry(node.nodeId)?.connectorBounds ?? {
                    ...node.position,
                    ...node.dimensions,
                }

                return [node.nodeId, {
                    id: node.nodeId,
                    shape: 'rect',
                    ...bounds,
                }]
            }),
        )
    }

    private styleFor(edge: EdgeConfig): ConnectorDatumStyle {
        const settings = canvasThemeConnectorSettings(this.board.theme.value)
        const viewport = this.board.canvas.scene.viewport
        const scaling = getAdaptiveBoundedZoomScalingOptions(this.zoomScaling)
        const worldSize = (value: number): number => scaleCanvasChromeWorldSizeForZoom(
            value,
            viewport.zoom,
            scaling,
        )

        return {
            selected: edge.id.startsWith(`${this.selected}-`) || edge.marker === 'arrowhead-selected',
            color: edge.marker === 'arrowhead-muted' ? this.board.theme.value.colors.muted : settings.styles.lineDefaultColor,
            selectedColor: settings.styles.lineFocusColor,
            strokeWidth: this.strokeWidth,
            markerSize: this.markerSize,
            markerOffset: {
                source: worldSize(this.sourceOffset),
                target: worldSize(this.targetOffset),
            },
            worldMarkerSize: worldSize(this.markerSize),
            markerBodyLengthFraction: arrowRightMarkerBodyLengthFraction,
        }
    }

    private routeEdge(
        edge: EdgeConfig,
        nodes: Map<string, NodeConfig>,
        style: ConnectorDatumStyle,
    ): EdgeConfig {
        if (edge.pathType !== 'orthogonal')
            return edge

        const endpoints = computeConnectorEndpoints(
            edge,
            nodes,
            style,
        )

        if (!endpoints)
            return edge

        const obstacles = [...nodes.values()]
        const plan = (bounds: typeof obstacles): CanvasEnginePoint[] =>
            getOrthogonalRoutePoints(
                endpoints.source.x,
                endpoints.source.y,
                endpoints.target.x,
                endpoints.target.y,
                edge.source.position,
                edge.target.position,
                edge.borderRadius ?? 24,
                undefined,
                bounds,
                edge.source.nodeId,
                edge.target.nodeId,
                edge.laneIndex ?? 0,
                edge.laneCount ?? 1,
            )
        const automatic = plan(obstacles)

        if (!isOrthogonalRouteSimple(automatic))
            throw new Error('The orthogonal route crosses or retraces itself. Move an endpoint to restore clearance.')

        if (
            !this.bendPoints
            || !edge.id.startsWith(`${this.selected}-`)
        )
            return edge

        // Reserve a small host-planned region on the automatic route. The native
        // planner must find a distinct detour, which becomes real explicit waypoints.
        const guide = createWaypointGuide(automatic, edge.id)
        const points = plan([...obstacles, guide])

        if (!isOrthogonalRouteSimple(points))
            throw new Error('The explicit waypoint detour crosses or retraces itself. Move an endpoint to restore clearance.')

        return {
            ...edge,
            bendPoints: points.slice(1, -1),
        }
    }

    private render(renderer: ConnectorRenderer): void {
        const nodes = this.worldNodes()
        const viewport = this.board.canvas.scene.viewport
        const scaling = this.board.theme.value.connectors.scaling.zoomScaling
        this.zoomScaling.minZoom = scaling.minZoom
        this.zoomScaling.lowZoomPower = scaling.lowZoomPower
        const data: ConnectorRenderDatum[] = []
        const failures: string[] = []

        for (const edge of this.edges()) {
            try {
                const style = this.styleFor(edge)
                const routed = this.routeEdge(
                    edge,
                    nodes,
                    style,
                )
                const datum = computeConnectorDatum(
                    routed,
                    nodes,
                    style,
                )

                if (datum)
                    data.push(datum)
            } catch (error) {
                failures.push(`${edge.id}: ${error instanceof Error ? error.message : String(error)}`)
            }
        }

        try {
            renderer.render(data, viewport)
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error))
        }

        const status = failures.join('\n')

        if (status === this.routingStatus)
            return

        this.routingStatus = status
        this.frame.report(status || 'All connector samples have a clear route.')

        if (status)
            this.frame.status.dataset.error = 'true'
    }

    private syncApplicability(): void {
        if (this.curvatureInput)
            this.curvatureInput.disabled = this.selected !== 'bezier'

        const orthogonal = this.selected === 'orthogonal'

        for (const input of [this.routeRadiusInput, this.laneIndexInput, this.laneCountInput])
            if (input)
                input.disabled = !orthogonal

        this.bendToggle?.setDisabled(!orthogonal)
    }

    private edges(): EdgeConfig[] {
        const result = (Object.keys(paths) as PathType[]).flatMap(
            path => (['solid', 'dashed'] as const).map(lineStyle => {
                const selected = path === this.selected

                return {
                    id: `${path}-${lineStyle}`,
                    source: {
                        nodeId: `${path}-source`,
                        position: selected ? this.sourceAnchor : 'right' as AnchorPosition,
                    },
                    target: {
                        nodeId: `${path}-${lineStyle}`,
                        position: selected ? this.targetAnchor : 'left' as AnchorPosition,
                    },
                    pathType: path,
                    lineStyle,
                    marker: selected ? this.marker : 'arrowhead' as MarkerType,
                    markerStart: selected ? this.markerStart : 'none' as MarkerType,
                    curvature: selected ? this.curvature : 0.35,
                    borderRadius: selected ? this.borderRadius : 24,
                    laneIndex: selected ? this.laneIndex : 0,
                    laneCount: selected ? this.laneCount : 1,
                    bendPoints: undefined,
                }
            }),
        )
        result.push(
            ...(Object.keys(markers) as MarkerType[]).map(
                marker => ({
                    id: `marker-${marker}`,
                    source: {
                        nodeId: `marker-${marker}-source`,
                        position: 'right' as AnchorPosition,
                    },
                    target: {
                        nodeId: `marker-${marker}-target`,
                        position: 'left' as AnchorPosition,
                    },
                    pathType: 'bezier' as PathType,
                    lineStyle: 'solid' as const,
                    marker,
                    markerStart: 'none' as MarkerType,
                    curvature: 0.35,
                    borderRadius: 24,
                    laneIndex: 0,
                    laneCount: 1,
                    bendPoints: undefined,
                }),
            ),
        )

        return result
    }

    private sourceCode(): string {
        const connectorSettings = canvasThemeConnectorSettings(this.board.theme.value)
        const edge = this.edges().find(value => value.id === `${this.selected}-solid`)

        return [
            "import { CanvasController } from '@lixpi/canvas-engine/frontend/runtime'",
            "import { ConnectorRenderer, computeConnectorDatum, computeConnectorEndpoints, type ConnectorRenderDatum, type EdgeConfig, type NodeConfig } from '@lixpi/canvas-engine/frontend/connectors'",
            "import { createArrowRightMarker, arrowRightMarkerBodyLengthFraction } from '@lixpi/ui-kit/svg'",
            "import { getAdaptiveBoundedZoomScalingOptions, scaleCanvasChromeWorldSizeForZoom, getOrthogonalRoutePoints, isOrthogonalRouteSimple, type CanvasEnginePoint } from '@lixpi/canvas-engine/shared'",
            '',
            '// Existing canvas nodes supply their live measured bounds. Status is an inline output.',
            'const mountConnectors = (canvas: CanvasController, status: HTMLOutputElement) => {',
            `    const zoomScaling = ${JSON.stringify(this.zoomScaling)}`,
            `    const edges: EdgeConfig[] = [${JSON.stringify(
                edge,
                null,
                4,
            )}]`,
            `    const createWaypointGuide: (points: readonly CanvasEnginePoint[], edgeId: string) => NodeConfig = ${createWaypointGuide.toString()}`,
            "    return canvas.installExtension({ id: 'styled-connectors', mount: context => {",
            '        const renderer = new ConnectorRenderer({ surface: context, marker: createArrowRightMarker(), dash: [8, 5], zoomScaling })',
            '        const render = () => {',
            '            const viewport = canvas.scene.viewport',
            '            const worldSize = (value: number) => scaleCanvasChromeWorldSizeForZoom(value, viewport.zoom, getAdaptiveBoundedZoomScalingOptions(zoomScaling))',
            '            const nodes = new Map<string, NodeConfig>(canvas.scene.scene.nodes.map(node => {',
            '                const bounds = canvas.scene.getNodeGeometry(node.nodeId)!.connectorBounds',
            "                return [node.nodeId, { id: node.nodeId, shape: 'rect', ...bounds }]",
            '            }))',
            '            const data: ConnectorRenderDatum[] = []',
            '            const failures: string[] = []',
            '            for (const edge of edges) {',
            '                try {',
            '                    const style = {',
            `                        selected: true, color: ${JSON.stringify(connectorSettings.styles.lineDefaultColor)}, selectedColor: ${JSON.stringify(connectorSettings.styles.lineFocusColor)},`,
            `                        strokeWidth: ${this.strokeWidth}, markerSize: ${this.markerSize},`,
            `                        markerOffset: { source: worldSize(${this.sourceOffset}), target: worldSize(${this.targetOffset}) },`,
            `                        worldMarkerSize: worldSize(${this.markerSize}), markerBodyLengthFraction: arrowRightMarkerBodyLengthFraction,`,
            '                    }',
            '                    let routed = edge',
            "                    if (edge.pathType === 'orthogonal') {",
            '                        const endpoints = computeConnectorEndpoints(edge, nodes, style)',
            '                        if (!endpoints) continue',
            '                        const obstacles = [...nodes.values()]',
            '                        const plan = (bounds: NodeConfig[]) => getOrthogonalRoutePoints(',
            '                            endpoints.source.x, endpoints.source.y, endpoints.target.x, endpoints.target.y,',
            '                            edge.source.position, edge.target.position, edge.borderRadius ?? 24, undefined,',
            '                            bounds, edge.source.nodeId, edge.target.nodeId, edge.laneIndex ?? 0, edge.laneCount ?? 1,',
            '                        )',
            '                        const automatic = plan(obstacles)',
            "                        if (!isOrthogonalRouteSimple(automatic)) throw new Error('Orthogonal route crosses or retraces itself')",
            `                        if (${this.bendPoints}) {`,
            '                            // Explicit waypoint detour reserves a host-planned guide region on the automatic route.',
            '                            // The shared planner returns a distinct route; it owns all orthogonal path math.',
            '                            const reservedGuide = createWaypointGuide(automatic, edge.id)',
            '                            const points = plan([...obstacles, reservedGuide])',
            "                            if (!isOrthogonalRouteSimple(points)) throw new Error('Explicit detour crosses or retraces itself')",
            '                            routed = { ...edge, bendPoints: points.slice(1, -1) }',
            '                        }',
            '                    }',
            '                    // This also validates explicit points against actual scene obstacles before painting.',
            '                    const datum = computeConnectorDatum(routed, nodes, style)',
            '                    if (datum) data.push(datum)',
            '                } catch (error) {',
            '                    failures.push(`${edge.id}: ${error instanceof Error ? error.message : String(error)}`)',
            '                }',
            '            }',
            '            renderer.render(data, viewport)',
            "            const message = failures.join('; ')",
            '            if (status.textContent !== message) status.textContent = message',
            '        }',
            '        const stopView = context.subscribeView(render)',
            '        const stopScene = context.subscribeScene(render)',
            '        const stopFrames = context.requestFrame(render)',
            '        render()',
            '        return () => {',
            '            stopFrames()',
            '            stopView()',
            '            stopScene()',
            '            renderer.destroy()',
            '        }',
            '    } })',
            '}',
        ].join('\n')
    }

    destroy(): void {
        this.board.destroy()
    }
}
