import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const AI_INTERACTION_SUBJECTS = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE),
        subject: AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE] },
            sub: {
                allow: [
                    `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.{userIdToken}.>`,
                    `${AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.STATUS}.{userIdToken}.>`,
                ],
            },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME),
        subject: AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
        type: 'reply',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE),
        subject: AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
        type: 'reply',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE] },
            sub: { allow: [] },
        },
    }
] as const satisfies readonly EndpointContract[]
