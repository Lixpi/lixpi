'use strict'

import { describe, expect, it, vi } from 'vitest'

import type {
    Asset,
    ProviderIdentityVerification,
    SubjectIdentityClassification,
} from '@lixpi/constants'

import {
    ASSET_SUBJECT_IDENTITY_DERIVATION_VERSION,
    deriveDepictionMedium,
    deriveSubjectIdentityFromLineage,
} from './asset-subject-identity-service.ts'

const verification = (overrides: Partial<ProviderIdentityVerification> = {}): ProviderIdentityVerification => ({
    provider: 'BytePlus',
    providerAccountScope: 'account-1',
    strategy: 'provider-hosted-session',
    subjectHandle: 'provider-asset-1',
    status: 'valid',
    verifiedAt: 1,
    derivativeReuse: 'documented-lineage',
    policyProfileVersion: 'byteplus-media-policy-v1',
    ...overrides,
})

const makeAsset = ({
    assetId,
    classification,
    identityGroupId,
    providerVerifications = [],
    mediaKind = 'image',
}: {
    assetId: string
    classification: SubjectIdentityClassification
    identityGroupId?: string
    providerVerifications?: ProviderIdentityVerification[]
    mediaKind?: 'image' | 'video' | 'audio' | 'document'
}): Asset => ({
    assetId,
    organizationId: 'organization-1',
    title: assetId,
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    media: {
        kind: mediaKind,
        originalName: `${assetId}.png`,
        sourceMimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
        modelSafe: true,
        renditions: {},
    },
    depictionMedium: 'unknown',
    subjectIdentity: {
        classification,
        source: classification === 'unknown' ? 'automatic-lineage' : 'user-attestation',
        ...(classification !== 'unknown' ? { currentAttestationId: `attestation-${assetId}` } : {}),
        ...(identityGroupId ? { identityGroupId } : {}),
        providerVerifications,
    },
    documents: {},
    states: {
        lifecycle: 'active',
        media: 'ready',
        conversation: 'none',
        provenance: 'none',
    },
    referenceCount: 1,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
})

describe('Asset subject identity derivation', () => {
    it('derives visual medium without inventing subject identity', () => {
        expect(deriveDepictionMedium({
            media: makeAsset({ assetId: 'painting', classification: 'unknown' }).media,
            descriptor: {
                status: 'ready',
                summary: 'watercolor portrait of a traveler',
                entityTags: ['person'],
                styleTags: ['watercolor'],
                source: 'analysis',
                version: '1',
                updatedAt: 1,
            },
        })).toBe('painting')
        expect(deriveDepictionMedium({
            media: makeAsset({ assetId: 'video', classification: 'unknown', mediaKind: 'video' }).media,
            descriptor: undefined,
        })).toBe('unknown')
    })

    it('ignores no-person inputs and derives fictional output when no person-bearing source remains', () => {
        const result = deriveSubjectIdentityFromLineage([
            makeAsset({ assetId: 'room', classification: 'no-person' }),
        ], { generatedOutput: true })

        expect(result).toEqual({
            classification: 'fictional',
            source: 'automatic-lineage',
            inheritedFromAssetIds: ['room'],
            derivationVersion: ASSET_SUBJECT_IDENTITY_DERIVATION_VERSION,
            providerVerifications: [],
        })
    })

    it('inherits one compatible real-person identity and documented provider handle', () => {
        vi.spyOn(Date, 'now').mockReturnValue(100)
        const sharedVerification = verification({ expiresAt: 200 })
        const result = deriveSubjectIdentityFromLineage([
            makeAsset({
                assetId: 'portrait-1',
                classification: 'authorized-real-person',
                identityGroupId: 'subject-1',
                providerVerifications: [sharedVerification],
            }),
            makeAsset({
                assetId: 'portrait-2',
                classification: 'authorized-real-person',
                identityGroupId: 'subject-1',
                providerVerifications: [sharedVerification],
            }),
        ], { generatedOutput: true })

        expect(result).toMatchObject({
            classification: 'authorized-real-person',
            source: 'inherited-lineage',
            identityGroupId: 'subject-1',
            inheritedFromAssetIds: ['portrait-1', 'portrait-2'],
            providerVerifications: [sharedVerification],
        })
        vi.restoreAllMocks()
    })

    it.each([
        ['unknown ancestry', [
            makeAsset({ assetId: 'known', classification: 'fictional' }),
            makeAsset({ assetId: 'unknown', classification: 'unknown' }),
        ]],
        ['fictional/real mixture', [
            makeAsset({ assetId: 'fictional', classification: 'fictional' }),
            makeAsset({ assetId: 'real', classification: 'self', identityGroupId: 'subject-1' }),
        ]],
        ['different real-person groups', [
            makeAsset({ assetId: 'real-1', classification: 'self', identityGroupId: 'subject-1' }),
            makeAsset({ assetId: 'real-2', classification: 'self', identityGroupId: 'subject-2' }),
        ]],
    ])('resolves %s conservatively', (_case, sources) => {
        expect(deriveSubjectIdentityFromLineage(sources, { generatedOutput: true }).classification).toBe('unknown')
    })

    it('does not inherit expired or non-reusable provider handles', () => {
        vi.spyOn(Date, 'now').mockReturnValue(100)
        const result = deriveSubjectIdentityFromLineage([
            makeAsset({
                assetId: 'portrait',
                classification: 'self',
                identityGroupId: 'subject-1',
                providerVerifications: [
                    verification({ expiresAt: 99 }),
                    verification({ subjectHandle: 'non-reusable', derivativeReuse: 'same-provider-account' }),
                ],
            }),
        ], { generatedOutput: true })

        expect(result.providerVerifications).toEqual([])
        vi.restoreAllMocks()
    })
})
