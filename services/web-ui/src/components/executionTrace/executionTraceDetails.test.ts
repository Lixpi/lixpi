import { describe, expect, it } from 'vitest'

import type { ExecutionTrace } from '@lixpi/constants'

import {
    createExecutionTraceDetail,
    formatExecutionTraceDuration,
    formatExecutionTraceHandleRole,
    formatExecutionTraceModelId,
    formatExecutionTraceTokenUsage,
    getExecutionTraceKey,
    isRenderableExecutionTrace,
} from './executionTraceDetails.ts'
import { createExecutionTraceTimelineDetailAdapter } from './executionTraceTimelineDetail.ts'

function makeTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
    return { traceVersion: 'execution-trace-v1', ...overrides }
}

function chipNames(element: HTMLElement): string[] {
    return [...element.querySelectorAll<HTMLElement>('.prompt-reference-chip-name')]
        .map(node => node.textContent ?? '')
}

// =============================================================================
// FORMATTERS
// =============================================================================

describe('executionTraceDetails — formatters', () => {
    it('strips the provider prefix from a namespaced model id', () => {
        expect(formatExecutionTraceModelId('openai:gpt-image-1')).toBe('gpt-image-1')
    })

    it('keeps a model id that carries no provider prefix', () => {
        expect(formatExecutionTraceModelId('gpt-image-1')).toBe('gpt-image-1')
    })

    it('keeps every segment after the first colon', () => {
        expect(formatExecutionTraceModelId('bedrock:us.anthropic:claude')).toBe('us.anthropic:claude')
    })

    it('humanizes a handle role without shouting the remaining words', () => {
        expect(formatExecutionTraceHandleRole('character-reference')).toBe('Character reference')
        expect(formatExecutionTraceHandleRole('edit_target_identity')).toBe('Edit target identity')
    })

    it('formats sub-second and multi-second durations differently', () => {
        expect(formatExecutionTraceDuration(0, 850)).toBe('850 ms')
        expect(formatExecutionTraceDuration(0, 4500)).toBe('4.5 s')
        expect(formatExecutionTraceDuration(0, 62_000)).toBe('62 s')
    })

    it('returns no duration when either endpoint is missing or the range is impossible', () => {
        expect(formatExecutionTraceDuration(undefined, 850)).toBe('')
        expect(formatExecutionTraceDuration(850, undefined)).toBe('')
        expect(formatExecutionTraceDuration(900, 850)).toBe('')
    })

    it('joins only the token counts that are present', () => {
        expect(formatExecutionTraceTokenUsage({ input: 10, output: 5 })).toBe('10 in · 5 out')
        expect(formatExecutionTraceTokenUsage({ reasoning: 7 })).toBe('7 reasoning')
        expect(formatExecutionTraceTokenUsage(undefined)).toBe('')
    })
})

// =============================================================================
// RENDERABILITY AND IDENTITY
// =============================================================================

describe('executionTraceDetails — renderability', () => {
    it('rejects a trace carrying nothing but its version', () => {
        expect(isRenderableExecutionTrace(makeTrace())).toBe(false)
    })

    it('rejects payloads that are not traces at all', () => {
        expect(isRenderableExecutionTrace(null)).toBe(false)
        expect(isRenderableExecutionTrace('trace')).toBe(false)
        expect(isRenderableExecutionTrace({ reasoning: 'why' })).toBe(false)
    })

    it('accepts a trace once it carries any content', () => {
        expect(isRenderableExecutionTrace(makeTrace({ reasoning: 'why' }))).toBe(true)
        expect(isRenderableExecutionTrace(makeTrace({ facts: [{ label: 'a', value: 'b' }] }))).toBe(true)
    })

    it('gives equal traces the same key and different traces different keys', () => {
        expect(getExecutionTraceKey(makeTrace({ reasoning: 'why' })))
            .toBe(getExecutionTraceKey(makeTrace({ reasoning: 'why' })))
        expect(getExecutionTraceKey(makeTrace({ reasoning: 'why' })))
            .not.toBe(getExecutionTraceKey(makeTrace({ reasoning: 'other' })))
    })

    it('returns an empty key for a missing trace', () => {
        expect(getExecutionTraceKey(null)).toBe('')
        expect(getExecutionTraceKey(undefined)).toBe('')
    })
})

