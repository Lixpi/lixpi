import {
    type ImageReferenceCapabilities,
} from '@lixpi/constants'

import {
    type ImageGenerationReferenceRole,
    type ResolvedImageGenerationReference,
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
    'edit-target',
    'edit-target-identity',
    'original-source',
    'face-crop',
    'body-outfit-crop',
    'canonical-anchor',
    'adjacent-angle',
    'opposite-angle',
])

const ROLE_PRIORITY: Readonly<Record<ImageGenerationReferenceRole, number>> = {
    'canonical-anchor': 0,
    'adjacent-angle': 1,
    'opposite-angle': 2,
    'original-source': 3,
    'edit-target': 4,
    'edit-target-identity': 5,
    'pose-reference': 6,
    'face-crop': 7,
    'body-outfit-crop': 8,
    'prop-crop': 9,
    'structure-reference': 10,
    'capability-reference': 11,
    'source-reference': 12,
}

const adaptByBudget = ({
    references,
    capabilities,
    requiresIdentity,
}: ImageReferenceAdapterInput): ImageReferenceAdaptation => {
    if (
        requiresIdentity && (!capabilities.conditioningModes.includes('identity')
            || capabilities.maxIdentityReferenceImages === 0)
    ) {
        throw new Error('IMAGE_REFERENCE_IDENTITY_CONDITIONING_UNSUPPORTED')
    }

    const hasCanonicalAnchor = references.some(reference => reference.role === 'canonical-anchor')
    const sorted = references
        .map((reference, index) => ({ reference, index }))
        .sort((left, right) =>
            getRolePriority(left.reference.role, hasCanonicalAnchor)
                - getRolePriority(right.reference.role, hasCanonicalAnchor)
            || left.index - right.index
        )
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
    if (
        requiresIdentity
        && suppliedIdentityReference
        && !included.some(reference => IDENTITY_ROLES.has(reference.role))
    ) {
        throw new Error('IMAGE_REFERENCE_IDENTITY_BUDGET_EXHAUSTED')
    }
    const suppliedPoseReference = references.some(reference => reference.role === 'pose-reference')
    if (
        requiresIdentity
        && suppliedPoseReference
        && !included.some(reference => reference.role === 'pose-reference')
    ) {
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
    if (!hasCanonicalAnchor) {
        if (role === 'edit-target') return 0
        if (role === 'edit-target-identity') return 1
        if (role === 'original-source') return 2
        if (role === 'pose-reference') return 3
        if (role === 'face-crop') return 4
        if (role === 'body-outfit-crop') return 5
        if (role === 'prop-crop') return 6
        if (role === 'adjacent-angle') return 7
        if (role === 'opposite-angle') return 8
    }
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

export function buildImageReferencePromptLabel(
    reference: Pick<ResolvedImageGenerationReference, 'role' | 'fileName'>,
    index: number,
    prefix = 'INPUT IMAGE',
): string {
    const heading = `${prefix} ${index + 1}`
    const file = ` File: ${reference.fileName}.`
    switch (reference.role) {
        case 'edit-target':
            return `${heading} — EXISTING EDIT TARGET.${file} This is not authoritative for traits rejected by the request. Preserve only request-approved or unchanged traits and apply every requested edit.`
        case 'edit-target-identity':
            return `${heading} — EDIT-TARGET IDENTITY CROP ONLY.${file} Preserve only the request-approved identity construction inside the approved face region. Do not copy any trait outside that region, any rejected trait inside it, or any prior-output defect.`
        case 'original-source':
            return `${heading} — AUTHORITATIVE ORIGINAL SOURCE.${file} Use its observed design, clothing, material, accessory, and placement evidence wherever the request assigns the target appearance to this source.`
        case 'face-crop':
            return `${heading} — FACE IDENTITY CROP.${file} Preserve observed facial construction unless the request explicitly changes it.`
        case 'body-outfit-crop':
            return `${heading} — BODY AND OUTFIT CROP.${file} Preserve observed proportions, silhouette, and clothing unless the request explicitly changes them.`
        case 'canonical-anchor':
            return `${heading} — CANONICAL GENERATED ANCHOR.${file} Keep only its request-compliant generated character identity and continuity.`
        case 'adjacent-angle':
            return `${heading} — ADJACENT GENERATED ANGLE.${file} Keep only its request-compliant cross-view continuity.`
        case 'opposite-angle':
            return `${heading} — OPPOSITE GENERATED ANGLE.${file} Keep only its request-compliant rear/front design continuity.`
        case 'prop-crop':
            return `${heading} — OBSERVED PROP CROP.${file} Preserve the visible prop unless the request explicitly changes it.`
        case 'pose-reference':
            return `${heading} — POSE REFERENCE ONLY.${file} Use its spatial pose and framing without copying identity, anatomy, clothing, materials, or style.`
        case 'structure-reference':
            return `${heading} — STRUCTURE REFERENCE ONLY.${file} Use its composition without copying identity or design.`
        case 'capability-reference':
            return `${heading} — CAPABILITY REFERENCE.${file} Apply it only according to the Capability instructions.`
        case 'source-reference':
            return `${heading} — SOURCE REFERENCE.${file}`
    }
}

export function prependImageReferencePromptLegend(
    prompt: string,
    references: readonly Pick<ResolvedImageGenerationReference, 'role' | 'fileName'>[],
): string {
    if (references.length === 0) return prompt
    return [
        'INPUT IMAGE ORDER — THE FOLLOWING ROLES MAP EXACTLY TO THE ORDERED REFERENCE IMAGE SET',
        ...references.map((reference, index) => buildImageReferencePromptLabel(reference, index)),
        'Do not merge conflicting traits across images. The authoritative request decides which role supplies each trait.',
        'IMAGE TASK',
        prompt,
    ].join('\n')
}
