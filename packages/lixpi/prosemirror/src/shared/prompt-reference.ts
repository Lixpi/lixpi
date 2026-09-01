import {
    type MediaPromptReference,
    type PromptReference,
    type PromptReferenceAtomAttrs,
} from '@lixpi/constants'

export const PROMPT_REFERENCE_NODE_TYPE = 'prompt_reference'
export const LEGACY_CAPABILITY_REFERENCE_NODE_TYPE = 'capability_reference'

export function normalizeLegacyCapabilityReferenceAttrs(input: unknown): PromptReferenceAtomAttrs | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const candidate = input as Record<string, unknown>
    if (
        (candidate.kind !== 'tool' && candidate.kind !== 'skill')
        || !isNonEmptyString(candidate.capabilityId)
        || !isNonEmptyString(candidate.displayName)
    ) return null
    return {
        referenceType: candidate.kind,
        capabilityId: candidate.capabilityId.trim(),
        displayName: candidate.displayName.trim(),
    }
}

export function normalizePromptReferenceAttrs(input: unknown): PromptReferenceAtomAttrs | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const candidate = input as Record<string, unknown>
    if (!isNonEmptyString(candidate.displayName)) return null
    const displayName = candidate.displayName.trim()

    if (candidate.referenceType === 'media') {
        if (
            !isNonEmptyString(candidate.assetId) || !isMediaKind(candidate.mediaKind)
            || hasNonEmptyString(candidate.moduleId) || hasNonEmptyString(candidate.capabilityId)
        ) return null
        return {
            referenceType: 'media',
            assetId: candidate.assetId.trim(),
            ...(isNonEmptyString(candidate.nodeId) ? { nodeId: candidate.nodeId.trim() } : {}),
            mediaKind: candidate.mediaKind,
            displayName,
        }
    }
    if (candidate.referenceType === 'capability-module') {
        if (
            !isNonEmptyString(candidate.moduleId)
            || hasNonEmptyString(candidate.assetId) || hasNonEmptyString(candidate.nodeId)
            || hasNonEmptyString(candidate.mediaKind) || hasNonEmptyString(candidate.capabilityId)
        ) return null
        return {
            referenceType: 'capability-module',
            moduleId: candidate.moduleId.trim(),
            displayName,
        }
    }
    if (candidate.referenceType === 'capability-artifact') {
        if (
            !isNonEmptyString(candidate.assetId) || !isNonEmptyString(candidate.artifactTypeId)
            || hasNonEmptyString(candidate.mediaKind) || hasNonEmptyString(candidate.moduleId)
            || hasNonEmptyString(candidate.capabilityId)
        ) return null
        return {
            referenceType: 'capability-artifact',
            artifactTypeId: candidate.artifactTypeId.trim(),
            assetId: candidate.assetId.trim(),
            ...(isNonEmptyString(candidate.nodeId) ? { nodeId: candidate.nodeId.trim() } : {}),
            displayName,
        }
    }
    if (candidate.referenceType === 'tool' || candidate.referenceType === 'skill') {
        if (
            !isNonEmptyString(candidate.capabilityId)
            || hasNonEmptyString(candidate.assetId) || hasNonEmptyString(candidate.nodeId)
            || hasNonEmptyString(candidate.mediaKind) || hasNonEmptyString(candidate.moduleId)
        ) return null
        return {
            referenceType: candidate.referenceType,
            capabilityId: candidate.capabilityId.trim(),
            displayName,
        }
    }
    return null
}

export function toPromptReference(attrs: PromptReferenceAtomAttrs): PromptReference {
    if (attrs.referenceType === 'media') {
        return {
            referenceType: 'media',
            assetId: attrs.assetId,
            ...(attrs.nodeId ? { nodeId: attrs.nodeId } : {}),
            mediaKind: attrs.mediaKind,
        }
    }
    if (attrs.referenceType === 'capability-module') {
        return { referenceType: 'capability-module', moduleId: attrs.moduleId }
    }
    if (attrs.referenceType === 'capability-artifact') {
        return {
            referenceType: 'capability-artifact',
            artifactTypeId: attrs.artifactTypeId,
            assetId: attrs.assetId,
            ...(attrs.nodeId ? { nodeId: attrs.nodeId } : {}),
        }
    }
    return { referenceType: attrs.referenceType, capabilityId: attrs.capabilityId }
}

export function getPromptReferenceStableId(reference: PromptReference): string {
    if (reference.referenceType === 'media') return reference.assetId
    if (reference.referenceType === 'capability-module') return reference.moduleId
    if (reference.referenceType === 'capability-artifact') return reference.assetId
    return reference.capabilityId
}

function isMediaKind(input: unknown): input is MediaPromptReference['mediaKind'] {
    return input === 'image' || input === 'video' || input === 'audio' || input === 'document'
}

function isNonEmptyString(input: unknown): input is string {
    return typeof input === 'string' && input.trim().length > 0
}

function hasNonEmptyString(input: unknown): boolean {
    return typeof input === 'string' && input.trim().length > 0
}
