import { describe, expect, it } from 'vitest'
import {
    computeConnectorDatum,
    type ConnectorDatumStyle,
    type EdgeConfig,
    type NodeConfig,
} from '@lixpi/canvas-engine/frontend/connectors'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getEdgeScaledSizes,
} from '@lixpi/canvas-engine/shared'
import { createCanvasConnectorSettings } from '@lixpi/canvas-components/connectors'
import { arrowRightMarkerBodyLengthFraction } from '@lixpi/ui-kit/svg'
import { getBranchConnectionTargetMarker } from '../../frontend/connectors/branch-connection-policy.ts'
import { layoutWorkspaceDiagram, type WorkspaceDiagram } from './workspace-diagram.ts'

const lifecycle: WorkspaceDiagram = {
    revision: 'lifecycle-feedback-routing',
    nodes: [
        {
            id: 'request',
            prompt: 'Authorized request',
            response: 'Goal, scope and resource limit',
            role: 'origin',
        },
        {
            id: 'resolve',
            prompt: 'Resolve context',
            response: 'Reauthorize inputs and seal packages',
            role: 'continuation',
        },
        {
            id: 'execute',
            prompt: 'Execute work',
            response: 'Checkpoints and durable events',
            role: 'origin',
        },
        {
            id: 'completed',
            prompt: 'Completed output',
            response: 'Evidence and actual usage',
            role: 'continuation',
        },
        {
            id: 'uncertain',
            prompt: 'Interrupted operation',
            response: 'Reconcile remote state before retry',
            role: 'continuation',
        },
        {
            id: 'review',
            prompt: 'Review',
            response: 'Interpretation and human decision',
            role: 'origin',
        },
        {
            id: 'accepted',
            prompt: 'Retain the result',
            response: 'Versions, conditions and corrections',
            role: 'continuation',
        },
        {
            id: 'continue',
            prompt: 'Next authorized step',
            response: 'Continue, revise or stop',
            role: 'continuation',
        },
    ],
    stages: [
        { trees: [{
            rootId: 'request',
            children: { request: ['resolve'] },
        }] },
        { trees: [{
            rootId: 'execute',
            children: { execute: ['completed', 'uncertain'] },
        }] },
        { trees: [{
            rootId: 'review',
            children: { review: ['accepted', 'continue'] },
        }] },
    ],
    edges: [
        {
            id: 'request-resolve',
            source: 'request',
            target: 'resolve',
        },
        {
            id: 'resolve-execute',
            source: 'resolve',
            target: 'execute',
        },
        {
            id: 'execute-completed',
            source: 'execute',
            target: 'completed',
        },
        {
            id: 'execute-uncertain',
            source: 'execute',
            target: 'uncertain',
        },
        {
            id: 'completed-review',
            source: 'completed',
            target: 'review',
        },
        {
            id: 'uncertain-review',
            source: 'uncertain',
            target: 'review',
        },
        {
            id: 'review-accepted',
            source: 'review',
            target: 'accepted',
        },
        {
            id: 'review-continue',
            source: 'review',
            target: 'continue',
        },
        {
            id: 'continue-execute',
            source: 'continue',
            target: 'execute',
            kind: 'feedback',
        },
    ],
}

type Point = {
    x: number
    y: number
}

const sampledSegments = (path: string): Array<[Point, Point]> => {
    const points: Point[] = []
    let current: Point | undefined

    for (const [, command, payload] of path.matchAll(/([MLQC])([^MLQC]*)/g)) {
        const values = [...payload.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)].map(match => Number(match[0]))

        if (
            command === 'M'
            || command === 'L'
        ) {
            current = {
                x: values[0],
                y: values[1],
            }
            points.push(current)

            continue
        }

        if (!current)
            throw new Error('SVG curve has no starting point')

        const start = current
        const end = command === 'Q'
            ? {
                x: values[2],
                y: values[3],
            }
            : {
                x: values[4],
                y: values[5],
            }

        for (let step = 1; step <= 128; step++) {
            const t = step / 128
            const u = 1 - t
            const point = command === 'Q'
                ? {
                    x: u * u * start.x + 2 * u * t * values[0] + t * t * end.x,
                    y: u * u * start.y + 2 * u * t * values[1] + t * t * end.y,
                }
                : {
                    x: u ** 3 * start.x + 3 * u * u * t * values[0] + 3 * u * t * t * values[2] + t ** 3 * end.x,
                    y: u ** 3 * start.y + 3 * u * u * t * values[1] + 3 * u * t * t * values[3] + t ** 3 * end.y,
                }
            points.push(point)
        }

        current = end
    }

    return points.slice(1).map((point, index) => [points[index], point])
}

