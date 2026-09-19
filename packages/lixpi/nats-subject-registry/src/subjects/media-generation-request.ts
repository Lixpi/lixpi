import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const REQUEST = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.GET),
        subject: REQUEST.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [REQUEST.GET] },
            sub: { allow: [`${REQUEST.STATUS}.{userIdToken}.>`] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.REPLAY),
        subject: REQUEST.REPLAY,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [REQUEST.REPLAY] },
            sub: { allow: [`${REQUEST.STATUS}.{userIdToken}.>`] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.RESOLVE_REFERENCE),
        subject: REQUEST.RESOLVE_REFERENCE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [REQUEST.RESOLVE_REFERENCE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.CANCEL),
        subject: REQUEST.CANCEL,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [REQUEST.CANCEL] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.VERIFICATION_START),
        subject: REQUEST.VERIFICATION_START,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [REQUEST.VERIFICATION_START] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.VERIFICATION_COMPLETE),
        subject: REQUEST.VERIFICATION_COMPLETE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [REQUEST.VERIFICATION_COMPLETE] },
            sub: { allow: [] },
        },
    }
] as const satisfies readonly EndpointContract[]
