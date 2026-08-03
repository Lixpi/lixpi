'use strict'

'use strict'

import { describe, expect, it, vi } from 'vitest'

import { CapabilityMediaDagRunner } from './capability-media-dag-runner.ts'

describe('CapabilityMediaDagRunner', () => {
    const nodes = [
        { nodeId: 'front', dependsOn: [] },
        { nodeId: 'profile', dependsOn: ['front'] },
        { nodeId: 'back', dependsOn: ['profile'] },
    ]

    it('executes dependencies and emits declaration-ordered events', async () => {
        const result = await new CapabilityMediaDagRunner(nodes, 2, 0).run({
            execute: async node => node.nodeId,
        })

        expect([...result.results.values()]).toEqual(['front', 'profile', 'back'])
        expect(result.events.filter(event => event.type === 'completed').map(event => event.nodeId))
            .toEqual(['front', 'profile', 'back'])
    })

    it('retries only retryable transport failures and always cleans up', async () => {
        const cleanup = vi.fn(async () => undefined)
        let attempts = 0
        await new CapabilityMediaDagRunner([nodes[0]!], 1, 1).run({
            execute: async () => {
                attempts += 1
                if (attempts === 1) throw Object.assign(new Error('capacity'), { status: 429 })
                return 'ok'
            },
            cleanup,
        })

        expect(attempts).toBe(2)
        expect(cleanup).toHaveBeenCalledOnce()
    })

    it('propagates cancellation and cleans up', async () => {
        const controller = new AbortController()
        const cleanup = vi.fn(async () => undefined)
        controller.abort(new Error('cancelled'))

        await expect(new CapabilityMediaDagRunner(nodes, 1, 0).run({
            execute: async () => 'unused',
            signal: controller.signal,
            cleanup,
        })).rejects.toThrow('cancelled')
        expect(cleanup).toHaveBeenCalledOnce()
    })

    it('records an allowed optional failure and continues independent work', async () => {
        const result = await new CapabilityMediaDagRunner([
            { nodeId: 'required', dependsOn: [] },
            { nodeId: 'optional', dependsOn: [] },
        ], 2, 0).run({
            execute: async node => {
                if (node.nodeId === 'optional') throw new Error('optional output unavailable')
                return node.nodeId
            },
            allowTerminalFailure: node => node.nodeId === 'optional',
        })

        expect(result.results.get('required')).toBe('required')
        expect(result.results.has('optional')).toBe(false)
        expect(result.events).toContainEqual(expect.objectContaining({ nodeId: 'optional', type: 'failed' }))
    })
})
