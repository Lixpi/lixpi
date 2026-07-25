'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
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
    requesterFromState,
    toolInputDeclaresProperty,
} from './capability-state-resolver.ts'

export type CapabilityModelToolExecution = {
    call: CapabilityModelToolCall
    result: Record<string, CapabilityJsonValue>
}

export class CapabilityModelToolExecutor {
    private readonly definitionsByName: ReadonlyMap<string, CapabilityModelToolDefinition>

    constructor(
        private readonly state: ProviderState,
        private readonly dispatcher: CapabilityDispatcher,
    ) {
        const definitions = [
            ...getStandingCapabilityModelTools(),
            ...getAttachedCapabilityModelTools(state.resolvedCapabilityPlan),
        ]
        this.definitionsByName = new Map(definitions.map(definition => [definition.name, definition]))
    }

    definitions(): CapabilityModelToolDefinition[] {
        return [...this.definitionsByName.values()]
    }

    recognizes(name: string): boolean {
        return this.definitionsByName.has(name)
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
        const args = argsValue && typeof argsValue === 'object' && !Array.isArray(argsValue)
            ? argsValue as Record<string, CapabilityJsonValue>
            : {}
        const requester = requesterFromState(this.state)
        const canResolvePlan = typeof (this.dispatcher as Partial<CapabilityDispatcher>).resolveToolPlan === 'function'
        const sealedPlan = this.state.resolvedCapabilityPlan?.getManifest(capabilityId)
            ? this.state.resolvedCapabilityPlan
            : canResolvePlan
                ? await this.dispatcher.resolveToolPlan(capabilityId, requester, signal)
                : undefined
        if (!Object.hasOwn(args, 'referenceAssetIds')
            && toolInputDeclaresProperty(sealedPlan, capabilityId, 'referenceAssetIds')) {
            args.referenceAssetIds = collectExplicitReferenceAssetIds(this.state)
        }
        const execution = await this.dispatcher.use({
            capabilityId,
            arguments: args,
            requester,
            origin: 'model',
            conversationAssetId: this.state.aiChatThreadId,
            sealedPlan,
            invocationDepth: this.state.capabilityInvocationDepth,
            signal,
        })
        applyModelCapabilityExecutionToState({
            state: this.state,
            capabilityId,
            runId: execution.run.runId,
            output: execution.output,
            outputAssetIds: execution.run.outputAssetIds,
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

export function shouldExposeCapabilityModelTools(state: ProviderState): boolean {
    if ((state.capabilityInvocationDepth ?? 0) !== 0) return false
    const plan = state.resolvedCapabilityPlan
    if (!plan) return true
    return !plan.serializable.rootCapabilityIds.some(capabilityId =>
        plan.getManifest(capabilityId)?.manifest.tool?.executionPolicy === 'required',
    )
}
