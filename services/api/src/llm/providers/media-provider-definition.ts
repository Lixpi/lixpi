'use strict'

import { v4 as uuid } from 'uuid'

import type {
    AiModelId,
    MediaGenerationProblem,
    ProviderName,
    ProviderSafeMediaIntent,
} from '@lixpi/constants'

import type { ProviderConstructor } from './provider-registry.ts'
import {
    assertNoForbiddenMediaReferenceLeak,
    buildProviderSafeReferenceContext,
} from '../media-reference/provider-safe-context.ts'

export type MediaProviderCompiledReference = {
    alias: string
    mediaKind: string
    semanticDescriptor: string
    depictionMedium: string
    subjectIdentityClassification: string
}

export type MediaProviderInputMode = 'text' | 'image-conditioned' | 'video-extension'
export type MediaProviderPolicyContext = {
    regionProfile?: 'standard' | 'restricted'
    providerAccountScope?: string
}

export type MediaProviderDefinition = {
    provider: ProviderName
    constructor: ProviderConstructor
    mediaCapabilities: Array<'image' | 'video'>
    referenceRules: {
        aliases: 'positional-reference'
        supportedInputs: Array<'text' | 'image' | 'video'>
        compile: (intent: ProviderSafeMediaIntent) => {
            prompt: string
            references: MediaProviderCompiledReference[]
        }
    }
    moderation: {
        policy: 'low' | 'input-mode-least-restrictive' | 'fixed-provider-policy'
        settings: (
            modelId: string,
            inputMode: MediaProviderInputMode,
            context?: MediaProviderPolicyContext,
        ) => Record<string, unknown>
        automaticRetry: 'never'
        costOnFilter: 'charged' | 'not-documented' | 'provider-dependent'
    }
    normalizeProblem: (error: unknown, context: {
        generationRequestId: string
        generationRun?: number
        modelId?: AiModelId
        stage: MediaGenerationProblem['stage']
    }) => MediaGenerationProblem
    verification: {
        strategy: 'unsupported' | 'provider-hosted-session'
        derivativeReuse: 'not-allowed' | 'same-provider-account' | 'documented-lineage'
    }
    retentionNotes: string
    sensitiveDataNotes: string
    documentationUrls: string[]
    reviewedAt: string
    profileVersion: string
}

