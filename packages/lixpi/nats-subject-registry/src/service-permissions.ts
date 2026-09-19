import { NATS_SUBJECTS } from '@lixpi/constants'
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
    METRICS_SUBJECTS,
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
                ...storagePublish,
                ...events,
                ...Object.values(ASSET_MAINTENANCE_SUBJECTS),
                ...Object.values(METRICS_SUBJECTS),
                BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS,
                CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL,
            ],
        },
        sub: {
            allow: [
                ...storageSubscribe,
                ...activeContracts.map(contract => contract.subject),
                ...events,
                ...Object.values(ASSET_MAINTENANCE_SUBJECTS),
            ],
        },
    },
    FILE_CONVERSION: {
        pub: { allow: storagePublish },
        sub: { allow: [...storageSubscribe, BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS] },
    },
    CHARACTER_FIDELITY: {
        pub: {
            allow: [
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
        sub: { allow: [...storageSubscribe, CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL] },
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
