import {
    describe,
    expect,
    it,
} from 'vitest'

import type {
    ExecutionTraceHandle,
    ExecutionTraceModelCall,
} from '@lixpi/constants'

import {
    createCapabilityTraceRecorder,
    hasTraceContent,
} from './capability-trace-recorder.ts'

function makeHandle(overrides: Partial<ExecutionTraceHandle> = {}): ExecutionTraceHandle {
    return {
        kind: 'media',
        id: 'asset-1',
        displayName: 'asset-1',
        mediaKind: 'image',
        ...overrides,
    }
}

function makeModelCall(overrides: Partial<ExecutionTraceModelCall> = {}): ExecutionTraceModelCall {
    return {
        id: 'call-1',
        role: 'media',
        provider: 'openai',
        modelId: 'openai:gpt-image-1',
        ...overrides,
    }
}

// =============================================================================
// TRACE ACCUMULATION
// =============================================================================

describe('createCapabilityTraceRecorder — accumulation', () => {
    it('returns undefined until something is recorded', () => {
        expect(createCapabilityTraceRecorder().snapshot()).toBeUndefined()
    })

    it('records reasoning, handles, model calls, and facts into one trace', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.setReasoning('Chose the three-shot plan')
        recorder.addHandles(makeHandle())
        recorder.addModelCall(makeModelCall())
        recorder.addFact('Planned shots', '3')

        const trace = recorder.snapshot()

        expect(trace?.traceVersion).toBe('execution-trace-v1')
        expect(trace?.reasoning).toBe('Chose the three-shot plan')
        expect(trace?.handles).toHaveLength(1)
        expect(trace?.modelCalls?.[0]?.modelId).toBe('openai:gpt-image-1')
        expect(trace?.facts).toEqual([{ label: 'Planned shots', value: '3' }])
    })

    it('deduplicates handles by kind, id, and role but keeps the same id under a different role', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addHandles(makeHandle({ role: 'source' }), makeHandle({ role: 'source' }))
        recorder.addHandles(makeHandle({ role: 'edit-target' }))

        expect(recorder.snapshot()?.handles?.map(handle => handle.role)).toEqual(['source', 'edit-target'])
    })

    it('drops handles that carry no identity or no display name', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addHandles(makeHandle({ id: '' }), makeHandle({ displayName: '' }))

        expect(recorder.snapshot()).toBeUndefined()
    })

    it('replaces a model call recorded again under the same id', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addModelCall(makeModelCall({ providerOperationId: 'first' }))
        recorder.addModelCall(makeModelCall({ providerOperationId: 'second' }))

        expect(recorder.snapshot()?.modelCalls).toHaveLength(1)
        expect(recorder.snapshot()?.modelCalls?.[0]?.providerOperationId).toBe('second')
    })

    it('keeps each model call at the position it was first recorded when updated in place', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addModelCall(makeModelCall({ id: 'call-1' }))
        recorder.addModelCall(makeModelCall({ id: 'call-2' }))
        recorder.addModelCall(makeModelCall({ id: 'call-1', purpose: 'updated' }))

        expect(recorder.snapshot()?.modelCalls?.map(call => call.id)).toEqual(['call-1', 'call-2'])
        expect(recorder.snapshot()?.modelCalls?.[0]?.purpose).toBe('updated')
    })

    it('ignores facts missing a label or a value', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addFact('', 'value')
        recorder.addFact('label', '')

        expect(recorder.snapshot()).toBeUndefined()
    })

    it('does not expose its internal state through recorded values', () => {
        const recorder = createCapabilityTraceRecorder()
        const handle = makeHandle()
        recorder.addHandles(handle)
        handle.displayName = 'mutated after recording'

        expect(recorder.snapshot()?.handles?.[0]?.displayName).toBe('asset-1')
    })
})

// =============================================================================
// SETTLEMENT
// =============================================================================

describe('createCapabilityTraceRecorder — settlement', () => {
    it('adds settled summaries to an otherwise empty trace', () => {
        const trace = createCapabilityTraceRecorder().snapshot({
            inputSummary: 'string(12)',
            outputSummary: 'object(result)',
        })

        expect(trace?.inputSummary).toBe('string(12)')
        expect(trace?.outputSummary).toBe('object(result)')
    })

    it('carries a settled error message alongside what the step already recorded', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addModelCall(makeModelCall())

        const trace = recorder.snapshot({ errorMessage: 'Provider timed out' })

        expect(trace?.errorMessage).toBe('Provider timed out')
        expect(trace?.modelCalls).toHaveLength(1)
    })

    it('can be settled repeatedly without accumulating settled fields', () => {
        const recorder = createCapabilityTraceRecorder()
        recorder.addFact('label', 'value')

        expect(recorder.snapshot({ outputSummary: 'first' })?.outputSummary).toBe('first')
        expect(recorder.snapshot()?.outputSummary).toBeUndefined()
    })
})

// =============================================================================
// CONTENT DETECTION
// =============================================================================

describe('hasTraceContent', () => {
    it('rejects a trace carrying only its version', () => {
        expect(hasTraceContent({ traceVersion: 'execution-trace-v1' })).toBe(false)
    })

    it('accepts a trace carrying any single field', () => {
        expect(hasTraceContent({ traceVersion: 'execution-trace-v1', reasoning: 'why' })).toBe(true)
        expect(hasTraceContent({ traceVersion: 'execution-trace-v1', handles: [makeHandle()] })).toBe(true)
        expect(hasTraceContent({ traceVersion: 'execution-trace-v1', modelCalls: [makeModelCall()] })).toBe(true)
        expect(hasTraceContent({ traceVersion: 'execution-trace-v1', facts: [{ label: 'a', value: 'b' }] })).toBe(true)
        expect(hasTraceContent({ traceVersion: 'execution-trace-v1', errorMessage: 'boom' })).toBe(true)
    })

    it('rejects a trace whose collections are all empty', () => {
        expect(hasTraceContent({
            traceVersion: 'execution-trace-v1',
            handles: [],
            modelCalls: [],
            facts: [],
        })).toBe(false)
    })
})
