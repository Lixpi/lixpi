import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    WRITES_IDX_MAP,
    type Checkpoint,
    type CheckpointTuple,
} from '@langchain/langgraph-checkpoint'
import { ConversationCheckpointSaver } from './conversation-checkpoint-saver.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const checkpoint = (id: string, value = id): Checkpoint => ({
    v: 4,
    id,
    ts: '2026-10-24T00:00:00.000Z',
    channel_values: { messages: [value] },
    channel_versions: { messages: 1 },
    versions_seen: {},
})
const metadata = {
    source: 'loop' as const,
    step: 1,
    parents: {},
}
const config = { configurable: {
    thread_id: 'conversation',
    checkpoint_ns: 'root',
} }

const fixture = async () => {
    const execution = await createConversationExecutionFixture()
    const saver = new ConversationCheckpointSaver(execution.repository, execution.payloads, {
        partition: execution.partition,
        threadId: 'conversation',
        assertRead: async () => void (await execution.owner.read()),
        writeFences: async () => await execution.owner.fences(0),
    })

    return {
        ...execution,
        saver,
    }
}

// =============================================================================
// CHECKPOINT RECOVERY AND PENDING WRITES
// =============================================================================

describe('conversation checkpoint saver', () => {
    it('recovers a committed checkpoint after its acknowledgement is lost and preserves the latest head', async () => {
        const {
            saver,
            database,
        } = await fixture()
        database.failAfterCommit = true
        await expect(saver.put(config, checkpoint('002'), metadata, {})).rejects.toThrow('ACKNOWLEDGEMENT_LOST')
        const saved = await saver.put(config, checkpoint('002'), metadata, {})
        await saver.put(config, checkpoint('001'), metadata, {})
        expect((await saver.getTuple(config))?.checkpoint.id).toBe('002')
        expect((await saver.getTuple(saved))?.checkpoint.channel_values.messages).toEqual(['002'])
        await expect(saver.put(config, checkpoint('002', 'changed'), metadata, {})).rejects.toThrow('AGENT_CHECKPOINT_ID_CONFLICT')
    })

    it('commits concurrent identical checkpoint retries once and retains parent lineage', async () => {
        const {
            saver,
            database,
        } = await fixture()
        const [first, duplicate] = await Promise.all([saver.put(config, checkpoint('001'), metadata, {}), saver.put(config, checkpoint('001'), metadata, {})])
        expect(duplicate).toEqual(first)
        const next = await saver.put(first, checkpoint('002'), metadata, {})
        expect((await saver.getTuple(next))?.parentConfig).toEqual(first)
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('CHECKPOINT#'))).toHaveLength(2)
    })

    it('recovers every paginated pending write and keeps successful task writes idempotent', async () => {
        const { saver } = await fixture()
        const saved = await saver.put(config, checkpoint('001'), metadata, {})

        for (let index = 0; index < 5; index++)
            await saver.putWrites(saved, [['messages', `result-${index}`]], `task-${index}`)

        await saver.putWrites(saved, [['messages', 'replacement']], 'task-0')
        const special = Object.entries(WRITES_IDX_MAP).find(([, index]) => index < 0)![0]
        await saver.putWrites(saved, [[special, 'first']], 'error-task')
        await saver.putWrites(saved, [[special, 'second']], 'error-task')
        const tuple = await saver.getTuple(saved)
        expect(tuple?.pendingWrites).toHaveLength(6)
        expect(tuple?.pendingWrites).toContainEqual(['task-0', 'messages', 'result-0'])
        expect(tuple?.pendingWrites).toContainEqual(['error-task', special, 'second'])
    })

    it('lists across namespaces with before/filter/limit and deletes all paginated payload owners', async () => {
        const {
            saver,
            database,
            payloads,
        } = await fixture()

        for (let index = 1; index <= 6; index++) {
            const current = { configurable: {
                thread_id: 'conversation',
                checkpoint_ns: index % 2 ? 'root' : 'child',
            } }
            const saved = await saver.put(current, checkpoint(`00${index}`), {
                ...metadata,
                step: index % 2,
            }, {})
            await saver.putWrites(saved, [['messages', index]], 'task')
        }

        const listed: CheckpointTuple[] = []

        for await (const tuple of saver.list({ configurable: { thread_id: 'conversation' } }, {
            before: { configurable: { checkpoint_id: '006' } },
            filter: { step: 1 },
            limit: 2,
        }))
            listed.push(tuple)

        expect(listed.map(tuple => tuple.checkpoint.id)).toEqual(['005', '003'])
        await saver.deleteThread('conversation')
        expect([...database.rows.values()].filter(row => /^(CHECKPOINT|WRITE|HEAD)#/u.test(String(row.sk)))).toHaveLength(0)
        expect(payloads.released).toHaveLength(12)
    })

    it('denies foreign threads and stale owner writes without changing checkpoints', async () => {
        const {
            saver,
            clock,
            database,
        } = await fixture()
        await expect(saver.getTuple({ configurable: { thread_id: 'another' } })).rejects.toThrow('THREAD_ACCESS_DENIED')
        await expect(saver.deleteThread('another')).rejects.toThrow('THREAD_ACCESS_DENIED')
        clock.now += 30001
        await expect(saver.put(config, checkpoint('001'), metadata, {})).rejects.toThrow('CONVERSATION_OWNER_LOST')
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('CHECKPOINT#'))).toHaveLength(0)
    })
})
