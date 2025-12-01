'use strict'

export * from './types.ts'
export * from './aws-resources.ts'

import natsSubjects from '../nats-subjects.json' with { type: 'json' }
import aiInteractionConstants from '../ai-interaction-constants.json' with { type: 'json' }

// Single dynamic export of all NATS subjects
export const NATS_SUBJECTS = natsSubjects

// AI interaction constants
export const AI_INTERACTION_CONSTANTS = aiInteractionConstants


export const BILLING_CONFIG: Record<string, string> = {
    defaultCurrency: 'usd',
}



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
