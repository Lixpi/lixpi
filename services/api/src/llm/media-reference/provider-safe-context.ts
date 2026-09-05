import {
    type MediaReferenceBinding,
    type ProviderSafeMediaIntent,
} from '@lixpi/constants'

import { normalizeMediaReferenceVariant } from './media-reference-matcher.ts'

const collectStrings = (
    value: unknown,
    path = '$',
): Array<{
    path: string
    value: string
}> => {
    if (typeof value === 'string')
        return [{
            path,
            value,
        }]

    if (Array.isArray(value))
        return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`))

    if (
        !value
        || typeof value !== 'object'
    )
        return []

    return Object.entries(value).flatMap(([key, item]) => collectStrings(item, `${path}.${key}`))
}

export const assertNoForbiddenMediaReferenceLeak = ({
    payload,
    forbiddenNameVariants,
}: {
    payload: unknown
    forbiddenNameVariants: string[]
}): void => {
    const forbidden = [...new Set(
        forbiddenNameVariants.map(normalizeMediaReferenceVariant).filter(Boolean),
    )]

    for (const candidate of collectStrings(payload)) {
        const normalized = normalizeMediaReferenceVariant(candidate.value)
        const leaked = forbidden.find(
            variant =>
                normalized === variant || normalized.includes(` ${variant} `)
                || normalized.startsWith(`${variant} `) || normalized.endsWith(` ${variant}`),
        )

        if (leaked)
            throw new Error(`MEDIA_REFERENCE_DISPLAY_NAME_LEAK:${candidate.path}`)
    }
}

export const buildProviderSafeReferenceContext = (bindings: MediaReferenceBinding[]): Array<Record<string, unknown>> =>
    bindings.map(
        binding => ({
            alias: binding.alias,
            mediaKind: binding.mediaKind,
            semanticDescriptor: binding.semanticDescriptor,
            depictionMedium: binding.depictionMedium,
            subjectIdentityClassification: binding.subjectIdentity.classification,
        }),
    )

export const formatProviderSafeReferenceContext = (bindings: MediaReferenceBinding[]): string => {
    if (bindings.length === 0)
        return ''

    return [
        'Attached media references:',
        ...bindings.map(
            binding =>
                [
                    `${binding.alias} — ${binding.semanticDescriptor}`,
                    `medium=${binding.depictionMedium}`,
                    `subjectIdentity=${binding.subjectIdentity.classification}`,
                ].join('; '),
        ),
    ].join('\n')
}

export const assertProviderSafeMediaIntent = (intent: ProviderSafeMediaIntent): void => {
    assertNoForbiddenMediaReferenceLeak({
        payload: {
            safePrompt: intent.safePrompt,
            referenceContext: buildProviderSafeReferenceContext(intent.bindings),
        },
        forbiddenNameVariants: intent.forbiddenNameVariants,
    })
}
