'use strict'

import type NatsService from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    type CharacterFidelityAssessmentRequest,
    type CharacterFidelityAssessmentResponse,
} from '@lixpi/constants'
import type {
    CapabilityMediaModelMeta,
    CharacterCreatorRuntimePorts,
    CharacterImageGenerationResult,
    CharacterReferenceRendition,
} from '@lixpi/capability-system/backend'

import type { ProviderRegistry } from '../llm/providers/provider-registry.ts'
import type { AiModelMetaInfo } from '../llm/graph/state.ts'
import type { ImageGenerationReference } from '../llm/image-generation-references.ts'
import { callStructuredVlm } from '../llm/structured-vlm/structured-vlm-client.ts'
import AssetModel from '../models/asset.ts'
import { getContentAddressedBlob } from '../services/blob-storage.ts'
import { TransientMediaStore } from '../services/transient-media-store.ts'

const DEFAULT_FIDELITY_TIMEOUT_MS = 15_000

export function createCharacterCreatorRuntimePorts(args: {
    registry: ProviderRegistry
    natsService: NatsService
}): CharacterCreatorRuntimePorts {
    return {
        referenceAssets: {
            getAuthorizedAsset: async request => {
                const asset = await AssetModel.get({
                    assetId: request.assetId,
                    requester: {
                        userId: request.userId,
                        workspaceIds: [request.workspaceId],
                        editableWorkspaceIds: [request.workspaceId],
                        organizationIds: [request.organizationId],
                    },
                })
                if ('error' in asset) throw new Error(`CHARACTER_REFERENCE_${asset.error}:${request.assetId}`)
                return {
                    assetId: asset.assetId,
                    organizationId: asset.organizationId,
                    ...(asset.media ? {
                        media: {
                            renditions: {
                                canonical: projectRendition(asset.media.renditions.canonical),
                                original: projectRendition(asset.media.renditions.original),
                            },
                        },
                    } : {}),
                }
            },
            readBlob: async request => await getContentAddressedBlob(request),
        },
        transientMedia: {
            create: context => {
                const store = new TransientMediaStore(args.natsService, {
                    organizationId: context.organizationId,
                    workspaceId: context.workspaceId,
                    conversationAssetId: context.conversationAssetId,
                    generationRequestId: context.generationRequestId,
                    mediaRunId: context.mediaRunId,
                })
                return {
                    putWithCoordinate: async input => {
                        const stored = await store.putWithCoordinate(input)
                        return {
                            coordinate: {
                                ...stored.coordinate,
                                mimeType: 'image/png',
                            },
                        }
                    },
                    clear: async () => await store.clear(),
                }
            },
        },
        imageGeneration: {
            generate: async request => await generateCapabilityImage({
                ...request,
                registry: args.registry,
            }),
        },
        structuredVlm: {
            call: async request => await callStructuredVlm({
                ...request,
                natsService: args.natsService,
            }),
        },
        fidelity: {
            assess: async (request, signal) => await assessCharacterFidelity(
                args.natsService,
                request,
                signal,
            ),
        },
    }
}

const projectRendition = (rendition: {
    status?: string
    blobHash?: string
    mimeType?: string
} | undefined): CharacterReferenceRendition | undefined => rendition ? {
    status: rendition.status,
    blobHash: rendition.blobHash,
    mimeType: rendition.mimeType,
} : undefined

const generateCapabilityImage = async (args: {
    registry: ProviderRegistry
} & Parameters<CharacterCreatorRuntimePorts['imageGeneration']['generate']>[0]): Promise<CharacterImageGenerationResult> => {
    const providerName = args.context.imageModel.provider
    const modelVersion = args.context.imageModel.modelVersion
    const modelMeta = args.context.imageModel.meta
    const instanceKey = [
        args.context.workspaceId,
        args.context.conversationAssetId,
        args.operationKey,
    ].join(':')
    const provider = args.registry.createTransient(instanceKey, providerName)
    const stopForAbort = (): void => { void args.registry.stop(instanceKey) }
    args.signal?.addEventListener('abort', stopForAbort, { once: true })
    const references: ImageGenerationReference[] = args.references.map(reference => ({
        ...reference,
        fileName: reference.fileName ?? `${reference.role}.png`,
    }))
    try {
        const result = await provider.process({
            messages: [{ role: 'user', content: args.prompt }],
            aiModelMetaInfo: { ...modelMeta, modelVersion } as AiModelMetaInfo,
            organizationId: args.context.organizationId,
            workspaceId: args.context.workspaceId,
            aiChatThreadId: args.context.conversationAssetId,
            enableImageGeneration: true,
            imageSize: resolvePanelImageSize(args.context.imageModel.requestedSize, modelMeta),
            imageGenerationReferences: references,
            capabilityMediaExecutionPlan: args.plan,
            capabilityUsageMode: args.usageMode,
            captureOnlyImageGeneration: true,
            abortSignal: args.signal,
            eventMeta: args.context.eventMeta,
            generationRun: args.context.generationRun,
            metricsAdmissionApproved: args.context.metricsAdmissionApproved,
            workflowId: args.context.workflowId,
            metricsOperationId: args.context.metricsOperationId,
        })
        if (result.error) throw new Error(result.error)
        const image = result.generatedImages?.[0]
        if (!image) throw new Error('CAPABILITY_IMAGE_PROVIDER_OUTPUT_MISSING')
        return {
            image,
            providerOperationId: result.aiVendorRequestId ?? result.responseId,
            includedReferenceRoles: result.imageReferenceAdaptation?.included.map(reference => reference.role)
                ?? references.map(reference => reference.role),
            omittedReferenceRoles: result.imageReferenceAdaptation?.omitted.map(reference => reference.role) ?? [],
        }
    } finally {
        args.signal?.removeEventListener('abort', stopForAbort)
        args.registry.remove(instanceKey)
    }
}

