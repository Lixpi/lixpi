import type {
    ExecutionTrace,
    ExecutionTraceFact,
    ExecutionTraceHandle,
    ExecutionTraceModelCall,
    ExecutionTraceParam,
} from '@lixpi/constants'

import {
    createCapabilityPromptReferencePreview,
    createMediaPromptReferencePreview,
    createPromptReferenceChipElement,
    type PromptReferencePreviewRenderer,
} from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'
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
        // Only Capability modules have a description sheet to hover; Tools and
        // Skills referenced on their own render as the same chip without a card,
        // exactly as they do in a user message.
        if (handle.kind === 'capability-module' && previewRenderer?.getCapabilityModule) {
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
        return html`
            <li className="execution-trace-model-call" data-model-call-role=${modelCall.role}>
                <div className="execution-trace-model-call-header">
                    <span className="execution-trace-model-call-role">${MODEL_CALL_ROLE_LABELS[modelCall.role]}</span>
                    <span className="execution-trace-model-call-id">${formatExecutionTraceModelId(modelCall.modelId)}</span>
                    <span className="execution-trace-model-call-provider">${modelCall.provider}</span>
                </div>
                ${modelCall.purpose
                    ? html`<p className="execution-trace-prose">${modelCall.purpose}</p>`
                    : null}
                ${modelCall.params?.length ? this.renderParams(modelCall.params) : null}
                ${modelCall.inputHandles?.length
                    ? html`
                        <div className="execution-trace-model-call-handles">
                            <span className="execution-trace-model-call-handles-label">Given</span>
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
                            <span className="execution-trace-model-call-handles-label">Produced</span>
                            ${this.renderHandleList(modelCall.outputHandles)}
                        </div>
                    `
                    : null}
                ${modelCall.errorMessage
                    ? html`<p className="execution-trace-prose execution-trace-model-call-error">${modelCall.errorMessage}</p>`
                    : null}
                ${duration || tokenUsage || modelCall.providerOperationId
                    ? html`
                        <div className="execution-trace-model-call-footer">
                            ${duration ? html`<span>${duration}</span>` : null}
                            ${tokenUsage ? html`<span>${tokenUsage}</span>` : null}
                            ${modelCall.providerOperationId
                                ? html`<span className="execution-trace-model-call-operation">${modelCall.providerOperationId}</span>`
                                : null}
                        </div>
                    `
                    : null}
            </li>
        ` as HTMLElement
    }

    private renderParams(params: readonly ExecutionTraceParam[]): HTMLElement {
        return html`
            <dl className="execution-trace-params">
                ${params.map(param => html`
                    <div className="execution-trace-param">
                        <dt>${param.name}</dt>
                        <dd>${param.value}</dd>
                    </div>
                `)}
            </dl>
        ` as HTMLElement
    }

    private renderFacts(facts: readonly ExecutionTraceFact[]): HTMLElement {
        return html`
            <section className="execution-trace-section">
                <dl className="execution-trace-params">
                    ${facts.map(fact => html`
                        <div className="execution-trace-param">
                            <dt>${fact.label}</dt>
                            <dd>${fact.value}</dd>
                        </div>
                    `)}
                </dl>
            </section>
        ` as HTMLElement
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