// =============================================================================
// RENDERED CONTENT
// =============================================================================

describe('createExecutionTraceDetail — rendered content', () => {
    it('renders reasoning, facts, and output as labelled sections', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                reasoning: 'Chose a three-panel turnaround',
                facts: [{ label: 'Planned shots', value: '3' }],
                outputSummary: 'Sheet composed',
            }),
        })

        const text = detail.element.textContent ?? ''
        expect(text).toContain('Chose a three-panel turnaround')
        expect(text).toContain('Planned shots')
        expect(text).toContain('Sheet composed')
        detail.destroy()
    })

    it('renders each model call with its role, model, provider, and params', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                modelCalls: [{
                    id: 'render',
                    role: 'media',
                    provider: 'openai',
                    modelId: 'openai:gpt-image-1',
                    params: [{ name: 'size', value: '1024x1536' }],
                }],
            }),
        })

        const call = detail.element.querySelector('.execution-trace-model-call') as HTMLElement
        expect(call.dataset.modelCallRole).toBe('media')
        expect(call.querySelector('.execution-trace-model-call-role')?.textContent).toBe('Media model')
        expect(call.querySelector('.execution-trace-model-call-id')?.textContent).toBe('gpt-image-1')
        expect(call.querySelector('.execution-trace-model-call-provider')?.textContent).toBe('openai')
        expect(call.textContent).toContain('1024x1536')
        detail.destroy()
    })

    it('renders prompts inside collapsible regions rather than inline', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                modelCalls: [{
                    id: 'render',
                    role: 'media',
                    provider: 'openai',
                    modelId: 'openai:gpt-image-1',
                    systemPrompt: 'System instruction text',
                    prompt: 'Render the front body panel',
                }],
            }),
        })

        const summaries = [...detail.element.querySelectorAll('.execution-trace-text-summary')]
            .map(node => node.textContent)
        expect(summaries).toEqual(['System prompt', 'Prompt'])
        detail.destroy()
    })

    it('renders an error message for a failed step and for a failed model call', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                errorMessage: 'Step failed',
                modelCalls: [{
                    id: 'render',
                    role: 'media',
                    provider: 'openai',
                    modelId: 'openai:gpt-image-1',
                    errorMessage: 'Provider refused',
                }],
            }),
        })

        expect(detail.element.querySelector('.execution-trace-section-error')?.textContent).toContain('Step failed')
        expect(detail.element.querySelector('.execution-trace-model-call-error')?.textContent).toBe('Provider refused')
        detail.destroy()
    })

    it('renders a model call footer only when it has timing, usage, or an operation id', () => {
        const bare = createExecutionTraceDetail({
            trace: makeTrace({
                modelCalls: [{ id: 'a', role: 'media', provider: 'openai', modelId: 'm' }],
            }),
        })
        expect(bare.element.querySelector('.execution-trace-model-call-footer')).toBeNull()
        bare.destroy()

        const detailed = createExecutionTraceDetail({
            trace: makeTrace({
                modelCalls: [{
                    id: 'a',
                    role: 'media',
                    provider: 'openai',
                    modelId: 'm',
                    providerOperationId: 'op-1',
                    startedAt: 0,
                    completedAt: 2000,
                }],
            }),
        })
        const footer = detailed.element.querySelector('.execution-trace-model-call-footer')
        expect(footer?.textContent).toContain('2.0 s')
        expect(footer?.textContent).toContain('op-1')
        detailed.destroy()
    })
})

// =============================================================================
// HANDLES
// =============================================================================

