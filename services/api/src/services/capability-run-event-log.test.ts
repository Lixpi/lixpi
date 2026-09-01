import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    type CapabilityRunEvent,
} from '@lixpi/constants'

import {
    CapabilityRunEventLog,
    getCapabilityRunEventSubject,
} from './capability-run-event-log.ts'

const event: CapabilityRunEvent = {
    runId: 'run-1',
    sequence: 1,
    eventType: 'RUN_STARTED',
    timestamp: 10,
    runStatus: 'running',
}

describe('CapabilityRunEventLog', () => {
    it('creates an R3 file stream and appends idempotent run events', async () => {
        const service = {
            ensureJetStreamStream: vi.fn().mockResolvedValue(undefined),
            publishJetStream: vi.fn().mockResolvedValue({ seq: 12 }),
        }
        const log = new CapabilityRunEventLog(service as any)

        const result = await log.append({ userId: 'user-1', workspaceId: 'workspace-1', event })

        expect(service.ensureJetStreamStream).toHaveBeenCalledWith(expect.objectContaining({
            name: 'CAPABILITY_RUN_EVENTS_workspace-1',
            storage: 'file',
            num_replicas: 3,
            subjects: ['ai.interaction.capability.run.events.workspace-1.>'],
        }))
        expect(service.publishJetStream).toHaveBeenCalledWith(
            'ai.interaction.capability.run.events.workspace-1.run-1',
            expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1', event }),
            { msgID: 'run-1:1', expect: { streamName: 'CAPABILITY_RUN_EVENTS_workspace-1' } },
        )
        expect(result.streamSequence).toBe(12)
    })

    it('replays a bounded sequence and reports whether more events remain', async () => {
        const service = {
            getJetStreamMessage: vi.fn()
                .mockResolvedValueOnce({ seq: 4, data: { userId: 'user-1', workspaceId: 'workspace-1', event } })
                .mockResolvedValueOnce({ seq: 2, data: { userId: 'user-1', workspaceId: 'workspace-1', event } })
                .mockResolvedValueOnce({ seq: 3, data: { userId: 'user-1', workspaceId: 'workspace-1', event } }),
        }
        const log = new CapabilityRunEventLog(service as any)

        const result = await log.replay({
            workspaceId: 'workspace-1',
            runId: 'run-1',
            startStreamSequence: 2,
            maxMessages: 2,
        })

        expect(result.events.map((candidate) => candidate.streamSequence)).toEqual([2, 3])
        expect(result.hasMore).toBe(true)
        expect(result.subject).toBe(getCapabilityRunEventSubject('workspace-1', 'run-1'))
    })
})
