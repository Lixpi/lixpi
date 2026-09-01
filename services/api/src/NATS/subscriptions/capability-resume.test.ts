'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    getCapabilityUserEventSubject,
    NATS_SUBJECTS,
    type CapabilityRunStatus,
} from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    replay: vi.fn(),
}))

vi.mock('../../services/capability-run-event-log.ts', () => ({
    CapabilityRunEventLog: class {
        static fromSingleton(): { replay: typeof mocks.replay } {
            return { replay: mocks.replay }
        }
    },
}))

import { capabilitySubjects } from './capability-subjects.ts'

const { RUN } = NATS_SUBJECTS.CAPABILITY_SUBJECTS

function makeRun(status: CapabilityRunStatus) {
    return {
        runId: `run-${status}`,
        rootCapabilityId: 'tool-1',
        resolvedManifests: [{ capabilityId: 'tool-1', manifestBlobHash: 'a'.repeat(64) }],
        workspaceId: 'workspace-1',
        origin: 'panel' as const,
        status,
        currentStepIds: [],
        outputAssetIds: status === 'completed' ? ['asset-1'] : [],
        eventStreamName: 'CAPABILITY_RUN_EVENTS_workspace-1',
        ownerUserId: 'user-1',
        createdAt: 1,
        updatedAt: 2,
    }
}

describe('Capability run event resume', () => {
    beforeEach(() => {
        mocks.replay.mockResolvedValue({
            streamName: 'CAPABILITY_RUN_EVENTS_workspace-1',
            subject: 'ai.interaction.capability.run.events.workspace-1.run-1',
            events: [],
            hasMore: false,
        })
    })

    it.each<CapabilityRunStatus>(['running', 'completed'])(
        'reloads durable events and returns the tokenized live subject for a %s run',
        async (status) => {
            const run = makeRun(status)
            ;(globalThis as any).dynamoDBService = {
                getItem: vi.fn().mockResolvedValue(run),
            }
            const resume = capabilitySubjects.find((subscription) => subscription.subject === RUN.RESUME)!

            const result = await resume.handler({
                user: { userId: 'user-1' },
                workspaceId: run.workspaceId,
                runId: run.runId,
                cursor: '7',
            })

            expect(mocks.replay).toHaveBeenCalledWith({
                workspaceId: run.workspaceId,
                runId: run.runId,
                startStreamSequence: 7,
                maxMessages: undefined,
            })
            expect(result).toEqual(expect.objectContaining({
                run,
                liveSubject: `${getCapabilityUserEventSubject('user-1', RUN.STATUS)}.workspace-1.${run.runId}`,
                replay: expect.objectContaining({ events: [] }),
            }))
        },
    )
})
