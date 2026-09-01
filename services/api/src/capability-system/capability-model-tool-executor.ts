'use strict'

import type {
    CapabilityGenerationTrace,
    CapabilityGenerationTraceStep,
    CapabilityJsonValue,
    CapabilityReasoningModelVariant,
} from '@lixpi/constants'
import {
    SEARCH_CAPABILITIES_TOOL_NAME,
    type CapabilityDispatcher,
    type CapabilityModelToolCall,
    type CapabilityModelToolDefinition,
    getAttachedCapabilityModelTools,
    getStandingCapabilityModelTools,
} from '@lixpi/capability-system/backend'

import type { ProviderState } from '../llm/graph/state.ts'
import {
    applyModelCapabilityExecutionToState,
    collectExplicitReferenceAssetIds,
    defaultToolInput,
    requesterFromState,
    toolInputDeclaresProperty,
} from './capability-state-resolver.ts'

export type CapabilityModelToolExecution = {
    call: CapabilityModelToolCall
    result: Record<string, CapabilityJsonValue>
}

export type CapabilityModelToolExecutorOptions = {
    onGenerationTrace?: (trace: CapabilityGenerationTrace) => void
}

const CAPABILITY_ONLY_COMPLETION_INSTRUCTION = [
    'A capability-only Tool has completed successfully and its generated Artifact is the result.',
    'Reply with one brief plain-language confirmation of what was created.',
    'Do not include code, pseudocode, code fences, imports, data literals, diagrams, visualizations, implementation steps, or a copy of the Artifact content.',
    'Do not propose unrelated follow-up work.',
].join(' ')

export function buildAnthropicRequiredCapabilityToolChoice(name: string): Record<string, string> {
    return { type: 'tool', name }
}

export function buildOpenAIRequiredCapabilityToolChoice(name: string): Record<string, string> {
    return { type: 'function', name }
}

export function buildGoogleRequiredCapabilityToolConfig(name: string): Record<string, unknown> {
    return {
        functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [name],
        },
    }
}

export class CapabilityModelToolExecutor {
    private readonly definitionsByName: ReadonlyMap<string, CapabilityModelToolDefinition>

    constructor(
        private readonly state: ProviderState,
        private readonly dispatcher: CapabilityDispatcher,
        private readonly options: CapabilityModelToolExecutorOptions = {},
    ) {
        const definitions = [
            ...getStandingCapabilityModelTools(),
            ...getAttachedCapabilityModelTools(state.resolvedCapabilityPlan),
        ]
        this.definitionsByName = new Map(definitions.map(definition => [definition.name, definition]))
    }

    definitions(): CapabilityModelToolDefinition[] {
        if (this.completedModelRequiredCapabilityOnlyOutput()) return []
        return [...this.definitionsByName.values()]
    }

    recognizes(name: string): boolean {
        return this.definitionsByName.has(name)
    }

    pendingRequiredToolName(): string | undefined {
        const completedCapabilityIds = new Set(
            (this.state.capabilityToolResults ?? []).map(result => result.capabilityId),
        )
        return this.definitions().find(definition => (
            definition.executionPolicy === 'model-required'
            && definition.capabilityId
            && !completedCapabilityIds.has(definition.capabilityId)
        ))?.name
    }

    completionInstruction(): string | undefined {
        return this.completedModelRequiredCapabilityOnlyOutput()
            ? CAPABILITY_ONLY_COMPLETION_INSTRUCTION
            : undefined
    }

    withCompletionInstruction(systemPrompt: string | undefined): string | undefined {
        const instruction = this.completionInstruction()
        if (!instruction) return systemPrompt
        return systemPrompt ? `${systemPrompt}\n\n${instruction}` : instruction
    }

    private completedModelRequiredCapabilityOnlyOutput(): boolean {
        const completedCapabilityIds = new Set(
            (this.state.capabilityToolResults ?? []).map(result => result.capabilityId),
        )
        return this.state.resolvedCapabilityPlan?.serializable.rootCapabilityIds.some(capabilityId => {
            if (!completedCapabilityIds.has(capabilityId)) return false
            const tool = this.state.resolvedCapabilityPlan?.getManifest(capabilityId)?.manifest.tool
            return tool?.executionPolicy === 'model-required'
                && tool.modelAxisPolicy?.outputMode === 'capability-only'
        }) ?? false
    }

