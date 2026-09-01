import type {
    ExecutionTrace,
    ExecutionTraceFact,
    ExecutionTraceHandle,
    ExecutionTraceModelCall,
    ExecutionTraceParam,
    MediaGenerationRunProgress,
    MediaGenerationRunStatus,
    OperationProgressItem,
} from './types.ts'

const mediaProgressPhaseOrder: MediaGenerationRunProgress['phase'][] = [
    'preparing',
    'rendering',
    'assessing',
    'composing',
]

const mediaProgressItemStatusRank: Record<OperationProgressItem['status'], number> = {
    pending: 0,
    running: 1,
    completed: 2,
    attention: 2,
    failed: 2,
    cancelled: 2,
    skipped: 2,
}

function mergeKeyedItems<T extends object>(
    current: readonly T[] | undefined,
    incoming: readonly T[] | undefined,
    getKey: (item: T) => string,
    mergeItem: (currentItem: T, incomingItem: T) => T = (currentItem, incomingItem) => ({
        ...currentItem,
        ...incomingItem,
    }),
): T[] | undefined {
    if (!current?.length) return incoming ? [...incoming] : undefined
    if (!incoming?.length) return [...current]
    const currentByKey = new Map(current.map(item => [getKey(item), item]))
    const incomingKeys = new Set(incoming.map(getKey))
    return [
        ...incoming.map(item => {
            const currentItem = currentByKey.get(getKey(item))
            return currentItem ? mergeItem(currentItem, item) : item
        }),
        ...current.filter(item => !incomingKeys.has(getKey(item))),
    ]
}

function getTraceHandleKey(handle: ExecutionTraceHandle): string {
    return `${handle.kind}:${handle.id}:${handle.role ?? ''}`
}

function mergeExecutionTraceModelCall(
    current: ExecutionTraceModelCall,
    incoming: ExecutionTraceModelCall,
): ExecutionTraceModelCall {
    const params = mergeKeyedItems<ExecutionTraceParam>(current.params, incoming.params, param => param.name)
    const inputHandles = mergeKeyedItems<ExecutionTraceHandle>(
        current.inputHandles,
        incoming.inputHandles,
        getTraceHandleKey,
    )
    const outputHandles = mergeKeyedItems<ExecutionTraceHandle>(
        current.outputHandles,
        incoming.outputHandles,
        getTraceHandleKey,
    )
    return {
        ...current,
        ...incoming,
        ...(params ? { params } : {}),
        ...(inputHandles ? { inputHandles } : {}),
        ...(outputHandles ? { outputHandles } : {}),
        ...(current.tokenUsage || incoming.tokenUsage
            ? { tokenUsage: { ...current.tokenUsage, ...incoming.tokenUsage } }
            : {}),
    }
}

function mergeExecutionTrace(
    current: ExecutionTrace | undefined,
    incoming: ExecutionTrace | undefined,
): ExecutionTrace | undefined {
    if (!current) return incoming
    if (!incoming) return current
    const handles = mergeKeyedItems<ExecutionTraceHandle>(current.handles, incoming.handles, getTraceHandleKey)
    const modelCalls = mergeKeyedItems<ExecutionTraceModelCall>(
        current.modelCalls,
        incoming.modelCalls,
        modelCall => modelCall.id,
        mergeExecutionTraceModelCall,
    )
    const facts = mergeKeyedItems<ExecutionTraceFact>(current.facts, incoming.facts, fact => fact.label)
    return {
        ...current,
        ...incoming,
        ...(handles ? { handles } : {}),
        ...(modelCalls ? { modelCalls } : {}),
        ...(facts ? { facts } : {}),
    }
}

