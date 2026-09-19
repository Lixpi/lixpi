import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const CAPABILITY_SUBJECTS = NATS_SUBJECTS.CAPABILITY_SUBJECTS
const PROMPT_REFERENCE_SUBJECTS = NATS_SUBJECTS.PROMPT_REFERENCE_SUBJECTS

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.MODULES.LIST),
        subject: CAPABILITY_SUBJECTS.MODULES.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CAPABILITY_SUBJECTS.MODULES.LIST] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.MODULES.GET),
        subject: CAPABILITY_SUBJECTS.MODULES.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CAPABILITY_SUBJECTS.MODULES.GET] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.PROMPT_REFERENCE_SUBJECTS.LIST),
        subject: PROMPT_REFERENCE_SUBJECTS.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [PROMPT_REFERENCE_SUBJECTS.LIST] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.PROMPT_REFERENCE_SUBJECTS.RECORD_ACCEPTED_USE),
        subject: PROMPT_REFERENCE_SUBJECTS.RECORD_ACCEPTED_USE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [] },
            sub: { allow: [] },
        },
    }
] as const satisfies readonly EndpointContract[]
