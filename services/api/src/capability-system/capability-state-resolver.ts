'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
import {
    type CapabilityDispatcher,
    type CapabilityRequesterContext,
    resolveCapabilities,
} from '@lixpi/capability-system/backend'

import type { ProviderState } from '../llm/graph/state.ts'
import { CapabilityModelResolverStore } from './capability-runtime-adapters.ts'
import { capabilityActionRegistry } from './capability-runtime.ts'

const MAX_SKILL_CONTEXT_CHARS = 64_000

export async function resolveCapabilitiesForState(
    state: ProviderState,
    signal?: AbortSignal,
): Promise<Partial<ProviderState>> {
    const references = state.capabilityReferences ?? []
    if (references.length === 0) return {}
    const plan = await resolveCapabilities(references, {
        store: new CapabilityModelResolverStore(),
        requester: requesterFromState(state),
        allowedActions: capabilityActionRegistry.allowedActionKeys(),
        signal,
    })
    const skillContext = buildSkillContext(plan)
    return {
        resolvedCapabilityPlan: plan,
        ...(skillContext ? {
            messages: [{ role: 'user', content: skillContext }, ...state.messages],
        } : {}),
    }
}

export async function executeRequiredCapabilitiesForState(
    state: ProviderState,
    dispatcher: CapabilityDispatcher,
    signal: AbortSignal,
): Promise<Partial<ProviderState>> {
    const plan = state.resolvedCapabilityPlan
    if (!plan) return {}
    const outputs: ProviderState['capabilityToolResults'] = []
    const outputAssetIds: string[] = []
    for (const capabilityId of plan.serializable.rootCapabilityIds) {
        const capability = plan.getManifest(capabilityId)
        if (capability?.manifest.tool?.executionPolicy !== 'required') continue
        const configuredInput = state.capabilityInputs?.[capabilityId] ?? defaultToolInput(state, capabilityId)
        const result = await dispatcher.use({
            capabilityId,
            arguments: configuredInput,
            requester: requesterFromState(state),
            origin: 'prompt',
            conversationAssetId: state.aiChatThreadId,
            sealedPlan: plan,
            invocationDepth: state.capabilityInvocationDepth,
            invocationGenerationRequestId: state.generationRun?.generationRequestId,
            signal,
        })
        outputs.push({
            capabilityId,
            runId: result.run.runId,
            output: result.output,
        })
        outputAssetIds.push(...result.run.outputAssetIds)
    }
    if (outputs.length === 0) return {}
    const mediaGenerationOutputs = outputs.flatMap(output => {
        const visualInstructions = output.output.visualInstructions
        const referenceImages = output.output.referenceImages
        const referenceImageTraceUrls = output.output.referenceImageTraceUrls
        const mediaGenerationMode = output.output.mediaGenerationMode
        const preserveUserPrompt = output.output.preserveUserPrompt
        if (typeof visualInstructions !== 'string'
            || !Array.isArray(referenceImages)
            || !referenceImages.every(value => typeof value === 'string')
            || !Array.isArray(referenceImageTraceUrls)
            || !referenceImageTraceUrls.every(value => typeof value === 'string')
            || typeof mediaGenerationMode !== 'string') return []
        return {
            mediaGenerationMode: mediaGenerationMode as NonNullable<ProviderState['capabilityUsageMode']>,
            preserveUserPrompt: preserveUserPrompt === true,
            visualInstructions,
            referenceImages,
            referenceImageTraceUrls,
        }
    })
    const mediaGenerationMode = mediaGenerationOutputs.at(-1)?.mediaGenerationMode
    const preserveUserPrompt = mediaGenerationOutputs.some(output => output.preserveUserPrompt)
    const requestPrompt = extractUserPrompt([...state.messages].reverse().find(message => message.role === 'user')?.content)
    return {
        capabilityToolResults: [...(state.capabilityToolResults ?? []), ...outputs],
        ...(outputAssetIds.length > 0 ? {
            capabilityOutputAssetIds: [...new Set(outputAssetIds)],
            enableImageGeneration: false,
            enableVideoGeneration: false,
        } : {}),
        ...(mediaGenerationOutputs.length > 0 ? {
            capabilityUsagePrompt: mediaGenerationOutputs.map(output => output.visualInstructions).join('\n\n'),
            capabilityReferenceImages: mediaGenerationOutputs.flatMap(output => output.referenceImages),
            capabilityReferenceImageTraceUrls: mediaGenerationOutputs.flatMap(output => output.referenceImageTraceUrls),
            ...(mediaGenerationMode ? { capabilityUsageMode: mediaGenerationMode } : {}),
            ...(preserveUserPrompt && requestPrompt ? { generatedImagePrompt: requestPrompt } : {}),
        } : {}),
        messages: [
            ...outputs.map(output => ({
                role: 'user',
                content: `Required Tool ${output.capabilityId} completed as run ${output.runId}. Structured output:\n${JSON.stringify(summarizeToolOutputForModel(output.output))}`,
            })),
            ...state.messages,
        ],
    }
}

