import type {
    ExecutionTrace,
    ExecutionTraceFact,
    ExecutionTraceHandle,
    ExecutionTraceModelCall,
    ExecutionTraceParam,
} from '@lixpi/constants'
import {
    createTagPill,
    type TagPillColors,
    type TagPillVariant,
} from '@lixpi/ui-kit/components/tag-pill'
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import { select } from 'd3-selection'

import {
    createCapabilityPromptReferencePreview,
    createMediaPromptReferencePreview,
    createPromptReferenceChipElement,
    type PromptReferencePreviewRenderer,
} from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'
import {
    applyMediaModelBadgeStyleProperties,
    resolveMediaModelBadgeConfig,
} from '$src/components/mediaModelBadge.ts'
import { colorPalette, settings } from '$src/settings.ts'
import { html } from '$src/utils/domTemplates.ts'

export type ExecutionTraceDetailInstance = {
    element: HTMLElement
    destroy: () => void
}

export type CreateExecutionTraceDetailOptions = {
    trace: ExecutionTrace
    // Supplies Asset lookup and Capability metadata so handles render with the
    // same hover cards the prompt editor and user messages use. Without it the
    // trace still renders, with plain chips instead of hover cards.
    previewRenderer?: PromptReferencePreviewRenderer
    inlinePopover?: boolean
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right'
}

const MODEL_CALL_ROLE_LABELS: Readonly<Record<ExecutionTraceModelCall['role'], string>> = {
    reasoning: 'Reasoning model',
    media: 'Media model',
    resolver: 'Resolver model',
    assessor: 'Assessor model',
    compositor: 'Compositor',
}