const intersects = (a: [Point, Point], b: [Point, Point]): boolean => {
    const cross = (p: Point, q: Point, r: Point): number =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
    const onSegment = (p: Point, q: Point, r: Point): boolean =>
        Math.min(p.x, r.x) - 1e-6 <= q.x
        && q.x <= Math.max(p.x, r.x) + 1e-6
        && Math.min(p.y, r.y) - 1e-6 <= q.y
        && q.y <= Math.max(p.y, r.y) + 1e-6
    const [p, q] = a
    const [r, s] = b
    const one = cross(p, q, r)
    const two = cross(p, q, s)
    const three = cross(r, s, p)
    const four = cross(r, s, q)

    return one * two < 0 && three * four < 0
        || Math.abs(one) < 1e-6 && onSegment(p, r, q)
        || Math.abs(two) < 1e-6 && onSegment(p, s, q)
        || Math.abs(three) < 1e-6 && onSegment(r, p, s)
        || Math.abs(four) < 1e-6 && onSegment(r, q, s)
}

const routeAtZoom = (layout: ReturnType<typeof layoutWorkspaceDiagram>, zoom: number) => {
    const { scaling } = createCanvasConnectorSettings()
    const scaled = getEdgeScaledSizes(zoom, {
        baseStrokeWidth: scaling.strokeWidth,
        baseMarkerSize: scaling.markerSize,
        baseMarkerOffset: scaling.markerOffset,
        zoomScaling: getAdaptiveBoundedZoomScalingOptions(scaling.zoomScaling),
    })
    const nodes = new Map<string, NodeConfig>(layout.scene.nodes.map(node => [node.nodeId, {
        id: node.nodeId,
        shape: 'rect',
        x: node.position.x,
        y: node.position.y,
        width: node.dimensions.width,
        height: node.dimensions.height,
    }]))
    const style: ConnectorDatumStyle = {
        selected: false,
        color: '#000000',
        selectedColor: '#000000',
        strokeWidth: scaling.strokeWidth,
        markerSize: scaling.markerSize,
        markerOffset: scaled.markerOffset,
        worldMarkerSize: scaled.markerSize,
        markerBodyLengthFraction: arrowRightMarkerBodyLengthFraction,
    }

    return layout.scene.edges.map(edge => {
        const node = (id: string) => layout.scene.nodes.find(candidate => candidate.nodeId === id)!
        const port = (nodeId: string, portId: string) =>
            node(nodeId).ports.find(candidate => candidate.id === portId)!
        const anchor = (nodeId: string, portId: string) => {
            const candidate = node(nodeId)
            const selected = port(nodeId, portId)
            const t = selected.direction === 'left'
                || selected.direction === 'right'
                ? selected.anchor.y / candidate.dimensions.height
                : selected.anchor.x / candidate.dimensions.width

            return {
                nodeId,
                position: selected.direction,
                t,
            }
        }
        const config: EdgeConfig = {
            id: edge.edgeId,
            source: anchor(edge.source.nodeId, edge.source.portId),
            target: anchor(edge.target.nodeId, edge.target.portId),
            pathType: edge.path,
            bendPoints: edge.bendPoints,
            marker: getBranchConnectionTargetMarker(node(edge.target.nodeId).data.role, false, edge.data.kind),
        }
        const datum = computeConnectorDatum(config, nodes, style)

        if (!datum)
            throw new Error(`Missing connector datum for ${edge.edgeId}`)

        return {
            edge,
            segments: sampledSegments(datum.svgPath),
        }
    })
}

describe('lifecycle feedback connector routing', () => {
    it('keeps the rendered feedback connector clear of every other connector across zoom scales', () => {
        const layout = layoutWorkspaceDiagram(lifecycle, 'lifecycle-feedback-routing')

        for (const zoom of [1, 0.4, 0.2]) {
            const routes = routeAtZoom(layout, zoom)
            const feedback = routes.find(route => route.edge.edgeId === 'continue-execute')!

            const crossingEdges = routes
                .filter(candidate => candidate !== feedback)
                .filter(candidate => candidate.segments.some(routeSegment => feedback.segments.some(feedbackSegment => intersects(feedbackSegment, routeSegment))))
                .map(candidate => candidate.edge.edgeId)

            expect(crossingEdges).toEqual([])
        }
    })

    it('keeps feedback attachments centered when no connector occupies that slot', () => {
        const layout = layoutWorkspaceDiagram(lifecycle, 'lifecycle-feedback-centering')
        const feedback = layout.scene.edges.find(edge => edge.edgeId === 'continue-execute')!
        const source = layout.scene.nodes.find(node => node.nodeId === feedback.source.nodeId)!
        const target = layout.scene.nodes.find(node => node.nodeId === feedback.target.nodeId)!
        const sourcePort = source.ports.find(port => port.id === feedback.source.portId)!
        const targetPort = target.ports.find(port => port.id === feedback.target.portId)!

        expect(sourcePort.anchor.x / source.dimensions.width).toBeCloseTo(0.5)
        expect(targetPort.anchor.x / target.dimensions.width).toBeCloseTo(0.5)
    })
})

