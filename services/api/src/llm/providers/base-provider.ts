'use strict'

import { v4 as uuid } from 'uuid'
import {
    StateGraph,
    END,
    START,
} from '@langchain/langgraph'

import type NatsService from '@lixpi/nats-service'
import {
    info,
    warn,
    err,
} from '@lixpi/debug-tools'
import {
    STREAM_STATUS,
    type CapabilityJsonValue,
    type ConfirmRequest,
    type MediaGenerationRunMeta,
    type ProviderName,
    type StreamStatus,
} from '@lixpi/constants'

import type { MetricsClient } from '../../metrics/metrics-client.ts'

import { LLM_TIMEOUT_MS } from '../config.ts'
import {
    channels,
    type AiModelMetaInfo,
    type ProviderState,
} from '../graph/state.ts'
import {
    StreamPublisher,
    type ProseMirrorContentHandler,
    type ProseMirrorSnapshotProvider,
} from '../graph/stream-publisher.ts'
import { ImagePublisher } from '../graph/image-publisher.ts'
import { VideoPublisher } from '../graph/video-publisher.ts'
import { UsageReporter } from '../usage/usage-reporter.ts'
import {
    getImagePromptMaxChars,
    validateImagePrompt as toolValidateImagePrompt,
} from '../tools/image-generation.ts'
import { buildImageGenerationTrace } from '../tools/image-generation-trace.ts'
import { buildVideoGenerationTrace } from '../tools/video-generation-trace.ts'
import { resolveWorkspaceContext } from '../graph/workspace-context-resolver.ts'
import { resolveMediaBranch } from '../graph/media-branch-resolver.ts'
import {
    tokenUsageConfirm,
    imageUsageConfirm,
    videoUsageConfirm,
} from '../usage/usage-event-mapper.ts'
import { resolveCheckMetering } from '../usage/usage-estimator.ts'
import {
    logUsageCheck,
    logUsageConfirm,
} from '../usage/usage-log.ts'
import { MediaBranchLineagePlanner } from '../lineage/media-branch-lineage-planner.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import {
    resolveCapabilityOutputMediaRuns,
    resolveDurableMediaRuns,
} from '../lineage/capability-output-media-runs.ts'
import {
    ensurePendingGeneratedAssets,
    resolveInheritedGenerationSeed,
} from '../../services/generated-asset-storage.ts'
import { generateMediaGenerationSeed } from './media-generation-seed.ts'
import { MediaGenerationRequestService } from '../../services/media-generation-request-service.ts'
import type { CapabilityDispatcher } from '@lixpi/capability-system/backend'
import { getCapabilityDispatcher } from '../../capability-system/capability-runtime.ts'
import {
    executeRequiredCapabilitiesForState,
    hasPendingModelRequiredCapabilityOnlyOutput,
    requiredCapabilityProducedCapabilityOnlyOutput,
    requiredCapabilityProducedOutput,
    resolveCapabilitiesForState,
} from '../../capability-system/capability-state-resolver.ts'
import { isCharacterCreatorCapabilitySelected } from '@lixpi/capability-system'
import type { MediaProviderDefinition } from './media-provider-definition.ts'
import { assertNoForbiddenMediaReferenceLeak } from '../media-reference/provider-safe-context.ts'
import { sanitizeMediaReferenceText } from '../media-reference/media-reference-compiler.ts'
import { resolveImageGenerationReferences } from '../image-generation-references.ts'
import {
    withTransportRetry,
    type TransportRetryAttempt,
} from '../utils/transport-retry.ts'
import {
    discardPendingCapabilityOutputsForState,
    finalizePendingCapabilityOutputsForState,
} from '../../capability-system/capability-output-finalizer.ts'

export type BaseProviderDeps = {
    natsService: NatsService
    usageReporter: UsageReporter
    runImageRouter: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>
    runVideoRouter: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>
    capabilityDispatcher?: CapabilityDispatcher
    // Metrics (optional — absent/disabled = the open-source plug, i.e. today's
    // behavior). The synchronous check/confirm run on the workflow path via this
    // abstract metering client (see metrics/metrics-client.ts).
    metrics?: MetricsClient
    mediaProviderDefinition: MediaProviderDefinition
}

type FanoutRouterResult = Pick<
    ProviderState,
    | 'error'
    | 'errorCode'
    | 'errorType'
    | 'generatedImages'
    | 'generatedVideos'
>

type MediaRouterOptions = {
    onProseMirrorContent?: ProseMirrorContentHandler
    getProseMirrorSnapshot?: ProseMirrorSnapshotProvider
    onCapabilityMediaTrace?: (trace: CapabilityJsonValue) => void
    signal?: AbortSignal
}

const LIVE_MIRRORED_MEDIA_STATUSES: ReadonlySet<StreamStatus> = new Set([
    STREAM_STATUS.IMAGE_PARTIAL,
    STREAM_STATUS.IMAGE_COMPLETE,
    STREAM_STATUS.IMAGE_ERROR,
    STREAM_STATUS.VIDEO_PENDING,
    STREAM_STATUS.VIDEO_GENERATING,
    STREAM_STATUS.VIDEO_COMPLETE,
    STREAM_STATUS.VIDEO_ERROR,
])

const catalogModelIdFor = (model: AiModelMetaInfo): string => `${model.provider}:${model.model}`

const isUserStopReason = (reason: unknown): boolean => {
    const candidate = reason as { message?: unknown }
    return typeof candidate?.message === 'string' && candidate.message === 'Stopped by user'
}

const normalizeModelOption = (
    requested: string | number | undefined,
    options: Array<{ value?: string; label?: string }> | undefined,
): string | undefined => {
    const requestedValue = requested == null ? '' : String(requested)
    if (!Array.isArray(options) || options.length === 0) return requestedValue || undefined

    const values = options
        .map(option => option.value)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (values.length === 0) return requestedValue || undefined
    if (requestedValue && values.includes(requestedValue)) return requestedValue
    return values[0]
}

// Shared LangGraph workflow for chat-style LLM calls (with optional image-gen branch).
// Style Extraction is a Capability Tool; this graph handles chat threads and media generation.
// Top-level chat requests publish START_STREAM before graph invocation so expensive
// pre-stream VLM/image preprocessing never leaves the browser looking frozen.
// Transient image-model providers skip their own stream lifecycle because the parent
// chat stream owns it.
//
// Topology:
//   START → validateRequest → resolveWorkspaceContext → resolveCapabilities → executeRequiredCapabilities → resolveMediaBranch → streamTokens → planMediaBranchLineage → [conditional]
//     generate_image: validateImagePrompt → [conditional]
//       generate_image: executeImageGeneration → calculateUsage → cleanup → END
//       skip:                                    calculateUsage → cleanup → END
//     skip:                                      calculateUsage → cleanup → END
//
// Each provider subclasses BaseProvider and supplies streamImpl(state).
export abstract class BaseProvider {
    abstract readonly providerName: ProviderName

    protected app: ReturnType<ReturnType<typeof BaseProvider.prototype.buildWorkflow>['compile']>
    protected abortController: AbortController | undefined
    protected streamPublisher: StreamPublisher | undefined
    protected imagePublisher: ImagePublisher | undefined
    protected videoPublisher: VideoPublisher | undefined
    public readonly instanceKey: string
    private readonly mediaBranchLineagePlanner = new MediaBranchLineagePlanner()
    private readonly mediaGenerationRunPlanner = new MediaGenerationRunPlanner()
    protected readonly capabilityDispatcher: CapabilityDispatcher
    private pipelineProseMirrorContentHandler: ProseMirrorContentHandler | undefined
    private pipelineProseMirrorSnapshotProvider: ProseMirrorSnapshotProvider | undefined
    private publishMirroredMediaLive = true
    private userStopRequested = false

    constructor(
        protected readonly _instanceKey: string,
        protected readonly deps: BaseProviderDeps,
    ) {
        this.instanceKey = _instanceKey
        this.capabilityDispatcher = deps.capabilityDispatcher ?? getCapabilityDispatcher()
        this.app = this.buildWorkflow().compile()
    }

    private publishPipelineProseMirrorContent(content: Parameters<ProseMirrorContentHandler>[0]): void {
        if (this.pipelineProseMirrorContentHandler) {
            this.pipelineProseMirrorContentHandler(content)
            if (this.publishMirroredMediaLive && LIVE_MIRRORED_MEDIA_STATUSES.has(content.status)) {
                this.streamPublisher?.publishChatContent(content, { mirrorProseMirror: false })
            }
            return
        }
        this.streamPublisher?.publishChatContent(content)
    }

