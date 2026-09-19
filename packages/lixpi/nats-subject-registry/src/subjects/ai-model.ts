import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const AI_MODELS_SUBJECTS = NATS_SUBJECTS.AI_MODELS_SUBJECTS

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS),
        subject: AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED),
        subject: AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED,
        type: 'subscribe',
        payloadType: 'json',
        permissions: {
            sub: { allow: [AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED] },
        },
    }
] as const satisfies readonly EndpointContract[]
