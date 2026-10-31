import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const subjects = NATS_SUBJECTS.CONVERSATION_SUBJECTS
const commands = [
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.CREATE), subjects.CREATE],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.LIST), subjects.LIST],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.GET), subjects.GET],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.MESSAGES), subjects.MESSAGES],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.SUBMIT), subjects.SUBMIT],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.SETTINGS_UPDATE), subjects.SETTINGS_UPDATE],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.STOP), subjects.STOP],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.QUEUE_UPDATE), subjects.QUEUE_UPDATE],
    [getNatsSubjectPath(tree => tree.CONVERSATION_SUBJECTS.REPLAY), subjects.REPLAY],
] as const

export const contracts = commands.map(
    ([id, subject]) => ({
        id,
        subject,
        type: 'reply' as const,
        payloadType: 'json' as const,
        permissions: {
            pub: { allow: [subject] },
            sub: { allow: [`${subjects.STATUS}.{userIdToken}.>`] },
        },
    }),
) satisfies readonly EndpointContract[]