    private getPipelineProseMirrorSnapshot(): ReturnType<ProseMirrorSnapshotProvider> {
        if (this.pipelineProseMirrorSnapshotProvider) return this.pipelineProseMirrorSnapshotProvider()
        return this.streamPublisher?.getProseMirrorSnapshot() ?? null
    }

    private buildWorkflow() {
        // `preflightResolved` gates every shared-resolution node below. For
        // multi-model matrix requests the orchestrator runs these resolvers ONCE
        // in a shared preflight and dispatches each child with
        // `preflightResolved: true`, so the child SKIPS them (returns `{}`) and
        // relies entirely on the resolution the matrix forwarded in the request.
        // INVARIANT: any field these resolvers emit must be propagated by
        // `MediaGenerationMatrixOrchestrator` (it forwards the whole resolved
        // patch). A field resolved here but not forwarded is lost for matrix
        // children — that is what once dropped the video reference images and
        // forced text-to-video. Single (non-matrix) requests leave the flag
        // `false`, so these nodes run in-graph and feed the same state directly.
        const graph = new StateGraph<ProviderState>({ channels: channels as any })
            .addNode('validateRequest', async (s: ProviderState) => this.validateRequest(s))
            .addNode('resolveWorkspaceContext', async (s: ProviderState) =>
                s.preflightResolved ? {} : resolveWorkspaceContext(s, {
                    natsService: this.nats,
                    publisher: this.publisher,
                    abortSignal: this.signal,
                }))
            .addNode('resolveCapabilities', async (s: ProviderState) => s.preflightResolved ? {} : resolveCapabilitiesForState(s, this.signal))
            .addNode('executeRequiredCapabilities', async (s: ProviderState) =>
                s.preflightResolved
                    ? {}
                    : executeRequiredCapabilitiesForState(s, this.capabilityDispatcher, this.signal))
            .addNode('resolveMediaBranch', async (s: ProviderState) => (
                s.preflightResolved
                    ? {}
                    : resolveMediaBranch(s, {
                        natsService: this.nats,
                        publisher: this.publisher,
                        abortSignal: this.signal,
                    })
            ))
            .addNode('planMediaBranchLineage', async (s: ProviderState) => s.preflightResolved ? {} : this.planMediaBranchLineage(s))
            .addNode('streamTokens', async (s: ProviderState) => this.streamTokens(s))
            .addNode('validateImagePrompt', async (s: ProviderState) => this.validateImagePromptNode(s))
            .addNode('executeImageGeneration', async (s: ProviderState) => this.executeImageGeneration(s))
            .addNode('executeVideoGeneration', async (s: ProviderState) => this.executeVideoGeneration(s))
            .addNode('calculateUsage', async (s: ProviderState) => this.calculateUsage(s))
            .addNode('cleanup', async (s: ProviderState) => this.cleanup(s))

        graph.addEdge(START, 'validateRequest' as any)
        graph.addEdge('validateRequest' as any, 'resolveWorkspaceContext' as any)
        graph.addEdge('resolveWorkspaceContext' as any, 'resolveCapabilities' as any)
        graph.addEdge('resolveCapabilities' as any, 'executeRequiredCapabilities' as any)
        graph.addEdge('executeRequiredCapabilities' as any, 'resolveMediaBranch' as any)
        graph.addEdge('resolveMediaBranch' as any, 'streamTokens' as any)
        graph.addEdge('streamTokens' as any, 'planMediaBranchLineage' as any)
        graph.addConditionalEdges(
            'planMediaBranchLineage' as any,
            (s: ProviderState) => this.routeAfterStream(s),
            {
                generate_image: 'validateImagePrompt' as any,
                generate_video: 'executeVideoGeneration' as any,
                skip: 'calculateUsage' as any,
            },
        )
        graph.addConditionalEdges(
            'validateImagePrompt' as any,
            (s: ProviderState) => this.shouldGenerateImage(s),
            { generate_image: 'executeImageGeneration' as any, skip: 'calculateUsage' as any },
        )
        graph.addEdge('executeImageGeneration' as any, 'calculateUsage' as any)
        graph.addEdge('executeVideoGeneration' as any, 'calculateUsage' as any)
        graph.addEdge('calculateUsage' as any, 'cleanup' as any)
        graph.addEdge('cleanup' as any, END)
        return graph
    }

