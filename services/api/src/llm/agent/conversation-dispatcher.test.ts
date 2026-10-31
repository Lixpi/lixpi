import { afterEach, describe, expect, it, vi } from 'vitest'
import { type default as NatsService } from '@lixpi/nats-service'
import { AccountRequestContext } from '../../services/account-request-context.ts'
import { ConversationDispatcher } from './conversation-dispatcher.ts'
import { conversationDueKey, conversationDuePartition, type ConversationDispatch } from './conversation-repository.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

afterEach(() => vi.restoreAllMocks())

describe('coalesced configuration dispatch', () => {
    it('retains a newer requested revision when the earlier projection finishes', async () => {
        const fixture = await createConversationExecutionFixture()
        const job: ConversationDispatch = {
            ...fixture.job,
            jobId: 'configuration',
            purpose: 'projection',
            projectionRevision: 2,
        }
        await fixture.repository.commit([fixture.repository.put(fixture.partition, 'DISPATCH#configuration', job)])
        vi.spyOn(AccountRequestContext, 'resumeWork').mockImplementation(async (_context, work) => await work())

        const consume = async (replace: boolean) => {
            let claimed = false
            let result: unknown
            let complete: () => void
            const finished = new Promise<void>(resolve => void (complete = resolve))
            let dispatcher: ConversationDispatcher
            const nats = {
                ensureJetStreamStream: async () => {},
                ensureJetStreamConsumer: async () => {},
                publishJetStream: async () => {},
                processJetStreamMessages: async (_stream, _consumer, handler) => {
                    if (claimed)
                        return await finished

                    claimed = true
                    result = await handler({ data: job })
                    dispatcher.stop()
                    complete!()
                },
            } as unknown as NatsService
            const execute = vi.fn(async (stored: ConversationDispatch): Promise<'done'> => {
                if (replace)
                    await fixture.repository.commit([fixture.repository.replace(fixture.partition, 'DISPATCH#configuration', {
                        ...stored,
                        projectionRevision: 3,
                    })])

                return 'done'
            })
            dispatcher = new ConversationDispatcher(nats, fixture.repository, execute)
            await dispatcher.start()
            await finished

            return {
                result,
                execute,
            }
        }

        const first = await consume(true)
        expect(first.result).toEqual({ nakDelayMs: 2000 })
        expect(await fixture.repository.read(fixture.partition, 'DISPATCH#configuration')).toMatchObject({ projectionRevision: 3 })
        const second = await consume(false)
        expect(second.execute).toHaveBeenCalledWith(expect.objectContaining({ projectionRevision: 3 }))
        expect(second.result).toBeUndefined()
        expect(await fixture.repository.read(fixture.partition, 'DISPATCH#configuration')).toBeUndefined()
    })

    it('keeps a newer due revision when publication of the preceding revision is acknowledged', async () => {
        const fixture = await createConversationExecutionFixture()
        const job: ConversationDispatch = {
            ...fixture.job,
            jobId: 'configuration',
            purpose: 'projection',
            projectionRevision: 2,
        }
        const partition = conversationDuePartition(job.conversationAssetId)
        const key = conversationDueKey(job)
        await fixture.repository.commit([fixture.repository.put(partition, key, job)])
        const commit = vi.spyOn(fixture.repository, 'commit')
        let complete: () => void
        const finished = new Promise<void>(resolve => void (complete = resolve))
        let dispatcher: ConversationDispatcher
        const nats = {
            ensureJetStreamStream: async () => {},
            ensureJetStreamConsumer: async () => {},
            processJetStreamMessages: async () => await finished,
            publishJetStream: async () => {
                await fixture.repository.commit([fixture.repository.replace(partition, key, {
                    ...job,
                    projectionRevision: 3,
                })])
                dispatcher.stop()
                complete!()
            },
        } as unknown as NatsService
        dispatcher = new ConversationDispatcher(nats, fixture.repository, async () => 'done')
        await dispatcher.start()
        await finished
        await vi.waitFor(() => expect(commit).toHaveBeenCalledWith([expect.objectContaining({
            type: 'delete',
            conditionExpression: '#projectionRevision = :projectionRevision',
            expressionAttributeValues: { ':projectionRevision': 2 },
        })]))
        expect(await fixture.repository.read(partition, key)).toMatchObject({ projectionRevision: 3 })
    })
})
