'use strict'

export * from './types.ts'
export * from './asset-types.ts'
export * from './aws-resources.ts'
export {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    type MediaGenerationLayoutSettings,
    type WorkspaceCollisionFlowSettings,
    type WorkspaceCollisionNodeTypeSettings,
    type WorkspaceCollisionSettings,
} from './media-generation-layout-settings.ts'
export {
    workspacePersistenceSettings,
    type WorkspacePersistenceSettings,
} from './workspace-persistence-settings.ts'

import natsSubjects from '../nats-subjects.json' with { type: 'json' }
import aiInteractionConstants from '../ai-interaction-constants.json' with { type: 'json' }

// Single dynamic export of all NATS subjects
export const NATS_SUBJECTS = natsSubjects

export const getNatsUserSubjectToken = (userId: string): string =>
    [...new TextEncoder().encode(userId)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')

export const getAiInteractionResponseSubject = (
    userId: string,
    scopeId: string,
    conversationOrRunId: string,
): string => [
    NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE,
    getNatsUserSubjectToken(userId),
    scopeId.replace(/[^A-Za-z0-9_-]/g, '_'),
    conversationOrRunId.replace(/[^A-Za-z0-9_-]/g, '_'),
].join('.')

export const getAiInteractionCanonicalResponseSubject = (
    scopeId: string,
    conversationOrRunId: string,
): string => [
    NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE,
    scopeId.replace(/[^A-Za-z0-9_-]/g, '_'),
    conversationOrRunId.replace(/[^A-Za-z0-9_-]/g, '_'),
].join('.')

export const getAssetEventSubject = (userId: string, canonicalSubject: string): string =>
    `${canonicalSubject}.${getNatsUserSubjectToken(userId)}`

// AI interaction constants
export const AI_INTERACTION_CONSTANTS = aiInteractionConstants
export const STREAM_STATUS = AI_INTERACTION_CONSTANTS.STREAM_STATUS as {
    readonly [K in keyof typeof AI_INTERACTION_CONSTANTS.STREAM_STATUS]: K
}
export type StreamStatus = typeof STREAM_STATUS[keyof typeof STREAM_STATUS]


export const METRICS_CONFIG: Record<string, string> = {
    defaultCurrency: 'usd',
}

// Schema version stamped onto every ContentDescriptor (see ContentDescriptor in
// types.ts). Bump when the descriptor shape or generation prompt changes so
// stale descriptors can be detected/regenerated. SUMMARY_MAX_LENGTH keeps the
// summary "descriptive but not massive" — short enough to feed into model
// context (e.g. the branch-resolver transcript) without bloat.
export const MEDIA_DESCRIPTOR_VERSION = 'media-descriptor-v2'
export const MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH = 280
export const MEDIA_DESCRIPTOR_TITLE_MAX_WORDS = 3

// Upper bound on the plain-text fed into a document/conversation Asset descriptor pass. A
// descriptor only needs the gist, so we cap the prompt rather than paying to
// summarize an entire long document/transcript every edit.
export const CONTENT_DESCRIPTOR_TEXT_INPUT_MAX_LENGTH = 12000



export const STRIPE_COMISSION: Record<string, string> = {    // Values processed as strings by decimal.js to avoid floating point errors
    comissionPercentRate: '0.029',    // 2.9%
    fixedFee: '0.30'    // 30 cents
}



export enum LoadingStatus {
    idle = 'idle',
    loading = 'loading',
    success = 'success',
    error = 'error'
}

export enum PaymentProcessingStatus {
    idle = 'idle',
    processing = 'processing',
    success = 'success',
    error = 'error'
}

export enum AuthenticationStatus {
    success = 'Success',
    userNotFound = 'User Not Found',
    noActiveSubscription = 'No Active Subscription',
}

export enum UserSubscription {
    minimumBalance = '5',
}