    async execute(call: CapabilityModelToolCall, signal: AbortSignal): Promise<CapabilityModelToolExecution> {
        const definition = this.definitionsByName.get(call.name)
        if (!definition) throw new Error(`Unknown Capability model tool ${call.name}`)
        if (call.name === SEARCH_CAPABILITIES_TOOL_NAME) {
            const kinds = Array.isArray(call.arguments.kinds)
                ? call.arguments.kinds.filter(kind => kind === 'tool' || kind === 'skill')
                : undefined
            const page = await this.dispatcher.search({
                query: typeof call.arguments.query === 'string' ? call.arguments.query : undefined,
                kinds,
                limit: typeof call.arguments.limit === 'number' ? call.arguments.limit : undefined,
                cursor: typeof call.arguments.cursor === 'string' ? call.arguments.cursor : undefined,
            }, requesterFromState(this.state))
            return {
                call,
                result: {
                    items: page.items.map(item => ({
                        capabilityId: item.capabilityId,
                        kind: item.kind,
                        name: item.name,
                        summary: item.summary,
                        tags: item.tags,
                    })),
                    ...(page.cursor ? { cursor: page.cursor } : {}),
                },
            }
        }

        const capabilityId = definition.capabilityId
            ?? (typeof call.arguments.capabilityId === 'string' ? call.arguments.capabilityId : '')
        const argsValue = definition.capabilityId ? call.arguments : call.arguments.arguments
        const modelArgs = argsValue && typeof argsValue === 'object' && !Array.isArray(argsValue)
            ? argsValue as Record<string, CapabilityJsonValue>
            : {}
        const requester = requesterFromState(this.state)
        const canResolvePlan = typeof (this.dispatcher as Partial<CapabilityDispatcher>).resolveToolPlan === 'function'
        const sealedPlan = this.state.resolvedCapabilityPlan?.getManifest(capabilityId)
            ? this.state.resolvedCapabilityPlan
            : canResolvePlan
            ? await this.dispatcher.resolveToolPlan(capabilityId, requester, signal)
            : undefined
        const configuredInput = this.state.capabilityInputs?.[capabilityId]
        const args = configuredInput
            ? {
                ...modelArgs,
                ...defaultToolInput(this.state, capabilityId),
                ...configuredInput,
            }
            : { ...modelArgs }
        if (
            !Object.hasOwn(args, 'referenceAssetIds')
            && toolInputDeclaresProperty(sealedPlan, capabilityId, 'referenceAssetIds')
        ) {
            args.referenceAssetIds = collectExplicitReferenceAssetIds(this.state)
        }
        const variant = resolveModelToolVariant(this.state, sealedPlan, capabilityId)
        const execution = await this.dispatcher.use({
            capabilityId,
            arguments: args,
            requester,
            origin: 'model',
            conversationAssetId: this.state.aiChatThreadId,
            sealedPlan,
            invocationDepth: this.state.capabilityInvocationDepth,
            invocationGenerationRequestId: this.state.generationRun?.generationRequestId,
            signal,
            variant,
        })
        applyModelCapabilityExecutionToState({
            state: this.state,
            capabilityId,
            runId: execution.run.runId,
            output: execution.output,
            outputAssetIds: execution.run.outputAssetIds,
        })
        const outputAssetId = execution.output.outputKind === 'capabilityArtifact'
                && typeof execution.output.assetId === 'string'
            ? execution.output.assetId
            : undefined
        if (outputAssetId && variant.axis === 'reasoning-model' && this.state.generationRun) {
            this.state.pendingCapabilityOutputFinalizations = [
                ...(this.state.pendingCapabilityOutputFinalizations ?? []),
                {
                    capabilityId,
                    capabilityRunId: execution.run.runId,
                    assetId: outputAssetId,
                    input: structuredClone(args),
                    variant,
                    generationRun: structuredClone(this.state.generationRun),
                },
            ]
        }
        this.options.onGenerationTrace?.({
            traceVersion: 'capability-generation-trace-v1',
            generationRun: this.state.generationRun,
            capabilityId,
            capabilityName: sealedPlan?.getManifest(capabilityId)?.manifest.name
                ?? definition.capabilityName
                ?? capabilityId,
            capabilityRunId: execution.run.runId,
            chatModelProvider: this.state.provider,
            chatModelId: this.state.generationRun?.reasoningModelId
                ?? `${this.state.provider}:${this.state.aiModelMetaInfo?.model ?? this.state.modelVersion}`,
            input: structuredClone(args),
            outputAssetIds: [...execution.run.outputAssetIds],
            steps: buildGenerationTraceSteps(execution.events ?? []),
        })
        return {
            call,
            result: {
                runId: execution.run.runId,
                status: execution.run.status,
                output: execution.output,
                outputAssetIds: execution.run.outputAssetIds,
            },
        }
    }
}

