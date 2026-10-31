import { getNatsSubjectPath } from '@lixpi/constants'
import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'
import { ConversationAdapters } from '../../llm/agent/conversation-adapters.ts'
import {
    ConversationProtocol,
    type ConversationRequests,
} from '../../llm/agent/conversation-protocol.ts'
import { ConversationRepository } from '../../llm/agent/conversation-repository.ts'

const protocol = new ConversationProtocol()

const handle = async <Kind extends keyof ConversationRequests>(
    kind: Kind,
    input: unknown,
) => {
    if (
        !input
        || typeof input !== 'object'
        || !('user' in input)
    )
        throw new Error('Authentication required')

    const {
        user,
        ...payload
    } = input as { user: { userId?: string } }

    if (
        typeof user?.userId !== 'string'
        || !user.userId
    )
        throw new Error('Authentication required')

    const request = protocol.parse(kind, payload)

    const service = new ConversationAdapters(
        new ConversationRepository(),
    ).service()
    const execute = service[kind].bind(service) as (
        request: ConversationRequests[Kind],
        userId: string,
    ) => Promise<unknown>

    return await execute(request, user.userId)
}

export const conversationSubjects = createNatsSubscriptions(
    'conversation',
    {
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.CREATE)]: data => handle('create', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.LIST)]: data => handle('list', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.GET)]: data => handle('get', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.MESSAGES)]: data => handle('messages', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.SUBMIT)]: data => handle('submit', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.SETTINGS_UPDATE)]: data => handle('settings', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.STOP)]: data => handle('stop', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.QUEUE_UPDATE)]: data => handle('queue', data),
        [getNatsSubjectPath(subjects => subjects.CONVERSATION_SUBJECTS.REPLAY)]: data => handle('replay', data),
    },
)
