'use strict'

import { createHash } from 'node:crypto'

import type {
    Asset,
    MediaPromptSegment,
    MediaReferenceBinding,
    ProviderSafeMediaIntent,
    UnresolvedReferenceBinding,
} from '@lixpi/constants'
import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    normalizeLegacyCapabilityReferenceAttrs,
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'

import {
    getMediaReferenceBindingVariants,
    isIdentifyingMediaReferencePhrase,
    matchMediaReferencePhrase,
    MEDIA_REFERENCE_MAX_BINDINGS,
    normalizeMediaReferenceVariant,
} from './media-reference-matcher.ts'
import { assertProviderSafeMediaIntent } from './provider-safe-context.ts'

const buildSemanticDescriptor = (asset: Asset): string => {
    const descriptor = asset.descriptor
    if (!descriptor) return `${asset.depictionMedium} ${asset.media?.kind ?? 'media'} reference`
    return [descriptor.summary, ...descriptor.entityTags, ...descriptor.styleTags]
        .map(value => value.trim())
        .filter(Boolean)
        .join('; ')
}

const filenameStem = (originalName: string | undefined): string | undefined => originalName
    ?.replace(/\.[^.]+$/u, '')
    .trim()

const GENERATED_MEDIA_PLACEHOLDER_VARIANT = /^generated(?: \d+)?$/u

const isForbiddenDisplayNameVariant = (variant: string): boolean =>
    Boolean(variant) && !GENERATED_MEDIA_PLACEHOLDER_VARIANT.test(variant)

export const createMediaReferenceBindings = ({
    assets,
    selectedNodeIds = {},
}: {
    assets: Asset[]
    selectedNodeIds?: Record<string, string | undefined>
}): MediaReferenceBinding[] => {
    const uniqueAssets = [...new Map(assets.map(asset => [asset.assetId, asset])).values()]
    if (uniqueAssets.length > MEDIA_REFERENCE_MAX_BINDINGS) throw new Error('MEDIA_REFERENCE_BINDING_LIMIT_EXCEEDED')
    return uniqueAssets.map((asset, index) => {
        const originalStem = filenameStem(asset.media?.originalName)
        const forbiddenNameVariants = [...new Set([
            asset.title,
            ...(originalStem ? [originalStem] : []),
        ].map(normalizeMediaReferenceVariant).filter(isForbiddenDisplayNameVariant))]
        return {
            assetId: asset.assetId,
            assetRevision: asset.revision,
            ...(selectedNodeIds[asset.assetId] ? { nodeId: selectedNodeIds[asset.assetId] } : {}),
            mediaKind: asset.media?.kind ?? 'document',
            alias: `REFERENCE_${index + 1}`,
            displayNameSnapshot: asset.title,
            forbiddenNameVariants,
            semanticDescriptor: buildSemanticDescriptor(asset),
            depictionMedium: asset.depictionMedium,
            subjectIdentity: asset.subjectIdentity,
        }
    })
}

export const segmentMediaPrompt = (node: ProseMirrorJsonNode): MediaPromptSegment[] => {
    const segments: MediaPromptSegment[] = []
    let offset = 0
    const appendText = (text: string): void => {
        if (!text) return
        const last = segments.at(-1)
        if (last?.kind === 'text') {
            last.text += text
            last.to += text.length
        } else {
            segments.push({ kind: 'text', text, from: offset, to: offset + text.length })
        }
        offset += text.length
    }
    const visit = (candidate: ProseMirrorJsonNode): void => {
        if (candidate.type === 'text') return appendText(candidate.text ?? '')
        if (candidate.type === 'hard_break') return appendText('\n')
        if (candidate.type === PROMPT_REFERENCE_NODE_TYPE || candidate.type === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE) {
            const attrs = candidate.type === PROMPT_REFERENCE_NODE_TYPE
                ? normalizePromptReferenceAttrs(candidate.attrs)
                : normalizeLegacyCapabilityReferenceAttrs(candidate.attrs)
            if (!attrs) return
            if (attrs.referenceType !== 'media') return appendText(attrs.displayName)
            segments.push({
                kind: 'reference',
                referenceType: 'media',
                assetId: attrs.assetId,
                ...(attrs.nodeId ? { nodeId: attrs.nodeId } : {}),
                mediaKind: attrs.mediaKind,
                displayName: attrs.displayName,
                from: offset,
                to: offset + attrs.displayName.length,
            })
            offset += attrs.displayName.length
            return
        }
        for (const child of candidate.content ?? []) visit(child)
    }
    visit(node)
    return segments
}

