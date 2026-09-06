import {
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type OperationStatusCanvasNode,
    type CapabilityRunEvent,
    type ExecutionTrace,
    type ExecutionTraceHandle,
    type OperationProgressItem,
    type MediaGenerationProgressState,
} from '@lixpi/constants'
import {
    resolveBranchMarkerMediaRequestStatuses,
    resolveBranchMarkerGlobalProgressStatuses,
    settleBranchMarkerProgressStatusForTerminalMedia,
    settleReadyMediaGenerationProgress,
} from './progress-state.ts'

export type BranchCapabilityProgressStep = {
    id: string
    title: string
    status: NonNullable<CapabilityRunEvent['stepStatus']>
    summary?: string
    trace?: ExecutionTrace
}
export type BranchCapabilityProgressRun = {
    runId: string
    status: CapabilityRunEvent['runStatus']
    lastSequence: number
    steps: ReadonlyMap<string, BranchCapabilityProgressStep>
}

export class BranchCapabilityProgress {
    private readonly threads = new Map<string, Map<string, BranchCapabilityProgressRun>>()

    get(threadId: string): ReadonlyMap<string, BranchCapabilityProgressRun> | undefined {
        return this.threads.get(threadId)
    }

    apply(
        threadId: string,
        event: CapabilityRunEvent,
    ): boolean {
        const runs = this.threads.get(threadId) ?? new Map<string, BranchCapabilityProgressRun>()
        const previous = runs.get(event.runId)

        if (event.sequence <= (previous?.lastSequence ?? 0))
            return false

        const steps = new Map(previous?.steps)

        if (
            event.stepId
            && event.stepStatus
        ) {
            const existing = steps.get(event.stepId)
            steps.set(
                event.stepId,
                {
                    id: event.stepId,
                    title: event.stepTitle ?? existing?.title ?? event.stepId,
                    status: event.stepStatus,
                    summary: event.errorMessage ?? event.safeOutputSummary ?? event.safeInputSummary ?? existing?.summary,
                    ...(event.trace
                        ?? existing?.trace
                        ? { trace: event.trace ?? existing?.trace }
                        : {}),
                },
            )
        }

        runs.set(
            event.runId,
            {
                runId: event.runId,
                status: event.runStatus,
                lastSequence: event.sequence,
                steps,
            },
        )
        this.threads.set(threadId, runs)

        return true
    }

    clear(): void {
        this.threads.clear()
    }
}

export type BranchMarkerProgressOptions = {
    nodeId: string
    generationRequestId: string
    nodes: readonly CanvasNode[]
    capabilityRuns: readonly BranchCapabilityProgressRun[]
    pending: boolean
    active: boolean
    responseText: string
    isReasoningReceiving: boolean
    promptHandles: ExecutionTraceHandle[]
    reasoningModelDescriptor?: {
        modelId: string
        modelProvider?: string
    }
    mediaModelDescriptors: readonly {
        label: string
        modelId: string
    }[]
    updatedAt: number
}

const getCapabilityRunStatus = (status: CapabilityRunEvent['runStatus']): OperationProgressItem['status'] => {
    if (
        status === 'completed'
        || status === 'failed'
        || status === 'cancelled'
        || status === 'pending'
    )
        return status

    return 'running'
}

