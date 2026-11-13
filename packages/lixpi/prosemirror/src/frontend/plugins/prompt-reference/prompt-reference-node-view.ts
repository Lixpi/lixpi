import {
    type MediaPromptReference,
    type PromptReferenceType,
} from '@lixpi/constants'
import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
} from '@lixpi/prosemirror'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    NodeSelection,
    Plugin,
    TextSelection,
    type Selection,
} from 'prosemirror-state'
import {
    type NodeView,
} from 'prosemirror-view'

import {
    type EditorPromptReferencePreviewRenderer,
    type EditorPromptReferenceChipDescriptor,
    type EditorContextPreviewTile,
    type EditorPreviewPorts,
} from '../../editor/editor-host-ports.ts'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type EditorCapabilityArtifacts,
} from '../../editor/editor-services.ts'

type PromptReferenceArrowKey = 'ArrowLeft' | 'ArrowRight'

const getPromptReferenceType = (node: ProseMirrorNode): PromptReferenceType => {
    if (node.type.name === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE)
        return node.attrs.kind === 'tool' ? 'tool' : 'skill'

    const referenceType = node.attrs.referenceType

    if (
        referenceType === 'media'
        || referenceType === 'capability-artifact'
        || referenceType === 'capability-module'
        || referenceType === 'tool'
        || referenceType === 'skill'
    )
        return referenceType

    return 'skill'
}

const isPromptReferenceNode = (node: ProseMirrorNode | null | undefined): node is ProseMirrorNode => {
    return node?.type.name === PROMPT_REFERENCE_NODE_TYPE
        || node?.type.name === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
}

const getMediaPromptReference = (
    node: ProseMirrorNode,
    previewRenderer?: EditorPromptReferencePreviewRenderer,
): MediaPromptReference | null => {
    if (node.type.name !== PROMPT_REFERENCE_NODE_TYPE)
        return null

    const attrs = normalizePromptReferenceAttrs(node.attrs)

    if (attrs?.referenceType === 'media')
        return attrs

    if (
        node.attrs.referenceType !== 'media'
        || typeof node.attrs.assetId !== 'string'
        || !node.attrs.assetId.trim()
    )
        return null

    const mediaKind = previewRenderer?.resolveMediaKind(node.attrs.assetId)

    if (
        mediaKind !== 'image'
        && mediaKind !== 'video'
        && mediaKind !== 'audio'
        && mediaKind !== 'document'
    )
        return null

    return {
        referenceType: 'media',
        assetId: node.attrs.assetId,
        ...(typeof node.attrs.nodeId === 'string'
            && node.attrs.nodeId.trim()
            ? { nodeId: node.attrs.nodeId }
            : {}),
        mediaKind,
    }
}

export const getPromptReferenceArrowTarget = (
    selection: Selection,
    key: PromptReferenceArrowKey,
): number | null => {
    if (
        selection instanceof NodeSelection
        && isPromptReferenceNode(selection.node)
    )
        return key === 'ArrowLeft' ? selection.from : selection.to

    if (
        !(selection instanceof TextSelection)
        || !selection.empty
        || !selection.$cursor
    )
        return null

    if (
        key === 'ArrowRight'
        && isPromptReferenceNode(selection.$cursor.nodeAfter)
    )
        return selection.from + selection.$cursor.nodeAfter.nodeSize

    if (
        key === 'ArrowLeft'
        && isPromptReferenceNode(selection.$cursor.nodeBefore)
    )
        return selection.from - selection.$cursor.nodeBefore.nodeSize

    return null
}

export class PromptReferenceNodeView implements NodeView {
    readonly dom: HTMLElement

    private readonly node: ProseMirrorNode
    private readonly previewTile: EditorContextPreviewTile | null
    private readonly artifactView: { destroy: () => void } | null

