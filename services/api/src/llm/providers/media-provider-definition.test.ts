'use strict'

import { describe, expect, it } from 'vitest'

import type { ProviderName } from '@lixpi/constants'
import type { ProviderSafeMediaIntent } from '@lixpi/constants'

import { CURRENT_MEDIA_PROVIDER_DEFINITIONS } from './current-media-provider-definitions.ts'
import {
    assertValidMediaProviderDefinition,
    normalizeProviderProblem,
} from './media-provider-definition.ts'

describe('current media provider policy definitions', () => {
    it('registers a complete, valid policy profile for every current provider', () => {
        const providers: ProviderName[] = ['OpenAI', 'Anthropic', 'Google', 'Stability', 'BytePlus']

        expect(Object.keys(CURRENT_MEDIA_PROVIDER_DEFINITIONS).sort()).toEqual([...providers].sort())
        for (const provider of providers) {
            expect(() => assertValidMediaProviderDefinition(CURRENT_MEDIA_PROVIDER_DEFINITIONS[provider])).not.toThrow()
            expect(CURRENT_MEDIA_PROVIDER_DEFINITIONS[provider].moderation.automaticRetry).toBe('never')
        }
    })

    it('uses OpenAI low moderation for image requests', () => {
        expect(CURRENT_MEDIA_PROVIDER_DEFINITIONS.OpenAI.moderation.settings(
            'gpt-image-1',
            'image-conditioned',
        )).toEqual({ moderation: 'low' })
    })

    it('compiles only provider-safe reference projections', () => {
        const intent: ProviderSafeMediaIntent = {
            intentVersion: 'media-provider-safe-intent-v1',
            originalSegments: [],
            safePrompt: 'Animate REFERENCE_1',
            bindings: [{
                assetId: 'asset-1',
                assetRevision: 3,
                mediaKind: 'image',
                alias: 'REFERENCE_1',
                displayNameSnapshot: 'Private display name',
                forbiddenNameVariants: ['private display name'],
                semanticDescriptor: 'watercolor traveler',
                depictionMedium: 'painting',
                subjectIdentity: {
                    classification: 'fictional',
                    source: 'user-attestation',
                    currentAttestationId: 'attestation-1',
                    providerVerifications: [],
                },
            }],
            forbiddenNameVariants: ['private display name'],
            promptFingerprint: 'a'.repeat(64),
        }

        const compiled = CURRENT_MEDIA_PROVIDER_DEFINITIONS.OpenAI.referenceRules.compile(intent)

        expect(compiled).toEqual({
            prompt: 'Animate REFERENCE_1',
            references: [{
                alias: 'REFERENCE_1',
                mediaKind: 'image',
                semanticDescriptor: 'watercolor traveler',
                depictionMedium: 'painting',
                subjectIdentityClassification: 'fictional',
            }],
        })
        expect(JSON.stringify(compiled)).not.toContain('Private display name')
        expect(JSON.stringify(compiled)).not.toContain('asset-1')
    })

    it('rejects an OpenAI profile that does not enforce low moderation', () => {
        expect(() => assertValidMediaProviderDefinition({
            ...CURRENT_MEDIA_PROVIDER_DEFINITIONS.OpenAI,
            moderation: {
                ...CURRENT_MEDIA_PROVIDER_DEFINITIONS.OpenAI.moderation,
                settings: () => ({ moderation: 'auto' }),
            },
        })).toThrow('OPENAI_LOW_MODERATION_PROFILE_REQUIRED')
    })

    it.each([
        ['standard text', 'text', 'standard', 'allow_all'],
        ['standard extension', 'video-extension', 'standard', 'allow_all'],
        ['standard image conditioning', 'image-conditioned', 'standard', 'allow_adult'],
        ['restricted text', 'text', 'restricted', 'allow_adult'],
        ['restricted image conditioning', 'image-conditioned', 'restricted', 'allow_adult'],
    ] as const)('uses Google least-restrictive settings for %s', (_case, inputMode, regionProfile, expected) => {
        expect(CURRENT_MEDIA_PROVIDER_DEFINITIONS.Google.moderation.settings(
            'veo-3.1-generate-preview',
            inputMode,
            { regionProfile },
        )).toEqual({ personGeneration: expected })
    })

    it('fails closed when Google region/account policy is not configured', () => {
        expect(() => CURRENT_MEDIA_PROVIDER_DEFINITIONS.Google.moderation.settings(
            'veo-3.1-generate-preview',
            'text',
        )).toThrow('GOOGLE_VEO_PERSON_GENERATION_PROFILE_REQUIRED')
    })

    it('sanitizes provider details and preserves the exact failure stage', () => {
        const problem = normalizeProviderProblem({
            provider: 'BytePlus',
            error: {
                code: 'SAFETY_FILTERED',
                message: 'moderation rejected https://provider.example/result?token=secret authorization=secret',
            },
            context: {
                generationRequestId: 'request-1',
                generationRun: 2,
                modelId: 'BytePlus:seedance-1-0-pro',
                stage: 'poll',
            },
        })

        expect(problem).toMatchObject({
            category: 'provider-moderation',
            stage: 'poll',
            provider: 'BytePlus',
            providerCode: 'SAFETY_FILTERED',
            generationRun: 2,
            action: 'edit-request',
        })
        expect(problem.providerReason).not.toContain('provider.example')
        expect(problem.providerReason).not.toContain('authorization=secret')
        expect(problem.supportCode).toMatch(/^[0-9a-f-]{36}$/u)
    })

    it('preserves provider moderation stage and categories so output filtering is not reported as input rejection', () => {
        const problem = normalizeProviderProblem({
            provider: 'OpenAI',
            error: {
                code: 'moderation_blocked',
                message: 'request rejected safety_violations=[violence]',
                moderation_details: {
                    moderation_stage: 'output',
                    categories: ['violence'],
                },
            },
            context: {
                generationRequestId: 'request-1',
                generationRun: 0,
                modelId: 'OpenAI:gpt-image-2',
                stage: 'submit',
            },
        })

        expect(problem).toMatchObject({
            category: 'provider-moderation',
            moderationStage: 'output',
            moderationCategories: ['violence'],
        })
        expect(problem.detail).toContain('generated result')
        expect(problem.detail).toContain('output safety check')
    })

    it('extracts legacy safety categories before the provider reason is truncated', () => {
        const problem = normalizeProviderProblem({
            provider: 'OpenAI',
            error: new Error([
                'CHARACTER_SHEET_IDENTITY_ANCHOR_UNAVAILABLE:',
                'Your request was rejected by the safety system. ',
                'Include request ID req_1234567890. ',
                'Additional provider diagnostic text that pushes the category beyond the display limit. '.repeat(3),
                'safety_violations=[violence]',
            ].join('')),
            context: {
                generationRequestId: 'request-1',
                modelId: 'OpenAI:gpt-image-2',
                stage: 'submit',
            },
        })

        expect(problem.moderationCategories).toEqual(['violence'])
        expect(problem.providerReason?.length).toBeLessThanOrEqual(240)
    })

    it('redacts JSON-shaped credential fields from allowlisted provider messages', () => {
        const problem = normalizeProviderProblem({
            provider: 'Stability',
            error: new Error('request failed {"token":"secret-value","cookie":"session-value"}'),
            context: { generationRequestId: 'request-1', stage: 'submit' },
        })

        expect(problem.providerReason).not.toContain('secret-value')
        expect(problem.providerReason).not.toContain('session-value')
    })

    it('recovers poll/download/persist stages from asynchronous provider failures', () => {
        const normalize = (message: string) => normalizeProviderProblem({
            provider: 'Google',
            error: new Error(message),
            context: { generationRequestId: 'request-1', stage: 'submit' },
        }).stage

        expect(normalize('VEO operation completed with raiMediaFilteredCount=1')).toBe('poll')
        expect(normalize('failed to download provider video output')).toBe('download')
        expect(normalize('object store persist failed')).toBe('persist')
    })
})
