'use strict'

import { StateGraph, END, START } from '@langchain/langgraph'

import type NatsService from '@lixpi/nats-service'
import { info, warn, err } from '@lixpi/debug-tools'

import { LLM_TIMEOUT_MS, type ProviderName } from '../config.ts'
import { channels, type ProviderState } from '../graph/state.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
import { ImagePublisher, type StoreWorkspaceImageFn } from '../graph/image-publisher.ts'
import { UsageReporter } from '../usage/usage-reporter.ts'
import {
    getImagePromptMaxChars,
    validateImagePrompt as toolValidateImagePrompt,
} from '../tools/image-generation.ts'

export type BaseProviderDeps = {
    natsService: NatsService
    storeWorkspaceImage: StoreWorkspaceImageFn
    usageReporter: UsageReporter
    runImageRouter: (state: ProviderState) => Promise<Partial<ProviderState>>
}

// Shared LangGraph workflow for all LLM providers.
// validateRequest → streamTokens → [conditional]
//   generate_image: validateImagePrompt → [conditional]
//     generate_image: executeImageGeneration → calculateUsage → cleanup → END
//     skip:                                    calculateUsage → cleanup → END
//   skip:                                      calculateUsage → cleanup → END
// Each provider subclasses BaseProvider and supplies streamImpl(state).
export abstract class BaseProvider {
    abstract readonly providerName: ProviderName

    protected app: ReturnType<ReturnType<typeof BaseProvider.prototype.buildWorkflow>['compile']>
    protected abortController: AbortController | undefined
    protected streamPublisher: StreamPublisher | undefined
    protected imagePublisher: ImagePublisher | undefined
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
            .addNode('validateRequest', async (s: ProviderState) => this.validateRequest(s))
            .addNode('streamTokens', async (s: ProviderState) => this.streamTokens(s))
            .addNode('validateImagePrompt', async (s: ProviderState) => this.validateImagePromptNode(s))
            .addNode('executeImageGeneration', async (s: ProviderState) => this.executeImageGeneration(s))
            .addNode('calculateUsage', async (s: ProviderState) => this.calculateUsage(s))
            .addNode('cleanup', async (s: ProviderState) => this.cleanup(s))

        graph.addEdge(START, 'validateRequest' as any)
        graph.addEdge('validateRequest' as any, 'streamTokens' as any)
        graph.addConditionalEdges(
            'streamTokens' as any,
            (s: ProviderState) => this.shouldGenerateImage(s),
            { generate_image: 'validateImagePrompt' as any, skip: 'calculateUsage' as any },
        )
        graph.addConditionalEdges(
            'validateImagePrompt' as any,
            (s: ProviderState) => this.shouldGenerateImage(s),
            { generate_image: 'executeImageGeneration' as any, skip: 'calculateUsage' as any },
        )
        graph.addEdge('executeImageGeneration' as any, 'calculateUsage' as any)
        graph.addEdge('calculateUsage' as any, 'cleanup' as any)
        graph.addEdge('cleanup' as any, END)
        return graph
    }

    // Run a request through the LangGraph workflow.
    async process(requestData: Record<string, any>): Promise<void> {
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
        }

        const timeoutHandle = setTimeout(() => {
            this.abortController?.abort(new Error('LLM circuit breaker timeout'))
        }, LLM_TIMEOUT_MS)

        try {
            await this.app.invoke(initialState, {
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
        return {}
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
        return this.deps.runImageRouter(state)
    }

    protected async calculateUsage(state: ProviderState): Promise<Partial<ProviderState>> {
        if (state.error) return {}
        if (state.usage) {
            this.deps.usageReporter.reportTokensUsage({
                eventMeta: state.eventMeta,
                aiModelMetaInfo: state.aiModelMetaInfo,
                aiVendorRequestId: state.aiVendorRequestId ?? 'unknown',
                aiVendorModelName: state.modelVersion,
                usage: state.usage,
                aiRequestReceivedAt: state.aiRequestReceivedAt,
                aiRequestFinishedAt: state.aiRequestFinishedAt ?? Date.now(),
            })
        }
        if (state.imageUsage) {
            this.deps.usageReporter.reportImageUsage({
                eventMeta: state.eventMeta,
                aiModelMetaInfo: state.aiModelMetaInfo,
                aiVendorRequestId: state.aiVendorRequestId ?? 'unknown',
                imageSize: state.imageUsage.size,
                imageQuality: state.imageUsage.quality,
                aiRequestReceivedAt: state.aiRequestReceivedAt,
                aiRequestFinishedAt: state.aiRequestFinishedAt ?? Date.now(),
            })
        }
        return {}
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

    protected get signal(): AbortSignal {
        if (!this.abortController) throw new Error('AbortController not initialized')
        return this.abortController.signal
    }

    protected get shouldStop(): boolean {
        return this.abortController?.signal.aborted ?? false
    }
}