const TRACE_TAG_MAX_LABEL_LENGTH = 28
const TRACE_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu
const TRACE_CATEGORICAL_TAG_VARIANTS = ['explicit', 'auto'] as const satisfies readonly TagPillVariant[]
const TRACE_FIELD_LABELS = new Map<string, string>([
    ['attempt', 'Provider attempt'],
    ['conditioning', 'Guidance applied'],
    ['failed dimensions', 'Checks needing review'],
    ['generated anchors attached', 'Generated anchors used'],
    ['max identity references', 'Identity reference limit'],
    ['max reference images', 'Provider reference limit'],
    ['reference entries', 'References prepared'],
    ['reference images', 'Reference images'],
    ['references accepted by provider', 'Reference roles used'],
    ['shots placed', 'Shots included'],
    ['shots unavailable', 'Missing shots'],
    ['size', 'Output size'],
])
const SINGLE_VALUE_TAGS = new Set([
    'complete',
    'completed',
    'failed',
    'false',
    'passed',
    'pending',
    'skipped',
    'true',
])
const POSITIVE_VALUE_TAGS = new Set(['complete', 'completed', 'passed', 'true'])
const CAUTION_VALUE_TAGS = new Set(['failed', 'false', 'pending', 'skipped'])
const TRACE_TAG_POSITIVE_COLORS = {
    fill: colorPalette.perfectLightGreen,
    fillActive: colorPalette.perfectLightGreen,
    fillHover: colorPalette.yetAnotherLightGreen,
    stroke: 'transparent',
    strokeActive: 'transparent',
    text: colorPalette.nightBlue,
    closeHover: 'rgba(66, 73, 79, 0.1)',
} as const satisfies TagPillColors
const TRACE_TAG_DANGER_COLORS = {
    fill: colorPalette.codeRedHover,
    fillActive: colorPalette.codeRedHover,
    fillHover: colorPalette.offWhite,
    stroke: 'transparent',
    strokeActive: 'transparent',
    text: colorPalette.nightBlue,
    closeHover: 'rgba(66, 73, 79, 0.1)',
} as const satisfies TagPillColors
const TRACE_TAG_CAUTION_COLORS = {
    fill: colorPalette.codeYellowHover,
    fillActive: colorPalette.codeYellowHover,
    fillHover: colorPalette.offWhite,
    stroke: 'transparent',
    strokeActive: 'transparent',
    text: colorPalette.nightBlue,
    closeHover: 'rgba(66, 73, 79, 0.1)',
} as const satisfies TagPillColors
const TRACE_TAG_VIOLET_COLORS = {
    fill: settings.gradient.styles.shiftingColors[1],
    fillActive: settings.gradient.styles.shiftingColors[1],
    fillHover: settings.gradient.styles.shiftingColors[3],
    stroke: 'transparent',
    strokeActive: 'transparent',
    text: colorPalette.nightBlue,
    closeHover: 'rgba(66, 73, 79, 0.1)',
} as const satisfies TagPillColors
const TRACE_CATEGORICAL_TAG_COLORS = [
    {
        fill: settings.gradient.styles.shiftingColors[2],
        fillActive: settings.gradient.styles.shiftingColors[2],
        fillHover: settings.gradient.styles.shiftingColors[1],
        stroke: 'transparent',
        strokeActive: 'transparent',
        text: colorPalette.nightBlue,
        closeHover: 'rgba(66, 73, 79, 0.1)',
    },
    {
        fill: colorPalette.perfectLightGreen,
        fillActive: colorPalette.perfectLightGreen,
        fillHover: colorPalette.yetAnotherLightGreen,
        stroke: 'transparent',
        strokeActive: 'transparent',
        text: colorPalette.nightBlue,
        closeHover: 'rgba(66, 73, 79, 0.1)',
    },
    TRACE_TAG_VIOLET_COLORS,
    {
        fill: settings.gradient.styles.shiftingColors[3],
        fillActive: settings.gradient.styles.shiftingColors[3],
        fillHover: settings.gradient.styles.shiftingColors[0],
        stroke: 'transparent',
        strokeActive: 'transparent',
        text: colorPalette.nightBlue,
        closeHover: 'rgba(66, 73, 79, 0.1)',
    },
    {
        fill: settings.gradient.styles.shiftingColors[0],
        fillActive: settings.gradient.styles.shiftingColors[0],
        fillHover: colorPalette.codeYellowHover,
        stroke: 'transparent',
        strokeActive: 'transparent',
        text: colorPalette.nightBlue,
        closeHover: 'rgba(66, 73, 79, 0.1)',
    },
] as const satisfies readonly TagPillColors[]

// The trace stores raw provider ids (`openai:gpt-image-1`). The provider prefix
// is rendered separately, so the model line stays readable at canvas sizes.
export function formatExecutionTraceModelId(modelId: string): string {
    const parts = modelId.split(':')
    return parts.length > 1 ? parts.slice(1).join(':') : modelId
}

