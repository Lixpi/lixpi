'use strict'

import { randomUUID } from 'node:crypto'

import type NatsService from '@lixpi/nats-service'
import {
    type AiModel as AiModelRecord,
    type AiModelId,
    type CapabilityJsonValue,
    type MediaGenerationRunMeta,
    type ProviderName,
} from '@lixpi/constants'

import AssetModel from '../../../models/asset.ts'
import AiModelModel from '../../../models/ai-model.ts'
import BlobModel from '../../../models/blob.ts'
import type { MetricsClient } from '../../../metrics/metrics-client.ts'
import { getContentAddressedBlob } from '../../../services/blob-storage.ts'
import { settleGeneratedAssetOriginal } from '../../../services/generated-asset-storage.ts'
import type { ImageRouter } from '../../../llm/tools/image-router.ts'
import { callStructuredVlm } from '../../../llm/structured-vlm/structured-vlm-client.ts'
import type { ProviderState } from '../../../llm/graph/state.ts'
import { readImageIntrinsicSize } from '../../../llm/graph/image-intrinsic-size.ts'
import type {
    CharacterCreatorActionDependencies,
    CharacterCreatorImageCandidate,
} from './character-creator-actions.ts'
import {
    CHARACTER_SHEET_ASSESSMENT_JSON_SCHEMA,
    type CharacterSheetAssessment,
} from './character-creator-prompt.ts'

type RuntimeOptions = {
    natsService: NatsService
    imageRouter: ImageRouter
    metrics?: MetricsClient
}