function resolveModelToolVariant(
    state: ProviderState,
    plan: ProviderState['resolvedCapabilityPlan'],
    capabilityId: string,
): { axis: 'request'; variantKey: 'request' } | CapabilityReasoningModelVariant {
    const tool = plan?.getManifest(capabilityId)?.manifest.tool
    if (
        !tool || (tool.executionMultiplicity !== 'per-reasoning-model'
            && (tool.modelAxisPolicy?.reasoning ?? 'ignore') === 'ignore')
    ) {
        return { axis: 'request', variantKey: 'request' }
    }
    return reasoningVariantFromState(state)
}

function reasoningVariantFromState(state: ProviderState): CapabilityReasoningModelVariant {
    const reasoningModelId = state.generationRun?.reasoningModelId
        ?? `${state.provider}:${state.aiModelMetaInfo?.model ?? state.modelVersion}`
    return {
        axis: 'reasoning-model',
        variantKey: `reasoning:${state.generationRun?.reasoningIndex ?? 0}:${reasoningModelId}`,
        reasoningIndex: state.generationRun?.reasoningIndex ?? 0,
        reasoningModelId,
        provider: state.provider,
        modelVersion: state.modelVersion,
        contextWindow: state.aiModelMetaInfo?.contextWindow ?? 0,
        maxCompletionSize: state.maxCompletionSize ?? state.aiModelMetaInfo?.maxCompletionSize ?? 0,
        inferenceCapabilities: state.aiModelMetaInfo.inferenceCapabilities,
    }
}

function buildGenerationTraceSteps(
    events: readonly Readonly<import('@lixpi/constants').CapabilityRunEvent>[],
): CapabilityGenerationTraceStep[] {
    return events.flatMap(event => {
        if (!event.stepId || !event.stepTitle) return []
        if (
            event.eventType !== 'STEP_COMPLETED'
            && event.eventType !== 'STEP_SKIPPED'
            && event.eventType !== 'STEP_FAILED'
            && event.eventType !== 'STEP_CANCELLED'
        ) return []
        return [{
            stepId: event.stepId,
            title: event.stepTitle,
            status: event.eventType === 'STEP_COMPLETED'
                ? 'completed' as const
                : event.eventType === 'STEP_SKIPPED'
                ? 'skipped' as const
                : event.eventType === 'STEP_CANCELLED'
                ? 'cancelled' as const
                : 'failed' as const,
            ...(event.safeInputSummary ? { inputSummary: event.safeInputSummary } : {}),
            ...(event.safeOutputSummary ? { outputSummary: event.safeOutputSummary } : {}),
            ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
            ...(event.trace ? { trace: event.trace } : {}),
        }]
    })
}

export function shouldExposeCapabilityModelTools(state: ProviderState): boolean {
    if ((state.capabilityInvocationDepth ?? 0) !== 0) return false
    const plan = state.resolvedCapabilityPlan
    if (!plan) return true
    return !plan.serializable.rootCapabilityIds.some(capabilityId => plan.getManifest(capabilityId)?.manifest.tool?.executionPolicy === 'required')
}
