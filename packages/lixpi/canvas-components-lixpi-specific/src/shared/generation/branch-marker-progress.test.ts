import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type CapabilityRunEvent,
    type ExecutionTraceHandle,
    type ImageCanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    BranchCapabilityProgress,
    buildBranchMarkerProgress,
    type BranchMarkerProgressOptions,
} from './branch-marker-progress.ts'

function event(sequence: number, overrides: Partial<CapabilityRunEvent> = {}): CapabilityRunEvent {
    return { runId: 'run', sequence, timestamp: sequence, eventType: 'STEP_STARTED', runStatus: 'running', stepId: 'step', stepStatus: 'running', stepTitle: 'Prepare input', ...overrides }
}

function progress(overrides: Partial<BranchMarkerProgressOptions> = {}) {
    return buildBranchMarkerProgress({ nodeId: 'marker', generationRequestId: 'request', nodes: [], capabilityRuns: [], pending: false, active: false, responseText: '', isReasoningReceiving: false, promptHandles: [], mediaModelDescriptors: [], updatedAt: 123, ...overrides })
}

describe('BranchCapabilityProgress', () => {
    it('rejects duplicate or out-of-order events and retains step metadata across updates', () => {
        const runs = new BranchCapabilityProgress()
        const trace = { traceVersion: 'execution-trace-v1' as const, reasoning: 'Prepared input' }
        expect(runs.apply('thread', event(2, { trace, safeInputSummary: 'Input' }))).toBe(true)
        const snapshot = runs.get('thread')!.get('run')!
        expect(runs.apply('thread', event(1, { runStatus: 'failed', errorMessage: 'Stale' }))).toBe(false)
        expect(runs.apply('thread', event(2))).toBe(false)
        expect(runs.apply('thread', event(3, { stepTitle: undefined, stepStatus: 'completed', safeOutputSummary: 'Output' }))).toBe(true)
        expect(runs.get('thread')!.get('run')!.steps.get('step')).toEqual({ id: 'step', title: 'Prepare input', status: 'completed', summary: 'Output', trace })
        expect(snapshot.steps.get('step')!.status).toBe('running')
    })

    it('isolates thread and instance state and drops it on workspace cleanup', () => {
        const a = new BranchCapabilityProgress(), b = new BranchCapabilityProgress()
        a.apply('one', event(1))
        a.apply('two', event(1, { runStatus: 'completed' }))
        b.apply('one', event(1, { runStatus: 'failed' }))
        expect(a.get('one')!.get('run')!.status).toBe('running')
        expect(a.get('two')!.get('run')!.status).toBe('completed')
        a.clear()
        expect(a.get('one')).toBeUndefined()
        expect(a.get('two')).toBeUndefined()
        expect(b.get('one')!.get('run')!.status).toBe('failed')
    })
})

describe('buildBranchMarkerProgress', () => {
    it('omits inactive branches without a request or Capability history', () => {
        const unrelated = { type: 'operationStatus', nodeId: 'other', operation: 'media-generation', generationRequestId: 'other-request', status: 'running' } as OperationStatusCanvasNode
        expect(progress({ nodes: [unrelated] })).toBeNull()
        expect(progress({ pending: true })?.status).toBe('running')
    })

    it('settles lagging Capability steps from completed output progress and ignores superseded operation status', () => {
        const runs = new BranchCapabilityProgress()
        runs.apply('thread', event(1))
        const output = { type: 'image', nodeId: 'output', mediaGenerationPhase: 'ready', generationProgress: { generationRequestId: 'request', mediaRunId: 'media-run', status: 'running' } } as ImageCanvasNode
        const operation = { type: 'operationStatus', nodeId: 'operation', operation: 'media-generation', generationRequestId: 'request', outputNodeId: 'output', mediaRunId: 'media-run', status: 'running' } as OperationStatusCanvasNode
        const state = progress({ nodes: [output, operation], capabilityRuns: [...runs.get('thread')!.values()] })!
        const steps = state.progress!.items!
        expect(state.status).toBe('completed')
        expect(steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed'])
        expect(steps[1]!.children![0]!.children![0]!.status).toBe('completed')
        expect(state.progress!.completedSteps).toBe(3)
        expect(output.generationProgress?.status).toBe('running')
    })

    it('projects supplied reasoning and model metadata without changing their identities', () => {
        const promptHandles: ExecutionTraceHandle[] = [{ kind: 'media', id: 'canonical-asset', displayName: 'Reference' }]
        const state = progress({ active: true, responseText: 'First\n  response', isReasoningReceiving: true, promptHandles, reasoningModelDescriptor: { modelId: 'test:reasoning', modelProvider: 'test' }, mediaModelDescriptors: [{ label: 'Image', modelId: 'test:image' }] })!
        const steps = state.progress!.items!
        expect(steps[0]!.summary).toBe('First response')
        expect(steps[0]!.showSummaryWhenCollapsed).toBe(true)
        expect(steps[0]!.trace?.modelCalls?.[0]).toMatchObject({ provider: 'test', modelId: 'test:reasoning', role: 'reasoning' })
        expect(steps[0]!.trace?.modelCalls?.[0]?.inputHandles).toEqual(promptHandles)
        expect(steps[0]!.trace?.handles).toEqual(promptHandles)
        expect(steps[1]!.trace?.handles).toEqual(promptHandles)
        expect(steps[2]!.trace?.facts).toContainEqual({ label: 'Image model', value: 'test:image' })
        expect(state.updatedAt).toBe(123)
    })
})
