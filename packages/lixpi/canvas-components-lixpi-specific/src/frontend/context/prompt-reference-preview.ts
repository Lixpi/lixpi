import type {
    CapabilityModuleMeta,
    CanvasNode,
    MediaPromptReference,
    PromptReferenceType,
} from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    atomIcon,
    documentIcon,
    fileIcon,
    imageIcon,
    promptIcon,
    videoPlayGlyphIcon,
    videoVolumeHighGlyphIcon,
} from '@lixpi/ui-kit/svg'
import {
    createContextPreviewTile,
    type ContextPreviewEnvironment,
} from './context-preview.ts'
import type { CapabilityModulePromiseCache } from './capability-prompt-preview.ts'

const promptReferenceIcons: Record<Exclude<PromptReferenceType, 'media' | 'capability-artifact'>, string> = {
    'capability-module': atomIcon,
    tool: promptIcon,
    skill: fileIcon,
}

type MediaKind = MediaPromptReference['mediaKind']
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
    getCapabilityModule?: (moduleId: string) => Promise<CapabilityModuleMeta>
    capabilityModuleCache?: CapabilityModulePromiseCache
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

function createPromptReferenceChipContent(descriptor: PromptReferenceChipDescriptor, document: Document): HTMLSpanElement {
    const html = createDocumentHtml(document)
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
        }, previewRenderer.environment.document)
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
    document: Document,
): HTMLSpanElement {
    const html = createDocumentHtml(document)
    return html`
        <span
            className=${`prompt-reference-chip prompt-reference-chip-${descriptor.referenceType}`}
            contenteditable="false"
        >${createPromptReferenceChipContent(descriptor, document)}</span>
    ` as HTMLSpanElement
}
