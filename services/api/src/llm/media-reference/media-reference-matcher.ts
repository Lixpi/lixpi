import { v4 as uuid } from 'uuid'

import {
    type MediaReferenceBinding,
    type UnresolvedReferenceBinding,
} from '@lixpi/constants'

export const MEDIA_REFERENCE_MATCHER_VERSION = 'bounded-local-v3'
export const MEDIA_REFERENCE_UNIQUE_THRESHOLD = 0.78
export const MEDIA_REFERENCE_WINNING_MARGIN = 0.12
export const MEDIA_REFERENCE_MAX_BINDINGS = 32
export const MEDIA_REFERENCE_MAX_CANDIDATES = 5

const GENERIC_SUFFIXES = new Set([
    'asset',
    'audio',
    'document',
    'file',
    'image',
    'img',
    'media',
    'photo',
    'picture',
    'video',
])
const NON_IDENTIFYING_TOKENS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'been',
    'being',
    'but',
    'by',
    'can',
    'could',
    'did',
    'do',
    'does',
    'for',
    'from',
    'had',
    'has',
    'have',
    'he',
    'her',
    'here',
    'him',
    'his',
    'how',
    'i',
    'if',
    'in',
    'into',
    'is',
    'it',
    'its',
    'may',
    'me',
    'might',
    'my',
    'no',
    'not',
    'of',
    'on',
    'or',
    'our',
    'she',
    'should',
    'so',
    'than',
    'that',
    'the',
    'their',
    'them',
    'then',
    'there',
    'these',
    'they',
    'this',
    'those',
    'to',
    'us',
    'was',
    'we',
    'were',
    'what',
    'when',
    'where',
    'which',
    'while',
    'who',
    'will',
    'with',
    'would',
    'you',
    'your',
])

const singularizeToken = (token: string): string => {
    if (
        token.endsWith('ies')
        && token.length > 4
    )
        return `${token.slice(0, -3)}y`

    if (
        token.endsWith('ses')
        && token.length > 4
    )
        return token.slice(0, -2)

    if (
        token.endsWith('s')
        && !token.endsWith('ss')
        && token.length > 3
    )
        return token.slice(0, -1)

    return token
}

export const normalizeMediaReferenceVariant = (value: string): string =>
    value
        .normalize('NFKC')
        .toLocaleLowerCase('en-US')
        .replace(/[’']/g, '')
        .replace(/\b([\p{L}\p{N}_-]+)s\b/gu, '$1')
        .replace(/\.[a-z0-9]{1,8}$/iu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/u).map(singularizeToken).filter(token => token.length > 0 && !GENERIC_SUFFIXES.has(token))
        .join(' ')

const tokenSet = (value: string): Set<string> => new Set(
    value.split(' ').filter(Boolean),
)
const identifyingTokenSet = (value: string): Set<string> => new Set(
    [...tokenSet(value)].filter(token => !NON_IDENTIFYING_TOKENS.has(token)),
)

export const isIdentifyingMediaReferencePhrase = (value: string): boolean => identifyingTokenSet(
    normalizeMediaReferenceVariant(value),
).size > 0

const tokenSimilarity = (
    left: string,
    right: string,
): number => {
    const a = tokenSet(left)
    const b = tokenSet(right)

    if (
        a.size === 0
        || b.size === 0
    )
        return 0

    const intersection = [...a].filter(token => b.has(token)).length

    return (2 * intersection) / (a.size + b.size)
}

const boundedEditDistance = (
    left: string,
    right: string,
    maximum: number,
): number => {
    if (Math.abs(left.length - right.length) > maximum)
        return maximum + 1

    let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex]
        let rowMinimum = leftIndex

        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
            const value = Math.min(
                current[rightIndex - 1]! + 1,
                previous[rightIndex]! + 1,
                previous[rightIndex - 1]! + cost,
            )
            current.push(value)
            rowMinimum = Math.min(rowMinimum, value)
        }

        if (rowMinimum > maximum)
            return maximum + 1

        previous = current
    }

    return previous[right.length]!
}

