import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const CATALOG = NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG
const RUN = NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN
const catalogEventPermission = { sub: { allow: [`${CATALOG.CATALOG_CHANGED}.{userIdToken}`] } }

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.SEARCH),
        subject: CATALOG.SEARCH,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.SEARCH] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.GET),
        subject: CATALOG.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.GET] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.CREATE),
        subject: CATALOG.CREATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.CREATE] },
            ...catalogEventPermission,
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.UPDATE),
        subject: CATALOG.UPDATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.UPDATE] },
            ...catalogEventPermission,
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.DELETE),
        subject: CATALOG.DELETE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.DELETE] },
            ...catalogEventPermission,
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.GRANT),
        subject: CATALOG.GRANT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.GRANT] },
            ...catalogEventPermission,
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.REVOKE),
        subject: CATALOG.REVOKE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.REVOKE] },
            ...catalogEventPermission,
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.LIST),
        subject: CATALOG.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.LIST] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.CATALOG.SAVE),
        subject: CATALOG.SAVE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.SAVE] },
            ...catalogEventPermission,
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.START),
        subject: RUN.START,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.START] },
            sub: { allow: [`${RUN.STATUS}.{userIdToken}.>`] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.STATUS),
        subject: RUN.STATUS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.STATUS] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.RESUME),
        subject: RUN.RESUME,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.RESUME] },
            sub: { allow: [`${RUN.STATUS}.{userIdToken}.>`] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.STOP),
        subject: RUN.STOP,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.STOP] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.GET),
        subject: RUN.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.GET] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.REPLAY),
        subject: RUN.REPLAY,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.REPLAY] },
            sub: { allow: [] },
        },
    }
] as const satisfies readonly EndpointContract[]
