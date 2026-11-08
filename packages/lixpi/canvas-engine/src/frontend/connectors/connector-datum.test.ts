import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    computeConnectorDatum,
    computeConnectorEndpoints,
    type ConnectorDatumStyle,
} from './connector-datum.ts'
import {
    type EdgeConfig,
    type NodeConfig,
} from '../../shared/connectors/path-types.ts'
import matrixFixture from '../../shared/connectors/paths/matrix-anchor-regression-fixtures.json'

const nodes = new Map<string, NodeConfig>([
    ['a', {
        id: 'a',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
    }],
    ['b', {
        id: 'b',
        shape: 'rect',
        x: 300,
        y: 0,
        width: 100,
        height: 100,
    }],
])
const edge: EdgeConfig = {
    id: 'ab',
    source: {
        nodeId: 'a',
        position: 'right',
    },
    target: {
        nodeId: 'b',
        position: 'left',
    },
    pathType: 'straight',
}
const style: ConnectorDatumStyle = {
    selected: false,
    color: '#000000',
    selectedColor: '#ffffff',
    strokeWidth: 2,
    markerSize: 12,
    markerOffset: {
        source: 5,
        target: 5,
    },
    worldMarkerSize: 20,
    markerBodyLengthFraction: 0.5,
}

describe('Connector geometry', () => {
    it('uses caller marker geometry while keeping undecorated endpoints at their plain gap', () => {
        const plain = computeConnectorDatum(edge, nodes, style)!
        expect(plain.svgPath).toContain('105')
        expect(plain.svgPath).toContain('295')
        expect(plain.arrowEnd).toBeNull()
        const decorated = computeConnectorDatum({
            ...edge,
            marker: 'arrowhead',
            markerStart: 'arrowhead',
        }, nodes, style)!
        expect(decorated.arrowStart?.x).toBe(115)
        expect(decorated.arrowEnd?.x).toBe(285)
        expect(decorated.arrowEnd?.baseScreenSize).toBe(12)
    })

    it('retains selected colors and dash presentation without knowing node data or artwork', () => {
        const result = computeConnectorDatum({
            ...edge,
            lineStyle: 'dashed',
        }, nodes, {
            ...style,
            selected: true,
        })!
        expect(result.strokeColor).toBe('#ffffff')
        expect(result.isDashed).toBe(true)
        expect(computeConnectorDatum(edge, new Map(), style)).toBeNull()
    })
})


type CapturedMatrixCase = {
    source: string
    target: string
    edges: Array<{
        edge: EdgeConfig
        endpoints: {
            source: {
                x: number
                y: number
            }
            target: {
                x: number
                y: number
            }
        }
        style: ConnectorDatumStyle
    }>
}

const capturedMatrixCases = matrixFixture.cases as CapturedMatrixCase[]
const capturedMatrixNodes = matrixFixture.nodes as NodeConfig[]

describe('captured connector matrix datum regression', () => {
    it.each(capturedMatrixCases)('creates both connector datums for $source to $target anchors', ({ edges }) => {
        const worldNodeMap = new Map(capturedMatrixNodes.map(node => [node.id, node]))

        for (const sample of edges) {
            const {
                edge,
                endpoints,
                style: capturedStyle,
            } = sample
            const label = `${edge.id} ${edge.source.position} to ${edge.target.position}`
            const actualEndpoints = computeConnectorEndpoints(edge, worldNodeMap, capturedStyle)

            expect(actualEndpoints, `${label} resolves world endpoints`).not.toBeNull()
            expect(actualEndpoints, `${label} matches the captured browser endpoints`).toEqual(endpoints)

            const datum = computeConnectorDatum(edge, worldNodeMap, capturedStyle)

            expect(datum, `${label} creates a connector datum`).not.toBeNull()
            expect(datum?.svgPath, `${label} creates an SVG route`).toMatch(/^M /)
        }
    })
})