describe('lifecycle feedback routing stability', () => {
    it('preserves tree-relative geometry with or without feedback', () => {
        const withFeedback = layoutWorkspaceDiagram(lifecycle, 'with-feedback')
        const withoutFeedback = layoutWorkspaceDiagram({
            ...lifecycle,
            edges: lifecycle.edges.filter(edge => edge.kind !== 'feedback'),
        }, 'without-feedback')
        const normalized = (layout: ReturnType<typeof layoutWorkspaceDiagram>) =>
            layout.scene.nodes.map(node => ({
                id: node.nodeId,
                x: node.position.x - layout.scene.nodes.find(candidate => candidate.nodeId === 'request')!.position.x,
                y: node.position.y - layout.scene.nodes.find(candidate => candidate.nodeId === 'request')!.position.y,
                width: node.dimensions.width,
                height: node.dimensions.height,
            })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

        expect(normalized(withFeedback)).toEqual(normalized(withoutFeedback))
    })

    it('keeps edge geometry stable when input edge order is reversed', () => {
        const forward = layoutWorkspaceDiagram(lifecycle, 'ordered')
        const reversed = layoutWorkspaceDiagram({
            ...lifecycle,
            edges: [...lifecycle.edges].reverse(),
        }, 'reversed')
        const geometry = (layout: ReturnType<typeof layoutWorkspaceDiagram>) =>
            layout.scene.edges.map(edge => ({
                id: edge.edgeId,
                source: edge.source,
                target: edge.target,
                bendPoints: edge.bendPoints,
            })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

        expect(geometry(reversed)).toEqual(geometry(forward))
    })

    it('keeps nested feedback curves clear of all other rendered connectors', () => {
        const nested = layoutWorkspaceDiagram({
            ...lifecycle,
            edges: [
                ...lifecycle.edges,
                {
                    id: 'accepted-resolve',
                    source: 'accepted',
                    target: 'resolve',
                    kind: 'feedback',
                },
            ],
        }, 'nested-feedback')

        for (const zoom of [1, 0.4, 0.2]) {
            const routes = routeAtZoom(nested, zoom)
            const feedback = routes.filter(route => route.edge.data.kind === 'feedback')

            for (const route of feedback) {
                const crossings = routes
                    .filter(candidate => candidate !== route)
                    .filter(candidate => candidate.segments.some(otherSegment => route.segments.some(segment => intersects(segment, otherSegment))))
                    .map(candidate => candidate.edge.edgeId)

                expect(crossings, `feedback ${route.edge.edgeId} crossings at zoom ${zoom}`).toEqual([])
            }
        }
    })
})

describe('lifecycle rendered route stability', () => {
    it('preserves actual connector paths when semantic edge input order changes', () => {
        const forward = layoutWorkspaceDiagram(lifecycle, 'rendered-forward')
        const reversed = layoutWorkspaceDiagram({
            ...lifecycle,
            edges: [...lifecycle.edges].reverse(),
        }, 'rendered-reversed')
        const paths = (layout: ReturnType<typeof layoutWorkspaceDiagram>) =>
            routeAtZoom(layout, 1)
                .map(route => ({
                    id: route.edge.edgeId,
                    segments: route.segments,
                }))
                .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

        expect(paths(reversed)).toEqual(paths(forward))
    })

    it('keeps nested feedback waypoints finite and inside fit bounds', () => {
        const nested = layoutWorkspaceDiagram({
            ...lifecycle,
            edges: [
                ...lifecycle.edges,
                {
                    id: 'accepted-resolve',
                    source: 'accepted',
                    target: 'resolve',
                    kind: 'feedback',
                },
            ],
        }, 'nested-feedback-bounds')

        expect(nested.size.width).toBeGreaterThan(0)
        expect(nested.size.height).toBeGreaterThan(0)

        for (const edge of nested.scene.edges.filter(candidate => candidate.data.kind === 'feedback')) {
            expect(edge.bendPoints?.length).toBeGreaterThan(0)
            expect(edge.bendPoints!.every(point =>
                Number.isFinite(point.x)
                && Number.isFinite(point.y)
                && point.x >= 0
                && point.x <= nested.size.width
                && point.y >= 0
                && point.y <= nested.size.height,
            )).toBe(true)
        }
    })
})

const evidenceDiagram: WorkspaceDiagram = {
    revision: 'evidence-wide',
    nodes: [
        {
            id: 'conditions',
            prompt: 'Shared protocol',
            response: 'Code, data and settings · Evaluation held fixed',
            role: 'origin',
        },
        {
            id: 'curves',
            prompt: 'Learning curves',
            response: 'When the advantage appears',
            role: 'continuation',
        },
        {
            id: 'repetitions',
            prompt: 'Repeated runs',
            response: 'Variation across attempts',
            role: 'continuation',
        },
        {
            id: 'validity',
            prompt: 'Validity checks',
            response: 'Is the comparison sound?',
            role: 'continuation',
        },
        {
            id: 'claim',
            prompt: 'Finding',
            response: 'Evidence · Conditions',
            role: 'origin',
        },
        {
            id: 'next',
            prompt: 'Next experiment',
            response: 'Duration or model size',
            role: 'continuation',
        },
        {
            id: 'bridge',
            prompt: 'Bridge experiment',
            response: 'Check before a new task',
            role: 'continuation',
        },
        {
            id: 'changed-input',
            prompt: 'Changed conditions',
            response: 'Code, data or evaluation',
            role: 'origin',
        },
        {
            id: 'review',
            prompt: 'Review',
            response: 'Affected tests · Next action',
            role: 'origin',
        },
        {
            id: 'record',
            prompt: 'Retained finding',
            response: 'Conditions and corrections',
            role: 'continuation',
        },
    ],
    stages: [
        {
            trees: [{
                rootId: 'conditions',
                children: { conditions: ['curves', 'repetitions', 'validity'] },
            }],
        },
        {
            trees: [{
                rootId: 'claim',
                children: { claim: ['next', 'bridge'] },
            }],
        },
        {
            alignNodeId: 'review',
            trees: [
                { rootId: 'changed-input' },
                {
                    rootId: 'review',
                    children: { review: ['record'] },
                },
            ],
        },
    ],
    edges: [
        {
            id: 'conditions-curves',
            source: 'conditions',
            target: 'curves',
            kind: 'forward',
        },
        {
            id: 'conditions-repetitions',
            source: 'conditions',
            target: 'repetitions',
            kind: 'forward',
        },
        {
            id: 'conditions-validity',
            source: 'conditions',
            target: 'validity',
            kind: 'forward',
        },
        {
            id: 'curves-claim',
            source: 'curves',
            target: 'claim',
            kind: 'forward',
        },
        {
            id: 'repetitions-claim',
            source: 'repetitions',
            target: 'claim',
            kind: 'forward',
        },
        {
            id: 'validity-claim',
            source: 'validity',
            target: 'claim',
            kind: 'forward',
        },
        {
            id: 'claim-next',
            source: 'claim',
            target: 'next',
            kind: 'forward',
        },
        {
            id: 'claim-bridge',
            source: 'claim',
            target: 'bridge',
            kind: 'forward',
        },
        {
            id: 'next-curves',
            source: 'next',
            target: 'curves',
            kind: 'feedback',
        },
        {
            id: 'bridge-record',
            source: 'bridge',
            target: 'record',
            kind: 'relation',
        },
        {
            id: 'claim-review',
            source: 'claim',
            target: 'review',
            kind: 'relation',
        },
        {
            id: 'changed-input-review',
            source: 'changed-input',
            target: 'review',
            kind: 'relation',
        },
        {
            id: 'review-conditions',
            source: 'review',
            target: 'conditions',
            kind: 'feedback',
        },
        {
            id: 'review-record',
            source: 'review',
            target: 'record',
            kind: 'forward',
        },
    ],
}

describe('website evidence feedback connector routing', () => {
    it('lays out the exact evidence graph and keeps rendered feedback curves clear', () => {
        const layout = layoutWorkspaceDiagram(evidenceDiagram, 'evidence-wide')

        expect(layout.scene.edges.map(edge => edge.edgeId)).toEqual(evidenceDiagram.edges.map(edge => edge.id))

        for (const edge of layout.scene.edges.filter(candidate => candidate.data.kind === 'feedback')) {
            expect(edge.bendPoints?.length).toBeGreaterThan(0)
            expect(edge.bendPoints!.every(point =>
                Number.isFinite(point.x)
                && Number.isFinite(point.y)
                && point.x >= 0
                && point.x <= layout.size.width
                && point.y >= 0
                && point.y <= layout.size.height,
            )).toBe(true)
        }

        for (const zoom of [1, 0.4, 0.2]) {
            const routes = routeAtZoom(layout, zoom)

            for (const feedback of routes.filter(route => route.edge.data.kind === 'feedback')) {

                const crossings = routes
                    .filter(candidate => candidate !== feedback)
                    .filter(candidate => candidate.segments.some(otherSegment =>
                        feedback.segments.some(segment => intersects(segment, otherSegment)),
                    ))
                    .map(candidate => candidate.edge.edgeId)

                expect(crossings, `evidence feedback ${feedback.edge.edgeId} crossings at zoom ${zoom}`).toEqual([])
            }
        }
    })
})
