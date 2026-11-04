import { describe, expect, it } from 'vitest'
import {
    isOrthogonalRouteClear,
} from '@lixpi/canvas-engine/shared'
import { getBranchConnectionTargetMarker } from '../../frontend/connectors/branch-connection-policy.ts'
import { layoutWorkspaceDiagram, type WorkspaceDiagram } from './workspace-diagram.ts'

const evidenceDiagram: WorkspaceDiagram = {
    revision: 'evidence-routing',
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
            role: 'fork',
        },
        {
            id: 'bridge',
            prompt: 'Bridge experiment',
            response: 'Check before a new task',
            role: 'fork',
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
            trees: [
                {
                    rootId: 'review',
                    children: { review: ['record'] },
                },
                { rootId: 'changed-input' },
            ],
        },
    ],
    edges: [
        {
            id: 'conditions-curves',
            source: 'conditions',
            target: 'curves',
        },
        {
            id: 'conditions-repetitions',
            source: 'conditions',
            target: 'repetitions',
        },
        {
            id: 'conditions-validity',
            source: 'conditions',
            target: 'validity',
        },
        {
            id: 'curves-claim',
            source: 'curves',
            target: 'claim',
        },
        {
            id: 'repetitions-claim',
            source: 'repetitions',
            target: 'claim',
        },
        {
            id: 'validity-claim',
            source: 'validity',
            target: 'claim',
        },
        {
            id: 'claim-next',
            source: 'claim',
            target: 'next',
        },
        {
            id: 'claim-bridge',
            source: 'claim',
            target: 'bridge',
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
        },
    ],
}

const portFor = (
    layout: ReturnType<typeof layoutWorkspaceDiagram>,
    nodeId: string,
    portId: string,
) => layout.scene.nodes.find(node => node.nodeId === nodeId)!.ports.find(port => port.id === portId)!

const worldAnchor = (
    layout: ReturnType<typeof layoutWorkspaceDiagram>,
    nodeId: string,
    portId: string,
) => {
    const node = layout.scene.nodes.find(candidate => candidate.nodeId === nodeId)!
    const port = portFor(layout, nodeId, portId)

    return {
        x: node.position.x + port.anchor.x,
        y: node.position.y + port.anchor.y,
    }
}

describe('workspace diagram native graph routing', () => {
    it('keeps feedback lanes inside the fit bounds and away from every non-endpoint node', () => {
        const layout = layoutWorkspaceDiagram(evidenceDiagram, 'evidence-routing')

        for (const edge of layout.scene.edges.filter(candidate => candidate.data.kind === 'feedback')) {
            expect(edge.bendPoints?.length).toBeGreaterThan(0)
            expect(edge.bendPoints!.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
            expect(edge.bendPoints!.every(point => point.x >= 0 && point.x <= layout.size.width && point.y >= 0 && point.y <= layout.size.height)).toBe(true)

            const points = [
                worldAnchor(layout, edge.source.nodeId, edge.source.portId),
                ...edge.bendPoints!,
                worldAnchor(layout, edge.target.nodeId, edge.target.portId),
            ]
            const obstacles = layout.scene.nodes
                .filter(node => node.nodeId !== edge.source.nodeId && node.nodeId !== edge.target.nodeId)
                .map(node => ({
                    id: node.nodeId,
                    x: node.position.x,
                    y: node.position.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                }))

            expect(isOrthogonalRouteClear(points, obstacles), edge.edgeId).toBe(true)
        }
    })

    it('keeps ordinary fan-outs and fan-ins on their shared lineage ports while returns use dedicated ports', () => {
        const layout = layoutWorkspaceDiagram(evidenceDiagram, 'evidence-routing')
        const forward = layout.scene.edges.filter(edge => !edge.data.kind || edge.data.kind === 'forward')
        const feedback = layout.scene.edges.filter(edge => edge.data.kind === 'feedback')
        const relations = layout.scene.edges.filter(edge => edge.data.kind === 'relation')

        expect(forward.filter(edge => edge.source.nodeId === 'conditions').map(edge => edge.source.portId)).toEqual([
            'right',
            'right',
            'right',
        ])
        expect(forward.filter(edge => edge.target.nodeId === 'claim').map(edge => edge.target.portId)).toEqual([
            'left',
            'left',
            'left',
        ])

        for (const edge of feedback) {
            expect(edge.source.portId).not.toBe('right')
            expect(edge.target.portId).not.toBe('left')

            const sourcePort = portFor(layout, edge.source.nodeId, edge.source.portId)
            const targetPort = portFor(layout, edge.target.nodeId, edge.target.portId)

            expect(sourcePort.role).toBe('output')
            expect(targetPort.role).toBe('input')
        }

        const sourceLanes = feedback.map(edge => edge.bendPoints![0].y)
        expect(new Set(sourceLanes).size).toBe(sourceLanes.length)
    })
})

describe('workspace diagram edge markers', () => {
    it('keeps arrows on relation and feedback edges when the target is a fork', () => {
        expect(getBranchConnectionTargetMarker('fork', false, 'forward')).toBe('none')
        expect(getBranchConnectionTargetMarker('fork', false, 'relation')).toBe('arrowhead')
        expect(getBranchConnectionTargetMarker('fork', false, 'feedback')).toBe('arrowhead')
        expect(getBranchConnectionTargetMarker('fork', true, 'relation')).toBe('arrowhead-selected')
        expect(getBranchConnectionTargetMarker('fork', true, 'feedback')).toBe('arrowhead-selected')
    })
})

describe('workspace diagram stage alignment', () => {
    it('aligns the selected node center and preserves its tree offsets', () => {
        const alignedDiagram: WorkspaceDiagram = {
            ...evidenceDiagram,
            stages: [
                ...evidenceDiagram.stages.slice(0, 2),
                {
                    ...evidenceDiagram.stages[2],
                    alignNodeId: 'review',
                },
            ],
        }
        const unaligned = layoutWorkspaceDiagram(evidenceDiagram, 'unaligned')
        const aligned = layoutWorkspaceDiagram(alignedDiagram, 'aligned')
        const centerY = (
            layout: ReturnType<typeof layoutWorkspaceDiagram>,
            nodeId: string,
        ): number => {
            const node = layout.scene.nodes.find(candidate => candidate.nodeId === nodeId)!

            return node.position.y + node.dimensions.height / 2
        }
        const treeOffset = (
            layout: ReturnType<typeof layoutWorkspaceDiagram>,
        ): number => {
            const review = layout.scene.nodes.find(node => node.nodeId === 'review')!
            const record = layout.scene.nodes.find(node => node.nodeId === 'record')!

            return record.position.y - review.position.y
        }

        expect(centerY(aligned, 'review')).toBeCloseTo(centerY(aligned, 'claim'))
        expect(treeOffset(aligned)).toBe(treeOffset(unaligned))
    })

    it('rejects an alignment anchor outside its stage', () => {
        const invalid: WorkspaceDiagram = {
            ...evidenceDiagram,
            stages: [
                ...evidenceDiagram.stages.slice(0, 2),
                {
                    ...evidenceDiagram.stages[2],
                    alignNodeId: 'conditions',
                },
            ],
        }

        expect(() => layoutWorkspaceDiagram(invalid, 'invalid-alignment'))
            .toThrow('Workspace diagram stage alignment must reference a node in that stage')
    })
})
