'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { NodeView } from 'prosemirror-view'

import type {
    CapabilityArtifactCanvasHost,
    CapabilityArtifactCanvasView,
    CapabilityArtifactFrontendDefinition,
    CapabilityArtifactInfoHost,
    CapabilityArtifactInfoView,
    CapabilityArtifactLibraryHost,
    CapabilityArtifactLibraryView,
    CapabilityPromptReferenceHost,
    CapabilityPromptReferenceView,
} from '../../../frontend/capability-artifact-registry.ts'
import { createCapabilityHtml } from '../../../frontend/dom-template.ts'
import {
    ACTION_TIMELINE_ARTIFACT_TYPE_ID,
    ACTION_TIMELINE_TOOL_ID,
    collectActionTimelineReferencedAssetIds,
    createActionTimelineDocumentSchema,
    formatTimelineTime,
} from '../shared/action-timeline.ts'

type JsonNode = {
    type?: string
    text?: string
    attrs?: Record<string, unknown>
    content?: JsonNode[]
}

export const ACTION_TIMELINE_FRONTEND_STYLES = `
.workspace-capability-artifact-node[data-artifact-type-id="action-timeline"] {
    --action-timeline-surface: var(--workspace-branch-origin-background-color, #5d656d);
    --action-timeline-border: rgba(255, 255, 255, 0.18);
    --action-timeline-muted: rgba(255, 255, 255, 0.7);
    --action-timeline-timecode: #ffd0b3;
    --prompt-reference-color: #d7e6ff;
    background: var(--action-timeline-surface);
    border: 1px solid var(--workspace-branch-origin-border-color, #5d656d);
    border-radius: 18px;
    box-shadow: var(--workspace-branch-origin-box-shadow, 0 8px 24px rgba(42, 48, 57, 0.22));
    overflow: visible;
}

.workspace-capability-artifact-node[data-artifact-type-id="action-timeline"] .capability-artifact-node-host {
    width: 100%;
    min-height: 100%;
}

.action-timeline-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 100%;
    padding: 14px 16px 12px;
    background: var(--action-timeline-surface);
    color: #f8f9fb;
    border-radius: 17px;
    box-sizing: border-box;
    overflow: visible;
}

.action-timeline-summary {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    padding: 0 1px 9px;
    border-bottom: 1px solid var(--action-timeline-border);
}

.action-timeline-summary strong {
    color: #ffffff;
    font: 720 15px/1.25 system-ui, sans-serif;
    letter-spacing: -0.012em;
}

.action-timeline-summary span {
    flex: 0 0 auto;
    color: var(--action-timeline-muted);
    font: 650 11px/1.3 system-ui, sans-serif;
    letter-spacing: 0.025em;
    text-transform: uppercase;
}

.action-timeline-thumbnails {
    position: relative;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 0;
}

.action-timeline-thumbnails:empty {
    display: none;
}

.action-timeline-thumbnail {
    flex: 0 0 58px;
    width: 58px;
    height: 42px;
    min-width: 58px;
}

.action-timeline-legend {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 1px 6px;
    color: var(--action-timeline-muted);
    font: 520 11px/1.35 system-ui, sans-serif;
}

.action-timeline-legend-chip {
    display: inline-flex;
    align-items: center;
    padding: 0;
    color: var(--action-timeline-timecode);
    font-weight: 700;
}

.action-timeline-editor {
    position: relative;
    z-index: 2;
    overflow: visible;
}

.action-timeline-editor .ProseMirror {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    outline: none;
    overflow: visible;
}

.action-timeline-editor .ProseMirror:focus {
    outline: none;
}

.action-timeline-segment-row,
.action-timeline-editor .action-timeline-segment {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    align-items: start;
    gap: 11px;
    padding: 8px 1px 9px;
    border: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    box-sizing: border-box;
    overflow: visible;
}

.action-timeline-segment-row:last-child,
.action-timeline-editor .action-timeline-segment:last-child {
    border-bottom: 0;
}

.action-timeline-time {
    display: block;
    padding: 2px 0 0;
    color: var(--action-timeline-timecode);
    font: 700 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    letter-spacing: -0.035em;
    white-space: nowrap;
    user-select: none;
}

.action-timeline-content,
.action-timeline-segment-content {
    min-width: 0;
    padding: 0;
    color: rgba(255, 255, 255, 0.96);
    font: 430 13px/1.55 system-ui, sans-serif;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.action-timeline-segment-content p {
    min-height: 1.55em;
    margin: 0;
}

.action-timeline-editor .prompt-reference-chip,
.action-timeline-reference {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-inline: 2px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--prompt-reference-color);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    vertical-align: baseline;
    white-space: nowrap;
}

.action-timeline-editor .prompt-reference-chip-capability-artifact {
    margin-inline: 2px;
    padding: 0;
    border: 0;
    background: transparent;
}

.action-timeline-editor .prompt-reference-chip-icon {
    flex-basis: 14px;
    width: 14px;
    height: 14px;
}

.action-timeline-editor .prompt-reference-chip-name {
    color: inherit;
    font-weight: 500;
}

.action-timeline-info {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px 16px;
    padding: 2px 0;
}

.action-timeline-info-item {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.action-timeline-info-item + .action-timeline-info-item::before {
    content: '·';
    color: rgba(0, 0, 0, 0.28);
    font: 700 13px/1 system-ui, sans-serif;
}

.action-timeline-info-label {
    color: rgba(0, 0, 0, 0.45);
    font: 700 10px/1.3 system-ui, sans-serif;
    text-transform: uppercase;
}

.action-timeline-info-value {
    color: rgba(0, 0, 0, 0.72);
    font: 700 14px/1.35 system-ui, sans-serif;
}

.action-timeline-library-row {
    display: grid;
    gap: 5px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #343b49;
    border-radius: 10px;
    background: #1d212a;
    color: #f4f7fc;
    text-align: left;
}

.action-timeline-library-row:hover {
    border-color: #4d586c;
    background: #242a35;
}

.action-timeline-library-meta {
    color: #909bad;
    font-size: 11px;
}
`

