import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.ORGANIZATION_SUBJECTS.GET_MEMBERSHIP),
        subject: NATS_SUBJECTS.ORGANIZATION_SUBJECTS.GET_MEMBERSHIP,
        type: 'reply',
        payloadType: 'json',
        permissions: 'none',
    }
] as const satisfies readonly EndpointContract[]
