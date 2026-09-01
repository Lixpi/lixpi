import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type ExecutionTrace,
} from '@lixpi/constants'

import {
    colorPalette,
    settings,
} from '$src/settings.ts'

import {
    createExecutionTraceDetail,
    formatExecutionTraceDisplayValue,
    formatExecutionTraceDuration,
    formatExecutionTraceFieldLabel,
    formatExecutionTraceHandleRole,
    formatExecutionTraceModelId,
    formatExecutionTraceTokenUsage,
    getExecutionTraceDisplayFacts,
    getExecutionTraceTagPillColors,
    getExecutionTraceTagValues,
    getExecutionTraceKey,
    getExecutionTraceTagPillVariant,
    isExecutionTraceInternalIdValue,
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

    it('humanizes camel-case and delimiter-separated field labels', () => {
        expect(formatExecutionTraceFieldLabel('referenceImages')).toBe('Reference images')
        expect(formatExecutionTraceFieldLabel('overall-score')).toBe('Overall score')
        expect(formatExecutionTraceFieldLabel('conditioning')).toBe('Guidance applied')
        expect(formatExecutionTraceFieldLabel('failed-dimensions')).toBe('Checks needing review')
        expect(formatExecutionTraceFieldLabel('references-accepted-by-provider')).toBe('Reference roles used')
    })

    it('formats decimal scores as readable percentages', () => {
        expect(formatExecutionTraceDisplayValue('0.87')).toBe('87%')
        expect(formatExecutionTraceDisplayValue('0.875')).toBe('87.5%')
        expect(formatExecutionTraceDisplayValue('1.0')).toBe('100%')
        expect(formatExecutionTraceDisplayValue('3')).toBe('3')
        expect(formatExecutionTraceDisplayValue('1:1')).toBe('1:1')
    })

    it('groups duplicate result facts without losing their count', () => {
        expect(getExecutionTraceDisplayFacts([
            { label: 'edit-target', value: '1242×2496' },
            { label: 'edit-target', value: '1242×2496' },
            { label: 'overall-score', value: '0.87' },
        ])).toEqual([
            { label: 'Edit targets (2)', value: '1242×2496' },
            { label: 'Overall score', value: '87%' },
        ])
    })

    it('identifies categorical trace values that belong in tag pills', () => {
        expect(getExecutionTraceTagValues('edit, identity, style')).toEqual(['edit', 'identity', 'style'])
        expect(getExecutionTraceTagValues('canonical-anchor')).toEqual(['canonical-anchor'])
        expect(getExecutionTraceTagValues('passed')).toEqual(['passed'])
        expect(getExecutionTraceTagValues('1024×1280')).toEqual([])
        expect(getExecutionTraceTagValues('a very long categorical value that must wrap as text')).toEqual([])
    })

    it('uses distinct pill variants for statuses and adjacent categorical values', () => {
        expect(getExecutionTraceTagPillVariant('passed')).toBe('explicit')
        expect(getExecutionTraceTagPillVariant('failed')).toBe('auto')
        expect(getExecutionTraceTagPillVariant('identity', 0)).toBe('explicit')
        expect(getExecutionTraceTagPillVariant('style', 1)).toBe('auto')
    })

    it('assigns visible semantic colors and cycles category colors', () => {
        expect(getExecutionTraceTagPillColors('passed').fillActive).toBe(colorPalette.perfectLightGreen)
        expect(getExecutionTraceTagPillColors('failed').fillActive).toBe(colorPalette.codeRedHover)
        expect(getExecutionTraceTagPillColors('pending').fillActive).toBe(colorPalette.codeYellowHover)
        expect(getExecutionTraceTagPillColors('identity', 0).fillActive)
            .toBe(settings.gradient.styles.shiftingColors[2])
        expect(getExecutionTraceTagPillColors('style', 1).fillActive).toBe(colorPalette.perfectLightGreen)
        expect(getExecutionTraceTagPillColors('pose', 2).fillActive)
            .toBe(settings.gradient.styles.shiftingColors[1])
    })

    it('identifies UUID-bearing internal values even when they have a provider prefix', () => {
        expect(isExecutionTraceInternalIdValue('media-b614f5f4-5d58-4291-9399-daaeba5d6d54')).toBe(true)
        expect(isExecutionTraceInternalIdValue('google-143583f1-7c3b-48ca-9f4a-13baeeebb6e8')).toBe(true)
        expect(isExecutionTraceInternalIdValue('Gemini 3 Pro Image')).toBe(false)
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
        expect(call.querySelector('.execution-trace-model-call-header > .execution-trace-value-tag')).toBeNull()
        expect(call.querySelector('.media-model-badge-model')?.textContent).toBe('gpt-image-1')
        expect(call.querySelector('.media-model-badge-provider')?.textContent).toBe('openai')
        expect(call.querySelector('.media-model-badge-icon svg')).not.toBeNull()
        expect(call.textContent).toContain('Parameters')
        expect(call.textContent).toContain('Output size')
        expect(call.textContent).toContain('1024x1536')
        detail.destroy()
    })

    it('renders parameters, results, and metadata as list items without table structures', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                facts: [{ label: 'References accepted', value: 'canonical-anchor, edit-target' }],
                modelCalls: [{
                    id: 'render',
                    role: 'media',
                    provider: 'openai',
                    modelId: 'openai:gpt-image-1',
                    params: [
                        { name: 'size', value: '1024x1536' },
                        { name: 'conditioning', value: 'edit, identity, pose' },
                    ],
                    providerOperationId: 'op-1',
                    startedAt: 0,
                    completedAt: 2000,
                }],
            }),
        })

        expect(detail.element.querySelector('table, thead, tbody, tr, th, td, dl, dt, dd')).toBeNull()
        expect(detail.element.querySelectorAll('.execution-trace-value-item')).toHaveLength(4)
        const tagLabels = [...detail.element.querySelectorAll('.execution-trace-value-item .tag-pill-label')]
            .map(node => node.textContent)
        expect(tagLabels).toEqual([
            'Edit',
            'Identity',
            'Pose',
            'Canonical anchor',
            'Edit target',
        ])
        const tagBackground = detail.element.querySelector('.execution-trace-value-tag .tag-pill-background')
        expect(tagBackground?.getAttribute('fill')).not.toBe('transparent')
        expect(tagBackground?.getAttribute('stroke')).toBe('transparent')
        expect((tagBackground as SVGElement | null)?.style.getPropertyValue('fill')).not.toBe('')
        expect((tagBackground as SVGElement | null)?.style.getPropertyValue('stroke')).toBe('transparent')
        const firstValueTag = detail.element.querySelector<SVGSVGElement>(
            '.execution-trace-value-item .execution-trace-value-tag',
        )
        expect(firstValueTag?.tagName.toLowerCase()).toBe('svg')
        expect(firstValueTag?.getAttribute('aria-label')).toBe('Edit')
        expect(firstValueTag?.getAttribute('data-help-tooltip')).toBe('aria-label')
        expect(firstValueTag?.getAttribute('title')).toBeNull()
        expect(firstValueTag?.style.width).toBe(`${firstValueTag?.getAttribute('width')}px`)
        expect(firstValueTag?.style.backgroundColor).toBe(settings.gradient.styles.shiftingColors[2])
        expect(firstValueTag?.style.getPropertyPriority('background')).toBe('important')
        expect(firstValueTag?.style.borderRadius).toBe('9px')
        expect(firstValueTag?.style.boxShadow).toBe('none')
        expect(firstValueTag?.querySelector('.tag-pill-label')?.getAttribute('font-size')).toBe('11')
        expect(firstValueTag?.querySelector('.tag-pill-label')?.getAttribute('y')).toBe('9')
        expect(firstValueTag?.querySelector('.tag-pill-label')?.getAttribute('dominant-baseline')).toBe('central')
        const valueTagFills = [...detail.element.querySelectorAll(
            '.execution-trace-value-item .tag-pill-background',
        )].map(node => node.getAttribute('fill'))
        expect(valueTagFills.slice(0, 3)).toEqual([
            settings.gradient.styles.shiftingColors[2],
            colorPalette.perfectLightGreen,
            settings.gradient.styles.shiftingColors[1],
        ])
        expect(new Set(valueTagFills).size).toBeGreaterThan(2)
        expect(detail.element.querySelectorAll('.execution-trace-value-item-tags')).toHaveLength(2)
        expect(detail.element.textContent).toContain('Outcome')
        expect(detail.element.textContent).toContain('Guidance applied')
        expect(detail.element.textContent).not.toContain('op-1')
        detail.destroy()
    })

    it('hides UUID-bearing parameters and result facts', () => {
        const detail = createExecutionTraceDetail({
            trace: makeTrace({
                facts: [
                    { label: 'Generation request', value: 'media-b614f5f4-5d58-4291-9399-daaeba5d6d54' },
                    { label: 'Media runs', value: '3' },
                ],
                modelCalls: [{
                    id: 'render',
                    role: 'media',
                    provider: 'google',
                    modelId: 'google:gemini-3-pro-image',
                    params: [
                        { name: 'operation', value: 'google-143583f1-7c3b-48ca-9f4a-13baeeebb6e8' },
                        { name: 'size', value: '1:1' },
                    ],
                }],
            }),
        })

        const text = detail.element.textContent ?? ''
        expect(text).not.toContain('Generation request')
        expect(text).not.toContain('b614f5f4-5d58-4291-9399-daaeba5d6d54')
        expect(text).not.toContain('143583f1-7c3b-48ca-9f4a-13baeeebb6e8')
        expect(text).toContain('Media runs')
        expect(text).toContain('1:1')
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

    it('renders a model call footer only when it has timing or usage', () => {
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
                    tokenUsage: { input: 10, output: 5 },
                }],
            }),
        })
        const footer = detailed.element.querySelector('.execution-trace-model-call-footer')
        expect(footer?.textContent).toContain('2.0 s')
        expect(footer?.textContent).toContain('10 in · 5 out')
        expect(footer?.textContent).not.toContain('op-1')
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

    it('gives standalone Tool and Skill handles the shared capability hover-card trigger', () => {
        const detail = createExecutionTraceDetail({
            previewRenderer: {
                getNode: () => undefined,
                getCapabilityModule: async () => ({}) as never,
                environment: {
                    getDocuments: () => [],
                    getThreads: () => [],
                    document,
                    tooltipHideDelayMs: 0,
                    getArtifactIcon: () => '',
                    extractDocumentText: () => '',
                    initialRenditionUrl: () => '',
                    resolveRenditionUrl: async () => '',
                    onError: vi.fn(),
                },
            },
            trace: makeTrace({
                handles: [
                    { kind: 'tool', id: 'module.tool', displayName: 'Some Tool' },
                    { kind: 'skill', id: 'module.skill', displayName: 'Some Skill' },
                ],
            }),
        })

        expect(detail.element.querySelectorAll('.capability-description-preview')).toHaveLength(2)
        expect(detail.element.querySelector('.prompt-reference-chip-tool .help-tooltip-trigger')).not.toBeNull()
        expect(detail.element.querySelector('.prompt-reference-chip-skill .help-tooltip-trigger')).not.toBeNull()
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

        const labels = [...detail.element.querySelectorAll('.execution-trace-model-call-handles .execution-trace-field-label')]
            .map(node => node.textContent)
        expect(labels).toEqual(['Inputs', 'Outputs'])
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
