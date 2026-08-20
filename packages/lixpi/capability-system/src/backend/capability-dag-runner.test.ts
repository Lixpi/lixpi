import { describe, expect, it } from 'vitest'

import { CapabilityDagRunner } from './capability-dag-runner.ts'

describe('CapabilityDagRunner', () => {
    it('releases ready nodes in declaration order and advances dependencies after success', () => {
        const runner = new CapabilityDagRunner([
            { nodeId: 'front', dependsOn: [] },
            { nodeId: 'profile', dependsOn: ['front'] },
            { nodeId: 'head', dependsOn: [] },
            { nodeId: 'action', dependsOn: ['front', 'head'] },
        ])

        expect(runner.getReadyNodes().map(node => node.nodeId)).toEqual(['front', 'head'])
        runner.setStatus('front', 'completed')
        runner.setStatus('head', 'completed')
        expect(runner.getReadyNodes().map(node => node.nodeId)).toEqual(['profile', 'action'])
    })

    it.each([
        [[{ nodeId: 'bad id', dependsOn: [] }], 'CAPABILITY_DAG_NODE_ID_INVALID'],
        [[{ nodeId: 'same', dependsOn: [] }, { nodeId: 'same', dependsOn: [] }], 'CAPABILITY_DAG_NODE_ID_DUPLICATE'],
        [[{ nodeId: 'first', dependsOn: ['missing'] }], 'CAPABILITY_DAG_DEPENDENCY_UNKNOWN'],
        [[{ nodeId: 'first', dependsOn: ['second'] }, { nodeId: 'second', dependsOn: ['first'] }], 'CAPABILITY_DAG_CYCLE'],
    ] as const)('rejects invalid dependency graphs', (nodes, errorCode) => {
        expect(() => new CapabilityDagRunner(nodes)).toThrow(errorCode)
    })

    it('cancels pending nodes in declaration order without changing settled nodes', () => {
        const runner = new CapabilityDagRunner([
            { nodeId: 'first', dependsOn: [] },
            { nodeId: 'second', dependsOn: ['first'] },
        ])
        runner.setStatus('first', 'completed')

        expect(runner.cancelPending().map(node => node.nodeId)).toEqual(['second'])
        expect(runner.snapshot()).toEqual({ first: 'completed', second: 'cancelled' })
    })
})
