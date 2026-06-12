'use strict'

import { v4 as uuid } from 'uuid'
import { StateGraph, END, START } from '@langchain/langgraph'

import type NatsService from '@lixpi/nats-service'
import { info, warn, err } from '@lixpi/debug-tools'
import type { ProviderName } from '@lixpi/constants'

import type { BillingClient } from '../../billing/billing-client.ts'
import type { Allowance } from '../../billing/contracts.ts'

import { LLM_TIMEOUT_MS } from '../config.ts'
import { channels, type ProviderState } from '../graph/state.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
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
import { resolveImageBranch } from '../graph/image-branch-resolver.ts'
import { tokenUsageEvent, imageUsageEvent, videoUsageEvent } from '../usage/usage-event-mapper.ts'

export type BaseProviderDeps = {
    natsService: NatsService
    storeWorkspaceImage: StoreWorkspaceImageFn
    storeWorkspaceVideo: StoreWorkspaceVideoFn
    usageReporter: UsageReporter
    runImageRouter: (state: ProviderState) => Promise<Partial<ProviderState>>
    runVideoRouter: (state: ProviderState) => Promise<Partial<ProviderState>>
    // Billing (optional — absent/disabled means today's behavior). The gate reads
    // the allowance locally; it never calls billing on the workflow path.
    billing?: BillingClient
    getOrgAllowance?: (userId: string) => Promise<Allowance | undefined>
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
//   START → resolveWorkspaceContext → resolveFeatures → resolveImageBranch → validateRequest → streamTokens → [conditional]
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

    constructor(
        protected readonly _instanceKey: string,
        protected readonly deps: BaseProviderDeps,
    ) {
        this.instanceKey = _instanceKey
        this.app = this.buildWorkflow().compile()
    }

    private buildWorkflow() {
        const graph = new StateGraph<ProviderState>({ channels: channels as any })
            .addNode('resolveWorkspaceContext', async (s: ProviderState) => resolveWorkspaceContext(s, {
                natsService: this.nats,
                publisher: this.publisher,
                abortSignal: this.signal,
            }))
            .addNode('resolveFeatures', async (s: ProviderState) => resolveFeatures(s))
            .addNode('resolveImageBranch', async (s: ProviderState) => resolveImageBranch(s, {
                natsService: this.nats,
                publisher: this.publisher,
                abortSignal: this.signal,
            }))
            .addNode('validateRequest', async (s: ProviderState) => this.validateRequest(s))
            .addNode('streamTokens', async (s: ProviderState) => this.streamTokens(s))
            .addNode('validateImagePrompt', async (s: ProviderState) => this.validateImagePromptNode(s))
            .addNode('executeImageGeneration', async (s: ProviderState) => this.executeImageGeneration(s))
            .addNode('executeVideoGeneration', async (s: ProviderState) => this.executeVideoGeneration(s))
            .addNode('calculateUsage', async (s: ProviderState) => this.calculateUsage(s))
            .addNode('cleanup', async (s: ProviderState) => this.cleanup(s))

        graph.addEdge(START, 'resolveWorkspaceContext' as any)
        graph.addEdge('resolveWorkspaceContext' as any, 'resolveFeatures' as any)
        graph.addEdge('resolveFeatures' as any, 'resolveImageBranch' as any)
        graph.addEdge('resolveImageBranch' as any, 'validateRequest' as any)
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
        this.streamPublisher = new StreamPublisher(
            this.deps.natsService,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
        )
        this.imagePublisher = new ImagePublisher(
            this.deps.natsService,
            this.deps.storeWorkspaceImage,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
        )
        this.videoPublisher = new VideoPublisher(
            this.deps.natsService,
            this.deps.storeWorkspaceVideo,
            this.deps.storeWorkspaceImage,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            this.providerName,
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
            imageBranchCandidateSnapshot: requestData.imageBranchCandidateSnapshot,
            referencedFeatureIds: requestData.referencedFeatureIds,
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
            this.streamPublisher.end()
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

    protected async validateRequest(state: ProviderState): Promise<Partial<ProviderState>> {
        if (!state.modelVersion) throw new Error('modelVersion is required')
        if (!state.messages?.length) throw new Error('messages list is required')
        if (!state.workspaceId) throw new Error('workspaceId is required')
        if (!state.aiChatThreadId) throw new Error('aiChatThreadId is required')
        return this.billingGate(state)
    }

    // Async spend gate: a local read of the allowance billing maintains via
    // billing.balance.changed (projected onto the user record). No call to billing
    // on this path, so billing latency/availability never affects the workflow.
    // On admission, mints the per-run workflowId and emits a fire-and-forget
    // run-start signal for billing's usage-leak check.
    private async billingGate(state: ProviderState): Promise<Partial<ProviderState>> {
        const billing = this.deps.billing
        if (!billing?.enabled) return {}

        const userId = state.eventMeta?.userId ?? ''
        const orgId = (state.eventMeta?.organizationId as string) ?? ''
        const workflowKind = this.deriveWorkflowKind(state)

        let allowance: Allowance | undefined
        try {
            allowance = await this.deps.getOrgAllowance?.(userId)
        } catch (e: any) {
            // Read failure falls through to the configured cold-start default below.
            warn(`[billing] allowance read failed for ${userId}: ${e?.message ?? String(e)}`)
        }

        if (!billing.gateAllows(allowance, workflowKind)) {
            throw new Error(`Billing: balance does not cover this workflow (${workflowKind})`)
        }

        const workflowId = uuid()
        billing.publishWorkflowStarted({ workflowId, orgId, userId, workflowKind })
        return { workflowId, workflowSeq: 0 }
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
                this.streamPublisher?.end()
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
        const trace = buildImageGenerationTrace(state)
        if (trace) {
            try {
                this.streamPublisher?.imageGenerationTrace(trace)
            } catch (error: any) {
                warn(`[BaseProvider] Skipping IMAGE_GENERATION_TRACE publish: ${error?.message ?? String(error)}`)
            }
        }

        const imageResult = await this.deps.runImageRouter(state)
        if (imageResult.error) {
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
        const trace = buildVideoGenerationTrace(state)
        if (trace) {
            try {
                this.streamPublisher?.videoGenerationTrace(trace)
            } catch (error: any) {
                warn(`[BaseProvider] Skipping VIDEO_GENERATION_TRACE publish: ${error?.message ?? String(error)}`)
            }
        }

        const videoResult = await this.deps.runVideoRouter(state)
        if (videoResult.error) {
            this.streamPublisher?.error(videoResult.error, videoResult.errorCode, videoResult.errorType)
        }
        return videoResult
    }

    protected async calculateUsage(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.error) return {}

        // Publish one billing usage event per provider call (modality), each with a
        // 1-based workflowSeq under the run's workflowId so billing can gap-detect.
        // workflowId is only set when the billing gate admitted the run (enabled).
        const billingOn = !!(this.deps.billing?.enabled && state.workflowId)
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
            if (billingOn && report) {
                this.deps.billing!.publishUsage(tokenUsageEvent(report, state.workflowId!, ++seq))
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
            if (billingOn && report) {
                this.deps.billing!.publishUsage(imageUsageEvent(report, state.workflowId!, ++seq))
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
            if (billingOn && report) {
                this.deps.billing!.publishUsage(videoUsageEvent(report, state.workflowId!, ++seq))
            }
        }
        return { workflowSeq: seq }
    }

    protected async cleanup(_state: ProviderState): Promise<Partial<ProviderState>> {
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
