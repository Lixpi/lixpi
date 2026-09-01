import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'

import { PipelineEventLog } from './pipeline-event-log.ts'

const createNatsService = () => ({
    ensureJetStreamStream: vi.fn(async () => undefined),
    publishJetStream: vi.fn(async () => ({ seq: 42 })),
    getJetStreamMessage: vi.fn(),
    purgeJetStreamSubject: vi.fn(async () => undefined),
})

// =============================================================================
// PIPELINE EVENT JETSTREAM LOG
// =============================================================================

describe('PipelineEventLog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('creates a workspace pipeline stream with bounded per-subject retention', async () => {
        const nats = createNatsService()
        const log = new PipelineEventLog(nats as any, {
            maxAgeMs: 1234,
            maxBytes: 5678,
            maxMsgsPerSubject: 91,
        })

        await log.ensureWorkspaceStream('workspace:one')

        expect(nats.ensureJetStreamStream).toHaveBeenCalledWith({
            name: 'PIPELINE_EVENTS_workspace_one',
            subjects: [`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.workspace_one.>`],
            retention: 'limits',
            storage: 'file',
            allow_direct: true,
            max_age: 1234 * 1000000,
            max_bytes: 5678,
            max_msgs_per_subject: 91,
        })
    })

    it('publishes sanitized payloads with msgID de-dupe and stream expectations', async () => {
        const nats = createNatsService()
        const log = new PipelineEventLog(nats as any)

        const event = await log.publishEvent({
            workspaceId: 'workspace:one',
            pipelineId: 'thread/one',
            eventId: 'event-1',
            payload: {
                keep: 'value',
                drop: undefined,
                nested: {
                    missing: undefined,
                    value: 7,
                },
            },
        })

        expect(nats.publishJetStream).toHaveBeenCalledWith(
            `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.workspace_one.thread_one`,
            expect.objectContaining({
                kind: 'PIPELINE_EVENT',
                workspaceId: 'workspace:one',
                pipelineId: 'thread/one',
                eventId: 'event-1',
                payload: {
                    keep: 'value',
                    nested: { value: 7 },
                },
                streamSequence: 0,
            }),
            {
                msgID: 'event-1',
                expect: { streamName: 'PIPELINE_EVENTS_workspace_one' },
            },
        )
        expect(event).toEqual(expect.objectContaining({
            eventId: 'event-1',
            streamSequence: 42,
        }))
    })

    it('replays events by direct stream message scan and attaches authoritative stream sequences', async () => {
        const nats = createNatsService()
        nats.getJetStreamMessage
            .mockResolvedValueOnce({
                seq: 9,
                subject: `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.ws.thread`,
                data: {
                    kind: 'PIPELINE_EVENT',
                    workspaceId: 'ws',
                    pipelineId: 'thread',
                    eventId: 'last',
                    payload: {},
                    publishedAt: 1,
                    streamSequence: 0,
                },
            })
            .mockResolvedValueOnce({
                seq: 4,
                subject: `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.ws.thread`,
                data: {
                    kind: 'PIPELINE_EVENT',
                    workspaceId: 'ws',
                    pipelineId: 'thread',
                    eventId: 'event-4',
                    payload: { content: { status: 'STREAMING' } },
                    publishedAt: 2,
                    streamSequence: 0,
                },
            })
            .mockResolvedValueOnce({
                seq: 7,
                subject: `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.ws.thread`,
                data: {
                    kind: 'PIPELINE_EVENT',
                    workspaceId: 'ws',
                    pipelineId: 'thread',
                    eventId: 'event-7',
                    payload: { content: { status: 'IMAGE_COMPLETE' } },
                    publishedAt: 3,
                    streamSequence: 0,
                },
            })

        const log = new PipelineEventLog(nats as any)
        const result = await log.replayPipelineEvents({
            workspaceId: 'ws',
            pipelineId: 'thread',
            startStreamSeq: 3,
            maxMessages: 2,
        })

        const subject = `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.ws.thread`
        expect(nats.getJetStreamMessage).toHaveBeenNthCalledWith(1, 'PIPELINE_EVENTS_ws', {
            last_by_subj: subject,
        })
        expect(nats.getJetStreamMessage).toHaveBeenNthCalledWith(2, 'PIPELINE_EVENTS_ws', {
            seq: 3,
            next_by_subj: subject,
        })
        expect(nats.getJetStreamMessage).toHaveBeenNthCalledWith(3, 'PIPELINE_EVENTS_ws', {
            seq: 5,
            next_by_subj: subject,
        })
        expect(result.events).toEqual([
            expect.objectContaining({ eventId: 'event-4', streamSequence: 4 }),
            expect.objectContaining({ eventId: 'event-7', streamSequence: 7 }),
        ])
    })
})