describe('createExecutionTraceDetail — handles', () => {
    it('renders every handle kind as a prompt-reference chip without a preview renderer', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                handles: [
                    { kind: 'media', id: 'asset-1', displayName: 'Urban Street Art', mediaKind: 'image' },
                    { kind: 'capability-module', id: 'global.character-creator', displayName: 'Character Creator' },
                    { kind: 'tool', id: 'tool-1', displayName: 'Some Tool' },
                    { kind: 'skill', id: 'skill-1', displayName: 'Some Skill' },
                ],
            }),
        })

        expect(chipNames(detail.element)).toEqual([
            'Urban Street Art',
            'Character Creator',
            'Some Tool',
            'Some Skill',
        ])
        detail.destroy()
    })

    it('tags each handle with its kind and renders its role and note', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                handles: [{
                    kind: 'media',
                    id: 'asset-1',
                    displayName: 'asset-1',
                    mediaKind: 'image',
                    role: 'character-reference',
                    note: 'Generated during this run',
                }],
            }),
        })

        const handle = detail.element.querySelector('.execution-trace-handle') as HTMLElement
        expect(handle.dataset.handleKind).toBe('media')
        expect(handle.querySelector('.execution-trace-handle-role')?.textContent).toBe('Character reference')
        expect(handle.querySelector('.execution-trace-handle-note')?.textContent).toBe('Generated during this run')
        detail.destroy()
    })

    it('renders a capability-artifact handle as a chip rather than dropping it', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                handles: [{
                    kind: 'capability-artifact',
                    id: 'asset-2',
                    displayName: 'Character Sheet',
                    artifactTypeId: 'character-sheet',
                }],
            }),
        })

        expect(chipNames(detail.element)).toEqual(['Character Sheet'])
        detail.destroy()
    })

    it('renders per-model-call input and output handles under their own labels', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                modelCalls: [{
                    id: 'render',
                    role: 'media',
                    provider: 'openai',
                    modelId: 'openai:gpt-image-1',
                    inputHandles: [{ kind: 'media', id: 'in', displayName: 'Given asset', mediaKind: 'image' }],
                    outputHandles: [{ kind: 'media', id: 'out', displayName: 'Produced asset', mediaKind: 'image' }],
                }],
            }),
        })

        const labels = [...detail.element.querySelectorAll('.execution-trace-model-call-handles-label')]
            .map(node => node.textContent)
        expect(labels).toEqual(['Given', 'Produced'])
        expect(chipNames(detail.element)).toEqual(['Given asset', 'Produced asset'])
        detail.destroy()
    })

    it('renders nothing for a trace section that has no content', () => {
        const detail = createExecutionTraceDetail({ trace: makeTrace() })

        expect(detail.element.querySelectorAll('.execution-trace-section')).toHaveLength(0)
        detail.destroy()
    })
})

// =============================================================================
// TIMELINE ADAPTER
// =============================================================================

describe('createExecutionTraceTimelineDetailAdapter', () => {
    it('renders a trace payload into a timeline detail block', () => {
        const adapter = createExecutionTraceTimelineDetailAdapter()
        const rendered = adapter.renderItemDetail(makeTrace({ reasoning: 'why' }))

        expect(rendered?.element.classList.contains('execution-trace')).toBe(true)
        rendered?.destroy?.()
    })

    it('declines payloads that are not renderable traces', () => {
        const adapter = createExecutionTraceTimelineDetailAdapter()

        expect(adapter.renderItemDetail(makeTrace())).toBeNull()
        expect(adapter.renderItemDetail(null)).toBeNull()
        expect(adapter.renderItemDetail({ some: 'object' })).toBeNull()
    })

    it('keys a renderable trace by content and gives an empty key to everything else', () => {
        const adapter = createExecutionTraceTimelineDetailAdapter()

        expect(adapter.getItemDetailKey(makeTrace({ reasoning: 'why' })))
            .toBe(adapter.getItemDetailKey(makeTrace({ reasoning: 'why' })))
        expect(adapter.getItemDetailKey(makeTrace())).toBe('')
        expect(adapter.getItemDetailKey(null)).toBe('')
    })
})