export function formatExecutionTraceHandleRole(role: string): string {
    return role
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .map((part, index) => index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
        .join(' ')
}

export function formatExecutionTraceFieldLabel(label: string): string {
    const words = label
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .join(' ')
    if (!words) return label
    const mappedLabel = TRACE_FIELD_LABELS.get(words.toLowerCase())
    return mappedLabel ?? `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

export function formatExecutionTraceDisplayValue(value: string): string {
    if (!/^(?:0?\.\d+|1\.0+)$/u.test(value.trim())) return value
    const percentage = Number(value) * 100
    if (!Number.isFinite(percentage)) return value
    return `${Number(percentage.toFixed(1))}%`
}

export function formatExecutionTraceTagLabel(label: string): string {
    return formatExecutionTraceFieldLabel(label)
}

export function getExecutionTraceTagPillVariant(label: string, index = 0): TagPillVariant {
    const normalizedLabel = label.trim().toLowerCase()
    if (POSITIVE_VALUE_TAGS.has(normalizedLabel)) return 'explicit'
    if (CAUTION_VALUE_TAGS.has(normalizedLabel)) return 'auto'
    return TRACE_CATEGORICAL_TAG_VARIANTS[index % TRACE_CATEGORICAL_TAG_VARIANTS.length]
}

export function getExecutionTraceTagPillColors(label: string, index = 0): TagPillColors {
    const normalizedLabel = label.trim().toLowerCase()
    if (POSITIVE_VALUE_TAGS.has(normalizedLabel)) return TRACE_TAG_POSITIVE_COLORS
    if (normalizedLabel === 'failed' || normalizedLabel === 'false') return TRACE_TAG_DANGER_COLORS
    if (normalizedLabel === 'pending' || normalizedLabel === 'skipped') return TRACE_TAG_CAUTION_COLORS
    return TRACE_CATEGORICAL_TAG_COLORS[index % TRACE_CATEGORICAL_TAG_COLORS.length]!
}

export function getExecutionTraceTagValues(value: string): string[] {
    const values = value.split(',').map(item => item.trim()).filter(Boolean)
    if (values.length === 0 || values.some(item => item.length > TRACE_TAG_MAX_LABEL_LENGTH)) return []
    if (values.length > 1) return values

    const [singleValue] = values
    if (SINGLE_VALUE_TAGS.has(singleValue.toLowerCase())) return values
    return /^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(singleValue) ? values : []
}

export function isExecutionTraceInternalIdValue(value: string): boolean {
    return TRACE_UUID_PATTERN.test(value)
}

export function getExecutionTraceDisplayFacts(
    facts: readonly ExecutionTraceFact[],
): ExecutionTraceFact[] {
    const groupedFacts = new Map<string, ExecutionTraceFact & { count: number }>()
    for (const fact of facts) {
        if (isExecutionTraceInternalIdValue(fact.value)) continue
        const key = `${fact.label}\u0000${fact.value}`
        const existing = groupedFacts.get(key)
        if (existing) {
            existing.count += 1
            continue
        }
        groupedFacts.set(key, {
            label: formatExecutionTraceFieldLabel(fact.label),
            value: formatExecutionTraceDisplayValue(fact.value),
            count: 1,
        })
    }

    return [...groupedFacts.values()].map(({ count, ...fact }) => count > 1
        ? {
            ...fact,
            label: `${fact.label}${fact.label.endsWith('s') ? '' : 's'} (${count})`,
        }
        : fact)
}

export function formatExecutionTraceDuration(startedAt?: number, completedAt?: number): string {
    if (typeof startedAt !== 'number' || typeof completedAt !== 'number') return ''
    const milliseconds = completedAt - startedAt
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return ''
    return milliseconds < 1000
        ? `${Math.round(milliseconds)} ms`
        : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}

export function formatExecutionTraceTokenUsage(usage: ExecutionTraceModelCall['tokenUsage']): string {
    if (!usage) return ''
    return [
        typeof usage.input === 'number' ? `${usage.input} in` : '',
        typeof usage.output === 'number' ? `${usage.output} out` : '',
        typeof usage.reasoning === 'number' ? `${usage.reasoning} reasoning` : '',
    ].filter(Boolean).join(' · ')
}

// A trace is fully described by its own content, so its identity is its content.
// Hosts pass this to the timeline so rendered detail blocks — and the hover
// cards inside them — survive streamed progress updates untouched.
export function getExecutionTraceKey(trace: ExecutionTrace | null | undefined): string {
    if (!trace) return ''
    try {
        return JSON.stringify(trace) ?? ''
    } catch {
        return ''
    }
}

export function isRenderableExecutionTrace(trace: unknown): trace is ExecutionTrace {
    if (!trace || typeof trace !== 'object') return false
    const candidate = trace as ExecutionTrace
    if (candidate.traceVersion !== 'execution-trace-v1') return false
    return Boolean(
        candidate.reasoning
        || candidate.handles?.length
        || candidate.modelCalls?.length
        || candidate.facts?.length
        || candidate.inputSummary
        || candidate.outputSummary
        || candidate.errorMessage,
    )
}

class ExecutionTraceDetail implements ExecutionTraceDetailInstance {
    readonly element: HTMLElement

    private readonly previewInstances: Array<{ destroy: () => void }> = []
    private valueTagSequence = 0

    constructor(private readonly options: CreateExecutionTraceDetailOptions) {
        const trace = options.trace
        this.element = html`
            <div className="execution-trace">
                ${trace.reasoning ? this.renderProse('Reasoning', trace.reasoning) : null}
                ${trace.inputSummary ? this.renderProse('Input', trace.inputSummary) : null}
                ${trace.handles?.length ? this.renderHandleSection('Passed in', trace.handles) : null}
                ${trace.modelCalls?.length ? this.renderModelCalls(trace.modelCalls) : null}
                ${trace.facts?.length ? this.renderFacts(trace.facts) : null}
                ${trace.outputSummary ? this.renderProse('Output', trace.outputSummary) : null}
                ${trace.errorMessage
                    ? html`
                        <section className="execution-trace-section execution-trace-section-error">
                            <h4 className="execution-trace-section-title">Error</h4>
                            <p className="execution-trace-prose">${trace.errorMessage}</p>
                        </section>
                    `
                    : null}
            </div>
        ` as HTMLElement
    }

    destroy(): void {
        for (const instance of this.previewInstances) instance.destroy()
        this.previewInstances.length = 0
        this.element.remove()
    }

    private renderProse(title: string, text: string): HTMLElement {
        return html`
            <section className="execution-trace-section">
                <h4 className="execution-trace-section-title">${title}</h4>
                <p className="execution-trace-prose">${text}</p>
            </section>
        ` as HTMLElement
    }

    private renderHandleSection(title: string, handles: readonly ExecutionTraceHandle[]): HTMLElement {
        return html`
            <section className="execution-trace-section">
                <h4 className="execution-trace-section-title">${title}</h4>
                ${this.renderHandleList(handles)}
            </section>
        ` as HTMLElement
    }

    private renderHandleList(handles: readonly ExecutionTraceHandle[]): HTMLElement {
        return html`
            <ul className="execution-trace-handles">
                ${handles.map(handle => html`
                    <li className="execution-trace-handle" data-handle-kind=${handle.kind}>
                        ${this.renderHandle(handle)}
                        ${handle.role
                            ? html`<span className="execution-trace-handle-role">${formatExecutionTraceHandleRole(handle.role)}</span>`
                            : null}
                        ${handle.note
                            ? html`<span className="execution-trace-handle-note">${handle.note}</span>`
                            : null}
                    </li>
                `)}
            </ul>
        ` as HTMLElement
    }

    // Every handle renders as the shared prompt-reference chip. Media handles get
    // the Asset hover card, Capability/Tool/Skill handles get the capability
    // description card; anything unresolvable degrades to the bare chip.
    private renderHandle(handle: ExecutionTraceHandle): HTMLElement {
        const previewRenderer = this.options.previewRenderer
        const placement = this.options.preferredPlacement ?? 'top'
        if (handle.kind === 'media' && previewRenderer) {
            const preview = createMediaPromptReferencePreview(
                {
                    referenceType: 'media',
                    assetId: handle.id,
                    ...(handle.nodeId ? { nodeId: handle.nodeId } : {}),
                    mediaKind: handle.mediaKind ?? 'image',
                    displayName: handle.displayName,
                },
                previewRenderer,
                { inlinePopover: this.options.inlinePopover, preferredPlacement: placement },
            )
            if (preview) {
                this.previewInstances.push(preview)
                return preview.dom
            }
        }
        if (
            (handle.kind === 'capability-module' || handle.kind === 'tool' || handle.kind === 'skill')
            && previewRenderer?.getCapabilityModule
        ) {
            const preview = createCapabilityPromptReferencePreview(
                { moduleId: handle.id, displayName: handle.displayName },
                previewRenderer,
                { inlinePopover: this.options.inlinePopover, preferredPlacement: placement },
            )
            this.previewInstances.push(preview)
            preview.dom.classList.add(`prompt-reference-chip-${handle.kind}`)
            return preview.dom
        }
        return createPromptReferenceChipElement({
            referenceType: handle.kind === 'capability-artifact' ? 'capability-module' : handle.kind,
            displayName: handle.displayName,
            ...(handle.mediaKind ? { mediaKind: handle.mediaKind } : {}),
        })
    }

    private renderModelCalls(modelCalls: readonly ExecutionTraceModelCall[]): HTMLElement {
        return html`
            <section className="execution-trace-section">
                <h4 className="execution-trace-section-title">Model calls</h4>
                <ol className="execution-trace-model-calls">
                    ${modelCalls.map(modelCall => this.renderModelCall(modelCall))}
                </ol>
            </section>
        ` as HTMLElement
    }

    private renderModelCall(modelCall: ExecutionTraceModelCall): HTMLElement {
        const duration = formatExecutionTraceDuration(modelCall.startedAt, modelCall.completedAt)
        const tokenUsage = formatExecutionTraceTokenUsage(modelCall.tokenUsage)
        const visibleParams = modelCall.params?.filter(param => !isExecutionTraceInternalIdValue(param.value)) ?? []
        const modelBadge = createMediaModelBadge(resolveMediaModelBadgeConfig({
            modelId: modelCall.modelId,
            modelProvider: modelCall.provider,
        }))
        const modelHeader = html`
            <div className="execution-trace-model-call-header">
                <span className="execution-trace-model-call-role">${MODEL_CALL_ROLE_LABELS[modelCall.role]}</span>
                ${modelBadge}
            </div>
        ` as HTMLElement
        applyMediaModelBadgeStyleProperties(modelHeader, {
            scale: settings.mediaNode.generatedMediaChrome.chatScale,
        })
        return html`
            <li className="execution-trace-model-call" data-model-call-role=${modelCall.role}>
                ${modelHeader}
                ${modelCall.purpose
                    ? html`
                        <div className="execution-trace-field">
                            <span className="execution-trace-field-label">Purpose</span>
                            <p className="execution-trace-prose">${modelCall.purpose}</p>
                        </div>
                    `
                    : null}
                ${visibleParams.length
                    ? html`
                        <div className="execution-trace-field">
                            <span className="execution-trace-field-label">Parameters</span>
                            ${this.renderParams(visibleParams)}
                        </div>
                    `
                    : null}
                ${modelCall.inputHandles?.length
                    ? html`
                        <div className="execution-trace-model-call-handles">
                            <span className="execution-trace-field-label">Inputs</span>
                            ${this.renderHandleList(modelCall.inputHandles)}
                        </div>
                    `
                    : null}
                ${modelCall.systemPrompt ? this.renderCollapsibleText('System prompt', modelCall.systemPrompt) : null}
                ${modelCall.prompt ? this.renderCollapsibleText('Prompt', modelCall.prompt) : null}
                ${modelCall.responseExcerpt ? this.renderCollapsibleText('Response', modelCall.responseExcerpt) : null}
                ${modelCall.outputHandles?.length
                    ? html`
                        <div className="execution-trace-model-call-handles">
                            <span className="execution-trace-field-label">Outputs</span>
                            ${this.renderHandleList(modelCall.outputHandles)}
                        </div>
                    `
                    : null}
                ${modelCall.errorMessage
                    ? html`<p className="execution-trace-prose execution-trace-model-call-error">${modelCall.errorMessage}</p>`
                    : null}
                ${duration || tokenUsage
                    ? html`
                        ${this.renderValueList([
                            ...(duration ? [{ label: 'Duration', value: duration }] : []),
                            ...(tokenUsage ? [{ label: 'Tokens', value: tokenUsage }] : []),
                        ], 'execution-trace-model-call-footer')}
                    `
                    : null}
            </li>
        ` as HTMLElement
    }

    private renderParams(params: readonly ExecutionTraceParam[]): HTMLElement {
        return this.renderValueList(params.map(param => ({
            label: formatExecutionTraceFieldLabel(param.name),
            value: formatExecutionTraceDisplayValue(param.value),
        })))
    }

    private renderFacts(facts: readonly ExecutionTraceFact[]): HTMLElement | null {
        const displayFacts = getExecutionTraceDisplayFacts(facts)
        if (displayFacts.length === 0) return null
        return html`
            <section className="execution-trace-section">
                <h4 className="execution-trace-section-title">Outcome</h4>
                ${this.renderValueList(displayFacts)}
            </section>
        ` as HTMLElement
    }

    private renderValueList(
        items: ReadonlyArray<{
            label: string
            value: string
            valueClassName?: string
            allowTags?: boolean
        }>,
        className = '',
    ): HTMLElement {
        return html`
            <ul className="execution-trace-value-list ${className}">
                ${items.map((item) => {
                    const tagValues = item.allowTags === false ? [] : getExecutionTraceTagValues(item.value)
                    const itemClassName = tagValues.length
                        ? 'execution-trace-value-item execution-trace-value-item-tags'
                        : 'execution-trace-value-item'
                    return html`
                        <li className=${itemClassName}>
                            <span className="execution-trace-value-label">${item.label}</span>
                            ${this.renderValue(item.value, tagValues, item.valueClassName)}
                        </li>
                    `
                })}
            </ul>
        ` as HTMLElement
    }

    private renderValue(value: string, tagValues: readonly string[], valueClassName = ''): HTMLElement {
        if (tagValues.length === 0) {
            return html`<span className="execution-trace-value-text ${valueClassName}">${value}</span>` as HTMLElement
        }
        return html`
            <span className="execution-trace-value-tags ${valueClassName}">
                ${tagValues.map((tagValue, index) => this.renderValueTag(
                    tagValue,
                    getExecutionTraceTagPillColors(tagValue, index),
                    index,
                ))}
            </span>
        ` as HTMLElement
    }

    private renderValueTag(
        label: string,
        colors: TagPillColors,
        index: number,
    ): HTMLElement {
        const displayLabel = formatExecutionTraceTagLabel(label)
        const selectedFill = colors.fillActive ?? colors.fill ?? 'transparent'
        const selectedStroke = colors.strokeActive ?? colors.stroke ?? 'transparent'
        const tag = html`
            <svg
                className="execution-trace-value-tag"
                aria-label=${displayLabel}
                data-help-tooltip="aria-label"
            ></svg>
        ` as unknown as SVGSVGElement
        const tagPill = createTagPill(select(tag), {
            id: `execution-trace-value-tag-${this.valueTagSequence++}`,
            x: 0,
            y: 0,
            height: 18,
            label: displayLabel,
            fontSize: 11,
            fontWeight: 400,
            horizontalPadding: 6,
            selected: true,
            variant: getExecutionTraceTagPillVariant(label, index),
            colors,
            className: 'execution-trace-value-tag-pill',
        })
        tag.style.setProperty('background', selectedFill, 'important')
        tag.style.borderRadius = '9px'
        tag.style.boxShadow = selectedStroke === 'transparent'
            ? 'none'
            : `inset 0 0 0 1px ${selectedStroke}`
        this.previewInstances.push(tagPill)
        return tag
    }

    private renderCollapsibleText(title: string, text: string): HTMLElement {
        return html`
            <details className="execution-trace-text">
                <summary className="execution-trace-text-summary">${title}</summary>
                <p className="execution-trace-prose execution-trace-text-body">${text}</p>
            </details>
        ` as HTMLElement
    }
}

export function createExecutionTraceDetail(
    options: CreateExecutionTraceDetailOptions,
): ExecutionTraceDetailInstance {
    return new ExecutionTraceDetail(options)
}
