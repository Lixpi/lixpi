'use strict'

import { ACTION_TIMELINE_TOOL_ID } from '@lixpi/capability-system'
import type { CanvasGeometryUpdate } from '@lixpi/constants'

import type {
    PendingCapabilityOutputFinalization,
    ProviderState,
} from '../llm/graph/state.ts'
import {
    discardStagedActionTimelineArtifact,
    finalizeActionTimelineArtifact,
} from './action-timeline-persistence-adapter.ts'

export type FinalizedCapabilityOutput = {
    canvasGeometry: CanvasGeometryUpdate
    generationRun: NonNullable<ProviderState['generationRun']>
}

type CapabilityOutputFinalizer = {
    finalize: (
        state: ProviderState,
        output: PendingCapabilityOutputFinalization,
    ) => Promise<FinalizedCapabilityOutput>
    discard: (
        state: ProviderState,
        output: PendingCapabilityOutputFinalization,
    ) => Promise<void>
}

const capabilityOutputFinalizers = new Map<string, CapabilityOutputFinalizer>([[
    ACTION_TIMELINE_TOOL_ID,
    {
        finalize: async (state, output) =>
            await finalizeActionTimelineArtifact({
                assetId: output.assetId,
                capabilityRunId: output.capabilityRunId,
                input: output.input,
                variant: output.variant,
                generationRun: output.generationRun,
                workspaceId: state.workspaceId,
                userId: requireEventMetaString(state.eventMeta.userId, 'USER_ID_REQUIRED'),
                organizationId: requireEventMetaString(state.eventMeta.organizationId, 'ORGANIZATION_ID_REQUIRED'),
                conversationAssetId: state.aiChatThreadId,
            }),
        discard: async (state, output) => {
            await discardStagedActionTimelineArtifact({
                assetId: output.assetId,
                workspaceId: state.workspaceId,
                userId: requireEventMetaString(state.eventMeta.userId, 'USER_ID_REQUIRED'),
                organizationId: requireEventMetaString(state.eventMeta.organizationId, 'ORGANIZATION_ID_REQUIRED'),
            })
        },
    },
]])

export async function finalizePendingCapabilityOutputsForState(
    state: ProviderState,
): Promise<FinalizedCapabilityOutput[]> {
    const pending = state.pendingCapabilityOutputFinalizations ?? []
    const finalized: FinalizedCapabilityOutput[] = []
    for (const output of pending) {
        finalized.push(await requireCapabilityOutputFinalizer(output.capabilityId).finalize(state, output))
    }
    return finalized
}

export async function discardPendingCapabilityOutputsForState(state: ProviderState): Promise<void> {
    const pending = state.pendingCapabilityOutputFinalizations ?? []
    await Promise.allSettled(pending.map(async output => {
        await capabilityOutputFinalizers.get(output.capabilityId)?.discard(state, output)
    }))
}

function requireCapabilityOutputFinalizer(capabilityId: string): CapabilityOutputFinalizer {
    const finalizer = capabilityOutputFinalizers.get(capabilityId)
    if (!finalizer) throw new Error(`CAPABILITY_OUTPUT_FINALIZER_NOT_REGISTERED:${capabilityId}`)
    return finalizer
}

function requireEventMetaString(value: unknown, errorCode: string): string {
    if (typeof value !== 'string' || !value) throw new Error(errorCode)
    return value
}