function mergeMediaProgressItem(
    current: OperationProgressItem,
    incoming: OperationProgressItem,
): OperationProgressItem {
    const currentRank = mediaProgressItemStatusRank[current.status]
    const incomingRank = mediaProgressItemStatusRank[incoming.status]
    const keepCurrentStatus = currentRank > incomingRank
        || (currentRank === incomingRank && currentRank === 2 && current.status !== incoming.status)
    const selected = keepCurrentStatus ? current : incoming
    const trace = mergeExecutionTrace(current.trace, incoming.trace)
    const children = mergeKeyedItems<OperationProgressItem>(
        current.children,
        incoming.children,
        child => child.id,
        mergeMediaProgressItem,
    )
    return {
        ...current,
        ...selected,
        status: keepCurrentStatus ? current.status : incoming.status,
        ...(trace ? { trace } : {}),
        ...(children ? { children } : {}),
    }
}

export function mergeMediaGenerationRunProgress(
    current: MediaGenerationRunProgress | undefined,
    incoming: MediaGenerationRunProgress,
): MediaGenerationRunProgress {
    if (!current) return incoming
    const currentPhaseIndex = mediaProgressPhaseOrder.indexOf(current.phase)
    const incomingPhaseIndex = mediaProgressPhaseOrder.indexOf(incoming.phase)
    const incomingIsCurrent = incomingPhaseIndex > currentPhaseIndex
        || (incomingPhaseIndex === currentPhaseIndex && incoming.completedSteps >= current.completedSteps)
    const selected = incomingIsCurrent ? incoming : current
    const items = mergeKeyedItems<OperationProgressItem>(
        current.items,
        incoming.items,
        item => item.id,
        mergeMediaProgressItem,
    )
    return {
        ...selected,
        totalSteps: Math.max(current.totalSteps, incoming.totalSteps),
        ...(items ? { items } : {}),
    }
}

export function createDefaultMediaGenerationRunProgress(
    status: MediaGenerationRunStatus,
    message: string,
): MediaGenerationRunProgress {
    const preparing = status === 'pending' || status === 'awaiting-provider-verification'
    const terminalStatus: OperationProgressItem['status'] = status === 'failed'
        ? 'failed'
        : status === 'cancelled'
        ? 'cancelled'
        : 'completed'
    const generationStatus: OperationProgressItem['status'] = status === 'running'
        ? 'running'
        : status === 'completed'
        ? 'completed'
        : status === 'failed' || status === 'cancelled'
        ? terminalStatus
        : 'pending'
    const providerStatus: OperationProgressItem['status'] = status === 'pending'
            || status === 'awaiting-provider-verification'
        ? 'running'
        : 'completed'

    return {
        phase: preparing ? 'preparing' : status === 'completed' ? 'composing' : 'rendering',
        completedSteps: status === 'completed' ? 1 : 0,
        totalSteps: 1,
        message,
        items: [
            {
                id: 'provider',
                title: 'Prepare provider run',
                status: providerStatus,
                ...(status === 'pending' || status === 'awaiting-provider-verification' ? { summary: message } : {}),
            },
            {
                id: 'generation',
                title: 'Generate media',
                status: generationStatus,
                ...(status === 'running' || status === 'failed' ? { summary: message } : {}),
            },
            {
                id: 'finalize',
                title: 'Finalize asset',
                status: status === 'completed' ? 'completed' : 'pending',
            },
        ],
    }
}

export function settleMediaGenerationRunProgress(
    progress: MediaGenerationRunProgress | undefined,
    status: 'completed' | 'failed' | 'cancelled',
    message: string,
): MediaGenerationRunProgress {
    const currentProgress = progress ?? createDefaultMediaGenerationRunProgress(status, message)
    const settleItem = (item: OperationProgressItem): OperationProgressItem => ({
        ...item,
        status: item.status === 'pending' || item.status === 'running'
            ? status
            : item.status,
        ...(item.children ? { children: item.children.map(settleItem) } : {}),
    })
    return {
        ...currentProgress,
        phase: status === 'completed' ? 'composing' : currentProgress.phase,
        completedSteps: status === 'completed' ? currentProgress.totalSteps : currentProgress.completedSteps,
        message,
        ...(currentProgress.items ? { items: currentProgress.items.map(settleItem) } : {}),
    }
}
