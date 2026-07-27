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
import {
    capabilityArtifactFrontendRegistry,
    ensureCapabilityStyles,
    getCapabilityArtifactIcon,
} from '$src/installed-capabilities.ts'

const promptReferenceIcons: Record<Exclude<PromptReferenceType, 'media' | 'capability-artifact'>, string> = {
    'capability-module': atomIcon,
    tool: promptIcon,
    skill: fileIcon,
}

type MediaKind = MediaPromptReference['mediaKind']
type PromptReferenceArrowKey = 'ArrowLeft' | 'ArrowRight'
export type PromptReferenceChipDescriptor = {
    referenceType: Exclude<PromptReferenceType, 'capability-artifact'>
    displayName: string
    mediaKind?: unknown
}

export type PromptReferencePreviewRenderer = {
    getNode: (reference: MediaPromptReference) => CanvasNode | undefined
    environment: ContextPreviewEnvironment
    inlinePopover?: boolean
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right'
}

export type PromptReferencePreviewInstance = {
    dom: HTMLElement
    destroy: () => void
}

export type CreatePromptReferencePreviewOptions = {
    inlinePopover?: boolean
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right'
    variant?: 'inline' | 'thumbnail'
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
        || referenceType === 'capability-artifact'
        || referenceType === 'capability-module'
        || referenceType === 'tool'
        || referenceType === 'skill') return referenceType
    return 'skill'
}

function isPromptReferenceNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
    return node?.type.name === PROMPT_REFERENCE_NODE_TYPE
        || node?.type.name === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
}

function getMediaPromptReference(
    node: ProseMirrorNode,
    previewRenderer?: PromptReferencePreviewRenderer,
): MediaPromptReference | null {
    if (node.type.name !== PROMPT_REFERENCE_NODE_TYPE) return null
    const attrs = normalizePromptReferenceAttrs(node.attrs)
    if (attrs?.referenceType === 'media') return attrs
    if (node.attrs.referenceType !== 'media' || typeof node.attrs.assetId !== 'string' || !node.attrs.assetId.trim()) {
        return null
    }
    const mediaKind = previewRenderer?.environment.getAsset?.(node.attrs.assetId)?.media?.kind
    if (mediaKind !== 'image' && mediaKind !== 'video' && mediaKind !== 'audio' && mediaKind !== 'document') {
        return null
    }
    return {
        referenceType: 'media',
        assetId: node.attrs.assetId,
        ...(typeof node.attrs.nodeId === 'string' && node.attrs.nodeId.trim()
            ? { nodeId: node.attrs.nodeId }
            : {}),
        mediaKind,
    }
}

export function getPromptReferenceIcon(
    referenceType: PromptReferenceType,
    mediaKind: unknown,
): string {
    if (referenceType === 'capability-artifact') return atomIcon
    if (referenceType !== 'media') return promptReferenceIcons[referenceType]
    if (mediaKind === 'video' || mediaKind === 'audio' || mediaKind === 'document') {
        return mediaPromptReferenceIcons[mediaKind]
    }
    return mediaPromptReferenceIcons.image
}

function createPromptReferenceChipContent(descriptor: PromptReferenceChipDescriptor): HTMLSpanElement {
    return html`
        <span className="prompt-reference-chip-content">
            <span
                className="prompt-reference-chip-icon"
                aria-hidden="true"
                innerHTML=${getPromptReferenceIcon(descriptor.referenceType, descriptor.mediaKind)}
            ></span>
            <span className="prompt-reference-chip-name">${descriptor.displayName}</span>
        </span>
    ` as HTMLSpanElement
}

function resolveMediaPromptReferenceDisplayName(
    reference: MediaPromptReference & { displayName: string },
    previewRenderer: PromptReferencePreviewRenderer,
): string {
    return previewRenderer.environment.getAsset?.(reference.assetId)?.title?.trim()
        || reference.displayName.trim()
        || reference.assetId
}

export function createMediaPromptReferencePreview(
    reference: MediaPromptReference & { displayName: string },
    previewRenderer: PromptReferencePreviewRenderer,
    options: CreatePromptReferencePreviewOptions = {},
): PromptReferencePreviewInstance | null {
    const previewNode = previewRenderer.getNode(reference)
    if (!previewNode) return null

    const displayName = resolveMediaPromptReferenceDisplayName(reference, previewRenderer)
    const triggerContent = options.variant === 'thumbnail'
        ? undefined
        : createPromptReferenceChipContent({
            referenceType: 'media',
            displayName,
            mediaKind: reference.mediaKind,
        })
    const previewTile = createContextPreviewTile({
        node: previewNode,
        getNode: () => previewRenderer.getNode(reference) ?? previewNode,
        environment: previewRenderer.environment,
        preferredPlacement: options.preferredPlacement ?? previewRenderer.preferredPlacement ?? 'top',
        inlinePopover: options.inlinePopover ?? previewRenderer.inlinePopover,
        triggerContent,
        titleOverride: displayName,
    })
    if (options.variant !== 'thumbnail') {
        previewTile.dom.classList.add(
            'prompt-reference-chip',
            'prompt-reference-chip-media',
            'context-preview-inline-label',
        )
    } else {
        previewTile.dom.classList.add('context-preview-thumbnail')
    }
    return previewTile
}

export function createPromptReferenceChipElement(
    descriptor: PromptReferenceChipDescriptor,
): HTMLSpanElement {
    return html`
        <span
            className=${`prompt-reference-chip prompt-reference-chip-${descriptor.referenceType}`}
            contenteditable="false"
        >${createPromptReferenceChipContent(descriptor)}</span>
    ` as HTMLSpanElement
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
    private readonly artifactView: { destroy: () => void } | null

    constructor(node: ProseMirrorNode, previewRenderer?: PromptReferencePreviewRenderer) {
        this.node = node
        const referenceType = getPromptReferenceType(node)
        if (referenceType === 'capability-artifact') {
            ensureCapabilityStyles(document)
            const artifactTypeId = String(node.attrs.artifactTypeId ?? '')
            const referenceHost = html`<span className="prompt-reference-chip-name prompt-reference-chip-artifact-host"></span>` as HTMLSpanElement
            this.dom = html`<span className="prompt-reference-chip prompt-reference-chip-capability-artifact" contenteditable="false">
                <span className="prompt-reference-chip-content">
                    <span className="prompt-reference-chip-icon" aria-hidden="true" innerHTML=${getCapabilityArtifactIcon(artifactTypeId)}></span>
                    ${referenceHost}
                </span>
            </span>` as HTMLSpanElement
            this.artifactView = capabilityArtifactFrontendRegistry.require(artifactTypeId).createPromptReferenceView({
                container: referenceHost,
                title: String(node.attrs.displayName ?? ''),
                displayMetadata: {},
            })
            this.previewTile = null
            return
        }
        this.artifactView = null
        const mediaReference = getMediaPromptReference(node, previewRenderer)
        const descriptor: PromptReferenceChipDescriptor = {
            referenceType,
            displayName: String(node.attrs.displayName ?? ''),
            mediaKind: mediaReference?.mediaKind ?? node.attrs.mediaKind,
        }
        this.previewTile = mediaReference && previewRenderer
            ? createMediaPromptReferencePreview({
                ...mediaReference,
                displayName: descriptor.displayName,
            }, previewRenderer)
            : null
        this.dom = this.previewTile?.dom
            ?? createPromptReferenceChipElement(descriptor)
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
