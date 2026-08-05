'use strict'

import type { ImageReferenceCapabilities } from '@lixpi/constants'

import type {
    ImageGenerationReferenceRole,
    ResolvedImageGenerationReference,
} from '../image-generation-references.ts'

export type ImageReferenceAdaptation = {
    included: ResolvedImageGenerationReference[]
    omitted: Array<{
        role: ImageGenerationReferenceRole
        fileName: string
        reason: 'identity-budget' | 'reference-budget' | 'unsupported-conditioning'
    }>
    explicitInputFidelity?: 'high'
}

export type ImageReferenceAdapterInput = {
    references: readonly ResolvedImageGenerationReference[]
    capabilities: ImageReferenceCapabilities
    requiresIdentity: boolean
}

export type ImageReferenceAdapter = {
    implementation: 'openai-images' | 'google-parts' | 'stability-controls'
    adapt: (input: ImageReferenceAdapterInput) => ImageReferenceAdaptation
}

const IDENTITY_ROLES = new Set<ImageGenerationReferenceRole>([
    'original-source',
    'face-crop',
    'body-outfit-crop',
    'canonical-anchor',
    'adjacent-angle',
])

const ROLE_PRIORITY: Readonly<Record<ImageGenerationReferenceRole, number>> = {
    'canonical-anchor': 0,
    'original-source': 1,
    'pose-reference': 2,
    'face-crop': 3,
    'body-outfit-crop': 4,
    'adjacent-angle': 5,
    'prop-crop': 6,
    'structure-reference': 7,
    'capability-reference': 8,
    'source-reference': 9,
}

const adaptByBudget = ({
    references,
    capabilities,
    requiresIdentity,
}: ImageReferenceAdapterInput): ImageReferenceAdaptation => {
    if (requiresIdentity && (!capabilities.conditioningModes.includes('identity')
        || capabilities.maxIdentityReferenceImages === 0)) {
        throw new Error('IMAGE_REFERENCE_IDENTITY_CONDITIONING_UNSUPPORTED')
    }

    const hasCanonicalAnchor = references.some(reference => reference.role === 'canonical-anchor')
    const sorted = references
        .map((reference, index) => ({ reference, index }))
        .sort((left, right) => getRolePriority(left.reference.role, hasCanonicalAnchor)
            - getRolePriority(right.reference.role, hasCanonicalAnchor)
            || left.index - right.index)
    const included: ResolvedImageGenerationReference[] = []
    const omitted: ImageReferenceAdaptation['omitted'] = []
    let identityCount = 0

    for (const { reference } of sorted) {
        const identity = IDENTITY_ROLES.has(reference.role)
        const unsupportedConditioning = (identity && !capabilities.conditioningModes.includes('identity'))
            || (reference.role === 'pose-reference'
                && !capabilities.conditioningModes.includes('edit')
                && (!capabilities.conditioningModes.includes('pose') || !capabilities.supportsPoseControl))
            || (reference.role === 'structure-reference'
                && (!capabilities.conditioningModes.includes('structure') || !capabilities.supportsStructureControl))
        if (unsupportedConditioning) {
            omitted.push({ role: reference.role, fileName: reference.fileName, reason: 'unsupported-conditioning' })
            continue
        }
        if (identity && identityCount >= capabilities.maxIdentityReferenceImages) {
            omitted.push({ role: reference.role, fileName: reference.fileName, reason: 'identity-budget' })
            continue
        }
        if (included.length >= capabilities.maxReferenceImages) {
            omitted.push({ role: reference.role, fileName: reference.fileName, reason: 'reference-budget' })
            continue
        }
        included.push(reference)
        if (identity) identityCount += 1
    }

    const suppliedIdentityReference = references.some(reference => IDENTITY_ROLES.has(reference.role))
    if (requiresIdentity
        && suppliedIdentityReference
        && !included.some(reference => IDENTITY_ROLES.has(reference.role))) {
        throw new Error('IMAGE_REFERENCE_IDENTITY_BUDGET_EXHAUSTED')
    }
    const suppliedPoseReference = references.some(reference => reference.role === 'pose-reference')
    if (requiresIdentity
        && suppliedPoseReference
        && !included.some(reference => reference.role === 'pose-reference')) {
        throw new Error('IMAGE_REFERENCE_POSE_CONDITIONING_UNAVAILABLE')
    }

    return {
        included,
        omitted,
        ...(capabilities.inputFidelity === 'high' ? { explicitInputFidelity: 'high' as const } : {}),
    }
}

const getRolePriority = (
    role: ImageGenerationReferenceRole,
    hasCanonicalAnchor: boolean,
): number => {
    if (!hasCanonicalAnchor) return ROLE_PRIORITY[role]
    if (role === 'pose-reference') return 1
    if (role === 'original-source') return 2
    return ROLE_PRIORITY[role]
}

export const OPENAI_IMAGE_REFERENCE_ADAPTER: ImageReferenceAdapter = {
    implementation: 'openai-images',
    adapt: adaptByBudget,
}

export const GOOGLE_IMAGE_REFERENCE_ADAPTER: ImageReferenceAdapter = {
    implementation: 'google-parts',
    adapt: adaptByBudget,
}

export const STABILITY_IMAGE_REFERENCE_ADAPTER: ImageReferenceAdapter = {
    implementation: 'stability-controls',
    adapt: (input) => {
        if (input.requiresIdentity) throw new Error('IMAGE_REFERENCE_IDENTITY_CONDITIONING_UNSUPPORTED')
        const unsupported = input.references.filter(reference => IDENTITY_ROLES.has(reference.role))
        if (unsupported.length > 0) throw new Error('IMAGE_REFERENCE_IDENTITY_CONDITIONING_UNSUPPORTED')
        return adaptByBudget(input)
    },
}