const trigrams = (value: string): Set<string> => {
    const padded = `  ${value}  `
    const result = new Set<string>()

    for (let index = 0; index <= padded.length - 3; index++)
        result.add(
            padded.slice(index, index + 3),
        )

    return result
}

const trigramSimilarity = (
    left: string,
    right: string,
): number => {
    const a = trigrams(left)
    const b = trigrams(right)
    const intersection = [...a].filter(value => b.has(value)).length

    return a.size + b.size === 0 ? 0 : (2 * intersection) / (a.size + b.size)
}

export const scoreMediaReferenceVariant = (
    phrase: string,
    variant: string,
): number => {
    const normalizedPhrase = normalizeMediaReferenceVariant(phrase)
    const normalizedVariant = normalizeMediaReferenceVariant(variant)

    if (
        !normalizedPhrase
        || !normalizedVariant
    )
        return 0

    const phraseTokens = identifyingTokenSet(normalizedPhrase)

    if (phraseTokens.size === 0)
        return 0

    if (normalizedPhrase === normalizedVariant)
        return 1

    const variantTokens = identifyingTokenSet(normalizedVariant)
    const boundedSubsetScore = normalizedPhrase.length >= 3
        && phraseTokens.size > 0
        && [...phraseTokens].every(token => variantTokens.has(token))
        ? 0.88
        : 0
    const maximumDistance = Math.max(
        1,
        Math.floor(Math.max(normalizedPhrase.length, normalizedVariant.length) * 0.2),
    )
    const distance = boundedEditDistance(
        normalizedPhrase,
        normalizedVariant,
        maximumDistance,
    )
    const editScore = distance > maximumDistance
        ? 0
        : 1 - distance / Math.max(normalizedPhrase.length, normalizedVariant.length)

    return Math.max(
        boundedSubsetScore,
        tokenSimilarity(normalizedPhrase, normalizedVariant),
        editScore * 0.95,
        trigramSimilarity(normalizedPhrase, normalizedVariant) * 0.86,
    )
}

export const getMediaReferenceBindingVariants = (binding: MediaReferenceBinding): string[] => [
    ...new Set(
        [
            binding.displayNameSnapshot,
            ...binding.forbiddenNameVariants,
        ].map(value => value.trim()).filter(Boolean),
    ),
]

export type MediaReferenceMatch = {
    kind: 'unique' | 'ambiguous' | 'none'
    binding?: MediaReferenceBinding
    unresolved?: UnresolvedReferenceBinding
    score?: number
}

export const matchMediaReferencePhrase = ({
    phrase,
    bindings,
    promptRange,
}: {
    phrase: string
    bindings: MediaReferenceBinding[]
    promptRange: {
        from: number
        to: number
    }
}): MediaReferenceMatch => {
    if (bindings.length > MEDIA_REFERENCE_MAX_BINDINGS)
        throw new Error('MEDIA_REFERENCE_BINDING_LIMIT_EXCEEDED')

    const scores = bindings.map(
        binding => ({
            binding,
            score: Math.max(...getMediaReferenceBindingVariants(binding).map(variant => scoreMediaReferenceVariant(phrase, variant))),
        }),
    ).filter(candidate => candidate.score >= MEDIA_REFERENCE_UNIQUE_THRESHOLD)
        .sort((left, right) => right.score - left.score || left.binding.assetId.localeCompare(right.binding.assetId))
    const winner = scores[0]

    if (!winner)
        return { kind: 'none' }

    const runnerUp = scores[1]

    if (
        !runnerUp
        || winner.score - runnerUp.score >= MEDIA_REFERENCE_WINNING_MARGIN
    )
        return {
            kind: 'unique',
            binding: winner.binding,
            score: winner.score,
        }

    return {
        kind: 'ambiguous',
        unresolved: {
            bindingId: uuid(),
            promptRange,
            originalText: phrase,
            matcherVersion: MEDIA_REFERENCE_MATCHER_VERSION,
            candidates: scores.slice(0, MEDIA_REFERENCE_MAX_CANDIDATES).map(
                candidate => ({
                    assetId: candidate.binding.assetId,
                    score: Number(
                        candidate.score.toFixed(4),
                    ),
                    previewRenditionName: 'thumbnail',
                }),
            ),
        },
    }
}
