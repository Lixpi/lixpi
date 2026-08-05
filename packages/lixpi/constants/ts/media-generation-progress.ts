import type {
    MediaGenerationRunProgress,
    MediaGenerationRunStatus,
    OperationProgressItem,
} from './types.ts'

export function createDefaultMediaGenerationRunProgress(
    status: MediaGenerationRunStatus,
    message: string,
): MediaGenerationRunProgress {
    const preparing = status === 'pending' || status === 'awaiting-provider-verification'
    const terminalStatus: OperationProgressItem['status'] = status === 'failed'
        ? 'failed'
        : status === 'cancelled' ? 'cancelled' : 'completed'
    const generationStatus: OperationProgressItem['status'] = status === 'running'
        ? 'running'
        : status === 'completed' ? 'completed'
            : status === 'failed' || status === 'cancelled' ? terminalStatus : 'pending'
    const providerStatus: OperationProgressItem['status'] = status === 'pending'
        ? 'pending'
        : status === 'awaiting-provider-verification' ? 'running' : 'completed'

    return {
        phase: preparing ? 'preparing' : status === 'completed' ? 'composing' : 'rendering',
        completedSteps: status === 'completed' ? 1 : 0,
        totalSteps: 1,
        message,
        items: [
            { id: 'request', title: 'Understand request', status: 'completed' },
            {
                id: 'references',
                title: 'Resolve references and capabilities',
                status: status === 'pending' ? 'running' : 'completed',
            },
            {
                id: 'provider',
                title: 'Prepare provider run',
                status: providerStatus,
                ...(status === 'awaiting-provider-verification' ? { summary: message } : {}),
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
