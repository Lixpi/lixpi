import type { PromptReferenceAtomAttrs } from '@lixpi/constants'
import {
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'

import {
    createMediaPromptReferencePreview,
    createCapabilityPromptReferencePreview,
    createPromptReferenceChipElement,
    type PromptReferencePreviewRenderer,
} from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

type CapabilityModuleReference = Extract<PromptReferenceAtomAttrs, { referenceType: 'capability-module' }>
type MediaReference = Extract<PromptReferenceAtomAttrs, { referenceType: 'media' }>
type ToolReference = Extract<PromptReferenceAtomAttrs, { referenceType: 'tool' }>
type SkillReference = Extract<PromptReferenceAtomAttrs, { referenceType: 'skill' }>

export type BranchMarkerPromptPart = {
    type: 'text'
    text: string
} | {
    type: 'capability-module'
    reference: CapabilityModuleReference
} | {
    type: 'media'
    reference: MediaReference
} | {
    type: 'tool'
    reference: ToolReference
} | {
    type: 'skill'
    reference: SkillReference
}

type BranchMarkerPromptReferencePart = Exclude<BranchMarkerPromptPart, { type: 'text' }>

function isPromptReferencePart(part: BranchMarkerPromptPart): part is BranchMarkerPromptReferencePart {
    return part.type !== 'text'
}

function appendText(parts: BranchMarkerPromptPart[], text: string): void {
    if (!text) return
    const previous = parts.at(-1)
    if (previous?.type === 'text') {
        previous.text += text
        return
    }
    parts.push({ type: 'text', text })
}

function collectRawPromptParts(node: ProseMirrorJsonNode | undefined): BranchMarkerPromptPart[] {
    if (!node) return []
    const parts: BranchMarkerPromptPart[] = []
    const visit = (candidate: ProseMirrorJsonNode): void => {
        if (candidate.type === 'text') {
            appendText(parts, candidate.text ?? '')
            return
        }
        if (candidate.type === 'hard_break') {
            appendText(parts, ' ')
            return
        }
        if (candidate.type === PROMPT_REFERENCE_NODE_TYPE) {
            const reference = normalizePromptReferenceAttrs(candidate.attrs)
            if (reference?.referenceType === 'capability-module') {
                parts.push({ type: 'capability-module', reference })
            } else if (reference?.referenceType === 'media') {
                parts.push({ type: 'media', reference })
            } else if (reference?.referenceType === 'tool') {
                parts.push({ type: 'tool', reference })
            } else if (reference?.referenceType === 'skill') {
                parts.push({ type: 'skill', reference })
            }
            return
        }
        for (const child of candidate.content ?? []) visit(child)
    }
    visit(node)
    return parts
}

function normalizePromptParts(parts: readonly BranchMarkerPromptPart[]): BranchMarkerPromptPart[] {
    const normalized: BranchMarkerPromptPart[] = []
    let hasVisibleContent = false
    let pendingWhitespace = false

    for (const part of parts) {
        if (isPromptReferencePart(part)) {
            if (pendingWhitespace && hasVisibleContent) appendText(normalized, ' ')
            normalized.push(part)
            hasVisibleContent = true
            pendingWhitespace = false
            continue
        }

        for (const character of part.text) {
            if (/\s/.test(character)) {
                pendingWhitespace = hasVisibleContent
                continue
            }
            if (pendingWhitespace) appendText(normalized, ' ')
            appendText(normalized, character)
            hasVisibleContent = true
            pendingWhitespace = false
        }
    }

    return normalized
}

export function getBranchMarkerPromptParts(
    userMessage: ProseMirrorJsonNode | undefined,
    fallbackText: string,
): BranchMarkerPromptPart[] {
    return resolveBranchMarkerPromptParts({
        persistedUserMessage: userMessage,
        fallbackText,
    })
}

export function resolveBranchMarkerPromptParts({
    persistedUserMessage,
    submittedParts = [],
    fallbackText,
}: {
    persistedUserMessage?: ProseMirrorJsonNode
    submittedParts?: readonly BranchMarkerPromptPart[]
    fallbackText: string
}): BranchMarkerPromptPart[] {
    const persistedParts = normalizePromptParts(collectRawPromptParts(persistedUserMessage))
    if (persistedParts.length > 0) return persistedParts

    const normalizedSubmittedParts = normalizePromptParts(submittedParts)
    if (normalizedSubmittedParts.length > 0) return normalizedSubmittedParts

    return [{ type: 'text', text: fallbackText.replace(/\s+/g, ' ').trim() }]
}

export function getBranchMarkerPromptDisplayText(parts: readonly BranchMarkerPromptPart[]): string {
    return parts.map((part) => part.type === 'text' ? part.text : part.reference.displayName).join('')
}

export function truncateBranchMarkerPromptParts(
    parts: readonly BranchMarkerPromptPart[],
    maximumCharacters: number,
): BranchMarkerPromptPart[] {
    const boundedMaximumCharacters = Math.max(0, Math.floor(maximumCharacters))
    const displayText = getBranchMarkerPromptDisplayText(parts)
    if (displayText.length <= boundedMaximumCharacters) return [...parts]

    const truncated: BranchMarkerPromptPart[] = []
    let displayedCharacters = 0
    let didTruncate = false
    for (const [index, part] of parts.entries()) {
        const partText = part.type === 'text' ? part.text : part.reference.displayName
        if (isPromptReferencePart(part)) {
            if (displayedCharacters >= boundedMaximumCharacters) {
                didTruncate = true
                break
            }
            truncated.push(part)
            displayedCharacters += partText.length
            if (displayedCharacters >= boundedMaximumCharacters && index < parts.length - 1) {
                didTruncate = true
                break
            }
            continue
        }

        const remainingCharacters = boundedMaximumCharacters - displayedCharacters
        if (remainingCharacters <= 0) {
            didTruncate = true
            break
        }
        if (partText.length <= remainingCharacters) {
            appendText(truncated, partText)
            displayedCharacters += partText.length
            continue
        }
        appendText(truncated, partText.slice(0, remainingCharacters))
        didTruncate = true
        break
    }
    if (didTruncate) appendText(truncated, '...')
    return truncated
}

export function renderBranchMarkerPromptParts(
    parts: readonly BranchMarkerPromptPart[],
    options: {
        previewRenderer?: PromptReferencePreviewRenderer
        inlinePopover?: boolean
    } = {},
): Array<string | HTMLElement> {
    return parts.map((part) => {
        if (part.type === 'text') return part.text
        if (part.type === 'media' && options.previewRenderer) {
            return createMediaPromptReferencePreview(part.reference, options.previewRenderer, {
                inlinePopover: options.inlinePopover,
                preferredPlacement: 'top',
            })?.dom ?? createPromptReferenceChipElement(part.reference)
        }
        if (part.type === 'capability-module' && options.previewRenderer?.getCapabilityModule) {
            return createCapabilityPromptReferencePreview(part.reference, options.previewRenderer, {
                inlinePopover: options.inlinePopover,
                preferredPlacement: 'top',
            }).dom
        }
        return createPromptReferenceChipElement(part.reference)
    })
}