export function applyModelCapabilityExecutionToState(args: {
    state: ProviderState
    capabilityId: string
    runId: string
    output: Record<string, CapabilityJsonValue>
    outputAssetIds: string[]
}): void {
    const { state, capabilityId, runId, output, outputAssetIds } = args
    state.capabilityToolResults = [
        ...(state.capabilityToolResults ?? []),
        { capabilityId, runId, output },
    ]
    if (outputAssetIds.length > 0) {
        state.capabilityOutputAssetIds = [
            ...new Set([...(state.capabilityOutputAssetIds ?? []), ...outputAssetIds]),
        ]
    }
    const visualInstructions = output.visualInstructions
    const referenceImages = output.referenceImages
    const referenceImageTraceUrls = output.referenceImageTraceUrls
    const mediaGenerationMode = output.mediaGenerationMode
    if (typeof visualInstructions !== 'string'
        || !Array.isArray(referenceImages)
        || !referenceImages.every(value => typeof value === 'string')
        || !Array.isArray(referenceImageTraceUrls)
        || !referenceImageTraceUrls.every(value => typeof value === 'string')
        || typeof mediaGenerationMode !== 'string') return

    state.capabilityUsagePrompt = [state.capabilityUsagePrompt, visualInstructions]
        .filter((value): value is string => Boolean(value))
        .join('\n\n')
    state.capabilityReferenceImages = [
        ...(state.capabilityReferenceImages ?? []),
        ...referenceImages,
    ]
    state.capabilityReferenceImageTraceUrls = [
        ...(state.capabilityReferenceImageTraceUrls ?? []),
        ...referenceImageTraceUrls,
    ]
    state.capabilityUsageMode = mediaGenerationMode as NonNullable<ProviderState['capabilityUsageMode']>
}

function summarizeToolOutputForModel(
    output: Record<string, CapabilityJsonValue>,
): Record<string, CapabilityJsonValue> {
    const summary = { ...output }
    const referenceImages = summary.referenceImages
    if (Array.isArray(referenceImages)) {
        summary.referenceImages = [`${referenceImages.length} reference image(s) applied directly to media generation`]
    }
    return summary
}

export function requiredCapabilityProducedOutput(state: ProviderState): boolean {
    return (state.capabilityOutputAssetIds?.length ?? 0) > 0
}

export function defaultToolInput(state: ProviderState, capabilityId: string): Record<string, CapabilityJsonValue> {
    const lastUserMessage = [...state.messages].reverse().find(message => message.role === 'user')
    const prompt = extractUserPrompt(lastUserMessage?.content)
    const input: Record<string, CapabilityJsonValue> = prompt
        ? { prompt }
        : {}
    if (toolInputDeclaresProperty(state.resolvedCapabilityPlan, capabilityId, 'referenceAssetIds')) {
        input.referenceAssetIds = collectExplicitReferenceAssetIds(state)
    }
    return input
}

function extractUserPrompt(content: unknown): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.flatMap(part => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) return []
        const value = part as { type?: unknown; text?: unknown }
        return value.type === 'input_text' && typeof value.text === 'string' ? [value.text] : []
    }).join('\n')
}

export function collectExplicitReferenceAssetIds(state: ProviderState): string[] {
    const assetIds: string[] = []
    const seen = new Set<string>()
    for (const node of state.workspaceContextSnapshot?.nodes ?? []) {
        if (!node.isExplicitChip || !node.assetId || seen.has(node.assetId)) continue
        seen.add(node.assetId)
        assetIds.push(node.assetId)
    }
    return assetIds
}

export function toolInputDeclaresProperty(
    plan: ProviderState['resolvedCapabilityPlan'],
    capabilityId: string,
    property: string,
): boolean {
    const capability = plan?.getManifest(capabilityId)
    const inputSchema = capability?.manifest.tool?.inputSchema
    if (!inputSchema) return false
    const resource = plan?.getResource(capabilityId, inputSchema.resourceId)
    if (!resource) return false
    try {
        const schema = JSON.parse(new TextDecoder().decode(resource.bytes)) as { properties?: Record<string, unknown> }
        return Boolean(schema.properties && Object.hasOwn(schema.properties, property))
    } catch {
        return false
    }
}

export function requesterFromState(state: ProviderState): CapabilityRequesterContext {
    const userId = state.eventMeta.userId
    if (!userId) throw new Error('Capability resolution requires user context')
    return {
        userId,
        workspaceId: state.workspaceId,
        organizationId: state.eventMeta.organizationId,
    }
}

function buildSkillContext(plan: NonNullable<ProviderState['resolvedCapabilityPlan']>): string {
    const sections: string[] = []
    let length = 0
    for (const capabilityId of plan.serializable.rootCapabilityIds) {
        const capability = plan.getManifest(capabilityId)
        if (capability?.kind !== 'skill') continue
        for (const resource of capability.manifest.resources) {
            if (resource.mediaType !== 'text/markdown' || resource.role !== 'instructions') continue
            const loaded = plan.getResource(capabilityId, resource.resourceId)
            if (!loaded) continue
            const text = new TextDecoder().decode(loaded.bytes)
            const section = `<skill id="${capabilityId}" name="${capability.manifest.name}">\n${text}\n</skill>`
            if (length + section.length > MAX_SKILL_CONTEXT_CHARS) break
            sections.push(section)
            length += section.length
        }
    }
    return sections.length > 0
        ? `Authorized Capability Skill instructions for this request:\n${sections.join('\n\n')}`
        : ''
}

export function asCapabilityArguments(value: unknown): Record<string, CapabilityJsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, CapabilityJsonValue>
        : {}
}
