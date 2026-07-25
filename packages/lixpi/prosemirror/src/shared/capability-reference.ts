import { type CapabilityKind, type CapabilityPromptReference } from '@lixpi/constants'

export const CAPABILITY_REFERENCE_NODE_TYPE = 'capability_reference'

export type CapabilityReferenceAttrs = CapabilityPromptReference & {
    displayName: string
}

export function normalizeCapabilityReferenceAttrs(input: unknown): CapabilityReferenceAttrs | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const candidate = input as Record<string, unknown>
    if (!isNonEmptyString(candidate.capabilityId)) return null
    if (!isCapabilityKind(candidate.kind)) return null
    if (!isNonEmptyString(candidate.displayName)) return null

    return {
        capabilityId: candidate.capabilityId.trim(),
        kind: candidate.kind,
        displayName: candidate.displayName.trim(),
    }
}

export function toCapabilityPromptReference(attrs: CapabilityReferenceAttrs): CapabilityPromptReference {
    return {
        capabilityId: attrs.capabilityId,
        kind: attrs.kind,
    }
}

function isCapabilityKind(input: unknown): input is CapabilityKind {
    return input === 'tool' || input === 'skill'
}

function isNonEmptyString(input: unknown): input is string {
    return typeof input === 'string' && input.trim().length > 0
}
