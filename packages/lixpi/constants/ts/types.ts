'use strict'

import type { Merge, Except } from 'type-fest'

// NOTE: User type restored exactly as originally defined per instruction (commas retained intentionally)
export type User = {
    userId: string,
    stripeCustomerId?: string,
    email: string,
    name: string,
    givenName: string,
    familyName: string,
    avatar: string,
    hasActiveSubscription: boolean,
    balance: string,
    currency: string,
    recentTags: string[],
    organizations: string[],
    createdAt: number,
    updatedAt: number,
}

export type AccessLevel = 'owner' | 'editor' | 'viewer'

export type Organization = {
    organizationId: string
    name: string
    tags: Record<string, {
        name: string
        color: string
    }>
    accessList: Record<string, AccessLevel> // userId -> accessLevel
    createdAt: number
    updatedAt: number
}

export type OrganizationAccessList = {
    userId: string
    organizationId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type DocumentFile = {
    id: string
    name: string
    mimeType: string
    size: number
    uploadedAt: number
}

export type CanvasNodeType = 'document' | 'image'

type CanvasNodePosition = {
    x: number
    y: number
}

type CanvasNodeDimensions = {
    width: number
    height: number
}

export type DocumentCanvasNode = {
    nodeId: string
    type: 'document'
    referenceId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type ImageCanvasNode = {
    nodeId: string
    type: 'image'
    fileId: string
    workspaceId: string
    src: string
    aspectRatio: number
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type CanvasNode = DocumentCanvasNode | ImageCanvasNode

export type CanvasViewport = {
    x: number
    y: number
    zoom: number
}

export type CanvasState = {
    viewport: CanvasViewport
    nodes: CanvasNode[]
}

export type Workspace = {
    workspaceId: string
    name: string
    accessType: 'private' | 'public'
    accessList: {
        userId: string
        accessLevel: AccessLevel
    }[]
    files?: DocumentFile[]
    canvasState: CanvasState
    createdAt: number
    updatedAt: number
}

export type WorkspaceMeta = {
    workspaceId: string
    name: string
    createdAt: number
    updatedAt: number
}

export type WorkspaceAccessList = {
    userId: string
    workspaceId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type Document = {
    documentId: string
    workspaceId: string
    revision: number
    title: string
    content: string
    prevRevision: number
    createdAt: number
    updatedAt: number
    revisionExpiresAt?: number
}

export type DocumentMeta = {
    documentId: string
    title: string
    tags: string[]
    createdAt: number
    updatedAt: number
}

export type DocumentAccessList = {
    userId: string
    documentId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type SubscriptionBalanceUpdateEvent = {
    userId: string
    stripeCustomerId: string
    organizationId: string
    amount: string
}

// AI Chat message types
export type AiInteractionChatSendMessagePayload = {
    messages: Array<{ role: string; content: string }>
    aiModel: AiModelId
    threadId: string
}

export type AiInteractionChatStopMessagePayload = {
    threadId: string
}

export type AiModel = {
    provider: string
    model: string
    title: string
    shortTitle?: string
    modelVersion: string
    contextWindow: number
    maxCompletionSize: number
    defaultTemperature: number
    supportsSystemPrompt: boolean
    color: string
    iconName: string
    sortingPosition: number
    modalities: Array<{ modality: string; title: string; shortTitle: string }>
    pricing: {
        currency: string
        resaleMargin: string
        text?: {
            measuringUnit: string
            pricePer: string
            tiers: {
                default: {
                    prompt: string
                    completion: string
                }
            }
        }
        audio?: {
            measuringUnit: string
            pricePer: string
            prompt: string
            completion: string
        }
        image?: {
            measuringUnit: string
            pricePer: string
            prompt: string
            completion: string
        }
    }
    createdAt: number
    updatedAt: number
}

export type EventMeta = {
    userId: string
    stripeCustomerId: string
    organizationId: string
    documentId: string
}

export type AiModelId = `${string}:${string}`

export type TokensUsage = {
    eventMeta: EventMeta
    aiModelMetaInfo: AiModel
    aiVendorRequestId: string
    aiVendorModelName: string
    usage: {
        promptTokens: number
        promptAudioTokens: number
        promptCachedTokens: number

        completionTokens: number
        completionAudioTokens: number
        completionReasoningTokens: number

        totalTokens: number
    }
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
}

export type TokensUsageEvent = {
    eventMeta: EventMeta
    aiModel: AiModelId
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
    textPricePer: string
    textPromptPrice: string
    textCompletionPrice: string
    textPromptPriceResale: string
    textCompletionPriceResale: string
    prompt: {
        usageTokens: number
        cachedTokens: number
        audioTokens: number
        purchasedFor: string
        soldToClientFor: string
    }
    completion: {
        usageTokens: number
        reasoningTokens: number
        audioTokens: number
        purchasedFor: string
        soldToClientFor: string
    }
    total: {
        usageTokens: number
        purchasedFor: string
        soldToClientFor: string
    }
}

export type SNS_OutputMessage = {
    TopicArn: string
    Message: any
    MessageAttributes?: {
        [key: string]: {
            DataType: 'String' | 'String.Array' | 'Number' | 'Binary'
            Value?: string | Uint8Array
        }
    }
}

export type SQS_OutputMessage = {
    TopicArn: string
    Message: any
    messageAttributes?: {
        [key: string]: {
            dataType: 'String' | `String.${string}` | 'Number' | `Number.${string}` | 'Binary' | `Binary.${string}`;
            stringValue?: string;
            binaryValue?: Uint8Array;
        }
    }
}

export type FinancialTransaction = {
    userId: string
    provider: 'Stripe'
    transactionId: string
    amount_decimal: string
    currency: string
    description: string
    status: string
    rawEvent: Record<string, any>
    createdAt: number
}