    // Run a request through the LangGraph workflow.
    async process(requestData: Record<string, any>): Promise<ProviderState> {
        this.userStopRequested = false
        this.abortController = new AbortController()
        const parentAbortSignal = requestData.abortSignal as AbortSignal | undefined
        const abortFromParent = (): void => {
            if (isUserStopReason(parentAbortSignal?.reason)) this.userStopRequested = true
            this.abortController?.abort(parentAbortSignal?.reason ?? new Error('Parent request aborted'))
        }
        if (parentAbortSignal?.aborted) {
            abortFromParent()
        } else {
            parentAbortSignal?.addEventListener('abort', abortFromParent, { once: true })
        }
        const characterCreatorSelected = requestData.capabilityUsageMode === 'character-creator'
            || isCharacterCreatorCapabilitySelected(requestData.capabilityReferences)
        const mediaFanoutPlan = characterCreatorSelected && requestData.mediaFanoutPlan
            ? {
                ...requestData.mediaFanoutPlan,
                videoModels: [],
                videoModelOptions: {},
                videoConfigGroups: [],
            }
            : requestData.mediaFanoutPlan
        const organizationId = requestData.organizationId ?? requestData.eventMeta?.organizationId
        if (!organizationId) throw new Error('Provider request is missing organizationId')
        const imageGenerationReferences = requestData.imageGenerationReferences ?? []
        const rawResolvedImageGenerationReferences = requestData.enableImageGeneration
            ? await resolveImageGenerationReferences(imageGenerationReferences, this.nats)
            : undefined
        const imageReferenceCapabilities = requestData.aiModelMetaInfo?.imageReferenceCapabilities
        if (rawResolvedImageGenerationReferences?.length && !imageReferenceCapabilities) {
            throw new Error('IMAGE_REFERENCE_CAPABILITIES_REQUIRED')
        }
        const imageReferenceAdaptation = rawResolvedImageGenerationReferences?.length
            ? this.deps.mediaProviderDefinition?.imageReferenceAdapter?.adapt({
                references: rawResolvedImageGenerationReferences,
                capabilities: imageReferenceCapabilities!,
                requiresIdentity: requestData.capabilityMediaExecutionPlan?.kind === 'character-sheet',
            })
            : undefined
        const resolvedImageGenerationReferences = imageReferenceAdaptation?.included
            ?? rawResolvedImageGenerationReferences
        if (resolvedImageGenerationReferences) {
            info(`[ImageGenerationReferences:${this.instanceKey}] resolved ${
                JSON.stringify({
                    provider: this.providerName,
                    modelVersion: requestData.aiModelMetaInfo?.modelVersion,
                    referenceCount: resolvedImageGenerationReferences.length,
                    references: resolvedImageGenerationReferences.map(reference => ({
                        role: reference.role,
                        fileName: reference.fileName,
                        byteLength: reference.byteLength,
                        mediaType: reference.mediaType,
                        sha256: reference.sha256,
                    })),
                })
            }`)
        }
        const ownsServerProseMirrorStream = Boolean(
            requestData.proseMirrorInitialDoc
                && requestData.generationRun?.requestKind !== 'media-generation-matrix',
        )
        const deferProseMirrorEnd = ownsServerProseMirrorStream && Boolean(
            requestData.enableImageGeneration
                || requestData.enableVideoGeneration
                || requestData.imageModelMetaInfo
                || requestData.videoModelMetaInfo,
        )
        this.pipelineProseMirrorContentHandler = typeof requestData.proseMirrorContentHandler === 'function'
            ? requestData.proseMirrorContentHandler as ProseMirrorContentHandler
            : undefined
        this.pipelineProseMirrorSnapshotProvider = typeof requestData.proseMirrorSnapshotProvider === 'function'
            ? requestData.proseMirrorSnapshotProvider as ProseMirrorSnapshotProvider
            : undefined
        this.publishMirroredMediaLive = requestData.generationRun?.requestKind === 'media-generation-matrix'
            && !requestData.generationRun?.mediaRunId
        const onPipelineContent: ProseMirrorContentHandler = content => this.publishPipelineProseMirrorContent(content)
        const getProseMirrorSnapshot: ProseMirrorSnapshotProvider = () => this.getPipelineProseMirrorSnapshot()
        this.streamPublisher = new StreamPublisher(
            this.deps.natsService,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
            requestData.generationRun,
            {
                organizationId,
                assetLeaseId: requestData.assetLeaseId,
                assetLeaseHolderId: requestData.assetLeaseHolderId,
                enableProseMirrorStream: ownsServerProseMirrorStream,
                proseMirrorBaseVersion: requestData.proseMirrorBaseVersion,
                proseMirrorInitialDoc: requestData.proseMirrorInitialDoc,
                deferProseMirrorEnd,
                canvasVisibleArea: requestData.canvasVisibleArea,
                proseMirrorContentMirror: this.pipelineProseMirrorContentHandler,
            },
        )
        this.imagePublisher = new ImagePublisher(
            this.deps.natsService,
            organizationId,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
            requestData.generationRun,
            undefined,
            onPipelineContent,
            requestData.canvasVisibleArea,
            getProseMirrorSnapshot,
            requestData.captureOnlyImageGeneration === true,
            typeof requestData.captureOnlyImagePartialHandler === 'function'
                ? requestData.captureOnlyImagePartialHandler
                : undefined,
        )
        this.videoPublisher = new VideoPublisher(
            this.deps.natsService,
            organizationId,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
            requestData.generationRun,
            undefined,
            onPipelineContent,
            requestData.canvasVisibleArea,
            getProseMirrorSnapshot,
        )

        const initialState: ProviderState = {
            messages: requestData.messages ?? [],
            aiModelMetaInfo: requestData.aiModelMetaInfo ?? {},
            eventMeta: requestData.eventMeta ?? {},
            workspaceId: requestData.workspaceId,
            aiChatThreadId: requestData.aiChatThreadId,
            instanceKey: this.instanceKey,
            provider: this.providerName,
            modelVersion: requestData.aiModelMetaInfo?.modelVersion,
            maxCompletionSize: requestData.aiModelMetaInfo?.maxCompletionSize,
            temperature: requestData.aiModelMetaInfo?.defaultTemperature ?? 0.7,
            reasoningGenerationConfig: requestData.reasoningGenerationConfig,
            streamActive: false,
            aiRequestReceivedAt: Date.now(),
            enableImageGeneration: requestData.enableImageGeneration ?? false,
            imageSize: requestData.imageSize ?? 'auto',
            imageModelMetaInfo: requestData.imageModelMetaInfo,
            imageModelVersion: requestData.imageModelMetaInfo?.modelVersion,
            imageProviderName: requestData.imageModelMetaInfo?.provider,
            imageGenerationConfig: requestData.imageGenerationConfig,
            generatedImagePrompt: requestData.generatedImagePrompt
                ?? (requestData.capabilityMediaExecutionPlan
                    ? requestData.providerSafeMediaIntent?.safePrompt
                    : undefined),
            imagePromptRetryCount: 0,
            imageGenerationReferences,
            resolvedImageGenerationReferences,
            imageReferenceAdaptation,
            workspaceContextSnapshot: requestData.workspaceContextSnapshot,
            workspaceContextResolution: requestData.workspaceContextResolution,
            mediaBranchCandidateSnapshot: requestData.mediaBranchCandidateSnapshot,
            mediaBranchResolution: requestData.mediaBranchResolution,
            mediaBranchLineagePlan: requestData.mediaBranchLineagePlan,
            isMediaRegenerationRun: requestData.isMediaRegenerationRun,
            promptReferenceAssetIds: requestData.promptReferenceAssetIds,
            canvasVisibleArea: requestData.canvasVisibleArea,
            capabilityReferences: requestData.capabilityReferences,
            capabilityInputs: requestData.capabilityInputs,
            resolvedCapabilityPlan: requestData.resolvedCapabilityPlan,
            capabilityInvocationDepth: requestData.capabilityInvocationDepth ?? 0,
            capabilityToolResults: requestData.capabilityToolResults,
            capabilityOutputAssetIds: requestData.capabilityOutputAssetIds,
            capabilityOutputMediaAssetIds: requestData.capabilityOutputMediaAssetIds,
            capabilityReferenceImages: requestData.capabilityReferenceImages,
            capabilityReferenceImageTraceUrls: requestData.capabilityReferenceImageTraceUrls,
            capabilityUsageMode: requestData.capabilityUsageMode,
            capabilityUsagePrompt: requestData.capabilityUsagePrompt,
            capabilityMediaExecutionPlan: requestData.capabilityMediaExecutionPlan,
            enableVideoGeneration: characterCreatorSelected ? false : requestData.enableVideoGeneration ?? false,
            videoModelMetaInfo: characterCreatorSelected ? undefined : requestData.videoModelMetaInfo,
            videoModelVersion: characterCreatorSelected ? undefined : requestData.videoModelMetaInfo?.modelVersion,
            videoProviderName: characterCreatorSelected ? undefined : requestData.videoModelMetaInfo?.provider,
            videoAspectRatio: characterCreatorSelected ? undefined : requestData.videoAspectRatio,
            videoResolution: characterCreatorSelected ? undefined : requestData.videoResolution,
            videoDurationSeconds: characterCreatorSelected ? undefined : requestData.videoDurationSeconds,
            videoGenerationConfig: characterCreatorSelected ? undefined : requestData.videoGenerationConfig,
            generatedVideoPrompt: characterCreatorSelected ? undefined : requestData.generatedVideoPrompt,
            generatedVideoNegativePrompt: characterCreatorSelected ? undefined : requestData.generatedVideoNegativePrompt,
            videoFirstFrameImage: characterCreatorSelected ? undefined : requestData.videoFirstFrameImage,
            videoReferenceImages: characterCreatorSelected ? undefined : requestData.videoReferenceImages,
            videoSourceForExtension: characterCreatorSelected ? undefined : requestData.videoSourceForExtension,
            videoSourceDurationSeconds: characterCreatorSelected ? undefined : requestData.videoSourceDurationSeconds,
            workflowId: requestData.workflowId,
            workflowSeq: requestData.workflowSeq,
            metricsOperationId: requestData.metricsOperationId,
            metricsAdmissionApproved: requestData.metricsAdmissionApproved,
            generationRun: requestData.generationRun,
            mediaFanoutPlan,
            replayMediaPrompts: requestData.replayMediaPrompts,
            preflightResolved: requestData.preflightResolved ?? false,
            durableGenerationRequestId: requestData.durableGenerationRequestId,
            durableMediaRuns: requestData.durableMediaRuns,
            providerSafeMediaIntent: requestData.providerSafeMediaIntent,
            mediaReferenceBindings: requestData.mediaReferenceBindings,
        }

        const timeoutHandle = setTimeout(() => {
            this.abortController?.abort(new Error('LLM circuit breaker timeout'))
        }, LLM_TIMEOUT_MS)

        try {
            if (!initialState.enableImageGeneration && !initialState.enableVideoGeneration) {
                this.streamPublisher.start()
            }

            return await this.app.invoke(initialState, {
                signal: this.abortController.signal,
                recursionLimit: 25,
            })
        } catch (e: any) {
            const message = e?.message ?? String(e)
            const cancelledByUser = this.userStopRequested
            if (cancelledByUser) {
                info(`Workflow cancelled by user for ${this.instanceKey}`)
            } else if (this.abortController.signal.aborted) {
                err(`Circuit breaker / abort fired for ${this.instanceKey}: ${message}`)
            } else {
                err(`Workflow failed for ${this.instanceKey}: ${message}`)
            }
            const ownsDurableMediaRequestLifecycle = this.ownsDurableMediaRequestLifecycle(initialState)
            const generationRequestId = initialState.durableGenerationRequestId
                ?? initialState.generationRun?.generationRequestId
            if (cancelledByUser && generationRequestId) {
                this.streamPublisher.beginMediaGenerationRequestCancellation(generationRequestId)
                if (ownsDurableMediaRequestLifecycle) {
                    await this.streamPublisher.cancelProseMirrorGenerationRequest(generationRequestId)
                    this.streamPublisher.mediaGenerationRequestComplete(generationRequestId, {
                        removeProjectedPendingNodes: true,
                    })
                }
            } else if (!cancelledByUser && ownsDurableMediaRequestLifecycle) {
                try {
                    await this.failUnfinishedDurableRuns(initialState)
                } catch (settlementError) {
                    err(`[BaseProvider] Failed to settle unfinished durable runs for ${this.instanceKey}:`, settlementError)
                }
            }
            if (!cancelledByUser) {
                this.streamPublisher.error(
                    initialState.durableGenerationRequestId
                        ? 'The provider could not complete this generation attempt.'
                        : message,
                )
            }
            if (!cancelledByUser && ownsDurableMediaRequestLifecycle) {
                this.streamPublisher.completeKnownMediaGenerationRequests()
            }
            this.streamPublisher.end()
            await this.streamPublisher.drainPendingWrites()
            await this.streamPublisher.finishProseMirrorStream()
            const terminalState = {
                ...initialState,
                streamActive: false,
                ...(cancelledByUser ? { cancelledByUser: true } : {}),
                aiRequestFinishedAt: Date.now(),
            }
            return cancelledByUser ? terminalState : { ...terminalState, error: message }
        } finally {
            parentAbortSignal?.removeEventListener('abort', abortFromParent)
            try {
                await this.imagePublisher?.clearTransientMedia()
            } catch (cleanupError) {
                err(`Transient media cleanup failed for ${this.instanceKey}:`, cleanupError)
            }
            clearTimeout(timeoutHandle)
        }
    }

