import type {
    CanvasNode,
    MediaPromptReference,
    PromptReferenceType,
} from '@lixpi/constants'
import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
} from '@lixpi/prosemirror'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
    NodeSelection,
    Plugin,
    TextSelection,
    type Selection,
} from 'prosemirror-state'
import type { NodeView } from 'prosemirror-view'

import {
    createContextPreviewTile,
    type ContextPreviewEnvironment,
    type ContextPreviewTileInstance,
} from '$src/components/contextPreview/index.ts'
import { html } from '$src/utils/domTemplates.ts'
import {
    atomIcon,
    documentIcon,
    fileIcon,
    imageIcon,
    promptIcon,
    videoPlayGlyphIcon,
    videoVolumeHighGlyphIcon,
} from '$src/svgIcons/index.ts'

const promptReferenceIcons: Record<Exclude<PromptReferenceType, 'media'>, string> = {
    'capability-module': atomIcon,
    tool: promptIcon,
    skill: fileIcon,
}

type MediaKind = MediaPromptReference['mediaKind']
type PromptReferenceArrowKey = 'ArrowLeft' | 'ArrowRight'

export type PromptReferencePreviewRenderer = {
    getNode: (reference: MediaPromptReference) => CanvasNode | undefined
    environment: ContextPreviewEnvironment
}

const mediaPromptReferenceIcons: Record<MediaKind, string> = {
    image: imageIcon,
    video: videoPlayGlyphIcon,
    audio: videoVolumeHighGlyphIcon,
    document: documentIcon,
}

function getPromptReferenceType(node: ProseMirrorNode): PromptReferenceType {
    if (node.type.name === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE) {
        return node.attrs.kind === 'tool' ? 'tool' : 'skill'
    }

    const referenceType = node.attrs.referenceType
    if (referenceType === 'media'
        || referenceType === 'capability-module'
        || referenceType === 'tool'
        || referenceType === 'skill') return referenceType
    return 'skill'
}

function isPromptReferenceNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
    return node?.type.name === PROMPT_REFERENCE_NODE_TYPE
        || node?.type.name === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
}

function getMediaPromptReference(node: ProseMirrorNode): MediaPromptReference | null {
    if (node.type.name !== PROMPT_REFERENCE_NODE_TYPE) return null
    const attrs = normalizePromptReferenceAttrs(node.attrs)
    return attrs?.referenceType === 'media' ? attrs : null
}

export function getPromptReferenceIcon(
    referenceType: PromptReferenceType,
    mediaKind: unknown,
): string {
    if (referenceType !== 'media') return promptReferenceIcons[referenceType]
    if (mediaKind === 'video' || mediaKind === 'audio' || mediaKind === 'document') {
        return mediaPromptReferenceIcons[mediaKind]
    }
    return mediaPromptReferenceIcons.image
}

export function getPromptReferenceArrowTarget(
    selection: Selection,
    key: PromptReferenceArrowKey,
): number | null {
    if (selection instanceof NodeSelection && isPromptReferenceNode(selection.node)) {
        return key === 'ArrowLeft' ? selection.from : selection.to
    }
    if (!(selection instanceof TextSelection) || !selection.empty || !selection.$cursor) return null

    if (key === 'ArrowRight' && isPromptReferenceNode(selection.$cursor.nodeAfter)) {
        return selection.from + selection.$cursor.nodeAfter.nodeSize
    }
    if (key === 'ArrowLeft' && isPromptReferenceNode(selection.$cursor.nodeBefore)) {
        return selection.from - selection.$cursor.nodeBefore.nodeSize
    }
    return null
}

export class PromptReferenceNodeView implements NodeView {
    readonly dom: HTMLElement

    private readonly node: ProseMirrorNode
    private readonly previewTile: ContextPreviewTileInstance | null

    constructor(node: ProseMirrorNode, previewRenderer?: PromptReferencePreviewRenderer) {
        this.node = node
        const referenceType = getPromptReferenceType(node)
        const content = html`
            <span className="prompt-reference-chip-content">
                <span
                    className="prompt-reference-chip-icon"
                    aria-hidden="true"
                    innerHTML=${getPromptReferenceIcon(referenceType, node.attrs.mediaKind)}
                ></span>
                <span className="prompt-reference-chip-name">${String(node.attrs.displayName ?? '')}</span>
            </span>
        ` as HTMLSpanElement
        const mediaReference = getMediaPromptReference(node)
        const previewNode = mediaReference ? previewRenderer?.getNode(mediaReference) : undefined

        this.previewTile = mediaReference && previewRenderer && previewNode
            ? createContextPreviewTile({
                node: previewNode,
                getNode: () => previewRenderer.getNode(mediaReference) ?? previewNode,
                environment: previewRenderer.environment,
                preferredPlacement: 'top',
                triggerContent: content,
                titleOverride: String(node.attrs.displayName ?? ''),
            })
            : null
        this.dom = this.previewTile?.dom
            ?? html`<span className="prompt-reference-chip" contenteditable="false">${content}</span>` as HTMLSpanElement
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
    }
}

export function createPromptReferenceNodeViewPlugin(
    previewRenderer?: PromptReferencePreviewRenderer,
): Plugin {
    return new Plugin({
        props: {
            nodeViews: {
                [PROMPT_REFERENCE_NODE_TYPE]: node => new PromptReferenceNodeView(node, previewRenderer),
                [LEGACY_CAPABILITY_REFERENCE_NODE_TYPE]: node => new PromptReferenceNodeView(node, previewRenderer),
            },
            handleKeyDown(view, event) {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false
                if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
                const target = getPromptReferenceArrowTarget(view.state.selection, event.key)
                if (target === null) return false

                event.preventDefault()
                view.dispatch(view.state.tr
                    .setSelection(TextSelection.create(view.state.doc, target))
                    .scrollIntoView())
                return true
            },
        },
    })
}
