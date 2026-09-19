import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const ASSET_SUBJECTS = NATS_SUBJECTS.ASSET_SUBJECTS

export const contracts = [
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.CREATE),
        subject: ASSET_SUBJECTS.CREATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.CREATE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.GET),
        subject: ASSET_SUBJECTS.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.GET] },
            sub: {
                allow: Object.values(ASSET_SUBJECTS.EVENTS).map(subject => `${subject}.{userIdToken}`),
            },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.LIST),
        subject: ASSET_SUBJECTS.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.LIST] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.UPDATE_METADATA),
        subject: ASSET_SUBJECTS.UPDATE_METADATA,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.UPDATE_METADATA] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.SUBJECT_IDENTITY_ATTEST),
        subject: ASSET_SUBJECTS.SUBJECT_IDENTITY_ATTEST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.SUBJECT_IDENTITY_ATTEST] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.CHANGE_SCOPE),
        subject: ASSET_SUBJECTS.CHANGE_SCOPE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.CHANGE_SCOPE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.REVIEW_GENERATED_OUTPUT),
        subject: ASSET_SUBJECTS.REVIEW_GENERATED_OUTPUT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.REVIEW_GENERATED_OUTPUT] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.ATTACH),
        subject: ASSET_SUBJECTS.ATTACH,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.ATTACH] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.DETACH),
        subject: ASSET_SUBJECTS.DETACH,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.DETACH] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.ACQUIRE_LEASE),
        subject: ASSET_SUBJECTS.ACQUIRE_LEASE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.ACQUIRE_LEASE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.RENEW_LEASE),
        subject: ASSET_SUBJECTS.RENEW_LEASE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.RENEW_LEASE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.RELEASE_LEASE),
        subject: ASSET_SUBJECTS.RELEASE_LEASE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.RELEASE_LEASE] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS),
        subject: ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS,
        type: 'reply',
        queue: 'assetDocumentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS] },
            sub: { allow: [] },
        },
    },
    {
        id: getNatsSubjectPath(subjects => subjects.ASSET_SUBJECTS.DOCUMENT_RESUME),
        subject: ASSET_SUBJECTS.DOCUMENT_RESUME,
        type: 'reply',
        queue: 'assetDocumentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.DOCUMENT_RESUME] },
            sub: { allow: [`${ASSET_SUBJECTS.DOCUMENT_EVENTS}.{userIdToken}.>`] },
        },
    }
] as const satisfies readonly EndpointContract[]