const replaceFreeFormMatches = ({
    text,
    offset,
    bindings,
    resolvedReferences,
}: {
    text: string
    offset: number
    bindings: MediaReferenceBinding[]
    resolvedReferences: Array<{ originalText: string; assetId: string }>
}): { safeText: string; unresolved: UnresolvedReferenceBinding[] } => {
    const variants = bindings.flatMap(getMediaReferenceBindingVariants)
        .map(normalizeMediaReferenceVariant)
        .filter(Boolean)
    const maximumWords = Math.max(1, ...variants.map(variant => variant.split(' ').length))
    const tokenMatches = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}’'._-]*/gu)]
    const replacements: Array<{ from: number; to: number; value: string }> = []
    const unresolved: UnresolvedReferenceBinding[] = []
    for (let startIndex = 0; startIndex < tokenMatches.length; startIndex++) {
        for (let wordCount = Math.min(maximumWords, tokenMatches.length - startIndex); wordCount >= 1; wordCount--) {
            const start = tokenMatches[startIndex]!.index
            const endMatch = tokenMatches[startIndex + wordCount - 1]!
            const end = endMatch.index + endMatch[0].length
            if (replacements.some(replacement => start < replacement.to && end > replacement.from)) continue
            const phrase = text.slice(start, end)
            if (!isIdentifyingMediaReferencePhrase(phrase)) continue
            const match = matchMediaReferencePhrase({
                phrase,
                bindings,
                promptRange: { from: offset + start, to: offset + end },
            })
            const persistedResolution = resolvedReferences.find(resolution =>
                normalizeMediaReferenceVariant(resolution.originalText) === normalizeMediaReferenceVariant(phrase))
            const persistedResolutionIsCurrentCandidate = persistedResolution && (
                (match.kind === 'unique' && match.binding?.assetId === persistedResolution.assetId)
                || (match.kind === 'ambiguous' && match.unresolved?.candidates
                    .some(candidate => candidate.assetId === persistedResolution.assetId))
            )
            if (persistedResolution && persistedResolutionIsCurrentCandidate) {
                const binding = bindings.find(candidate => candidate.assetId === persistedResolution.assetId)
                if (!binding) throw new Error(`MEDIA_REFERENCE_RESOLUTION_ASSET_NOT_BOUND:${persistedResolution.assetId}`)
                replacements.push({ from: start, to: end, value: binding.alias })
                break
            }
            if (match.kind === 'unique' && match.binding) {
                replacements.push({ from: start, to: end, value: match.binding.alias })
                break
            }
            if (match.kind === 'ambiguous' && match.unresolved) {
                unresolved.push(match.unresolved)
                replacements.push({ from: start, to: end, value: phrase })
                break
            }
        }
    }
    let safeText = text
    for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
        safeText = `${safeText.slice(0, replacement.from)}${replacement.value}${safeText.slice(replacement.to)}`
    }
    return { safeText, unresolved }
}

export const compileMediaReferenceIntent = ({
    prompt,
    bindings,
    resolvedReferences = [],
}: {
    prompt: ProseMirrorJsonNode
    bindings: MediaReferenceBinding[]
    resolvedReferences?: Array<{ originalText: string; assetId: string }>
}): { intent: ProviderSafeMediaIntent; unresolvedBindings: UnresolvedReferenceBinding[] } => {
    const segments = segmentMediaPrompt(prompt)
    const unresolvedBindings: UnresolvedReferenceBinding[] = []
    const safePrompt = segments.map(segment => {
        if (segment.kind === 'reference') {
            const binding = bindings.find(candidate => candidate.assetId === segment.assetId)
            if (!binding) throw new Error(`MEDIA_REFERENCE_NOT_AUTHORIZED:${segment.assetId}`)
            return binding.alias
        }
        const compiled = replaceFreeFormMatches({ text: segment.text, offset: segment.from, bindings, resolvedReferences })
        unresolvedBindings.push(...compiled.unresolved)
        return compiled.safeText
    }).join('')
    const fingerprintInput = JSON.stringify({
        safePrompt,
        assetIds: bindings.map(binding => binding.assetId),
    })
    const intent: ProviderSafeMediaIntent = {
        intentVersion: 'media-provider-safe-intent-v1',
        originalSegments: segments,
        safePrompt,
        bindings,
        forbiddenNameVariants: [...new Set(bindings.flatMap(binding => binding.forbiddenNameVariants))],
        promptFingerprint: createHash('sha256').update(fingerprintInput).digest('hex'),
    }
    if (unresolvedBindings.length === 0) assertProviderSafeMediaIntent(intent)
    return { intent, unresolvedBindings }
}

const escapeRegularExpression = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

export const sanitizeMediaReferenceText = (text: string, bindings: MediaReferenceBinding[]): string => {
    let safe = text
    for (const binding of bindings) {
        const variants = [
            binding.displayNameSnapshot,
            ...binding.forbiddenNameVariants,
        ].map(value => value.trim()).filter(Boolean).sort((left, right) => right.length - left.length)
        for (const variant of variants) {
            safe = safe.replace(new RegExp(`\\b${escapeRegularExpression(variant)}\\b`, 'giu'), binding.alias)
        }
    }
    return safe
}