export function createCharacterCreatorActionDependencies(
    options: RuntimeOptions,
): CharacterCreatorActionDependencies {
    return {
        resolveReferences: async ({ assetIds, context }) => await Promise.all(assetIds.map(async (assetId) => {
            const asset = await AssetModel.get({
                assetId,
                requester: {
                    userId: context.userId,
                    workspaceIds: [context.workspaceId],
                    editableWorkspaceIds: [context.workspaceId],
                    organizationIds: context.organizationId ? [context.organizationId] : [],
                },
            })
            if ('error' in asset) throw new Error(`REFERENCE_ASSET_${asset.error}:${assetId}`)
            const rendition = asset.media?.renditions.canonical?.status === 'ready'
                ? asset.media.renditions.canonical
                : asset.media?.renditions.original
            if (rendition?.status !== 'ready' || !rendition.blobHash || !rendition.mimeType) {
                throw new Error(`REFERENCE_ASSET_NOT_MODEL_READY:${assetId}`)
            }
            const bytes = await getContentAddressedBlob({
                organizationId: asset.organizationId,
                blobHash: rendition.blobHash,
            })
            return {
                assetId,
                modelUrl: toDataUrl(bytes, rendition.mimeType),
            }
        })),
        generateImage: async ({ prompt, references, oneShotExample, context }) => {
            const imageModel = await getDefaultModel('image')
            const result = await options.imageRouter.execute({
                workspaceId: context.workspaceId,
                aiChatThreadId: context.runId,
                provider: imageModel.provider as ProviderName,
                modelVersion: imageModel.modelVersion,
                imageProviderName: imageModel.provider as ProviderName,
                imageModelVersion: imageModel.modelVersion,
                imageModelMetaInfo: imageModel,
                generatedImagePrompt: prompt,
                imageSize: 'auto',
                referenceImages: [
                    ...references.map((reference) => reference.modelUrl),
                    toDataUrl(oneShotExample, 'image/jpeg'),
                ],
                eventMeta: {
                    userId: context.userId,
                    organizationId: context.organizationId,
                },
            } as ProviderState, {
                signal: context.signal,
                captureOnly: true,
            })
            if (result.error || !result.generatedImages?.[0]) {
                throw new Error(result.error ?? 'CHARACTER_CREATOR_IMAGE_EMPTY')
            }
            return {
                image: normalizeGeneratedImage(result.generatedImages[0]) as CapabilityJsonValue,
                providerMetadata: {
                    modelId: `${imageModel.provider}:${imageModel.model}`,
                    sourceAssetIds: references.map((reference) => reference.assetId),
                },
            }
        },
        assessSheet: async ({ image, context }) => {
            if (typeof image !== 'string') throw new Error('CHARACTER_CREATOR_IMAGE_REFERENCE_INVALID')
            const reasoningModel = await getDefaultModel('reasoning')
            const workflowId = `capability-${context.runId}`
            const admission = await options.metrics?.check({
                orgId: context.organizationId ?? '',
                userId: context.userId,
                workspaceId: context.workspaceId,
                workflowId,
                model: reasoningModel.modelVersion,
                modality: 'tokens',
                estimatedUnits: 0,
                currency: 'USD',
            })
            if (admission && !admission.approved) {
                throw new Error(`Metrics: balance does not cover Character Creator validation${admission.reason ? `: ${admission.reason}` : ''}`)
            }
            const providerRequestId = randomUUID()
            const result = await callStructuredVlm<CharacterSheetAssessment>({
                provider: reasoningModel.provider as ProviderName,
                modelVersion: reasoningModel.modelVersion,
                systemPrompt: 'Inspect the supplied character sheet against the complete attached-template contract: landscape canvas, five aligned full-body views, five head views, expression and feature panels, hands/feet/props panels, costume/palette/material/detail panels, six pose panels, anatomical guides, framing, labels, and identity consistency. Report every check exactly through the schema.',
                userMessages: [{
                    role: 'user',
                    content: [
                        { type: 'input_text', text: 'Validate this single character-sheet image.' },
                        { type: 'input_image', image_url: image, detail: 'high' },
                    ],
                }],
                schema: {
                    name: 'character_sheet_assessment',
                    description: 'Complete detailed-template layout, guides, panels, framing, labels, and identity consistency.',
                    schema: CHARACTER_SHEET_ASSESSMENT_JSON_SCHEMA,
                },
                natsService: options.natsService,
                abortSignal: context.signal,
                temperature: 0,
            })
            await options.metrics?.confirm({
                providerRequestId,
                operationId: admission?.operationId,
                orgId: context.organizationId ?? '',
                userId: context.userId,
                workspaceId: context.workspaceId,
                workflowId,
                workflowSeq: context.attempt,
                model: reasoningModel.modelVersion,
                modality: 'tokens',
                measuringUnit: 'tokens',
                usage: {
                    promptTokens: result.promptTokens,
                    completionTokens: result.completionTokens,
                },
                currency: 'USD',
                occurredAt: new Date().toISOString(),
            })
            return result.parsed
        },
        persistSheet: async ({ candidate, validation, correctionAttempts, context }) => {
            if (typeof candidate.image !== 'string') throw new Error('CHARACTER_CREATOR_IMAGE_REFERENCE_INVALID')
            if (!context.organizationId) throw new Error('CHARACTER_CREATOR_ORGANIZATION_REQUIRED')
            const decoded = decodeDataUrl(candidate.image)
            const assetId = `asset-${randomUUID()}`
            const now = Date.now()
            const provenanceBytes = Buffer.from(JSON.stringify({
                schemaVersion: 'capability-output-provenance-v1',
                runId: context.runId,
                rootCapabilityId: context.rootCapabilityId,
                resolvedCapabilities: context.plan.serializable.resolvedManifests,
                actionTrace: context.getRunEvents(),
                stepId: context.stepId,
                correctionAttempts,
                validation,
            }))
            const provenanceBlob = await BlobModel.store({
                organizationId: context.organizationId,
                bytes: provenanceBytes,
                mimeType: 'application/json',
                description: 'Character Creator sealed provenance',
            })
            const providerMetadata = asRecord(candidate.providerMetadata)
            const sourceAssetIds = Array.isArray(providerMetadata?.sourceAssetIds)
                ? providerMetadata.sourceAssetIds.filter((value): value is string => typeof value === 'string')
                : []
            const mediaModelId = typeof providerMetadata?.modelId === 'string'
                ? providerMetadata.modelId
                : 'capability:character-creator'
            const generationRun = buildCanvasGenerationRun({
                assetId,
                runId: context.runId,
                generationRequestId: context.invocationGenerationRequestId ?? context.runId,
                mediaModelId,
                prompt: 'Character Creator',
            })
            await AssetModel.create({
                assetId,
                organizationId: context.organizationId,
                title: 'Character sheet',
                scope: 'workspace',
                scopeOwnerId: context.workspaceId,
                originWorkspaceId: context.workspaceId,
                ownerUserId: context.userId,
                documents: {
                    provenance: {
                        role: 'provenance',
                        blobHash: provenanceBlob.blobHash,
                        version: 1,
                        schemaVersion: 'capability-output-provenance-v1',
                        byteSize: provenanceBytes.byteLength,
                        updatedAt: now,
                        sealedAt: now,
                    },
                },
                lineage: {
                    sourceConversationAssetId: context.conversationAssetId,
                    sourceAssetIds,
                    generationRequestId: generationRun.generationRequestId,
                    reasoningRunId: context.runId,
                    mediaRunId: generationRun.mediaRunId,
                    reasoningModelId: 'capability:character-creator',
                    mediaModelId,
                },
                generatedOutputReview: { status: 'candidate' },
                states: {
                    lifecycle: 'creating',
                    media: 'processing',
                    conversation: 'none',
                    provenance: 'sealed',
                },
                workspaceReference: {
                    workspaceId: context.workspaceId,
                    surfaceIds: [`capability-run#${context.runId}`],
                },
            })
            await settleGeneratedAssetOriginal({
                generationRun,
                workspaceId: context.workspaceId,
                buffer: decoded.bytes,
                originalName: decoded.mimeType === 'image/png' ? 'generated-image.png' : 'generated-image.jpg',
                mimeType: decoded.mimeType,
                kind: 'image',
                ...(readImageIntrinsicSize(decoded.bytes) ?? {}),
            })
            return { assetId }
        },
    }
}

