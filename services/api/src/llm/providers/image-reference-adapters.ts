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
    'original-source': 0,
    'face-crop': 1,
    'body-outfit-crop': 2,
    'canonical-anchor': 3,
    'adjacent-angle': 4,
    'prop-crop': 5,
    'pose-reference': 6,
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

    const sorted = references
        .map((reference, index) => ({ reference, index }))
        .sort((left, right) => ROLE_PRIORITY[left.reference.role] - ROLE_PRIORITY[right.reference.role]
            || left.index - right.index)
    const included: ResolvedImageGenerationReference[] = []
    const omitted: ImageReferenceAdaptation['omitted'] = []
    let identityCount = 0

    for (const { reference } of sorted) {
        const identity = IDENTITY_ROLES.has(reference.role)
        const unsupportedConditioning = (identity && !capabilities.conditioningModes.includes('identity'))
            || (reference.role === 'pose-reference'
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

    return {
        included,
        omitted,
        ...(capabilities.inputFidelity === 'high' ? { explicitInputFidelity: 'high' as const } : {}),
    }
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
