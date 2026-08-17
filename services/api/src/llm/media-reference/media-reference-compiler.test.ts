'use strict'

import { describe, expect, it } from 'vitest'

import type { Asset, MediaReferenceBinding } from '@lixpi/constants'
import type { ProseMirrorJsonNode } from '@lixpi/prosemirror'

import {
    compileMediaReferenceIntent,
    createMediaReferenceBindings,
    sanitizeMediaReferenceText,
    segmentMediaPrompt,
} from './media-reference-compiler.ts'
import {
    MEDIA_REFERENCE_MAX_BINDINGS,
    matchMediaReferencePhrase,
    normalizeMediaReferenceVariant,
    scoreMediaReferenceVariant,
} from './media-reference-matcher.ts'
import {
    assertNoForbiddenMediaReferenceLeak,
    buildProviderSafeReferenceContext,
} from './provider-safe-context.ts'

const makeAsset = ({
    assetId,
    title,
    originalName = `${title}.png`,
    summary = 'watercolor illustration of a traveler',
    entityTags = ['traveler'],
}: {
    assetId: string
    title: string
    originalName?: string
    summary?: string
    entityTags?: string[]
}): Asset => ({
    assetId,
    organizationId: 'organization-1',
    title,
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    media: {
        kind: 'image',
        originalName,
        sourceMimeType: 'image/png',
        modelSafe: true,
        renditions: {},
    },
    descriptor: {
        status: 'ready',
        summary,
        entityTags,
        styleTags: ['watercolor'],
        source: 'analysis',
        version: '1',
        updatedAt: 1,
    },
    depictionMedium: 'painting',
    subjectIdentity: {
        classification: 'fictional',
        source: 'user-attestation',
        currentAttestationId: 'attestation-1',
        identityGroupId: `subject-${assetId}`,
        providerVerifications: [],
    },
    documents: {},
    states: {
        lifecycle: 'active',
        media: 'ready',
        conversation: 'none',
        provenance: 'none',
    },
    referenceCount: 1,
    revision: 3,
    createdAt: 1,
    updatedAt: 1,
})

