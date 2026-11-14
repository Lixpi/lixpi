import {
    type CanvasGeometryUpdate,
} from '@lixpi/constants'

import {
    type PendingCapabilityOutputFinalization,
    type ProviderState,
} from '../llm/graph/state.ts'

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

const capabilityOutputFinalizers = new Map<string, CapabilityOutputFinalizer>()

export const finalizePendingCapabilityOutputsForState = async (state: ProviderState): Promise<FinalizedCapabilityOutput[]> => {
    const pending = state.pendingCapabilityOutputFinalizations ?? []
    const finalized: FinalizedCapabilityOutput[] = []

    for (const output of pending) {
        finalized.push(await requireCapabilityOutputFinalizer(output.capabilityId).finalize(state, output))
    }

    return finalized
}

export const discardPendingCapabilityOutputsForState = async (state: ProviderState): Promise<void> => {
    const pending = state.pendingCapabilityOutputFinalizations ?? []
    await Promise.allSettled(
        pending.map(async output => void (await capabilityOutputFinalizers.get(output.capabilityId)?.discard(state, output))),
    )
}

const requireCapabilityOutputFinalizer = (capabilityId: string): CapabilityOutputFinalizer => {
    const finalizer = capabilityOutputFinalizers.get(capabilityId)

    if (!finalizer)
        throw new Error(`CAPABILITY_OUTPUT_FINALIZER_NOT_REGISTERED:${capabilityId}`)

    return finalizer
}