export const actionTimelineFrontendDefinition: CapabilityArtifactFrontendDefinition = {
    artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
    iconId: 'ordered-list',
    createEditorPlugins: createActionTimelineEditorPlugins,
    createCanvasNodeView: createActionTimelineCanvasView,
    createGeneratedOutputInfoView: createActionTimelineInfoView,
    buildReplaySubmitData: host => {
        const input = asRecord(host.provenance.input) ?? {}
        const variant = asRecord(host.provenance.variant) ?? asRecord(asRecord(host.provenance.generationRun)?.lineageAssignment) ?? {}
        const reasoningModelId = typeof variant.reasoningModelId === 'string' ? variant.reasoningModelId : ''
        return {
            capabilityId: ACTION_TIMELINE_TOOL_ID,
            capabilityInputs: {
                [ACTION_TIMELINE_TOOL_ID]: {
                    durationMs: numberValue(input.durationMs),
                    precisionMs: numberValue(input.precisionMs),
                },
            },
            reasoningModelIds: reasoningModelId ? [reasoningModelId] : [],
        }
    },
    createPromptReferenceView: createActionTimelinePromptReferenceView,
    createLibraryItemView: createActionTimelineLibraryView,
}

export function createActionTimelineEditorPlugins(): Plugin[] {
    return [new Plugin({
        props: {
            nodeViews: {
                actionTimelineSegment: node => new ActionTimelineSegmentNodeView(node),
            },
        },
    })]
}

class ActionTimelineSegmentNodeView implements NodeView {
    readonly dom: HTMLElement
    readonly contentDOM: HTMLElement
    private readonly time: HTMLElement

    constructor(node: ProseMirrorNode) {
        const html = createCapabilityHtml(document)
        this.dom = html`<section className="action-timeline-segment">
            <header className="action-timeline-time" contenteditable="false"></header>
            <div className="action-timeline-segment-content"></div>
        </section>` as HTMLElement
        this.time = this.dom.querySelector('.action-timeline-time') as HTMLElement
        this.contentDOM = this.dom.querySelector('.action-timeline-segment-content') as HTMLElement
        this.updateTime(node)
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type.name !== 'actionTimelineSegment') return false
        this.updateTime(node)
        return true
    }

    ignoreMutation(mutation: MutationRecord): boolean {
        return this.time.contains(mutation.target)
    }

    private updateTime(node: ProseMirrorNode): void {
        this.time.textContent = `${formatTimelineTime(numberValue(node.attrs.startMs))} – ${formatTimelineTime(numberValue(node.attrs.endMs))}`
    }
}

function createActionTimelineCanvasView(host: CapabilityArtifactCanvasHost): CapabilityArtifactCanvasView {
    const html = createCapabilityHtml(host.container.ownerDocument)
    const root = html`<div className="action-timeline-body">
        <div className="action-timeline-summary"><strong>Action Timeline</strong><span></span></div>
        <div className="action-timeline-thumbnails"></div>
        <div className="action-timeline-legend"><span className="action-timeline-legend-chip">@ Asset</span><span>References stay attached to the beat where they are used.</span></div>
        <div className="action-timeline-editor nopan"></div>
    </div>` as HTMLDivElement
    const summary = root.querySelector('.action-timeline-summary span') as HTMLElement
    const thumbnails = root.querySelector('.action-timeline-thumbnails') as HTMLElement
    const editorContainer = root.querySelector('.action-timeline-editor') as HTMLElement
    let editor: ReturnType<NonNullable<CapabilityArtifactCanvasHost['mountEditor']>> | undefined
    let referenceViews: Array<{ destroy: () => void }> = []

    const destroyReferenceViews = (): void => {
        for (const view of referenceViews) view.destroy()
        referenceViews = []
    }

    const mountDocument = (document: object): void => {
        const doc = document as JsonNode
        const segmentCount = doc.content?.length ?? 0
        summary.textContent = `${formatTimelineTime(numberValue(doc.attrs?.durationMs))} · ${segmentCount} segment${segmentCount === 1 ? '' : 's'}`
        destroyReferenceViews()
        thumbnails.replaceChildren()
        for (const assetId of collectActionTimelineReferencedAssetIds(document)) {
            const view = host.createAssetReferenceView({ assetId, variant: 'thumbnail' })
            if (!view) continue
            view.dom.classList.add('action-timeline-thumbnail')
            referenceViews.push(view)
            thumbnails.appendChild(view.dom)
        }
        if (host.mountEditor) {
            if (editor) editor.updateDocument(document)
            else editor = host.mountEditor({
                container: editorContainer,
                document,
                schema: createActionTimelineDocumentSchema(),
                plugins: createActionTimelineEditorPlugins(),
            })
        } else {
            renderStaticTimeline(editorContainer, document, host, view => referenceViews.push(view))
        }
        queueMicrotask(() => host.onHeightChange(root.scrollHeight))
    }

    host.container.appendChild(root)
    mountDocument(host.document)
    return {
        updateDocument: mountDocument,
        destroy: () => {
            editor?.destroy()
            destroyReferenceViews()
            root.remove()
        },
    }
}

