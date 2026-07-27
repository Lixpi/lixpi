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
.workspace-capability-artifact-node{background:#151820;border:1px solid #353b49;border-radius:14px;box-shadow:0 14px 34px rgba(4,7,12,.35);overflow:visible}
.action-timeline-body{display:flex;flex-direction:column;gap:10px;min-height:100%;padding:13px;background:linear-gradient(145deg,#181b23,#12151b);color:#f5f7fb;border-radius:13px;box-sizing:border-box;overflow:visible}
.action-timeline-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 2px 7px;border-bottom:1px solid #303644}
.action-timeline-summary strong{font:700 13px/1.3 system-ui,sans-serif;letter-spacing:.01em}.action-timeline-summary span{color:#9da9bd;font:600 11px/1.3 system-ui,sans-serif}
.action-timeline-thumbnails{display:flex;gap:6px;min-height:0}.action-timeline-thumbnail{width:34px;height:34px;border-radius:7px;object-fit:cover;border:1px solid #3b4251;background:#222732}
.action-timeline-legend{display:flex;align-items:center;gap:7px;color:#8f9aaf;font:500 10px/1.3 system-ui,sans-serif}.action-timeline-legend-chip{display:inline-flex;padding:2px 7px;border-radius:999px;background:#313949;color:#e3eaf7;font-weight:650}
.action-timeline-editor{overflow:visible}.action-timeline-editor .ProseMirror{display:flex;flex-direction:column;gap:8px;outline:none;overflow:visible}.action-timeline-editor .ProseMirror:focus{outline:none}
.action-timeline-segment-row,.action-timeline-editor .action-timeline-segment{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;padding:9px 10px;background:#20242d;border:1px solid #303746;border-radius:9px;box-sizing:border-box;overflow:visible}
.action-timeline-time{font:650 11px/1.35 ui-monospace,SFMono-Regular,monospace;color:#9eabc1;white-space:nowrap;user-select:none}
.action-timeline-content,.action-timeline-segment-content{min-width:0;font:400 13px/1.55 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}.action-timeline-segment-content p{margin:0;min-height:1.55em}
.action-timeline-reference{display:inline-flex;align-items:center;margin:0 3px;padding:1px 7px;border-radius:999px;background:#343e50;color:#e2ebfb;font:650 11px/1.55 system-ui,sans-serif}
.action-timeline-info{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.action-timeline-info-item{display:flex;flex-direction:column;gap:3px;padding:9px 10px;border:1px solid rgba(0,0,0,.07);border-radius:8px;background:rgba(0,0,0,.025)}.action-timeline-info-label{color:rgba(0,0,0,.45);font:700 10px/1.3 system-ui,sans-serif;text-transform:uppercase}.action-timeline-info-value{color:rgba(0,0,0,.72);font:650 13px/1.35 system-ui,sans-serif}.action-timeline-library-row{display:grid;gap:5px;width:100%;padding:10px 12px;text-align:left;border:1px solid #343b49;border-radius:10px;background:#1d212a;color:#f4f7fc}.action-timeline-library-row:hover{background:#242a35;border-color:#4d586c}.action-timeline-library-meta{color:#909bad;font-size:11px}
`

export const actionTimelineFrontendDefinition: CapabilityArtifactFrontendDefinition = {
    artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
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

    const mountDocument = (document: object): void => {
        const doc = document as JsonNode
        const segmentCount = doc.content?.length ?? 0
        summary.textContent = `${formatTimelineTime(numberValue(doc.attrs?.durationMs))} · ${segmentCount} segment${segmentCount === 1 ? '' : 's'}`
        thumbnails.replaceChildren()
        for (const assetId of collectActionTimelineReferencedAssetIds(document)) {
            const url = host.resolveThumbnailUrl(assetId)
            if (!url) continue
            thumbnails.appendChild(html`<img className="action-timeline-thumbnail" src=${url} alt=${host.resolveAssetTitle(assetId)} />` as HTMLImageElement)
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
            renderStaticTimeline(editorContainer, document, host)
        }
        queueMicrotask(() => host.onHeightChange(root.scrollHeight))
    }

    host.container.appendChild(root)
    mountDocument(host.document)
    return {
        updateDocument: mountDocument,
        destroy: () => {
            editor?.destroy()
            root.remove()
        },
    }
}

function renderStaticTimeline(
    container: HTMLElement,
    document: object,
    host: CapabilityArtifactCanvasHost,
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
        renderInlineContent(content, segment, host)
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
): void {
    const html = createCapabilityHtml(container.ownerDocument)
    const visit = (child: JsonNode): void => {
        if (child.type === 'text' && child.text) container.append(child.text)
        if (child.type === 'prompt_reference') {
            const assetId = typeof child.attrs?.assetId === 'string' ? child.attrs.assetId : ''
            const label = host.resolveAssetTitle(assetId) || assetId
            container.appendChild(html`<span className="action-timeline-reference">${label}</span>` as HTMLSpanElement)
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
