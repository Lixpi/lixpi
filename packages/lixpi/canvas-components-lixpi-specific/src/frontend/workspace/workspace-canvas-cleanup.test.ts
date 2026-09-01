import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { destroyWorkspaceCanvasResources } from './workspace-canvas-cleanup.ts'

describe('destroyWorkspaceCanvasResources', () => {
    it('destroys resources in reverse ownership order', () => {
        const calls: string[] = []

        destroyWorkspaceCanvasResources([
            () => calls.push('first'),
            () => calls.push('second'),
        ])

        expect(calls).toEqual(['second', 'first'])
    })

    it('continues cleanup and aggregates failures', () => {
        const completed = vi.fn()

        expect(() =>
            destroyWorkspaceCanvasResources([
                completed,
                () => {
                    throw new Error('broken cleanup')
                },
            ])
        ).toThrow(AggregateError)
        expect(completed).toHaveBeenCalledOnce()
    })
})