function renderStaticTimeline(
    container: HTMLElement,
    document: object,
    host: CapabilityArtifactCanvasHost,
    registerReferenceView: (view: { destroy: () => void }) => void,
): void {
    const html = createCapabilityHtml(container.ownerDocument)
    container.replaceChildren()
    const doc = document as JsonNode
    for (const segment of doc.content ?? []) {
        const row = html`<section className="action-timeline-segment-row">
            <div className="action-timeline-time">${formatTimelineTime(numberValue(segment.attrs?.startMs))} – ${formatTimelineTime(numberValue(segment.attrs?.endMs))}</div>
            <div className="action-timeline-content"></div>
        </section>` as HTMLElement
        const content = row.querySelector('.action-timeline-content') as HTMLElement
        renderInlineContent(content, segment, host, registerReferenceView)
        container.appendChild(row)
    }
}

function createActionTimelineInfoView(host: CapabilityArtifactInfoHost): CapabilityArtifactInfoView {
    const html = createCapabilityHtml(host.container.ownerDocument)
    const doc = host.document as JsonNode
    const segments = doc.content?.length ?? 0
    const references = collectActionTimelineReferencedAssetIds(host.document).length
    const root = html`<div className="action-timeline-info">
        <div className="action-timeline-info-item">
            <span className="action-timeline-info-label">Duration</span>
            <span className="action-timeline-info-value">${formatTimelineTime(numberValue(doc.attrs?.durationMs))}</span>
        </div>
        <div className="action-timeline-info-item">
            <span className="action-timeline-info-label">Segments</span>
            <span className="action-timeline-info-value">${segments}</span>
        </div>
        <div className="action-timeline-info-item">
            <span className="action-timeline-info-label">Cited Assets</span>
            <span className="action-timeline-info-value">${references}</span>
        </div>
    </div>` as HTMLDivElement
    host.container.appendChild(root)
    return { destroy: () => root.remove() }
}

function createActionTimelinePromptReferenceView(host: CapabilityPromptReferenceHost): CapabilityPromptReferenceView {
    const html = createCapabilityHtml(host.container.ownerDocument)
    const segmentCount = numberValue(host.displayMetadata.segmentCount)
    const root = html`<span className="action-timeline-reference">${host.title}${segmentCount > 0 ? ` · ${segmentCount} segments` : ''}</span>` as HTMLSpanElement
    host.container.appendChild(root)
    return { destroy: () => root.remove() }
}

function createActionTimelineLibraryView(host: CapabilityArtifactLibraryHost): CapabilityArtifactLibraryView {
    const html = createCapabilityHtml(host.container.ownerDocument)
    const durationMs = numberValue(host.displayMetadata.durationMs)
    const segmentCount = numberValue(host.displayMetadata.segmentCount)
    const root = html`<button type="button" className="action-timeline-library-row">
        <strong>${host.title}</strong>
        <span className="action-timeline-library-meta">${formatTimelineTime(durationMs)} · ${segmentCount} segments · ${host.scope}</span>
    </button>` as HTMLButtonElement
    root.addEventListener('click', host.onAddToCanvas)
    host.container.appendChild(root)
    return { destroy: () => root.remove() }
}

function renderInlineContent(
    container: HTMLElement,
    node: JsonNode,
    host: CapabilityArtifactCanvasHost,
    registerReferenceView: (view: { destroy: () => void }) => void,
): void {
    const visit = (child: JsonNode): void => {
        if (child.type === 'text' && child.text) container.append(child.text)
        if (child.type === 'prompt_reference') {
            const assetId = typeof child.attrs?.assetId === 'string' ? child.attrs.assetId : ''
            const displayName = typeof child.attrs?.displayName === 'string' ? child.attrs.displayName : undefined
            const view = host.createAssetReferenceView({ assetId, displayName, variant: 'inline' })
            if (view) {
                registerReferenceView(view)
                container.appendChild(view.dom)
            }
        }
        for (const nested of child.content ?? []) visit(nested)
    }
    visit(node)
}

function numberValue(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: CapabilityJsonValue | undefined): Record<string, CapabilityJsonValue> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, CapabilityJsonValue>
        : undefined
}