async function getDefaultModel(kind: 'reasoning' | 'image'): Promise<Omit<AiModelRecord, 'pricing'>> {
    const catalog = await AiModelModel.getAvailableAiModels()
    const modelId = catalog.defaultModels[kind]
    const model = catalog.models.find((candidate) => `${candidate.provider}:${candidate.model}` === modelId)
    if (!model) throw new Error(`CHARACTER_CREATOR_DEFAULT_${kind.toUpperCase()}_MODEL_REQUIRED`)
    return model
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

function normalizeGeneratedImage(value: string): string {
    if (value.startsWith('data:')) return value
    if (!/^[A-Za-z0-9+/=\r\n]+$/u.test(value)) {
        throw new Error('CHARACTER_CREATOR_IMAGE_FORMAT_INVALID')
    }
    const bytes = Buffer.from(value, 'base64')
    if (bytes.length > 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47) {
        return `data:image/png;base64,${value}`
    }
    if (bytes.length > 3
        && bytes[0] === 0xff
        && bytes[1] === 0xd8
        && bytes[2] === 0xff) {
        return `data:image/jpeg;base64,${value}`
    }
    throw new Error('CHARACTER_CREATOR_IMAGE_FORMAT_INVALID')
}

function decodeDataUrl(value: string): { bytes: Buffer; mimeType: string } {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(value)
    if (!match) throw new Error('CHARACTER_CREATOR_OUTPUT_MUST_BE_DATA_URL')
    return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') }
}

function asRecord(value: CapabilityJsonValue | undefined): Record<string, CapabilityJsonValue> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, CapabilityJsonValue>
        : undefined
}

function buildCanvasGenerationRun(args: {
    assetId: string
    runId: string
    generationRequestId: string
    mediaModelId: string
    prompt: string
}): MediaGenerationRunMeta {
    const mediaRunId = `${args.runId}:image:0`
    return {
        requestKind: 'single-media',
        generationRequestId: args.generationRequestId,
        reasoningRunId: args.runId,
        mediaRunId,
        reasoningModelId: 'capability:character-creator' as AiModelId,
        mediaModelId: args.mediaModelId as AiModelId,
        mediaType: 'image',
        reasoningIndex: 0,
        mediaIndex: 0,
        variantIndex: 0,
        lineageAssignment: {
            assetId: args.assetId,
            generationRequestId: args.generationRequestId,
            reasoningRunId: args.runId,
            mediaRunId,
            reasoningModelId: 'capability:character-creator' as AiModelId,
            mediaModelId: args.mediaModelId as AiModelId,
            mediaType: 'image',
            mediaIndex: 0,
            branchId: `capability-${args.runId}`,
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            promptText: args.prompt,
            createdAt: Date.now(),
        },
    }
}