const textPrompt = (text: string): ProseMirrorJsonNode => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('media reference matching and compilation', () => {
    it('normalizes common case, possessive, plural, suffix, and small-edit variations', () => {
        expect(normalizeMediaReferenceVariant("SHELBY'S Image.png")).toBe('shelby')
        expect(scoreMediaReferenceVariant('shelby', 'Shelby image')).toBe(1)
        expect(scoreMediaReferenceVariant('travellers', 'traveler')).toBeGreaterThanOrEqual(0.78)
        expect(scoreMediaReferenceVariant('shelbi', 'shelby')).toBeGreaterThanOrEqual(0.78)
    })

    it.each(['in the', 'with', 'the'])(
        'does not treat the function-word phrase %j as an Asset reference',
        phrase => {
            const descriptor = 'A figure in the foreground stands with a coat against the wall'

            expect(scoreMediaReferenceVariant(phrase, descriptor)).toBe(0)
        },
    )

    it('collapses duplicate Asset placements and assigns stable positional aliases', () => {
        const asset = makeAsset({ assetId: 'asset-1', title: 'Shelby' })
        const bindings = createMediaReferenceBindings({
            assets: [asset, asset],
            selectedNodeIds: { 'asset-1': 'node-17' },
        })

        expect(bindings).toHaveLength(1)
        expect(bindings[0]).toMatchObject({
            assetId: 'asset-1',
            nodeId: 'node-17',
            alias: 'REFERENCE_1',
            displayNameSnapshot: 'Shelby',
            semanticDescriptor: expect.stringContaining('watercolor illustration'),
        })
    })

    it('replaces explicit reference atoms and matching free-form text without leaking display metadata', () => {
        const bindings = createMediaReferenceBindings({
            assets: [makeAsset({ assetId: 'asset-1', title: 'Shelby', originalName: 'Shelby source.png' })],
        })
        const prompt: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Animate ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'media',
                            assetId: 'asset-1',
                            mediaKind: 'image',
                            displayName: 'Shelby',
                        },
                    },
                    { type: 'text', text: "; keep shelby's scarf." },
                ],
            }],
        }

        const compiled = compileMediaReferenceIntent({ prompt, bindings })

        expect(segmentMediaPrompt(prompt).some(segment => segment.kind === 'reference')).toBe(true)
        expect(compiled.unresolvedBindings).toEqual([])
        expect(compiled.intent.safePrompt).toBe('Animate REFERENCE_1; keep REFERENCE_1 scarf.')
        expect(JSON.stringify(buildProviderSafeReferenceContext(bindings))).not.toMatch(/Shelby/iu)
        expect(compiled.intent.promptFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    })

    it('does not treat descriptive Asset metadata or unmatched public-figure text as an Asset identity', () => {
        const bindings = createMediaReferenceBindings({
            assets: [makeAsset({
                assetId: 'asset-1',
                title: 'Old train',
                summary: 'weathered steam locomotive',
                entityTags: ['steam locomotive'],
            })],
        })
        const descriptiveText = compileMediaReferenceIntent({
            prompt: textPrompt('Use the steam locomotive at dusk'),
            bindings,
        })
        const unboundName = compileMediaReferenceIntent({
            prompt: textPrompt('Make Tom Cruise wave'),
            bindings,
        })

        expect(descriptiveText.intent.safePrompt).toBe('Use the steam locomotive at dusk')
        expect(unboundName.intent.safePrompt).toBe('Make Tom Cruise wave')
    })

    it('persists close candidates instead of selecting one', () => {
        const bindings = createMediaReferenceBindings({
            assets: [
                makeAsset({ assetId: 'asset-1', title: 'Alex portrait' }),
                makeAsset({ assetId: 'asset-2', title: 'Alex sketch' }),
            ],
        })
        const result = matchMediaReferencePhrase({
            phrase: 'Alex',
            bindings,
            promptRange: { from: 4, to: 8 },
        })

        expect(result.kind).toBe('ambiguous')
        expect(result.unresolved?.candidates.map(candidate => candidate.assetId)).toEqual(['asset-1', 'asset-2'])
        expect(result.unresolved?.matcherVersion).toBe('bounded-local-v3')
    })

    it('does not pause the exact correction prompt on incidental descriptive language', () => {
        const bindings = createMediaReferenceBindings({
            assets: [
                makeAsset({
                    assetId: 'source-drawing',
                    title: 'Urban Street Art',
                    summary: 'A figure wearing a gray coat stands against a wall with a canvas bag',
                    entityTags: ['figure', 'coat', 'red scarf', 'street art'],
                }),
                makeAsset({
                    assetId: 'character-sheet',
                    title: 'Cyborg Character Design',
                    summary: 'Three views of an android character with mechanical body parts and human hair',
                    entityTags: ['android', 'cyborg', 'human hair', 'character design'],
                }),
            ],
        })
        const prompt = textPrompt([
            'This character sheet was created out of this reference drawing.',
            "But there's an error in the last shot, arms are not covered with jacked, it contradicts the previous shot!",
            'Also remove hair completely, but add a bunch of flexible antennas that resemble the hair.',
            'And change the words on the bag to `Lixpi` (in red) `ai` (in black).',
            'Use Character Creator to create an improved variant of this character.',
        ].join(' '))

        const compiled = compileMediaReferenceIntent({ prompt, bindings })

        expect(compiled.unresolvedBindings).toEqual([])
        expect(compiled.intent.safePrompt).toContain('in the last shot')
        expect(compiled.intent.safePrompt).toContain('covered with jacked')
        expect(compiled.intent.safePrompt).toContain('(in red)')
    })

    it('does not ask which Asset owns a descriptive trait shared by attached references', () => {
        const bindings = createMediaReferenceBindings({
            assets: [
                makeAsset({ assetId: 'asset-1', title: 'Source Drawing', entityTags: ['red scarf'] }),
                makeAsset({ assetId: 'asset-2', title: 'Character Sheet', entityTags: ['red scarf'] }),
            ],
        })

        const compiled = compileMediaReferenceIntent({
            prompt: textPrompt('Keep the red scarf and write Lixpi in red on the bag'),
            bindings,
        })

        expect(compiled.unresolvedBindings).toEqual([])
        expect(compiled.intent.safePrompt).toBe('Keep the red scarf and write Lixpi in red on the bag')
    })

    it('uses a persisted user resolution to compile the same request deterministically', () => {
        const bindings = createMediaReferenceBindings({
            assets: [
                makeAsset({ assetId: 'asset-1', title: 'Alex portrait' }),
                makeAsset({ assetId: 'asset-2', title: 'Alex sketch' }),
            ],
        })
        const compiled = compileMediaReferenceIntent({
            prompt: textPrompt('Use Alex'),
            bindings,
            resolvedReferences: [{ originalText: 'Alex', assetId: 'asset-2' }],
        })

        expect(compiled.unresolvedBindings).toEqual([])
        expect(compiled.intent.safePrompt).toBe('Use REFERENCE_2')
    })

    it('ignores legacy persisted resolutions that do not identify an Asset by its current identity variants', () => {
        const bindings = createMediaReferenceBindings({
            assets: [makeAsset({ assetId: 'asset-1', title: 'Character Sheet' })],
        })
        const compiled = compileMediaReferenceIntent({
            prompt: textPrompt('Write Lixpi (in red) and fix the coat with the attached reference'),
            bindings,
            resolvedReferences: [
                { originalText: 'the', assetId: 'asset-1' },
                { originalText: 'with', assetId: 'asset-1' },
                { originalText: 'coat', assetId: 'asset-1' },
                { originalText: 'in red', assetId: 'asset-1' },
            ],
        })

        expect(compiled.unresolvedBindings).toEqual([])
        expect(compiled.intent.safePrompt).toBe('Write Lixpi (in red) and fix the coat with the attached reference')
    })

    it('rejects nested reasoning/provider payload leaks and sanitizes known display text', () => {
        const bindings = createMediaReferenceBindings({
            assets: [makeAsset({ assetId: 'asset-1', title: 'Shelby' })],
        })

        expect(() => assertNoForbiddenMediaReferenceLeak({
            payload: { candidate: { visualSummary: 'A shot of Shelby on a train' } },
            forbiddenNameVariants: bindings[0]!.forbiddenNameVariants,
        })).toThrow('MEDIA_REFERENCE_DISPLAY_NAME_LEAK:$.candidate.visualSummary')
        expect(sanitizeMediaReferenceText('Shelby boards the train', bindings)).toBe('REFERENCE_1 boards the train')
    })

    it('does not treat generated media placeholders as user display-name leaks', () => {
        const placeholderBinding = createMediaReferenceBindings({
            assets: [makeAsset({
                assetId: 'asset-placeholder',
                title: 'Generated image',
                originalName: 'generated-image.png',
            })],
        })[0]!
        const titledBinding = createMediaReferenceBindings({
            assets: [makeAsset({
                assetId: 'asset-titled',
                title: 'Cute Tabby Kitten',
                originalName: 'generated-image.png',
            })],
        })[0]!

        expect(placeholderBinding.forbiddenNameVariants).toEqual([])
        expect(titledBinding.forbiddenNameVariants).toEqual(['cute tabby kitten'])
        expect(() => assertNoForbiddenMediaReferenceLeak({
            payload: {
                mediaBranchCandidateSnapshot: {
                    candidates: [{ roleHints: ['base-context', 'generated-variant'] }],
                },
            },
            forbiddenNameVariants: [
                ...placeholderBinding.forbiddenNameVariants,
                ...titledBinding.forbiddenNameVariants,
            ],
        })).not.toThrow()
    })

    it('fails closed when the maximum request-scoped binding count is exceeded', () => {
        const binding = createMediaReferenceBindings({
            assets: [makeAsset({ assetId: 'asset-template', title: 'Template' })],
        })[0]!
        const tooMany = Array.from({ length: MEDIA_REFERENCE_MAX_BINDINGS + 1 }, (_, index) => ({
            ...binding,
            assetId: `asset-${index}`,
            alias: `REFERENCE_${index + 1}`,
        })) as MediaReferenceBinding[]

        expect(() => matchMediaReferencePhrase({
            phrase: 'Template',
            bindings: tooMany,
            promptRange: { from: 0, to: 8 },
        })).toThrow('MEDIA_REFERENCE_BINDING_LIMIT_EXCEEDED')
    })
})