const resolvePanelImageSize = (
    requested: string | undefined,
    modelMeta: CapabilityMediaModelMeta,
): string => {
    const resolutionForRatio: Readonly<Record<string, string>> = {
        '1:1': '1024x1024',
        '3:2': '1536x1024',
        '2:3': '1024x1536',
    }
    const ratioForResolution = Object.fromEntries(
        Object.entries(resolutionForRatio).map(([ratio, resolution]) => [resolution, ratio]),
    )
    if (modelMeta.imageSizeMode === 'resolution') {
        const supported = modelMeta.imageSizes?.flatMap(option => typeof option.value === 'string' ? [option.value] : []) ?? []
        const normalized = requested ? resolutionForRatio[requested] ?? requested : undefined
        if (normalized && normalized !== 'auto' && supported.includes(normalized)) return normalized
        return supported.includes('1024x1024') ? '1024x1024' : supported[0] ?? 'auto'
    }

    const supported = modelMeta.imageReferenceCapabilities?.supportedAspectRatios ?? []
    const normalized = requested ? ratioForResolution[requested] ?? requested : undefined
    if (normalized && normalized !== 'auto' && supported.includes(normalized)) return normalized
    return supported.includes('1:1') ? '1:1' : supported[0] ?? 'auto'
}

const assessCharacterFidelity = async (
    natsService: NatsService,
    request: CharacterFidelityAssessmentRequest,
    signal?: AbortSignal,
): Promise<CharacterFidelityAssessmentResponse> => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const startedAt = Date.now()
    console.info('[CharacterFidelity] dispatch', {
        jobId: request.jobId,
        panelId: request.panelId,
        attemptId: request.attemptId,
        sourceCount: request.sources.length,
        sourceMedium: request.sourceMedium,
        expectedFaceVisibility: request.expectedFaceVisibility,
        candidateObjectKey: request.candidate.objectKey,
        candidateByteLength: request.candidate.byteLength,
        timeoutMs: DEFAULT_FIDELITY_TIMEOUT_MS,
    })
    const pending = natsService.request<CharacterFidelityAssessmentRequest, CharacterFidelityAssessmentResponse>(
        NATS_SUBJECTS.CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL,
        request,
        DEFAULT_FIDELITY_TIMEOUT_MS,
    )
    try {
        let response: CharacterFidelityAssessmentResponse
        if (!signal) {
            response = await pending
        } else {
            let abort: (() => void) | undefined
            const cancelled = new Promise<CharacterFidelityAssessmentResponse>((_resolve, reject) => {
                abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
                signal.addEventListener('abort', abort, { once: true })
                if (signal.aborted) abort?.()
            })
            try {
                response = await Promise.race([pending, cancelled])
            } finally {
                if (abort) signal.removeEventListener('abort', abort)
            }
        }
        console.info('[CharacterFidelity] result', {
            jobId: request.jobId,
            panelId: request.panelId,
            attemptId: request.attemptId,
            durationMs: Date.now() - startedAt,
            available: response.metric.available,
            unavailableReason: response.metric.unavailableReason,
            cosineSimilarity: response.metric.cosineSimilarity,
            sourceDetectionCount: response.sourceDetections.length,
            candidateDetectionCount: response.candidateDetections.length,
            errorCode: response.error?.code,
            detectorArtifactId: response.detector.artifactId,
            recognizerArtifactId: response.recognizer.artifactId,
        })
        return response
    } catch (error) {
        console.warn('[CharacterFidelity] request failed', {
            jobId: request.jobId,
            panelId: request.panelId,
            attemptId: request.attemptId,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        })
        throw error
    }
}
