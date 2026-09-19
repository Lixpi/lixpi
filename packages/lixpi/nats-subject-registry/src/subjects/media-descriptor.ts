import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const MEDIA_DESCRIBE = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_DESCRIBE

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_DESCRIBE),
        subject: MEDIA_DESCRIBE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_DESCRIBE] },
            sub: { allow: [] },
        },
    }
] as const satisfies readonly EndpointContract[]