    async stop(): Promise<void> {
        info(`Stopping stream for instance: ${this.instanceKey}`)
        this.userStopRequested = true
        this.abortController?.abort(new Error('Stopped by user'))
    }

    // -- Workflow nodes (shared) --

    protected async planMediaBranchLineage(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.error) return {}
        if (state.mediaBranchLineagePlan) return {}
        if (requiredCapabilityProducedCapabilityOnlyOutput(state)) return {}

        const capabilityOutputMediaAssetIds = state.capabilityOutputMediaAssetIds
            ?? state.capabilityOutputAssetIds
            ?? []
        if (capabilityOutputMediaAssetIds.length === 0 && !state.imageModelVersion && !state.videoModelVersion) return {}

        const generationRun = this.mediaGenerationRunPlanner.buildSingleReasoningRun({
            existingRun: state.generationRun,
            eventMeta: state.eventMeta,
            provider: state.provider,
            modelName: state.aiModelMetaInfo.model,
            modelVersion: state.modelVersion,
        })
        const selectedImageModality = Boolean(state.generatedImagePrompt)
        const selectedVideoModality = Boolean(state.generatedVideoPrompt)
        const hasSelectedModality = selectedImageModality || selectedVideoModality
        const imageModelId = state.imageModelVersion
                && state.imageProviderName
                && (selectedImageModality || (!hasSelectedModality && !state.videoModelVersion))
            ? this.mediaGenerationRunPlanner.buildMediaModelId(state.imageProviderName, state.imageModelMetaInfo?.model, state.imageModelVersion)
            : undefined
        const videoModelId = state.capabilityUsageMode !== 'character-creator'
                && state.videoModelVersion
                && state.videoProviderName
                && (selectedVideoModality || (!hasSelectedModality && !state.imageModelVersion))
            ? this.mediaGenerationRunPlanner.buildMediaModelId(state.videoProviderName, state.videoModelMetaInfo?.model, state.videoModelVersion)
            : undefined
        const preassignedMediaRuns = capabilityOutputMediaAssetIds.length > 0
            ? await resolveCapabilityOutputMediaRuns(capabilityOutputMediaAssetIds)
            : resolveDurableMediaRuns(state.durableMediaRuns)
        const lineagePlan = this.mediaBranchLineagePlanner.buildPlan({
            generationRequestId: generationRun.generationRequestId,
            reasoningModelIds: preassignedMediaRuns
                ? [...new Set(preassignedMediaRuns.map(run => run.reasoningModelId))]
                : [generationRun.reasoningModelId],
            ...(preassignedMediaRuns
                ? { preassignedMediaRuns }
                : {
                    ...(imageModelId ? { imageModelIds: [imageModelId] } : {}),
                    ...(videoModelId ? { videoModelIds: [videoModelId] } : {}),
                }),
            mediaBranchCandidateSnapshot: state.mediaBranchCandidateSnapshot,
            mediaBranchResolution: state.mediaBranchResolution,
            referenceAssetIds: state.promptReferenceAssetIds,
            workspaceContextSnapshot: state.workspaceContextSnapshot,
            createdAt: Date.now(),
        })
        const lineageAssignment = preassignedMediaRuns
            ? lineagePlan.runAssignments[0]
            : lineagePlan.runAssignments.find(assignment => assignment.reasoningRunId === generationRun.reasoningRunId)
        const nextGenerationRun: MediaGenerationRunMeta = lineageAssignment
            ? {
                ...generationRun,
                reasoningRunId: lineageAssignment.reasoningRunId,
                reasoningModelId: lineageAssignment.reasoningModelId,
                reasoningIndex: lineageAssignment.reasoningIndex,
                ...(lineageAssignment.mediaRunId ? { mediaRunId: lineageAssignment.mediaRunId } : {}),
                ...(lineageAssignment.mediaModelId ? { mediaModelId: lineageAssignment.mediaModelId } : {}),
                ...(lineageAssignment.mediaType ? { mediaType: lineageAssignment.mediaType } : {}),
                mediaIndex: lineageAssignment.mediaIndex,
                lineageAssignment,
            }
            : generationRun

        const organizationId = state.eventMeta.organizationId as string | undefined
        const ownerUserId = state.eventMeta.userId as string | undefined
        if (!organizationId || !ownerUserId) {
            throw new Error('Asset media generation requires organization and user context')
        }
        await ensurePendingGeneratedAssets({
            lineagePlan,
            workspaceId: state.workspaceId,
            conversationAssetId: state.aiChatThreadId,
            organizationId,
            ownerUserId,
            mediaBranchCandidateSnapshot: state.mediaBranchCandidateSnapshot,
            workspaceContextSnapshot: state.workspaceContextSnapshot,
        })
        this.streamPublisher?.mediaLineagePlanned(lineagePlan, nextGenerationRun)
        await this.streamPublisher?.drainPendingWrites()
        if (state.durableGenerationRequestId) {
            await new MediaGenerationRequestService().bindRunsToLineagePlan({
                generationRequestId: state.durableGenerationRequestId,
                workspaceId: state.workspaceId,
                lineagePlan,
            })
        }
        info(`[BaseProvider] media branch lineage planned ${
            JSON.stringify(
                {
                    workspaceId: state.workspaceId,
                    aiChatThreadId: state.aiChatThreadId,
                    generationRequestId: lineagePlan.generationRequestId,
                    branchId: lineagePlan.branchId,
                    branchOriginNodeId: lineagePlan.branchOrigin?.nodeId,
                    branchForkCount: lineagePlan.branchForks.length,
                    runAssignmentCount: lineagePlan.runAssignments.length,
                },
                null,
                0,
            )
        }`)

