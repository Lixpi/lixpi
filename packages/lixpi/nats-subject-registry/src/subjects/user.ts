import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const USER_SUBJECTS = NATS_SUBJECTS.USER_SUBJECTS

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.GET_USER),
        subject: USER_SUBJECTS.GET_USER,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [USER_SUBJECTS.GET_USER] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.UPDATE_PREFERENCES),
        subject: USER_SUBJECTS.UPDATE_PREFERENCES,
        type: 'reply',
        payloadType: 'json',
        queue: 'userPreferenceWrites',
        permissions: {
            pub: { allow: [USER_SUBJECTS.UPDATE_PREFERENCES] },
            sub: { allow: [] },
        },
    },
] as const satisfies readonly EndpointContract[]
