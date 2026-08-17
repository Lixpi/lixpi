'use strict'

import type { ProviderName } from '@lixpi/constants'

import { AnthropicProvider } from './anthropic-provider.ts'
import { BytePlusProvider } from './byteplus-provider.ts'
import { GoogleProvider } from './google-provider.ts'
import { OpenAIProvider } from './openai-provider.ts'
import { StabilityProvider } from './stability-provider.ts'
import {
    compileProviderSafeIntent,
    normalizeProviderProblem,
    type MediaProviderDefinition,
} from './media-provider-definition.ts'
import {
    GOOGLE_IMAGE_REFERENCE_ADAPTER,
    OPENAI_IMAGE_REFERENCE_ADAPTER,
    STABILITY_IMAGE_REFERENCE_ADAPTER,
} from './image-reference-adapters.ts'

const createDefinition = ({
    provider,
    constructor,
    mediaCapabilities,
    imageReferenceAdapter,
    moderation,
    verification,
    documentationUrls,
    retentionNotes,
    sensitiveDataNotes,
}: Pick<MediaProviderDefinition,
    'provider' | 'constructor' | 'mediaCapabilities' | 'imageReferenceAdapter' | 'moderation' | 'verification' | 'documentationUrls' | 'retentionNotes' | 'sensitiveDataNotes'
>): MediaProviderDefinition => ({
    provider,
    constructor,
    mediaCapabilities,
    imageReferenceAdapter,
    referenceRules: {
        aliases: 'positional-reference',
        supportedInputs: ['text', 'image', 'video'],
        compile: compileProviderSafeIntent,
    },
    moderation,
    normalizeProblem: (error, context) => normalizeProviderProblem({ provider, error, context }),
    verification,
    retentionNotes,
    sensitiveDataNotes,
    documentationUrls,
    reviewedAt: '2026-07-28',
    profileVersion: `${provider.toLocaleLowerCase()}-media-policy-v1`,
})

export const CURRENT_MEDIA_PROVIDER_DEFINITIONS: Record<ProviderName, MediaProviderDefinition> = {
    OpenAI: createDefinition({
        provider: 'OpenAI',
        constructor: OpenAIProvider,
        mediaCapabilities: ['image'],
        imageReferenceAdapter: OPENAI_IMAGE_REFERENCE_ADAPTER,
        moderation: {
            policy: 'low',
            settings: () => ({ moderation: 'low' }),
            automaticRetry: 'never',
            costOnFilter: 'provider-dependent',
        },
        verification: { strategy: 'unsupported', derivativeReuse: 'not-allowed' },
        retentionNotes: 'OpenAI endpoint retention is governed by the configured API account and service terms.',
        sensitiveDataNotes: 'Reference bytes are sent only for the selected generation request.',
        documentationUrls: ['https://platform.openai.com/docs/guides/image-generation'],
    }),
    Anthropic: createDefinition({
        provider: 'Anthropic',
        constructor: AnthropicProvider,
        mediaCapabilities: [],
        imageReferenceAdapter: null,
        moderation: {
            policy: 'fixed-provider-policy',
            settings: () => ({}),
            automaticRetry: 'never',
            costOnFilter: 'not-documented',
        },
        verification: { strategy: 'unsupported', derivativeReuse: 'not-allowed' },
        retentionNotes: 'Reasoning-only provider; it does not receive media generation calls.',
        sensitiveDataNotes: 'Only provider-safe reference context may be used for reasoning.',
        documentationUrls: ['https://docs.anthropic.com/en/docs/about-claude/models'],
    }),
    Google: createDefinition({
        provider: 'Google',
        constructor: GoogleProvider,
        mediaCapabilities: ['image', 'video'],
        imageReferenceAdapter: GOOGLE_IMAGE_REFERENCE_ADAPTER,
        moderation: {
            policy: 'input-mode-least-restrictive',
            settings: (modelId, inputMode, context) => {
                if (!/veo/iu.test(modelId)) return {}
                if (!context?.regionProfile) throw new Error('GOOGLE_VEO_PERSON_GENERATION_PROFILE_REQUIRED')
                return {
                    personGeneration: context.regionProfile === 'restricted'
                        ? 'allow_adult'
                        : inputMode === 'image-conditioned' ? 'allow_adult' : 'allow_all',
                }
            },
            automaticRetry: 'never',
            costOnFilter: 'provider-dependent',
        },
        verification: { strategy: 'unsupported', derivativeReuse: 'not-allowed' },
        retentionNotes: 'Gemini Developer API or Vertex project retention applies by configured account mode.',
        sensitiveDataNotes: 'Veo receives only selected frames/reference bytes and safe prompt aliases.',
        documentationUrls: ['https://ai.google.dev/gemini-api/docs/veo'],
    }),
    Stability: createDefinition({
        provider: 'Stability',
        constructor: StabilityProvider,
        mediaCapabilities: ['image'],
        imageReferenceAdapter: STABILITY_IMAGE_REFERENCE_ADAPTER,
        moderation: {
            policy: 'fixed-provider-policy',
            settings: () => ({}),
            automaticRetry: 'never',
            costOnFilter: 'provider-dependent',
        },
        verification: { strategy: 'unsupported', derivativeReuse: 'not-allowed' },
        retentionNotes: 'Stability API retention is governed by the configured account terms.',
        sensitiveDataNotes: 'Only selected reference images and safe prompt text are submitted.',
        documentationUrls: ['https://platform.stability.ai/docs/api-reference'],
    }),
    BytePlus: createDefinition({
        provider: 'BytePlus',
        constructor: BytePlusProvider,
        mediaCapabilities: ['video'],
        imageReferenceAdapter: null,
        moderation: {
            policy: 'fixed-provider-policy',
            settings: () => ({}),
            automaticRetry: 'never',
            costOnFilter: 'provider-dependent',
        },
        verification: { strategy: 'provider-hosted-session', derivativeReuse: 'documented-lineage' },
        retentionNotes: 'Seedance task output URLs are downloaded before provider expiry.',
        sensitiveDataNotes: 'Real-person verification media is sent directly to BytePlus and never stored by Lixpi.',
        documentationUrls: [
            'https://docs.byteplus.com/en/docs/modelark/2333589',
            'https://docs.byteplus.com/en/docs/ModelArk/BytePlus_Real_Person_Verification_H5_and_API_Usage_Rules?lang=en',
        ],
    }),
}
