'use strict'

export * from './types.ts'
export * from './aws-resources.ts'
export {
    mediaGenerationLayoutSettings,
    type MediaGenerationLayoutSettings,
} from './media-generation-layout-settings.ts'

import natsSubjects from '../nats-subjects.json' with { type: 'json' }
import aiInteractionConstants from '../ai-interaction-constants.json' with { type: 'json' }

// Single dynamic export of all NATS subjects
export const NATS_SUBJECTS = natsSubjects

// AI interaction constants
export const AI_INTERACTION_CONSTANTS = aiInteractionConstants
export const STREAM_STATUS = AI_INTERACTION_CONSTANTS.STREAM_STATUS as {
    readonly [K in keyof typeof AI_INTERACTION_CONSTANTS.STREAM_STATUS]: K
}
export type StreamStatus = typeof STREAM_STATUS[keyof typeof STREAM_STATUS]


export const BILLING_CONFIG: Record<string, string> = {
    defaultCurrency: 'usd',
}

// Schema version stamped onto every ContentDescriptor (see ContentDescriptor in
// types.ts). Bump when the descriptor shape or generation prompt changes so
// stale descriptors can be detected/regenerated. SUMMARY_MAX_LENGTH keeps the
// summary "descriptive but not massive" — short enough to feed into model
// context (e.g. the branch-resolver transcript) without bloat.
export const MEDIA_DESCRIPTOR_VERSION = 'media-descriptor-v1'
export const MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH = 280

// Upper bound on the plain-text fed into a document/thread descriptor pass. A
// descriptor only needs the gist, so we cap the prompt rather than paying to
// summarize an entire long document/transcript every edit.
export const CONTENT_DESCRIPTOR_TEXT_INPUT_MAX_LENGTH = 12000



export const USER_SUBSCRIPTION_EVENTS_SQS_MESSAGE_TYPES: Record<string, string> = {
    TOP_UP_BALANCE_SUCCEED: 'top-up-balance',
    USE_CREDITS: 'use-credits',
}




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

export enum SNS_messageTypes {
    AiTokensUsage = 'AiTokensUsage',
    StripeInvoiceEvent = 'StripeInvoiceEvent',
}