        return {
            mediaBranchLineagePlan: lineagePlan,
            generationRun: nextGenerationRun,
            eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, nextGenerationRun),
        }
    }

    protected async validateRequest(state: ProviderState): Promise<Partial<ProviderState>> {
        if (!state.modelVersion) throw new Error('modelVersion is required')
        if (!state.messages?.length) throw new Error('messages list is required')
        if (!state.workspaceId) throw new Error('workspaceId is required')
        if (!state.aiChatThreadId) throw new Error('aiChatThreadId is required')
        if (state.providerSafeMediaIntent) {
            const compiledReferencePayload = this.deps.mediaProviderDefinition.referenceRules.compile(
                state.providerSafeMediaIntent,
            )
            assertNoForbiddenMediaReferenceLeak({
                payload: {
                    compiledReferencePayload,
                    messages: state.messages,
                    workspaceContextSnapshot: state.workspaceContextSnapshot,
                    mediaBranchCandidateSnapshot: state.mediaBranchCandidateSnapshot,
                },
                forbiddenNameVariants: state.providerSafeMediaIntent.forbiddenNameVariants,
            })
        }
        if (state.metricsAdmissionApproved) return {}
        return this.metricsCheck(state)
    }

    // The matrix orchestrator calls this before resolving or persisting shared
    // lineage. Its result is forwarded to the child run, which skips a duplicate
    // admission check while retaining the operation identity for usage confirms.
    async preflightAdmission(state: ProviderState): Promise<Partial<ProviderState>> {
        return {
            ...await this.validateRequest(state),
            metricsAdmissionApproved: true,
        }
    }

    // Synchronous spend check before the paid provider call: ask the metering port
    // whether the balance covers this run. Fail-closed — a denied (or, per the
    // client's policy, an unreachable) port stops the run before any provider spend.
    // Disabled = the open-source plug, which always approves. On admission, mint the
    // per-run workflowId so the confirm calls can be grouped.
    private async metricsCheck(state: ProviderState): Promise<Partial<ProviderState>> {
        const metrics = this.deps.metrics
        if (!metrics?.enabled) return {}

        const userId = state.eventMeta?.userId ?? ''
        const orgId = (state.eventMeta?.organizationId as string) ?? ''
        const workflowKind = this.deriveWorkflowKind(state)
        const workflowId = uuid()
        // Modality and unit count are derived together so they always describe the
        // same model, the one named below. See llm/usage/usage-estimator.ts.
        const model = state.modelVersion ?? ''
        const { modality, estimatedUnits, basis } = resolveCheckMetering(state)

        const res = await metrics.check({
            orgId,
            userId,
            workspaceId: state.workspaceId,
            workflowId,
            model,
            modality,
            estimatedUnits,
            currency: 'USD',
        })
        logUsageCheck({ model, modality, estimatedUnits, basis, workflowId, response: res })
        if (!res.approved) {
            const reason = res.reason ? `: ${res.reason}` : ''
            throw new Error(`Metrics: balance does not cover this workflow (${workflowKind}${reason})`)
        }
        // Thread the operationId from the check into graph state so the confirm(s)
        // can correlate back to this admission.
        return { workflowId, workflowSeq: 0, metricsOperationId: res.operationId }
    }

    // Labels the run by its broadest enabled modality, for the denial message only.
    // It deliberately does NOT drive the check's modality: the check names
    // state.modelVersion, and a reasoning model has no image or video tariff, so
    // escalating here would get every image-enabled chat run denied as unpriceable.
    // The image and video calls this run may go on to make are separate paid calls
    // through transient media providers, each admitted against its own media model.
    private deriveWorkflowKind(state: ProviderState): string {
        if (state.enableVideoGeneration) return 'chat_video'
        if (state.enableImageGeneration) return 'chat_image'
        return 'chat_text'
    }

    // Subclasses implement streamImpl(state) and return partial-state updates (usage, response_id, etc.).
    protected async streamTokens(state: ProviderState): Promise<Partial<ProviderState>> {
        const update: Partial<ProviderState> = { streamActive: true }
        try {
            if (!state.generationRun && hasPendingModelRequiredCapabilityOnlyOutput(state)) {
                const generationRun = this.mediaGenerationRunPlanner.buildSingleReasoningRun({
                    eventMeta: state.eventMeta,
                    provider: state.provider,
                    modelName: state.aiModelMetaInfo.model,
                    modelVersion: state.modelVersion,
                })
                state.generationRun = generationRun
                state.eventMeta = this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun)
                this.streamPublisher?.setGenerationRun(generationRun)
            }
            if (state.replayMediaPrompts?.length) {
                return this.sanitizeProviderMediaPrompts({
                    ...update,
                    generatedImagePrompt: state.replayMediaPrompts.find(prompt => prompt.mediaType === 'image')?.finalPrompt,
                    generatedVideoPrompt: state.replayMediaPrompts.find(prompt => prompt.mediaType === 'video')?.finalPrompt,
                    streamActive: false,
                    aiRequestFinishedAt: Date.now(),
                }, state.providerSafeMediaIntent)
            }
            const implResult = await this.streamImpl(state)
            await this.completePendingCapabilityOutputsAfterStream(state, Boolean(implResult.error))
            return this.sanitizeProviderMediaPrompts({
                ...update,
                generationRun: state.generationRun,
                eventMeta: state.eventMeta,
                capabilityToolResults: state.capabilityToolResults,
                capabilityOutputAssetIds: state.capabilityOutputAssetIds,
                capabilityOutputMediaAssetIds: state.capabilityOutputMediaAssetIds,
                pendingCapabilityOutputFinalizations: state.pendingCapabilityOutputFinalizations,
                capabilityReferenceImages: state.capabilityReferenceImages,
                capabilityReferenceImageTraceUrls: state.capabilityReferenceImageTraceUrls,
                capabilityUsageMode: state.capabilityUsageMode,
                capabilityUsagePrompt: state.capabilityUsagePrompt,
                ...implResult,
                streamActive: false,
                aiRequestFinishedAt: Date.now(),
            }, state.providerSafeMediaIntent)
        } catch (e: any) {
            const message = e?.message ?? String(e)
            err(`Streaming error (${this.providerName}): ${message}`)
            try {
                await discardPendingCapabilityOutputsForState(state)
                state.pendingCapabilityOutputFinalizations = []
                this.streamPublisher?.error(
                    state.durableGenerationRequestId
                        ? 'The provider could not complete this generation attempt.'
                        : message,
                )
                if (state.generationRun?.requestKind !== 'media-generation-matrix') {
                    this.streamPublisher?.completeKnownMediaGenerationRequests()
                }
                this.streamPublisher?.end()
                await this.streamPublisher?.drainPendingWrites()
            } catch {}
            return {
                ...update,
                streamActive: false,
                aiRequestFinishedAt: Date.now(),
                error: message,
            }
        }
    }

    protected async completePendingCapabilityOutputsAfterStream(
        state: ProviderState,
        streamFailed: boolean,
    ): Promise<void> {
        if (!state.pendingCapabilityOutputFinalizations?.length) return
        await this.streamPublisher?.drainPendingWrites()
        this.publisher.end({ deferPipelineFinish: true })
        await this.streamPublisher?.drainPendingWrites()
        if (streamFailed || this.shouldStop) {
            await discardPendingCapabilityOutputsForState(state)
            state.pendingCapabilityOutputFinalizations = []
            return
        }

        try {
            await this.streamPublisher?.finishProseMirrorConversation()
            const finalized = await finalizePendingCapabilityOutputsForState(state)
            for (const output of finalized) {
                this.publisher.canvasGeometryResolved(output.canvasGeometry, output.generationRun)
            }
            state.pendingCapabilityOutputFinalizations = []
            await this.streamPublisher?.drainPendingWrites()
        } catch (error) {
            await discardPendingCapabilityOutputsForState(state)
            state.pendingCapabilityOutputFinalizations = []
            throw error
        }
    }

    protected abstract streamImpl(state: ProviderState): Promise<Partial<ProviderState>>

    protected shouldGenerateImage(state: ProviderState): 'generate_image' | 'skip' {
        if (requiredCapabilityProducedOutput(state)) return 'skip'
        return state.generatedImagePrompt || state.capabilityMediaExecutionPlan
            ? 'generate_image'
            : 'skip'
    }

    // Post-stream routing normally gives video precedence when a model emits
    // both calls. Character Creator is image-only and keeps its prepared image
    // prompt authoritative even if the reasoning model also emits a video call.
    protected routeAfterStream(state: ProviderState): 'generate_image' | 'generate_video' | 'skip' {
        if (requiredCapabilityProducedOutput(state)) {
            const generationRequestId = state.generationRun?.generationRequestId
            if (generationRequestId && state.generationRun?.requestKind !== 'media-generation-matrix') {
                this.publisher.mediaGenerationRequestComplete(generationRequestId)
            }
            return 'skip'
        }
        if (state.capabilityMediaExecutionPlan && state.imageModelVersion) return 'generate_image'
        if (state.generatedVideoPrompt) return 'generate_video'
        if (state.generatedImagePrompt) return 'generate_image'
        // A lineage plan was already announced to clients, but no media tool
        // call was emitted — the planned runs will never start. Tell the UI so
        // pending branch markers settle instead of spinning forever.
        if (state.mediaBranchLineagePlan) {
            this.publisher.mediaGenerationSkipped(state.mediaBranchLineagePlan.generationRequestId)
        }
        return 'skip'
    }

    protected async validateImagePromptNode(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.capabilityMediaExecutionPlan) return {}
        const prompt = state.generatedImagePrompt
        if (!prompt) return {}
        const maxChars = getImagePromptMaxChars(state.imageModelMetaInfo, state.imageProviderName)
        if (!maxChars) return {}

        const validationError = toolValidateImagePrompt(
            prompt,
            state.imageModelMetaInfo,
            state.imageProviderName,
        )
        if (!validationError) return {}

        warn(`Image prompt exceeds limit for ${this.instanceKey}: ${validationError}`)
        this.streamPublisher?.error(validationError)
        return {
            generatedImagePrompt: undefined,
            error: validationError,
        }
    }

    protected async executeImageGeneration(state: ProviderState): Promise<Partial<ProviderState>> {
        const providerSafeState = this.sanitizeProviderMediaPrompts(state, state.providerSafeMediaIntent)
        if (providerSafeState.mediaFanoutPlan && providerSafeState.generationRun) {
            return this.executeMediaFanout(providerSafeState)
        }

        const trace = buildImageGenerationTrace(providerSafeState)
        if (trace) {
            try {
                this.streamPublisher?.imageGenerationTrace(trace)
            } catch (error: any) {
                warn(`[BaseProvider] Skipping IMAGE_GENERATION_TRACE publish: ${error?.message ?? String(error)}`)
            }
        }

        if (!providerSafeState.capabilityMediaExecutionPlan) {
            this.assertProviderMediaPayload(providerSafeState, providerSafeState.generatedImagePrompt)
        }
        const imageResult = await this.deps.runImageRouter(providerSafeState, {
            onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
            getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
            onCapabilityMediaTrace: trace =>
                this.publishCapabilityReviewTrace(
                    providerSafeState,
                    { capabilityMediaTrace: trace },
                    providerSafeState.generationRun,
                ),
        })
        if (imageResult.error) {
            this.streamPublisher?.imageGenerationError(imageResult.error, providerSafeState.generationRun)
            this.streamPublisher?.error(imageResult.error, imageResult.errorCode, imageResult.errorType)
        }
        return imageResult
    }

    // Routes a generate_video tool call to the VideoRouter (transient VEO
    // provider). The VEO submit/poll happens synchronously inside the router,
    // emitting VIDEO_PENDING/GENERATING/COMPLETE on the same per-thread subject.
    // The VIDEO_GENERATION_TRACE event is published BEFORE the router runs so
    // chat history can render the tool prompt and explicit reference roles
    // even if the VEO operation later fails.
    protected async executeVideoGeneration(state: ProviderState): Promise<Partial<ProviderState>> {
        const providerSafeState = this.sanitizeProviderMediaPrompts(state, state.providerSafeMediaIntent)
        if (providerSafeState.mediaFanoutPlan && providerSafeState.generationRun) {
            return this.executeMediaFanout(providerSafeState)
        }

        const trace = buildVideoGenerationTrace(providerSafeState)
        if (trace) {
            try {
                this.streamPublisher?.videoGenerationTrace(trace)
            } catch (error: any) {
                warn(`[BaseProvider] Skipping VIDEO_GENERATION_TRACE publish: ${error?.message ?? String(error)}`)
            }
        }

        this.assertProviderMediaPayload(providerSafeState, providerSafeState.generatedVideoPrompt)
        const videoResult = await this.deps.runVideoRouter(providerSafeState, {
            onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
            getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
            ...(this.abortController ? { signal: this.abortController.signal } : {}),
        })
        if (videoResult.error) {
            this.streamPublisher?.error(videoResult.error, videoResult.errorCode, videoResult.errorType)
        }
        return videoResult
    }

    private sanitizeProviderMediaPrompts<T extends Partial<ProviderState>>(
        state: T,
        providerSafeMediaIntent: ProviderState['providerSafeMediaIntent'],
    ): T {
        const bindings = providerSafeMediaIntent?.bindings
        if (!bindings?.length) return state

        const generatedImagePrompt = state.generatedImagePrompt
            ? sanitizeMediaReferenceText(state.generatedImagePrompt, bindings)
            : state.generatedImagePrompt
        const generatedVideoPrompt = state.generatedVideoPrompt
            ? sanitizeMediaReferenceText(state.generatedVideoPrompt, bindings)
            : state.generatedVideoPrompt
        const generatedVideoNegativePrompt = state.generatedVideoNegativePrompt
            ? sanitizeMediaReferenceText(state.generatedVideoNegativePrompt, bindings)
            : state.generatedVideoNegativePrompt
        const configuredVideoNegativePrompt = state.videoGenerationConfig?.negativePrompt
            ? sanitizeMediaReferenceText(state.videoGenerationConfig.negativePrompt, bindings)
            : state.videoGenerationConfig?.negativePrompt
        const videoGenerationConfig = configuredVideoNegativePrompt === state.videoGenerationConfig?.negativePrompt
            ? state.videoGenerationConfig
            : {
                ...state.videoGenerationConfig,
                negativePrompt: configuredVideoNegativePrompt,
            }
        if (
            generatedImagePrompt === state.generatedImagePrompt
            && generatedVideoPrompt === state.generatedVideoPrompt
            && generatedVideoNegativePrompt === state.generatedVideoNegativePrompt
            && videoGenerationConfig === state.videoGenerationConfig
        ) return state

        return {
            ...state,
            generatedImagePrompt,
            generatedVideoPrompt,
            generatedVideoNegativePrompt,
            videoGenerationConfig,
        }
    }

    protected assertProviderMediaPayload(state: ProviderState, prompt: string | undefined): void {
        if (!state.providerSafeMediaIntent || !prompt) return
        assertNoForbiddenMediaReferenceLeak({
            payload: {
                prompt,
                ...(state.generatedVideoNegativePrompt
                    ? { generatedVideoNegativePrompt: state.generatedVideoNegativePrompt }
                    : {}),
                ...(state.videoGenerationConfig?.negativePrompt
                    ? { configuredVideoNegativePrompt: state.videoGenerationConfig.negativePrompt }
                    : {}),
            },
            forbiddenNameVariants: state.providerSafeMediaIntent.forbiddenNameVariants,
        })
    }

    protected async executeMediaFanout(state: ProviderState): Promise<Partial<ProviderState>> {
        if (!state.generationRun || !state.mediaFanoutPlan) return {}

        if (state.generatedVideoPrompt && state.generatedImagePrompt) {
            const [imageResult, videoResult] = await Promise.all([
                this.executeImageFanout(state),
                this.executeVideoFanout(state),
            ])
            return {
                ...imageResult,
                ...videoResult,
                generatedImages: imageResult.generatedImages,
                generatedVideos: videoResult.generatedVideos,
                error: imageResult.error ?? videoResult.error,
                errorCode: imageResult.errorCode ?? videoResult.errorCode,
                errorType: imageResult.errorType ?? videoResult.errorType,
            }
        }
        if (state.generatedVideoPrompt) {
            return this.executeVideoFanout(state)
        }
        if (state.generatedImagePrompt || state.capabilityMediaExecutionPlan) {
            return this.executeImageFanout(state)
        }
        return {}
    }

    private buildMediaRun(
        state: ProviderState,
        mediaModel: AiModelMetaInfo,
        mediaType: 'image' | 'video',
        mediaIndex: number,
        mediaModelCount: number,
    ): MediaGenerationRunMeta | undefined {
        const mediaModelId = this.mediaGenerationRunPlanner.buildMediaModelId(
            mediaModel.provider,
            mediaModel.model,
            mediaModel.modelVersion,
        )
        return this.mediaGenerationRunPlanner.buildProviderMediaRun({
            generationRun: state.generationRun,
            mediaModelId,
            mediaType,
            mediaIndex,
            mediaModelCount,
            lineageAssignments: state.mediaBranchLineagePlan?.runAssignments,
        })
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error)
    }

    private getSettledFanoutResults(settledResults: Array<PromiseSettledResult<FanoutRouterResult>>): FanoutRouterResult[] {
        return settledResults.map((result) => {
            if (result.status === 'fulfilled') return result.value
            return { error: this.getErrorMessage(result.reason) }
        })
    }

    private async executeImageFanout(state: ProviderState): Promise<Partial<ProviderState>> {
        const imageModels = state.mediaFanoutPlan?.imageModels ?? []
        if (imageModels.length === 0) return {}

        const settledResults = await Promise.allSettled(imageModels.map(async (imageModelMetaInfo, imageIndex): Promise<FanoutRouterResult> => {
            const durableRun = state.durableMediaRuns?.find(run => (
                run.reasoningIndex === state.generationRun?.reasoningIndex
                && run.modelId === catalogModelIdFor(imageModelMetaInfo)
            ))
            if (durableRun && ['completed', 'failed', 'cancelled'].includes(durableRun.status)) {
                return { generatedImages: [] }
            }
            const generationRun = this.buildMediaRun(state, imageModelMetaInfo, 'image', imageIndex, imageModels.length)
            const imageModelOptions = state.mediaFanoutPlan?.imageModelOptions?.[catalogModelIdFor(imageModelMetaInfo)]
            let fanoutState: ProviderState = {
                ...state,
                generationRun,
                imageModelMetaInfo,
                imageModelVersion: imageModelMetaInfo.modelVersion,
                imageProviderName: imageModelMetaInfo.provider as ProviderName,
                imageSize: imageModelOptions?.imageSize ?? state.mediaFanoutPlan?.imageSize ?? state.imageSize,
                imageGenerationConfig: imageModelOptions,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
            }
            const replayPrompt = state.mediaFanoutPlan?.replayPrompts?.find(prompt =>
                prompt.mediaType === 'image'
                && prompt.mediaModelId === catalogModelIdFor(imageModelMetaInfo)
            )
            if (replayPrompt) fanoutState.generatedImagePrompt = replayPrompt.finalPrompt
            fanoutState = this.sanitizeProviderMediaPrompts(fanoutState, fanoutState.providerSafeMediaIntent)
            const promptValidationPatch = await this.validateImageFanoutPrompt(fanoutState)
            fanoutState = { ...fanoutState, ...promptValidationPatch }
            if (fanoutState.error || (!fanoutState.generatedImagePrompt && !fanoutState.capabilityMediaExecutionPlan)) {
                const error = fanoutState.error ?? 'Image prompt validation failed for selected image model.'
                this.streamPublisher?.imageGenerationError(error, generationRun)
                return {
                    error,
                    errorCode: fanoutState.errorCode,
                    errorType: fanoutState.errorType,
                    generatedImages: [],
                }
            }

            const trace = buildImageGenerationTrace(fanoutState)
            if (trace) {
                try {
                    this.streamPublisher?.imageGenerationTrace(trace, generationRun)
                } catch (error) {
                    warn(`[BaseProvider] Skipping IMAGE_GENERATION_TRACE publish: ${this.getErrorMessage(error)}`)
                }
            }

            if (!fanoutState.capabilityMediaExecutionPlan) {
                this.assertProviderMediaPayload(fanoutState, fanoutState.generatedImagePrompt)
            }
            const imageResult = await this.deps.runImageRouter(fanoutState, {
                onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
                getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
                onCapabilityMediaTrace: trace =>
                    this.publishCapabilityReviewTrace(
                        fanoutState,
                        { capabilityMediaTrace: trace },
                        generationRun,
                    ),
            })
            if (imageResult.error) {
                this.streamPublisher?.imageGenerationError(imageResult.error, generationRun)
            }
            return {
                error: imageResult.error,
                errorCode: imageResult.errorCode,
                errorType: imageResult.errorType,
                generatedImages: imageResult.generatedImages ?? [],
            }
        }))
        const results = this.getSettledFanoutResults(settledResults)

        const generatedImages = results.flatMap((result) => result.generatedImages ?? [])
        if (generatedImages.length > 0) {
            return { generatedImages }
        }

        const firstError = results.find((result): result is FanoutRouterResult & { error: string } => typeof result.error === 'string' && result.error.length > 0)
        if (!firstError) return {}
        this.streamPublisher?.error(firstError.error, firstError.errorCode, firstError.errorType)
        return {
            error: firstError.error,
            errorCode: firstError.errorCode,
            errorType: firstError.errorType,
        }
    }

    private async validateImageFanoutPrompt(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.capabilityMediaExecutionPlan) return {}
        const prompt = state.generatedImagePrompt
        if (!prompt) return {}
        const maxChars = getImagePromptMaxChars(state.imageModelMetaInfo, state.imageProviderName)
        if (!maxChars) return {}

        const validationError = toolValidateImagePrompt(
            prompt,
            state.imageModelMetaInfo,
            state.imageProviderName,
        )
        if (!validationError) return {}

        return { error: validationError }
    }

    private publishCapabilityReviewTrace(
        state: ProviderState,
        result: Partial<ProviderState>,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        if (!result.capabilityMediaTrace) return
        const trace = buildImageGenerationTrace({ ...state, ...result })
        if (!trace) return
        try {
            this.streamPublisher?.imageGenerationTrace(trace, generationRun)
        } catch (error) {
            warn(`[BaseProvider] Skipping capability review trace publish: ${this.getErrorMessage(error)}`)
        }
    }

    private async executeVideoFanout(state: ProviderState): Promise<Partial<ProviderState>> {
        const videoModels = state.mediaFanoutPlan?.videoModels ?? []
        if (videoModels.length === 0) return {}

        const settledResults = await Promise.allSettled(videoModels.map(async (videoModelMetaInfo, videoIndex): Promise<FanoutRouterResult> => {
            const durableRun = state.durableMediaRuns?.find(run => (
                run.reasoningIndex === state.generationRun?.reasoningIndex
                && run.modelId === catalogModelIdFor(videoModelMetaInfo)
                && run.mediaIndex === videoIndex
            ))
            if (durableRun && ['completed', 'failed', 'cancelled'].includes(durableRun.status)) {
                return { generatedVideos: [] }
            }
            const generationRun = this.buildMediaRun(state, videoModelMetaInfo, 'video', videoIndex, videoModels.length)
            const videoModelOptions = state.mediaFanoutPlan?.videoModelOptions?.[catalogModelIdFor(videoModelMetaInfo)]
            const normalizedVideoAspectRatio = normalizeModelOption(
                videoModelOptions?.aspectRatio ?? state.mediaFanoutPlan?.videoAspectRatio ?? state.videoAspectRatio,
                videoModelMetaInfo.videoAspectRatios as Array<{ value?: string; label?: string }> | undefined,
            )
            const normalizedVideoResolution = normalizeModelOption(
                videoModelOptions?.resolution ?? state.mediaFanoutPlan?.videoResolution ?? state.videoResolution,
                videoModelMetaInfo.videoResolutions as Array<{ value?: string; label?: string }> | undefined,
            )
            const normalizedVideoDuration = normalizeModelOption(
                videoModelOptions?.duration ?? state.mediaFanoutPlan?.videoDuration ?? state.mediaFanoutPlan?.videoDurationSeconds ?? state.videoDurationSeconds,
                videoModelMetaInfo.videoDurations as Array<{ value?: string; label?: string }> | undefined,
            )
            const replayPrompt = state.mediaFanoutPlan?.replayPrompts?.find(prompt =>
                prompt.mediaType === 'video'
                && prompt.mediaModelId === catalogModelIdFor(videoModelMetaInfo)
            )
            let fanoutState: ProviderState = {
                ...state,
                generationRun,
                videoModelMetaInfo,
                videoModelVersion: videoModelMetaInfo.modelVersion,
                videoProviderName: videoModelMetaInfo.provider as ProviderName,
                videoAspectRatio: normalizedVideoAspectRatio,
                videoResolution: normalizedVideoResolution,
                videoDurationSeconds: normalizedVideoDuration ? Number(normalizedVideoDuration) : undefined,
                videoGenerationConfig: videoModelOptions,
                videoSourceForExtension: state.mediaFanoutPlan?.videoSourceForExtension ?? state.videoSourceForExtension,
                videoSourceDurationSeconds: state.videoSourceDurationSeconds,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
                ...(replayPrompt ? { generatedVideoPrompt: replayPrompt.finalPrompt } : {}),
            }
            fanoutState = this.sanitizeProviderMediaPrompts(fanoutState, fanoutState.providerSafeMediaIntent)

            const trace = buildVideoGenerationTrace(fanoutState)
            if (trace) {
                try {
                    this.streamPublisher?.videoGenerationTrace(trace, generationRun)
                } catch (error) {
                    warn(`[BaseProvider] Skipping VIDEO_GENERATION_TRACE publish: ${this.getErrorMessage(error)}`)
                }
            }

            this.assertProviderMediaPayload(fanoutState, fanoutState.generatedVideoPrompt)
            const videoResult = await this.deps.runVideoRouter(fanoutState, {
                onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
                getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
                ...(this.abortController ? { signal: this.abortController.signal } : {}),
            })
            return {
                error: videoResult.error,
                errorCode: videoResult.errorCode,
                errorType: videoResult.errorType,
                generatedVideos: videoResult.generatedVideos ?? [],
            }
        }))
        const results = this.getSettledFanoutResults(settledResults)

        const generatedVideos = results.flatMap((result) => result.generatedVideos ?? [])
        if (generatedVideos.length > 0) {
            return { generatedVideos }
        }

        const firstError = results.find((result): result is FanoutRouterResult & { error: string } => typeof result.error === 'string' && result.error.length > 0)
        if (!firstError) return {}
        this.streamPublisher?.error(firstError.error, firstError.errorCode, firstError.errorType)
        return {
            error: firstError.error,
            errorCode: firstError.errorCode,
            errorType: firstError.errorType,
        }
    }

    protected async calculateUsage(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.error) return {}

        // Confirm one provider call per modality, each with a 1-based workflowSeq
        // under the run's workflowId (for grouping/display). confirm is awaited but
        // best-effort — the client logs failures rather than failing the completed
        // request. workflowId is only set when the check admitted the run (enabled).
        const metricsOn = !!(this.deps.metrics?.enabled && state.workflowId)
        let seq = state.workflowSeq ?? 0

        if (state.usage) {
            const report = this.deps.usageReporter.reportTokensUsage({
                eventMeta: state.eventMeta,
                aiModelMetaInfo: state.aiModelMetaInfo,
                aiVendorRequestId: state.aiVendorRequestId ?? 'unknown',
                aiVendorModelName: state.modelVersion,
                usage: state.usage,
                aiRequestReceivedAt: state.aiRequestReceivedAt,
                aiRequestFinishedAt: state.aiRequestFinishedAt ?? Date.now(),
            })
            if (metricsOn && report) {
                await this.confirmUsage(
                    { ...tokenUsageConfirm(report, state.workflowId!, ++seq), operationId: state.metricsOperationId },
                    report.total,
                )
            }
        }
        if (state.imageUsage) {
            const report = this.deps.usageReporter.reportImageUsage({
                eventMeta: state.eventMeta,
                aiModelMetaInfo: state.aiModelMetaInfo,
                aiVendorRequestId: state.aiVendorRequestId ?? 'unknown',
                imageSize: state.imageUsage.size,
                imageQuality: state.imageUsage.quality,
                aiRequestReceivedAt: state.aiRequestReceivedAt,
                aiRequestFinishedAt: state.aiRequestFinishedAt ?? Date.now(),
            })
            if (metricsOn && report) {
                await this.confirmUsage(
                    { ...imageUsageConfirm(report, state.workflowId!, ++seq), operationId: state.metricsOperationId },
                    report.image,
                )
            }
        }
        if (state.videoUsage) {
            const report = this.deps.usageReporter.reportVideoUsage({
                eventMeta: state.eventMeta,
                aiModelMetaInfo: state.videoModelMetaInfo ?? state.aiModelMetaInfo,
                aiVendorRequestId: state.aiVendorRequestId ?? 'unknown',
                durationSeconds: state.videoUsage.durationSeconds,
                resolution: state.videoUsage.resolution,
                aspectRatio: state.videoUsage.aspectRatio,
                totalTokens: state.videoUsage.totalTokens,
                completionTokens: state.videoUsage.completionTokens,
                inputVideoSeconds: state.videoSourceForExtension ? state.videoSourceDurationSeconds : undefined,
                aiRequestReceivedAt: state.aiRequestReceivedAt,
                aiRequestFinishedAt: state.aiRequestFinishedAt ?? Date.now(),
            })
            if (metricsOn && report) {
                await this.confirmUsage(
                    { ...videoUsageConfirm(report, state.workflowId!, ++seq), operationId: state.metricsOperationId },
                    report.video,
                )
            }
        }
        return { workflowSeq: seq }
    }

    // Posts one measured provider call and logs it in the same shape as its
    // matching check, so the pair reads together in the log. The reporter has
    // already priced the call locally; that cost travels to the log only, never
    // over the wire, because the metering backend owns pricing.
    private async confirmUsage(
        request: ConfirmRequest,
        cost: { purchasedFor: string; soldToClientFor: string },
    ): Promise<void> {
        const response = await this.deps.metrics!.confirm(request)
        logUsageConfirm({
            request,
            response,
            purchasedFor: cost.purchasedFor,
            soldToClientFor: cost.soldToClientFor,
        })
    }

    protected async cleanup(_state: ProviderState): Promise<Partial<ProviderState>> {
        let terminalSweepError: unknown
        if (this.ownsDurableMediaRequestLifecycle(_state)) {
            try {
                await this.failUnfinishedDurableRuns(_state)
            } catch (error) {
                terminalSweepError = error
                err(`[BaseProvider] Failed to settle unfinished durable runs for ${this.instanceKey}:`, error)
            }
            this.streamPublisher?.completeKnownMediaGenerationRequests()
        }
        await this.streamPublisher?.drainPendingWrites()
        await this.streamPublisher?.finishProseMirrorStream()
        if (terminalSweepError) throw terminalSweepError
        return {}
    }

    private ownsDurableMediaRequestLifecycle(state: ProviderState): boolean {
        return !state.enableImageGeneration
            && !state.enableVideoGeneration
            && state.generationRun?.requestKind !== 'media-generation-matrix'
    }

    private async failUnfinishedDurableRuns(state: ProviderState): Promise<void> {
        if (!state.durableGenerationRequestId) return
        await new MediaGenerationRequestService().failUnfinishedRuns({
            generationRequestId: state.durableGenerationRequestId,
            workspaceId: state.workspaceId,
        })
    }

    // -- Helpers exposed to subclasses --

    protected get nats(): NatsService {
        return this.deps.natsService
    }

    protected get publisher(): StreamPublisher {
        if (!this.streamPublisher) throw new Error('StreamPublisher not initialized')
        return this.streamPublisher
    }

    protected get imagePub(): ImagePublisher {
        if (!this.imagePublisher) throw new Error('ImagePublisher not initialized')
        return this.imagePublisher
    }

    protected get videoPub(): VideoPublisher {
        if (!this.videoPublisher) throw new Error('VideoPublisher not initialized')
        return this.videoPublisher
    }

    // Seed for a provider that accepts one. A generation continuing or
    // referencing an earlier generated Asset reuses that Asset's seed; everything
    // else gets a fresh one. `maxValue` is the calling provider's accepted range.
    //
    // Regenerating an output is the exception: the user is asking for a different
    // take, and reusing the source seed would return what they already rejected.
    protected async resolveGenerationSeed(state: ProviderState, maxValue: number): Promise<number> {
        const assetId = state.generationRun?.lineageAssignment?.assetId
        const isRegeneration = state.isMediaRegenerationRun
            || Boolean(state.mediaBranchLineagePlan?.regenerationTarget)
        if (!assetId || isRegeneration) {
            return generateMediaGenerationSeed(maxValue)
        }
        try {
            const inheritedSeed = await resolveInheritedGenerationSeed({ assetId, maxValue })
            if (inheritedSeed !== undefined) {
                info(`[BaseProvider] reusing inherited generation seed ${
                    JSON.stringify(
                        {
                            assetId,
                            inheritedSeed,
                        },
                        null,
                        0,
                    )
                }`)
                return inheritedSeed
            }
        } catch (error) {
            // A lineage read failure must not block generation; a fresh seed is
            // always a valid request.
            warn(`[BaseProvider] inherited seed lookup failed: ${this.getErrorMessage(error)}`)
        }
        return generateMediaGenerationSeed(maxValue)
    }

    protected get signal(): AbortSignal {
        if (!this.abortController) throw new Error('AbortController not initialized')
        return this.abortController.signal
    }

    protected get shouldStop(): boolean {
        return this.abortController?.signal.aborted ?? false
    }

    // Error class names this provider's SDK uses for a connection failure, on
    // top of the Node socket codes every provider shares through fetch.
    // Providers whose SDK reaches the network with bare fetch add nothing.
    protected get transportFaultNames(): readonly string[] {
        return []
    }

    // Bounded reconnect around a single provider network operation. Wrap only
    // work that is safe to run again from the start; an attempt that publishes
    // as it goes must call markPublished() at its first emission.
    protected async retryTransport<T>(
        operation: string,
        attempt: (context: TransportRetryAttempt) => Promise<T>,
    ): Promise<T> {
        return await withTransportRetry({
            label: `${this.providerName}:${operation}:${this.instanceKey}`,
            faultNames: this.transportFaultNames,
            signal: this.abortController?.signal,
            shouldStop: () => this.shouldStop,
            attempt,
        })
    }
}
