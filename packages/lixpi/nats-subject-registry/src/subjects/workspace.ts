import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const WORKSPACE_SUBJECTS = NATS_SUBJECTS.WORKSPACE_SUBJECTS

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_WORKSPACE),
        subject: WORKSPACE_SUBJECTS.GET_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.GET_WORKSPACE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE),
        subject: WORKSPACE_SUBJECTS.CREATE_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.CREATE_WORKSPACE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_USER_WORKSPACES),
        subject: WORKSPACE_SUBJECTS.GET_USER_WORKSPACES,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.GET_USER_WORKSPACES] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE),
        subject: WORKSPACE_SUBJECTS.UPDATE_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.UPDATE_WORKSPACE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE),
        subject: WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.DELETE_WORKSPACE),
        subject: WORKSPACE_SUBJECTS.DELETE_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.DELETE_WORKSPACE] },
            sub: { allow: [] },
        },
    }
] as const satisfies readonly EndpointContract[]
