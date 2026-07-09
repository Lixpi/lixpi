'use strict'

import { v4 as uuid } from 'uuid'
import { StateGraph, END, START } from '@langchain/langgraph'

import type NatsService from '@lixpi/nats-service'
import { info, warn, err } from '@lixpi/debug-tools'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName, type StreamStatus } from '@lixpi/constants'

import type { MetricsClient } from '../../metrics/metrics-client.ts'
import type { Modality } from '../../metrics/contracts.ts'

import { LLM_TIMEOUT_MS } from '../config.ts'
import { channels, type AiModelMetaInfo, type ProviderState } from '../graph/state.ts'
import { StreamPublisher, type ProseMirrorContentHandler, type ProseMirrorSnapshotProvider } from '../graph/stream-publisher.ts'
import { ImagePublisher, type StoreWorkspaceImageFn } from '../graph/image-publisher.ts'
import { VideoPublisher, type StoreWorkspaceVideoFn } from '../graph/video-publisher.ts'
import { UsageReporter } from '../usage/usage-reporter.ts'
import {
    getImagePromptMaxChars,
    validateImagePrompt as toolValidateImagePrompt,
} from '../tools/image-generation.ts'
import { buildImageGenerationTrace } from '../tools/image-generation-trace.ts'
import { buildVideoGenerationTrace } from '../tools/video-generation-trace.ts'
import { resolveWorkspaceContext } from '../graph/workspace-context-resolver.ts'
import { resolveFeatures } from '../graph/feature-resolver.ts'
import { resolveMediaBranch } from '../graph/media-branch-resolver.ts'
import { tokenUsageConfirm, imageUsageConfirm, videoUsageConfirm } from '../usage/usage-event-mapper.ts'
import { MediaBranchLineagePlanner } from '../lineage/media-branch-lineage-planner.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'

export type BaseProviderDeps = {
    natsService: NatsService
    storeWorkspaceImage: StoreWorkspaceImageFn
    storeWorkspaceVideo: StoreWorkspaceVideoFn
    usageReporter: UsageReporter
    runImageRouter: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>
    runVideoRouter: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>
    // Metrics (optional — absent/disabled = the open-source plug, i.e. today's
    // behavior). The synchronous check/confirm run on the workflow path via this
    // abstract metering client (see metrics/metrics-client.ts).
    metrics?: MetricsClient
}

type FanoutRouterResult = Pick<ProviderState,
    'error' |
    'errorCode' |
    'errorType' |
    'generatedImages' |
    'generatedVideos'
>

