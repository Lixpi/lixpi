'use strict'

import type {
    ExecutionTrace,
    ExecutionTraceFact,
    ExecutionTraceHandle,
    ExecutionTraceModelCall,
} from '@lixpi/constants'

// Steps record what they actually did while they do it, rather than being
// summarized after the fact. A recorder is created per step by the workflow
// runner and handed to the action, so model calls, references, and reasoning
// are captured even when the step later fails.
export type CapabilityTraceRecorder = {
    setReasoning: (reasoning: string) => void
    addHandles: (...handles: ExecutionTraceHandle[]) => void
    addModelCall: (modelCall: ExecutionTraceModelCall) => void
    addFact: (label: string, value: string) => void
    snapshot: (settled?: {
        inputSummary?: string
        outputSummary?: string
        errorMessage?: string
    }) => ExecutionTrace | undefined
}

const handleIdentity = (handle: ExecutionTraceHandle): string => `${handle.kind}:${handle.id}:${handle.role ?? ''}`

export function createCapabilityTraceRecorder(): CapabilityTraceRecorder {
    let reasoning = ''
    const handlesByIdentity = new Map<string, ExecutionTraceHandle>()
    const modelCallsById = new Map<string, ExecutionTraceModelCall>()
    const facts: ExecutionTraceFact[] = []

    return {
        setReasoning: (value) => {
            reasoning = value
        },
        addHandles: (...handles) => {
            for (const handle of handles) {
                if (!handle.id || !handle.displayName) continue
                handlesByIdentity.set(handleIdentity(handle), structuredClone(handle))
            }
        },
        addModelCall: (modelCall) => {
            modelCallsById.set(modelCall.id, structuredClone(modelCall))
        },
        addFact: (label, value) => {
            if (!label || !value) return
            facts.push({ label, value })
        },
        snapshot: (settled = {}) => {
            const trace: ExecutionTrace = {
                traceVersion: 'execution-trace-v1',
                ...(reasoning ? { reasoning } : {}),
                ...(handlesByIdentity.size ? { handles: [...handlesByIdentity.values()] } : {}),
                ...(modelCallsById.size ? { modelCalls: [...modelCallsById.values()] } : {}),
                ...(facts.length ? { facts: [...facts] } : {}),
                ...(settled.inputSummary ? { inputSummary: settled.inputSummary } : {}),
                ...(settled.outputSummary ? { outputSummary: settled.outputSummary } : {}),
                ...(settled.errorMessage ? { errorMessage: settled.errorMessage } : {}),
            }
            return hasTraceContent(trace) ? trace : undefined
        },
    }
}

export function hasTraceContent(trace: ExecutionTrace): boolean {
    return Boolean(
        trace.reasoning
            || trace.handles?.length
            || trace.modelCalls?.length
            || trace.facts?.length
            || trace.inputSummary
            || trace.outputSummary
            || trace.errorMessage,
    )
}
