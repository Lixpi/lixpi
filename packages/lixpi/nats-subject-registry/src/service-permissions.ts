import {
    NATS_SUBJECTS,
    ACCOUNT_ADMISSION_CHECK_SUBJECT,
    ACCOUNT_ADMISSION_REPLY_PREFIX,
    ACCOUNT_ADMISSION_CHANGED_SUBJECT,
    ACCOUNT_WORK_ADMISSION_SUBJECT,
} from '@lixpi/constants'
import { activeContracts } from './contracts.ts'
import {
    type ServicePermissions,
} from './types.ts'

const {
    AI_INTERACTION_SUBJECTS,
    ASSET_SUBJECTS,
    ASSET_MAINTENANCE_SUBJECTS,
    BLOB_PROCESSING_SUBJECTS,
    CAPABILITY_SUBJECTS,
    CHARACTER_FIDELITY_SUBJECTS,
    CONVERSATION_SUBJECTS,
    METRICS_SUBJECTS,
    MEDIA_RENDER_SUBJECTS,
    PROTOCOL_SUBJECTS,
} = NATS_SUBJECTS
const { JETSTREAM } = PROTOCOL_SUBJECTS

const storagePublish = [
    JETSTREAM.API,
    JETSTREAM.DOMAIN_API,
    JETSTREAM.ACK,
    JETSTREAM.FLOW_CONTROL,
    PROTOCOL_SUBJECTS.OBJECT_STORE,
    PROTOCOL_SUBJECTS.INBOX,
]
const storageSubscribe = [
    PROTOCOL_SUBJECTS.OBJECT_STORE,
    PROTOCOL_SUBJECTS.INBOX,
]
const events = [
    `${CONVERSATION_SUBJECTS.STATUS}.>`,
    `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.>`,
    `${AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.>`,
    `${AI_INTERACTION_SUBJECTS.CHAT_ERROR}.>`,
    `${AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.EVENTS}.>`,
    `${AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.STATUS}.>`,
    `${CAPABILITY_SUBJECTS.RUN.EVENTS}.>`,
    `${CAPABILITY_SUBJECTS.RUN.STATUS}.>`,
    CAPABILITY_SUBJECTS.CATALOG.EVENTS,
    `${CAPABILITY_SUBJECTS.CATALOG.EVENTS}.>`,
    `${ASSET_SUBJECTS.DOCUMENT_STEPS}.>`,
    `${ASSET_SUBJECTS.DOCUMENT_EVENTS}.>`,
    ...Object.values(ASSET_SUBJECTS.EVENTS).flatMap(subject => [subject, `${subject}.>`]),
]
const nexSubjects = [
    PROTOCOL_SUBJECTS.NEX,
    PROTOCOL_SUBJECTS.SERVICE,
    PROTOCOL_SUBJECTS.INBOX,
    JETSTREAM.API,
    JETSTREAM.DOMAIN_API,
    JETSTREAM.FLOW_CONTROL,
    JETSTREAM.ACK,
]

export const builtInPermissions = {
    API: {
        pub: {
            allow: [
                `${ACCOUNT_ADMISSION_REPLY_PREFIX}.AUTH.>`,
                ...storagePublish,
                ...events,
                ...Object.values(ASSET_MAINTENANCE_SUBJECTS),
                ...Object.values(METRICS_SUBJECTS),
                'provider-usage.outbox',
                CONVERSATION_SUBJECTS.DISPATCH,
                CONVERSATION_SUBJECTS.OPERATION_COMPLETED,
                BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS,
                CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL,
                MEDIA_RENDER_SUBJECTS.RENDER,
                MEDIA_RENDER_SUBJECTS.CANCEL,
                MEDIA_RENDER_SUBJECTS.READINESS,
                MEDIA_RENDER_SUBJECTS.PROBE_SOURCE,
                MEDIA_RENDER_SUBJECTS.DISPATCH,
            ],
        },
        sub: {
            allow: [
                ACCOUNT_ADMISSION_CHECK_SUBJECT,
                ACCOUNT_WORK_ADMISSION_SUBJECT,
                ...storageSubscribe,
                CONVERSATION_SUBJECTS.DISPATCH,
                CONVERSATION_SUBJECTS.OPERATION_COMPLETED,
                ...activeContracts.map(contract => contract.subject),
                MEDIA_RENDER_SUBJECTS.PROGRESS,
                MEDIA_RENDER_SUBJECTS.COMPLETE,
                MEDIA_RENDER_SUBJECTS.DISPATCH,
                ...events,
                ...Object.values(ASSET_MAINTENANCE_SUBJECTS),
            ],
        },
    },
    MEDIA_RENDER: {
        pub: { allow: [...storagePublish, ACCOUNT_WORK_ADMISSION_SUBJECT, MEDIA_RENDER_SUBJECTS.PROGRESS, MEDIA_RENDER_SUBJECTS.COMPLETE] },
        sub: { allow: [...storageSubscribe, ACCOUNT_ADMISSION_CHANGED_SUBJECT, MEDIA_RENDER_SUBJECTS.RENDER, MEDIA_RENDER_SUBJECTS.CANCEL, MEDIA_RENDER_SUBJECTS.READINESS, MEDIA_RENDER_SUBJECTS.PROBE_SOURCE] },
    },
    FILE_CONVERSION: {
        pub: { allow: [...storagePublish, ACCOUNT_WORK_ADMISSION_SUBJECT] },
        sub: { allow: [...storageSubscribe, BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS, ACCOUNT_ADMISSION_CHANGED_SUBJECT] },
    },
    CHARACTER_FIDELITY: {
        pub: {
            allow: [
                ACCOUNT_WORK_ADMISSION_SUBJECT,
                JETSTREAM.INFO,
                JETSTREAM.STREAM_INFO,
                JETSTREAM.CONSUMER,
                JETSTREAM.DIRECT_GET,
                JETSTREAM.STREAM_MESSAGE_GET,
                JETSTREAM.ACK,
                JETSTREAM.FLOW_CONTROL,
                PROTOCOL_SUBJECTS.INBOX,
            ],
        },
        sub: { allow: [...storageSubscribe, CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL, ACCOUNT_ADMISSION_CHANGED_SUBJECT] },
    },
    BACKUP: {
        pub: {
            allow: [
                JETSTREAM.INFO,
                JETSTREAM.STREAM_LIST,
                JETSTREAM.STREAM_NAMES,
                JETSTREAM.STREAM_INFO,
                JETSTREAM.STREAM_SNAPSHOT,
                JETSTREAM.SNAPSHOT_ACK,
                PROTOCOL_SUBJECTS.INBOX,
            ],
        },
        sub: { allow: [PROTOCOL_SUBJECTS.INBOX] },
    },
    OPERATOR: {
        pub: { allow: [...storagePublish, JETSTREAM.SNAPSHOT_RESTORE] },
        sub: { allow: storageSubscribe },
    },
    AI_MODEL_REGISTRY: {
        pub: { allow: [NATS_SUBJECTS.AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED] },
        sub: { allow: [PROTOCOL_SUBJECTS.INBOX] },
    },
    NEX_NODE: {
        pub: { allow: nexSubjects },
        sub: { allow: nexSubjects },
    },
} satisfies Record<string, ServicePermissions>
