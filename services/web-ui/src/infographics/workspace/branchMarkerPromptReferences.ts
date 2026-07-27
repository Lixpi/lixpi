import type { PromptReferenceAtomAttrs } from '@lixpi/constants'
import {
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'

import { createPromptReferenceChipElement } from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

type CapabilityModuleReference = Extract<PromptReferenceAtomAttrs, { referenceType: 'capability-module' }>

export type BranchMarkerPromptPart = {
    type: 'text'
    text: string
} | {
    type: 'capability-module'
    reference: CapabilityModuleReference
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
        if (part.type === 'capability-module') {
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
    const parts = normalizePromptParts(collectRawPromptParts(userMessage))
    return parts.length > 0 ? parts : [{ type: 'text', text: fallbackText.replace(/\s+/g, ' ').trim() }]
}

export function getBranchMarkerPromptDisplayText(parts: readonly BranchMarkerPromptPart[]): string {
    return parts.map((part) => part.type === 'text' ? part.text : part.reference.displayName).join('')
}

export function truncateBranchMarkerPromptParts(
    parts: readonly BranchMarkerPromptPart[],
    maximumCharacters: number,
): BranchMarkerPromptPart[] {
    const displayText = getBranchMarkerPromptDisplayText(parts)
    if (displayText.length <= maximumCharacters) return [...parts]

    const truncated: BranchMarkerPromptPart[] = []
    let remainingCharacters = maximumCharacters
    for (const part of parts) {
        if (remainingCharacters <= 0) break
        const partText = part.type === 'text' ? part.text : part.reference.displayName
        if (partText.length <= remainingCharacters) {
            truncated.push(part)
            remainingCharacters -= partText.length
            continue
        }
        if (part.type === 'capability-module') break
        appendText(truncated, partText.slice(0, remainingCharacters))
        remainingCharacters = 0
    }
    appendText(truncated, '...')
    return truncated
}

export function renderBranchMarkerPromptParts(
    parts: readonly BranchMarkerPromptPart[],
): Array<string | HTMLSpanElement> {
    return parts.map((part) => part.type === 'text'
        ? part.text
        : createPromptReferenceChipElement(part.reference))
}