export const buildBranchMarkerProgress = ({
    nodeId,
    generationRequestId,
    nodes,
    capabilityRuns,
    pending,
    active,
    responseText,
    isReasoningReceiving,
    promptHandles,
    reasoningModelDescriptor,
    mediaModelDescriptors,
    updatedAt,
}: BranchMarkerProgressOptions): MediaGenerationProgressState | null => {
    const requestNodes = nodes.filter(
        (candidate): candidate is ImageCanvasNode | VideoCanvasNode | OperationStatusCanvasNode => (
            candidate.nodeId !== nodeId
            && (
                ((candidate.type === 'image' || candidate.type === 'video')
                    && (candidate.generationProgress?.generationRequestId
                            ?? candidate.generatedBy?.generationRequestId) === generationRequestId)
                || (candidate.type === 'operationStatus'
                    && candidate.operation === 'media-generation'
                    && candidate.generationRequestId === generationRequestId)
            )
        ),
    )
    const mediaRequestStatuses = resolveBranchMarkerMediaRequestStatuses(
        requestNodes.map(
            candidate => (
                candidate.type === 'operationStatus'
                    ? {
                        kind: 'operation' as const,
                        nodeId: candidate.nodeId,
                        outputNodeId: candidate.outputNodeId,
                        mediaRunId: candidate.mediaRunId,
                        status: candidate.status,
                    }
                    : {
                        kind: 'output' as const,
                        nodeId: candidate.nodeId,
                        mediaRunId: candidate.generationProgress?.mediaRunId ?? candidate.generatedBy?.mediaRunId,
                        status: candidate.generationProgress
                            ? settleReadyMediaGenerationProgress(candidate.generationProgress, candidate.mediaGenerationPhase).status
                            : candidate.mediaGenerationPhase === 'ready'
                                ? 'completed'
                                : undefined,
                    }
            ),
        ),
    )

    if (
        !pending
        && !active
        && requestNodes.length === 0
        && capabilityRuns.length === 0
    )
        return null

    const capabilityItems: OperationProgressItem[] = capabilityRuns.map(
        (run, index) => ({
            id: `capability:${run.runId}`,
            title: capabilityRuns.length === 1 ? 'Selected capability workflow' : `Capability workflow ${index + 1}`,
            status: settleBranchMarkerProgressStatusForTerminalMedia(
                getCapabilityRunStatus(run.status),
                mediaRequestStatuses,
            ),
            children: [...run.steps.values()].map(
                step => ({
                    id: `capability:${run.runId}:${step.id}`,
                    title: step.title,
                    status: settleBranchMarkerProgressStatusForTerminalMedia(step.status, mediaRequestStatuses),
                    ...(step.summary ? { summary: step.summary } : {}),
                    ...(step.trace ? { trace: step.trace } : {}),
                }),
            ),
        }),
    )
    const statuses = resolveBranchMarkerGlobalProgressStatuses({
        hasReasoningResponse: Boolean(responseText),
        isReasoningReceiving,
        branchPending: pending,
        branchActive: active,
        requestNodeCount: requestNodes.length,
        mediaRequestStatuses,
        capabilityRunStatuses: capabilityRuns.map(run => run.status),
    })
    const reasoningSummary = responseText.replace(/\s+/g, ' ').trim()
    const items: OperationProgressItem[] = [
        {
            id: 'understand-request',
            title: 'Understand request',
            status: statuses.reasoning,
            ...(reasoningSummary
                ? {
                    summary: reasoningSummary,
                    showSummaryWhenCollapsed: true,
                }
                : {}),
            trace: {
                traceVersion: 'execution-trace-v1',
                ...(reasoningSummary ? { reasoning: reasoningSummary } : {}),
                ...(promptHandles.length ? { handles: promptHandles } : {}),
                ...(reasoningModelDescriptor
                    ? {
                        modelCalls: [{
                            id: `reasoning:${generationRequestId}`,
                            role: 'reasoning' as const,
                            provider: reasoningModelDescriptor.modelProvider ?? '',
                            modelId: reasoningModelDescriptor.modelId,
                            purpose: 'Read the request, choose the Capabilities and references, and drive media generation.',
                            inputHandles: promptHandles,
                        }],
                    }
                    : {}),
            },
        },
        {
            id: 'resolve-capabilities-and-references',
            title: 'Resolve capabilities, tools, and references',
            status: statuses.capability,
            trace: {
                traceVersion: 'execution-trace-v1',
                ...(promptHandles.length ? { handles: promptHandles } : {}),
                facts: [
                    {
                        label: 'Capability runs',
                        value: String(capabilityRuns.length),
                    },
                    {
                        label: 'References attached',
                        value: String(promptHandles.filter(handle => handle.kind === 'media').length),
                    },
                ],
            },
            ...(capabilityItems.length ? { children: capabilityItems } : {}),
        },
        {
            id: 'resolve-branch-lineage',
            title: 'Resolve branch lineage and media runs',
            status: statuses.lineage,
            trace: {
                traceVersion: 'execution-trace-v1',
                facts: [
                    {
                        label: 'Media runs',
                        value: String(requestNodes.length),
                    },
                    ...mediaModelDescriptors.map(
                        descriptor => ({
                            label: `${descriptor.label} model`,
                            value: descriptor.modelId,
                        }),
                    ),
                ],
            },
        },
    ]

    return {
        generationRequestId,
        status: active
            || pending
            ? 'running'
            : 'completed',
        message: active
            || pending
            ? 'Preparing this branch.'
            : 'Branch preparation completed.',
        progress: {
            phase: 'preparing',
            completedSteps: items.filter(item => item.status === 'completed').length,
            totalSteps: items.length,
            message: active
                || pending
                ? 'Preparing this branch.'
                : 'Branch preparation completed.',
            items,
        },
        updatedAt,
    }
}