type MediaRouterOptions = {
    onProseMirrorContent?: ProseMirrorContentHandler
    getProseMirrorSnapshot?: ProseMirrorSnapshotProvider
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

const catalogModelIdFor = (model: AiModelMetaInfo): string =>
    `${model.provider}:${model.model}`

// modalityForKind maps a workflow kind to the metering modality the check sends.
const modalityForKind = (kind: string): Modality =>
    kind === 'chat_video' ? 'video' : kind === 'chat_image' ? 'image' : 'tokens'

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
// Extraction runs have their own dedicated graph in src/llm/extraction/; this graph is
// for chat threads and image generation only. The resolveFeatures pre-stage handles
// /use chip resolution by injecting Feature definitions + source crops into state.messages.
// Top-level chat requests publish START_STREAM before graph invocation so expensive
// pre-stream VLM/image preprocessing never leaves the browser looking frozen.
// Transient image-model providers skip their own stream lifecycle because the parent
// chat stream owns it.
//
// Topology:
//   START → resolveWorkspaceContext → resolveFeatures → resolveMediaBranch → planMediaBranchLineage → validateRequest → streamTokens → [conditional]
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
    private pipelineProseMirrorContentHandler: ProseMirrorContentHandler | undefined
    private pipelineProseMirrorSnapshotProvider: ProseMirrorSnapshotProvider | undefined

    constructor(
        protected readonly _instanceKey: string,
        protected readonly deps: BaseProviderDeps,
    ) {
        this.instanceKey = _instanceKey
        this.app = this.buildWorkflow().compile()
    }

    private publishPipelineProseMirrorContent(content: Parameters<ProseMirrorContentHandler>[0]): void {
        if (this.pipelineProseMirrorContentHandler) {
            this.pipelineProseMirrorContentHandler(content)
            if (LIVE_MIRRORED_MEDIA_STATUSES.has(content.status)) {
                info('[BaseProvider][pipeline-content] live-publish-mirrored-media', {
                    instanceKey: this.instanceKey,
                    status: content.status,
                    generationRequestId: content.generationRun?.generationRequestId ?? '',
                    reasoningRunId: content.generationRun?.reasoningRunId ?? '',
                    mediaRunId: content.generationRun?.mediaRunId ?? '',
                    mediaModelId: content.generationRun?.mediaModelId ?? '',
                    partialIndex: content.partialIndex ?? null,
                    hasCanvasGeometry: Boolean(content.canvasGeometry),
                })
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
            .addNode('resolveWorkspaceContext', async (s: ProviderState) => s.preflightResolved ? {} : resolveWorkspaceContext(s, {
                natsService: this.nats,
                publisher: this.publisher,
                abortSignal: this.signal,
            }))
            .addNode('resolveFeatures', async (s: ProviderState) => s.preflightResolved ? {} : resolveFeatures(s))
            .addNode('resolveMediaBranch', async (s: ProviderState) => s.preflightResolved ? {} : resolveMediaBranch(s, {
                natsService: this.nats,
                publisher: this.publisher,
                abortSignal: this.signal,
            }))
            .addNode('planMediaBranchLineage', async (s: ProviderState) => s.preflightResolved ? {} : this.planMediaBranchLineage(s))
            .addNode('validateRequest', async (s: ProviderState) => this.validateRequest(s))
            .addNode('streamTokens', async (s: ProviderState) => this.streamTokens(s))
            .addNode('validateImagePrompt', async (s: ProviderState) => this.validateImagePromptNode(s))
            .addNode('executeImageGeneration', async (s: ProviderState) => this.executeImageGeneration(s))
            .addNode('executeVideoGeneration', async (s: ProviderState) => this.executeVideoGeneration(s))
            .addNode('calculateUsage', async (s: ProviderState) => this.calculateUsage(s))
            .addNode('cleanup', async (s: ProviderState) => this.cleanup(s))

        graph.addEdge(START, 'resolveWorkspaceContext' as any)
        graph.addEdge('resolveWorkspaceContext' as any, 'resolveFeatures' as any)
        graph.addEdge('resolveFeatures' as any, 'resolveMediaBranch' as any)
        graph.addEdge('resolveMediaBranch' as any, 'planMediaBranchLineage' as any)
        graph.addEdge('planMediaBranchLineage' as any, 'validateRequest' as any)
        graph.addEdge('validateRequest' as any, 'streamTokens' as any)
        graph.addConditionalEdges(
            'streamTokens' as any,
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
        this.abortController = new AbortController()
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
        const onPipelineContent: ProseMirrorContentHandler = content => this.publishPipelineProseMirrorContent(content)
        const getProseMirrorSnapshot: ProseMirrorSnapshotProvider = () => this.getPipelineProseMirrorSnapshot()
        this.streamPublisher = new StreamPublisher(
            this.deps.natsService,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
            requestData.generationRun,
            {
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
            this.deps.storeWorkspaceImage,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
            requestData.generationRun,
            undefined,
            onPipelineContent,
            requestData.canvasVisibleArea,
            getProseMirrorSnapshot,
        )
        this.videoPublisher = new VideoPublisher(
            this.deps.natsService,
            this.deps.storeWorkspaceVideo,
            this.deps.storeWorkspaceImage,
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
            streamActive: false,
            aiRequestReceivedAt: Date.now(),
            enableImageGeneration: requestData.enableImageGeneration ?? false,
            imageSize: requestData.imageSize ?? 'auto',
            imageModelMetaInfo: requestData.imageModelMetaInfo,
            imageModelVersion: requestData.imageModelMetaInfo?.modelVersion,
            imageProviderName: requestData.imageModelMetaInfo?.provider,
            imagePromptRetryCount: 0,
            workspaceContextSnapshot: requestData.workspaceContextSnapshot,
            workspaceContextResolution: requestData.workspaceContextResolution,
            mediaBranchCandidateSnapshot: requestData.mediaBranchCandidateSnapshot,
            mediaBranchResolution: requestData.mediaBranchResolution,
            mediaBranchLineagePlan: requestData.mediaBranchLineagePlan,
            canvasVisibleArea: requestData.canvasVisibleArea,
            referencedFeatureIds: requestData.referencedFeatureIds,
            featureReferenceImages: requestData.featureReferenceImages,
            featureReferenceImageTraceUrls: requestData.featureReferenceImageTraceUrls,
            featureUsagePrompt: requestData.featureUsagePrompt,
            enableVideoGeneration: requestData.enableVideoGeneration ?? false,
            videoModelMetaInfo: requestData.videoModelMetaInfo,
            videoModelVersion: requestData.videoModelMetaInfo?.modelVersion,
            videoProviderName: requestData.videoModelMetaInfo?.provider,
            videoAspectRatio: requestData.videoAspectRatio,
            videoResolution: requestData.videoResolution,
            videoDurationSeconds: requestData.videoDurationSeconds,
            videoFirstFrameImage: requestData.videoFirstFrameImage,
            videoReferenceImages: requestData.videoReferenceImages,
            videoSourceForExtension: requestData.videoSourceForExtension,
            generationRun: requestData.generationRun,
            mediaFanoutPlan: requestData.mediaFanoutPlan,
            preflightResolved: requestData.preflightResolved ?? false,
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
            if (this.abortController.signal.aborted) {
                err(`Circuit breaker / abort fired for ${this.instanceKey}: ${message}`)
            } else {
                err(`Workflow failed for ${this.instanceKey}: ${message}`)
            }
            this.streamPublisher.error(message)
            this.streamPublisher.completeKnownMediaGenerationRequests()
            this.streamPublisher.end()
            await this.streamPublisher.drainPendingWrites()
            await this.streamPublisher.finishProseMirrorStream()
            return {
                ...initialState,
                error: message,
                streamActive: false,
                aiRequestFinishedAt: Date.now(),
            }
        } finally {
            clearTimeout(timeoutHandle)
        }
    }

    async stop(): Promise<void> {
        info(`Stopping stream for instance: ${this.instanceKey}`)
        this.abortController?.abort(new Error('Stopped by user'))
    }

    // -- Workflow nodes (shared) --

    protected async planMediaBranchLineage(state: ProviderState): Promise<Partial<ProviderState>> {
        if (!state.imageModelVersion && !state.videoModelVersion) return {}
        if (state.mediaBranchLineagePlan) return {}

        const generationRun = this.mediaGenerationRunPlanner.buildSingleReasoningRun({
            existingRun: state.generationRun,
            eventMeta: state.eventMeta,
            provider: state.provider,
            modelName: state.aiModelMetaInfo.model,
            modelVersion: state.modelVersion,
        })
        const imageModelId = state.imageModelVersion && state.imageProviderName
            ? this.mediaGenerationRunPlanner.buildMediaModelId(state.imageProviderName, state.imageModelMetaInfo?.model, state.imageModelVersion)
            : undefined
        const videoModelId = state.videoModelVersion && state.videoProviderName
            ? this.mediaGenerationRunPlanner.buildMediaModelId(state.videoProviderName, state.videoModelMetaInfo?.model, state.videoModelVersion)
            : undefined
        const lineagePlan = this.mediaBranchLineagePlanner.buildPlan({
            generationRequestId: generationRun.generationRequestId,
            reasoningModelIds: [generationRun.reasoningModelId],
            ...(imageModelId ? { imageModelIds: [imageModelId] } : {}),
            ...(videoModelId ? { videoModelIds: [videoModelId] } : {}),
            mediaBranchCandidateSnapshot: state.mediaBranchCandidateSnapshot,
            mediaBranchResolution: state.mediaBranchResolution,
            workspaceContextSnapshot: state.workspaceContextSnapshot,
            createdAt: Date.now(),
        })
        const lineageAssignment = lineagePlan.runAssignments.find(
            assignment => assignment.reasoningRunId === generationRun.reasoningRunId
        )
        const nextGenerationRun: MediaGenerationRunMeta = {
            ...generationRun,
            ...(lineageAssignment ? { lineageAssignment } : {}),
        }

        this.streamPublisher?.mediaLineagePlanned(lineagePlan, nextGenerationRun)
        info(`[BaseProvider] media branch lineage planned ${JSON.stringify({
            workspaceId: state.workspaceId,
            aiChatThreadId: state.aiChatThreadId,
            generationRequestId: lineagePlan.generationRequestId,
            branchId: lineagePlan.branchId,
            branchOriginNodeId: lineagePlan.branchOrigin?.nodeId,
            branchForkCount: lineagePlan.branchForks.length,
            runAssignmentCount: lineagePlan.runAssignments.length,
        }, null, 0)}`)

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
        return this.metricsCheck(state)
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

        const res = await metrics.check({
            orgId,
            userId,
            workspaceId: state.workspaceId,
            workflowId,
            model: state.modelVersion ?? '',
            modality: modalityForKind(workflowKind),
            // Best-effort upper bound; a real per-model estimate is a growth point
            // (the metering backend prices conservatively from the model).
            estimatedUnits: 0,
            currency: 'USD',
        })
        if (!res.approved) {
            const reason = res.reason ? `: ${res.reason}` : ''
            throw new Error(`Metrics: balance does not cover this workflow (${workflowKind}${reason})`)
        }
        // Thread the operationId from the check into graph state so the confirm(s)
        // can correlate back to this admission.
        return { workflowId, workflowSeq: 0, metricsOperationId: res.operationId }
    }

    // The run's gate kind is its broadest enabled modality — gating conservatively
    // so a run that may escalate to image/video is checked against that ceiling.
    private deriveWorkflowKind(state: ProviderState): string {
        if (state.enableVideoGeneration) return 'chat_video'
        if (state.enableImageGeneration) return 'chat_image'
        return 'chat_text'
    }

    // Subclasses implement streamImpl(state) and return partial-state updates (usage, response_id, etc.).
    protected async streamTokens(state: ProviderState): Promise<Partial<ProviderState>> {
        const update: Partial<ProviderState> = { streamActive: true }
        try {
            const implResult = await this.streamImpl(state)
            return {
                ...update,
                ...implResult,
                streamActive: false,
                aiRequestFinishedAt: Date.now(),
            }
        } catch (e: any) {
            const message = e?.message ?? String(e)
            err(`Streaming error (${this.providerName}): ${message}`)
            try {
                this.streamPublisher?.error(message)
                this.streamPublisher?.completeKnownMediaGenerationRequests()
                this.streamPublisher?.end()
                await this.streamPublisher?.drainPendingWrites()
            } catch { }
            return {
                ...update,
                streamActive: false,
                aiRequestFinishedAt: Date.now(),
                error: message,
            }
        }
    }

    protected abstract streamImpl(state: ProviderState): Promise<Partial<ProviderState>>

    protected shouldGenerateImage(state: ProviderState): 'generate_image' | 'skip' {
        return state.generatedImagePrompt ? 'generate_image' : 'skip'
    }

    // Post-stream routing: a generate_video tool call takes precedence, then
    // generate_image, else skip straight to usage. The text model normally emits
    // at most one media tool call per turn.
    protected routeAfterStream(state: ProviderState): 'generate_image' | 'generate_video' | 'skip' {
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

        const retryCount = state.imagePromptRetryCount ?? 0
        warn(`Image prompt exceeds limit for ${this.instanceKey}: ${validationError}`)

        if (retryCount < 1) {
            try {
                const rewritten = await this.rewriteImagePromptToFitLimit(state, prompt, maxChars)
                if (rewritten) {
                    const trimmed = rewritten.trim()
                    const retryError = toolValidateImagePrompt(
                        trimmed,
                        state.imageModelMetaInfo,
                        state.imageProviderName,
                    )
                    if (!retryError) {
                        info(`Image prompt rewritten under limit for ${this.instanceKey} after retry`)
                        return {
                            generatedImagePrompt: trimmed,
                            imagePromptRetryCount: retryCount + 1,
                        }
                    }
                }
            } catch (e) {
                err(`Image prompt rewrite failed for ${this.instanceKey}: ${e}`)
            }
        }

        // Give up: clear the prompt so the conditional edge routes to "skip"
        // and surface the error to the client.
        this.streamPublisher?.error(validationError)
        return {
            generatedImagePrompt: undefined,
            error: validationError,
        }
    }

    // Default no-op. OpenAI and Anthropic override to short-circuit a tool call to themselves.
    protected async rewriteImagePromptToFitLimit(
        _state: ProviderState,
        _prompt: string,
        _maxChars: number,
    ): Promise<string | undefined> {
        return undefined
    }

    protected async executeImageGeneration(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.mediaFanoutPlan && state.generationRun) {
            return this.executeMediaFanout(state)
        }

        const trace = buildImageGenerationTrace(state)
        if (trace) {
            try {
                this.streamPublisher?.imageGenerationTrace(trace)
            } catch (error: any) {
                warn(`[BaseProvider] Skipping IMAGE_GENERATION_TRACE publish: ${error?.message ?? String(error)}`)
            }
        }

        const imageResult = await this.deps.runImageRouter(state, {
            onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
            getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
        })
        if (imageResult.error) {
            this.streamPublisher?.imageGenerationError(imageResult.error, state.generationRun)
            this.streamPublisher?.error(imageResult.error, imageResult.errorCode, imageResult.errorType)
        }
        return imageResult
    }

    // Routes a generate_video tool call to the VideoRouter (transient VEO
    // provider). The VEO submit/poll happens synchronously inside the router,
    // emitting VIDEO_PENDING/GENERATING/COMPLETE on the same per-thread subject.
    // The VIDEO_GENERATION_TRACE event is published BEFORE the router runs so
    // chat history can render the tool prompt + selected/excluded references
    // even if the VEO operation later fails.
    protected async executeVideoGeneration(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.mediaFanoutPlan && state.generationRun) {
            return this.executeMediaFanout(state)
        }

        const trace = buildVideoGenerationTrace(state)
        if (trace) {
            try {
                this.streamPublisher?.videoGenerationTrace(trace)
            } catch (error: any) {
                warn(`[BaseProvider] Skipping VIDEO_GENERATION_TRACE publish: ${error?.message ?? String(error)}`)
            }
        }

        const videoResult = await this.deps.runVideoRouter(state, {
            onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
            getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
        })
        if (videoResult.error) {
            this.streamPublisher?.error(videoResult.error, videoResult.errorCode, videoResult.errorType)
        }
        return videoResult
    }

    protected async executeMediaFanout(state: ProviderState): Promise<Partial<ProviderState>> {
        if (!state.generationRun || !state.mediaFanoutPlan) return {}

        if (state.generatedVideoPrompt) {
            return this.executeVideoFanout(state)
        }
        if (state.generatedImagePrompt) {
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
            const generationRun = this.buildMediaRun(state, imageModelMetaInfo, 'image', imageIndex, imageModels.length)
            const imageModelOptions = state.mediaFanoutPlan?.imageModelOptions?.[catalogModelIdFor(imageModelMetaInfo)]
            let fanoutState: ProviderState = {
                ...state,
                generationRun,
                imageModelMetaInfo,
                imageModelVersion: imageModelMetaInfo.modelVersion,
                imageProviderName: imageModelMetaInfo.provider as ProviderName,
                imageSize: imageModelOptions?.imageSize ?? state.mediaFanoutPlan?.imageSize ?? state.imageSize,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
            }
            const promptValidationPatch = await this.validateImageFanoutPrompt(fanoutState)
            fanoutState = { ...fanoutState, ...promptValidationPatch }
            if (fanoutState.error || !fanoutState.generatedImagePrompt) {
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

            const imageResult = await this.deps.runImageRouter(fanoutState, {
                onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
                getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
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

        const firstError = results.find((result): result is FanoutRouterResult & { error: string } =>
            typeof result.error === 'string' && result.error.length > 0
        )
        if (!firstError) return {}
        this.streamPublisher?.error(firstError.error, firstError.errorCode, firstError.errorType)
        return {
            error: firstError.error,
            errorCode: firstError.errorCode,
            errorType: firstError.errorType,
        }
    }

    private async validateImageFanoutPrompt(state: ProviderState): Promise<Partial<ProviderState>> {
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

        try {
            const rewritten = await this.rewriteImagePromptToFitLimit(state, prompt, maxChars)
            if (rewritten) {
                const trimmed = rewritten.trim()
                const retryError = toolValidateImagePrompt(
                    trimmed,
                    state.imageModelMetaInfo,
                    state.imageProviderName,
                )
                if (!retryError) return { generatedImagePrompt: trimmed }
                return { error: retryError }
            }
        } catch (error) {
            warn(`[BaseProvider] Image fanout prompt rewrite failed for ${this.instanceKey}: ${this.getErrorMessage(error)}`)
        }

        return { error: validationError }
    }

    private async executeVideoFanout(state: ProviderState): Promise<Partial<ProviderState>> {
        const videoModels = state.mediaFanoutPlan?.videoModels ?? []
        if (videoModels.length === 0) return {}

        const settledResults = await Promise.allSettled(videoModels.map(async (videoModelMetaInfo, videoIndex): Promise<FanoutRouterResult> => {
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
            const fanoutState: ProviderState = {
                ...state,
                generationRun,
                videoModelMetaInfo,
                videoModelVersion: videoModelMetaInfo.modelVersion,
                videoProviderName: videoModelMetaInfo.provider as ProviderName,
                videoAspectRatio: normalizedVideoAspectRatio,
                videoResolution: normalizedVideoResolution,
                videoDurationSeconds: normalizedVideoDuration ? Number(normalizedVideoDuration) : undefined,
                videoSourceForExtension: state.mediaFanoutPlan?.videoSourceForExtension ?? state.videoSourceForExtension,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
            }

            const trace = buildVideoGenerationTrace(fanoutState)
            if (trace) {
                try {
                    this.streamPublisher?.videoGenerationTrace(trace, generationRun)
                } catch (error) {
                    warn(`[BaseProvider] Skipping VIDEO_GENERATION_TRACE publish: ${this.getErrorMessage(error)}`)
                }
            }

            const videoResult = await this.deps.runVideoRouter(fanoutState, {
                onProseMirrorContent: content => this.publishPipelineProseMirrorContent(content),
                getProseMirrorSnapshot: () => this.getPipelineProseMirrorSnapshot(),
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

        const firstError = results.find((result): result is FanoutRouterResult & { error: string } =>
            typeof result.error === 'string' && result.error.length > 0
        )
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
                await this.deps.metrics!.confirm({ ...tokenUsageConfirm(report, state.workflowId!, ++seq), operationId: state.metricsOperationId })
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
                await this.deps.metrics!.confirm({ ...imageUsageConfirm(report, state.workflowId!, ++seq), operationId: state.metricsOperationId })
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
                aiRequestReceivedAt: state.aiRequestReceivedAt,
                aiRequestFinishedAt: state.aiRequestFinishedAt ?? Date.now(),
            })
            if (metricsOn && report) {
                await this.deps.metrics!.confirm({ ...videoUsageConfirm(report, state.workflowId!, ++seq), operationId: state.metricsOperationId })
            }
        }
        return { workflowSeq: seq }
    }

    protected async cleanup(_state: ProviderState): Promise<Partial<ProviderState>> {
        this.streamPublisher?.completeKnownMediaGenerationRequests()
        await this.streamPublisher?.drainPendingWrites()
        await this.streamPublisher?.finishProseMirrorStream()
        return {}
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

    protected get signal(): AbortSignal {
        if (!this.abortController) throw new Error('AbortController not initialized')
        return this.abortController.signal
    }

    protected get shouldStop(): boolean {
        return this.abortController?.signal.aborted ?? false
    }
}