const sanitizeProviderText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const sanitized = value
        .replace(/https?:\/\/\S+/giu, '[provider-url-omitted]')
        .replace(/\bBearer\s+\S+/giu, 'Bearer [omitted]')
        .replace(/\b(api[_-]?key|authorization|cookie|secret|signature|token)=\S+/giu, '$1=[omitted]')
        .replace(/(["']?(?:api[_-]?key|authorization|cookie|secret|signature|token)["']?\s*:\s*)["'][^"']*["']/giu, '$1"[omitted]"')
        .replace(/[\r\n\t]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
    return sanitized ? sanitized.slice(0, 240) : undefined
}

export const normalizeProviderProblem = ({
    provider,
    error,
    context,
}: {
    provider: ProviderName
    error: unknown
    context: {
        generationRequestId: string
        generationRun?: number
        modelId?: AiModelId
        stage: MediaGenerationProblem['stage']
    }
}): MediaGenerationProblem => {
    const candidate = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown }
    const providerCode = sanitizeProviderText(candidate?.code ?? candidate?.status ?? candidate?.name)
    const providerReason = sanitizeProviderText(candidate?.message)
    const evidence = `${providerCode ?? ''} ${providerReason ?? ''}`
    const stage: MediaGenerationProblem['stage'] = context.stage !== 'submit'
        ? context.stage
        : /download|fetch.*(?:file|output|video|image)/iu.test(evidence)
            ? 'download'
            : /persist|storage|rendition|object store/iu.test(evidence)
                ? 'persist'
                : /poll|operation|retrieve.*task|task.*(?:failed|cancelled|expired)|raiMediaFilteredCount/iu.test(evidence)
                    ? 'poll'
                    : context.stage
    const moderation = /moderation|filter|policy|rai|safety/iu.test(evidence)
    const configuration = /configuration|invalid.*(?:parameter|setting)|not configured|required|unsupported/iu.test(evidence)
    const capacity = /\b429\b|capacity|quota|rate.?limit|resource.?exhausted/iu.test(evidence)
    const output = stage === 'download' || stage === 'persist'
        || /output.*(?:blocked|missing|invalid)|download|persist/iu.test(evidence)
    const category: MediaGenerationProblem['category'] = moderation
        ? 'provider-moderation'
        : configuration
            ? 'provider-configuration'
            : capacity
                ? 'provider-capacity'
                : output ? 'provider-output' : 'provider-transport'
    return {
        problemVersion: '1',
        type: `urn:lixpi:media-problem:${category}`,
        title: moderation
            ? 'Provider moderation rejected this generation'
            : configuration ? 'Provider configuration rejected this generation'
                : capacity ? 'Provider capacity prevented this generation'
                    : output ? 'Provider output could not be used' : 'Provider generation failed',
        detail: moderation
            ? 'The provider rejected this attempt. Edit the request before submitting another attempt.'
            : 'The provider could not complete this attempt. Edit the request before submitting again.',
        category,
        stage,
        generationRequestId: context.generationRequestId,
        ...(context.generationRun !== undefined ? { generationRun: context.generationRun } : {}),
        provider,
        ...(context.modelId ? { modelId: context.modelId } : {}),
        ...(providerCode ? { providerCode } : {}),
        ...(providerReason ? { providerReason } : {}),
        supportCode: uuid(),
        action: 'edit-request',
    }
}

export const compileProviderSafeIntent = (intent: ProviderSafeMediaIntent): {
    prompt: string
    references: MediaProviderCompiledReference[]
} => {
    const payload = {
        prompt: intent.safePrompt,
        references: buildProviderSafeReferenceContext(intent.bindings) as MediaProviderCompiledReference[],
    }
    assertNoForbiddenMediaReferenceLeak({ payload, forbiddenNameVariants: intent.forbiddenNameVariants })
    return payload
}

export const assertValidMediaProviderDefinition = (definition: MediaProviderDefinition): void => {
    if (!definition.provider || typeof definition.constructor !== 'function') throw new Error('MEDIA_PROVIDER_CONSTRUCTOR_REQUIRED')
    if (definition.mediaCapabilities.length === 0 && definition.provider !== 'Anthropic') {
        throw new Error(`MEDIA_PROVIDER_CAPABILITY_REQUIRED:${definition.provider}`)
    }
    if (definition.referenceRules.aliases !== 'positional-reference'
        || definition.referenceRules.supportedInputs.length === 0
        || typeof definition.referenceRules.compile !== 'function') {
        throw new Error(`MEDIA_PROVIDER_REFERENCE_RULES_REQUIRED:${definition.provider}`)
    }
    if (!['low', 'input-mode-least-restrictive', 'fixed-provider-policy'].includes(definition.moderation.policy)
        || definition.moderation.automaticRetry !== 'never'
        || !['charged', 'not-documented', 'provider-dependent'].includes(definition.moderation.costOnFilter)
        || typeof definition.moderation.settings !== 'function') {
        throw new Error(`MEDIA_PROVIDER_MODERATION_PROFILE_REQUIRED:${definition.provider}`)
    }
    if (typeof definition.normalizeProblem !== 'function') {
        throw new Error(`MEDIA_PROVIDER_PROBLEM_MAPPER_REQUIRED:${definition.provider}`)
    }
    if (!['unsupported', 'provider-hosted-session'].includes(definition.verification.strategy)) {
        throw new Error(`MEDIA_PROVIDER_VERIFICATION_STRATEGY_REQUIRED:${definition.provider}`)
    }
    if (!definition.retentionNotes || !definition.sensitiveDataNotes || definition.documentationUrls.length === 0
        || definition.documentationUrls.some(url => !url.startsWith('https://'))
        || !/^\d{4}-\d{2}-\d{2}$/u.test(definition.reviewedAt) || !definition.profileVersion) {
        throw new Error(`MEDIA_PROVIDER_POLICY_METADATA_REQUIRED:${definition.provider}`)
    }
    if (definition.provider === 'OpenAI') {
        const settings = definition.moderation.settings('gpt-image-1', 'image-conditioned')
        if (settings.moderation !== 'low') throw new Error('OPENAI_LOW_MODERATION_PROFILE_REQUIRED')
    }
    if (definition.provider === 'Google') {
        const textSettings = definition.moderation.settings('veo-provider-profile-audit', 'text', { regionProfile: 'standard' })
        const imageSettings = definition.moderation.settings('veo-provider-profile-audit', 'image-conditioned', { regionProfile: 'standard' })
        if (textSettings.personGeneration !== 'allow_all' || imageSettings.personGeneration !== 'allow_adult') {
            throw new Error('GOOGLE_VEO_PERSON_GENERATION_PROFILE_INVALID')
        }
    }
    if (definition.provider === 'BytePlus'
        && (definition.verification.strategy !== 'provider-hosted-session'
            || definition.verification.derivativeReuse !== 'documented-lineage')) {
        throw new Error('BYTEPLUS_VERIFICATION_PROFILE_REQUIRED')
    }
    if ((definition.provider as string) === 'Runway') {
        const settings = definition.moderation.settings('runway-provider-profile-audit', 'text')
        const contentModeration = settings.contentModeration as Record<string, unknown> | undefined
        if (contentModeration?.publicFigureThreshold !== 'low') {
            throw new Error('RUNWAY_LOW_PUBLIC_FIGURE_THRESHOLD_REQUIRED')
        }
    }
}