    constructor(
        node: ProseMirrorNode,
        capabilityArtifacts: EditorCapabilityArtifacts,
        previews: EditorPreviewPorts,
        previewRenderer?: EditorPromptReferencePreviewRenderer,
    ) {
        this.node = node
        const referenceType = getPromptReferenceType(node)

        if (referenceType === 'capability-artifact') {
            capabilityArtifacts.ensureStyles(document)
            const artifactTypeId = String(node.attrs.artifactTypeId ?? '')
            const referenceHost = html`<span className="prompt-reference-chip-name prompt-reference-chip-artifact-host"></span>` as HTMLSpanElement
            this.dom = html`
                <span
                    className="prompt-reference-chip prompt-reference-chip-capability-artifact"
                    contenteditable="false"
                >
                <span className="prompt-reference-chip-content">
                    <span
                        className="prompt-reference-chip-icon"
                        aria-hidden="true"
                        innerHTML=${capabilityArtifacts.icon(artifactTypeId)}
                    ></span>
                    ${referenceHost}
                </span>
            </span>
            ` as HTMLSpanElement
            this.artifactView = capabilityArtifacts.createPromptReferenceView(
                artifactTypeId,
                {
                    container: referenceHost,
                    title: String(node.attrs.displayName ?? ''),
                    displayMetadata: {},
                },
            )
            this.previewTile = null

            return
        }

        this.artifactView = null
        const mediaReference = getMediaPromptReference(node, previewRenderer)
        const descriptor: EditorPromptReferenceChipDescriptor = {
            referenceType,
            displayName: String(node.attrs.displayName ?? ''),
            mediaKind: mediaReference?.mediaKind ?? node.attrs.mediaKind,
        }
        this.previewTile = mediaReference
            && previewRenderer
            ? previewRenderer.createMediaPreview({
                ...mediaReference,
                displayName: descriptor.displayName,
            })
            : referenceType === 'capability-module'
                && previewRenderer?.createCapabilityPreview
                ? previewRenderer.createCapabilityPreview({
                    moduleId: String(node.attrs.moduleId ?? ''),
                    displayName: descriptor.displayName,
                })
                : null
        this.dom = this.previewTile?.dom
            ?? previews.createReferenceChip(descriptor, previewRenderer?.document ?? document)
        this.dom.classList.add('prompt-reference-chip', `prompt-reference-chip-${referenceType}`)
    }

    update(node: ProseMirrorNode): boolean {
        return node.type.name === this.node.type.name && node.sameMarkup(this.node)
    }

    ignoreMutation(): boolean {
        return true
    }

    destroy(): void {
        this.previewTile?.destroy()
        this.artifactView?.destroy()
    }
}

export const createPromptReferenceNodeViewPlugin = (
    capabilityArtifacts: EditorCapabilityArtifacts,
    previews: EditorPreviewPorts,
    previewRenderer?: EditorPromptReferencePreviewRenderer,
): Plugin => {
    return new Plugin({
        props: {
            nodeViews: {
                [PROMPT_REFERENCE_NODE_TYPE]: node => new PromptReferenceNodeView(
                    node,
                    capabilityArtifacts,
                    previews,
                ),
                [LEGACY_CAPABILITY_REFERENCE_NODE_TYPE]: node => new PromptReferenceNodeView(
                    node,
                    capabilityArtifacts,
                    previews,
                ),
            },
            handleKeyDown(
                view,
                event,
            ) {
                if (
                    event.key !== 'ArrowLeft'
                    && event.key !== 'ArrowRight'
                )
                    return false

                if (
                    event.shiftKey
                    || event.altKey
                    || event.ctrlKey
                    || event.metaKey
                )
                    return false

                const target = getPromptReferenceArrowTarget(view.state.selection, event.key)

                if (target === null)
                    return false

                event.preventDefault()
                view.dispatch(
                    view.state.tr
                        .setSelection(
                            TextSelection.create(view.state.doc, target),
                        )
                        .scrollIntoView(),
                )

                return true
            },
        },
    })
}
