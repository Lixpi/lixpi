import { describe, expect, it, vi } from 'vitest'
import type { CapabilityRun, CapabilityRunEvent } from '@lixpi/constants'

import {
    createCapabilityRunProgress,
    projectCapabilityRunEvents,
} from '$src/components/capabilityRun/capabilityRunProgress.ts'

const run: CapabilityRun = {
    runId: 'run-1',
    rootCapabilityId: 'tool-1',
    resolvedManifests: [],
    workspaceId: 'workspace-1',
    origin: 'panel',
    status: 'running',
    currentStepIds: ['generate'],
    outputAssetIds: [],
    eventStreamName: 'events',
    createdAt: 1,
    updatedAt: 2,
}

function event(overrides: Partial<CapabilityRunEvent> & Pick<CapabilityRunEvent, 'sequence' | 'eventType'>): CapabilityRunEvent {
    return {
        runId: 'run-1',
        timestamp: overrides.sequence,
        runStatus: 'running',
        ...overrides,
    }
}

describe('projectCapabilityRunEvents', () => {
    it('sorts replayed events, ignores duplicate sequences, and preserves manifest step order', () => {
        const state = projectCapabilityRunEvents(run, [
            event({ sequence: 3, eventType: 'STEP_COMPLETED', stepId: 'generate', stepTitle: 'Generate sheet', stepStatus: 'completed', safeOutputSummary: 'One image' }),
            event({ sequence: 1, eventType: 'RUN_STARTED' }),
            event({ sequence: 2, eventType: 'STEP_STARTED', stepId: 'generate', stepTitle: 'Generate sheet', stepStatus: 'running' }),
            event({ sequence: 2, eventType: 'STEP_STARTED', stepId: 'duplicate', stepStatus: 'running' }),
            event({ sequence: 4, eventType: 'RUN_COMPLETED', runStatus: 'completed', outputAssetIds: ['asset-1'] }),
        ])

        expect(state.status).toBe('completed')
        expect(state.lastSequence).toBe(4)
        expect(state.outputAssetIds).toEqual(['asset-1'])
        expect(state.steps).toEqual([{
            stepId: 'generate',
            title: 'Generate sheet',
            status: 'completed',
            summary: 'One image',
            error: undefined,
        }])
    })
})

describe('CapabilityRunProgress replay', () => {
    it('subscribes before replay and merges buffered and subsequent live events by sequence', async () => {
        let resolveReplay: ((value: { run: CapabilityRun; events: CapabilityRunEvent[] }) => void) | undefined
        const replay = vi.fn(() => new Promise<{ run: CapabilityRun; events: CapabilityRunEvent[] }>((resolve) => {
            resolveReplay = resolve
        }))
        let liveListener: ((event: CapabilityRunEvent) => void) | undefined
        const unsubscribe = vi.fn()
        const subscribeToRunEvents = vi.fn((_runId: string, listener: (event: CapabilityRunEvent) => void) => {
            liveListener = listener
            return unsubscribe
        })
        const progress = createCapabilityRunProgress({ replay, subscribeToRunEvents })

        const replayPromise = progress.replay('run-1')
        expect(subscribeToRunEvents.mock.invocationCallOrder[0]).toBeLessThan(replay.mock.invocationCallOrder[0] ?? 0)
        liveListener?.(event({ sequence: 2, eventType: 'STEP_STARTED', stepId: 'build', stepStatus: 'running' }))
        resolveReplay?.({
            run,
            events: [event({ sequence: 1, eventType: 'RUN_STARTED' })],
        })
        await replayPromise

        expect(progress.getState()?.lastSequence).toBe(2)
        liveListener?.(event({ sequence: 3, eventType: 'RUN_COMPLETED', runStatus: 'completed' }))
        expect(progress.getState()?.status).toBe('completed')
        expect(progress.getState()?.lastSequence).toBe(3)
        expect(unsubscribe).toHaveBeenCalledOnce()

        progress.destroy()
        expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('renders a replay error when live subscription setup fails', async () => {
        const progress = createCapabilityRunProgress({
            replay: vi.fn(),
            subscribeToRunEvents: () => {
                throw new Error('disconnected')
            },
        })

        await expect(progress.replay('run-1')).resolves.toBeUndefined()

        expect(progress.element.textContent).toContain('Could not replay this Tool run.')
    })
})
