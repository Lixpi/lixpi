'use strict'

export * from './types.ts'
export * from './aws-resources.ts'

export const AI_MODELS_SUBJECTS: Record<string, string> = {
    GET_AVAILABLE_MODELS: 'aiModels.getAvailableModels'
}

export const USER_SUBJECTS: Record<string, string> = {
    GET_USER: 'user.get',
}

export const AI_CHAT_SUBJECTS: Record<string, string> = {
    SEND_MESSAGE: 'aiChat.sendMessage',
    SEND_MESSAGE_RESPONSE: 'aiChat.receiveMessage',
    STOP_MESSAGE: 'aiChat.stopMessage',
}

export const DOCUMENT_SUBJECTS: Record<string, string> = {
    CREATE_DOCUMENT: 'document.create',
    GET_DOCUMENT: 'document.get',
    UPDATE_DOCUMENT: 'document.update',
    DELETE_DOCUMENT: 'document.delete',
    GET_USER_DOCUMENTS: 'document.getUserDocuments',
    ADD_TAG_TO_DOCUMENT: 'document.addTag',
    REMOVE_TAG_FROM_DOCUMENT: 'document.removeTag',
}


export const ORGANIZATION_SUBJECTS: Record<string, string> = {
    GET_ORGANIZATION: 'organization.get',
    CREATE_ORGANIZATION: 'organization.create',
    UPDATE_ORGANIZATION: 'organization.update',
    CREATE_ORGANIZATION_TAG: 'organization.createTag',
    UPDATE_ORGANIZATION_TAG: 'organization.updateTag',
    DELETE_ORGANIZATION_TAG: 'organization.deleteTag'
}

export const USER_SUBSCRIPTION_SUBJECTS: Record<string, string> = {
    GET_PAYMENT_METHOD_SETUP_INTENT: 'subscriptioin.paymentMethod.getSetupIntent',
    GET_USER_PAYMENT_METHODS: 'subscriptioin.paymentMethod.getUserPaymentMethods',
    DELETE_USER_PAYMENT_METHOD: 'subscriptioin.paymentMethod.deleteUuserPaymentMethod',
    TOP_UP_USER_BALANCE: 'subscriptioin.balance.topUp',
    USE_CREDITS: 'subscriptioin.balance.useCredits',
    TEST_MESSAGE: 'subscriptioin.testMessage',
}






// --- Lambda invocation targets ------------------------------------------
export const BILLING_HANDLER_LAMBDA_TARGETS: Record<string, string> = {
    GET_PAYMENT_METHOD_SETUP_INTENT_SECRET: 'get-payment-method-setup-intent-secret',
    GET_CUSTOMER_PAYMENT_METHODS: 'get-customer-payment-methods',
    DELETE_CUSTOMER_PAYMENT_METHOD: 'delete-customer-payment-method',
    TOP_UP_CUSTOMER_BALANCE: 'top-up-customer-balance',
    GET_CUSTOMER: 'get-customer',
}
// --- END  Lambda invocation targets ------------------------------------------


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
