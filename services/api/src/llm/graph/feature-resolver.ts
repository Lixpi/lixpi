'use strict'

import { info, err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import type { ProviderState, ChatMessage } from './state.ts'
import Feature from '../../models/feature.ts'

const CACHE_TTL_MS = 60_000
const MAX_REFERENCE_SAMPLES_PER_FEATURE = 3

type FeatureSampleReference = {
    idx: number
    subject: string
    imageUrl: string
    traceImageUrl: string
    kind: 'sample'
}

type CacheEntry = { messages: ChatMessage[]; referenceImages: string[]; traceImageUrls: string[]; usagePrompt: string; cachedAt: number }
const resolverCache = new Map<string, CacheEntry>()

const pruneCache = () => {
    const now = Date.now()
    for (const [key, entry] of resolverCache.entries()) {
        if (now - entry.cachedAt > CACHE_TTL_MS) resolverCache.delete(key)
    }
}

const getSampleMimeType = (ext: string | undefined): string => {
    const normalizedExt = (ext ?? '').toLowerCase().replace(/^\./, '')
    if (normalizedExt === 'jpg' || normalizedExt === 'jpeg') return 'image/jpeg'
    if (normalizedExt === 'webp') return 'image/webp'
    return 'image/png'
}

const buildFeatureDefinitionMessage = (featureId: string, name: string, category: string, scope: string, summary: string, instructions: string, parameters: Record<string, any>, references: FeatureSampleReference[]): ChatMessage => {
    const referencesXml = references.map((s) => `  <reference kind="${s.kind}" idx="${s.idx}" subject="${s.subject}" imageReference="attached-feature-${s.kind}-${s.idx}" />`).join('\n')
    const content =
        `<feature id="${featureId}" name="${name}" category="${category}" scope="${scope}">\n` +
        `  <summary>${summary}</summary>\n  <instructions>\n${instructions}\n  </instructions>\n` +
        `  <parameters>${JSON.stringify(parameters)}</parameters>\n` +
        (references.length > 0 ? `  <visualReferences>\n${referencesXml}\n  </visualReferences>\n` : '') +
        `  <usage>When this feature is used for image generation, transfer the reusable visual property to the requested new subject. The attached images are derived feature samples generated during extraction; the original source image is intentionally not attached. Do not copy sample subjects, composition, pose, or layout unless the user explicitly asks.</usage>\n` +
        `</feature>`
    return { role: 'user', content: `Feature definition for @${name}. Use this as reusable context for the next request.\n${content}` }
}

const buildFeatureReferenceMessage = (name: string, category: string, references: FeatureSampleReference[]): ChatMessage | undefined => {
    if (references.length === 0) return undefined
    return {
        role: 'user',
        content: [
            {
                type: 'input_text',
                text: `Feature visual references for @${name} (${category}). These are derived sample images created during feature extraction; the original source image is not attached. Use these samples as references for texture, palette, surface behavior, edge treatment, grain, linework, brushwork, mark-making, and transfer strength. Apply those qualities to the next requested subject so the subject is itself constructed FROM this medium; do not reproduce any sample subject or layout.`,
            },
            ...references.map((sample) => ({
                type: 'input_image',
                image_url: sample.imageUrl,
                detail: 'high',
            })),
        ],
    }
}

const truncateFeatureText = (text: string, maxLength: number): string =>
    text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text

const buildFeatureUsagePrompt = (feature: any, references: FeatureSampleReference[]): string => {
    const sampleCount = references.length
    const parameters = JSON.stringify(feature.parameters ?? {})
    const styleFingerprint = feature.parameters?.styleFingerprint ? JSON.stringify(feature.parameters.styleFingerprint) : ''
    const transferSignature = feature.parameters?.transferSignature ? JSON.stringify(feature.parameters.transferSignature) : ''
    const contentSeparation = feature.parameters?.contentSeparation ? JSON.stringify(feature.parameters.contentSeparation) : ''
    const contrastiveProbes = feature.parameters?.contrastiveProbes ? JSON.stringify(feature.parameters.contrastiveProbes) : ''
    return [
        `FEATURE @${feature.name} (${feature.category}) MUST BE VISIBLY USED.`,
        `Summary: ${feature.summary}`,
        `Transfer target: render the new requested subject CONSTRUCTED FROM the extracted medium itself \u2014 the brush strokes, washes, grain, paper tooth, deckle behavior, palette, edge treatment, and mark-making must appear on the new subject's body, not as a decorative frame around a clean digital subject.`,
        `Visual evidence attached: ${sampleCount} feature sample image(s). The samples show (1) the texture/style specimen and (2) a neutral subject rendered IN this medium. Match the level of mark-making visibility on the subject's surface that those samples demonstrate.`,
        styleFingerprint ? `Style fingerprint: ${truncateFeatureText(styleFingerprint, 1200)}` : undefined,
        transferSignature ? `Transfer signature: ${truncateFeatureText(transferSignature, 1200)}` : undefined,
        contentSeparation ? `Content separation: ${truncateFeatureText(contentSeparation, 900)}` : undefined,
        contrastiveProbes ? `Contrastive probes: ${truncateFeatureText(contrastiveProbes, 900)}` : undefined,
        `Instructions: ${truncateFeatureText(feature.instructions ?? '', 2200)}`,
        `Parameters: ${truncateFeatureText(parameters, 1400)}`,
        'Do not dilute this into a generic style phrase. The concrete fingerprint and samples outrank any generic wording in the user prompt.',
        'Failure mode to forbid: a clean smooth digital subject placed on top of a textured paper background. That is rejected. The subject itself must be painted/drawn USING this medium, with mark-making visible on its body.',
    ].filter(Boolean).join('\n')
}

export const resolveFeatures = async (state: ProviderState): Promise<Partial<ProviderState>> => {
    const ids = state.referencedFeatureIds
    if (!ids || ids.length === 0) return {}
    pruneCache()

    const natsService = NATS_Service.getInstance()
    const featureMessages: ChatMessage[] = []
    const featureReferenceImages: string[] = []
    const featureReferenceImageTraceUrls: string[] = []
    const featureUsagePrompts: string[] = []

    for (const featureId of ids) {
        const cacheKey = `${featureId}:1`
        const cached = resolverCache.get(cacheKey)
        if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
            featureMessages.push(...cached.messages)
            featureReferenceImages.push(...cached.referenceImages)
            featureReferenceImageTraceUrls.push(...cached.traceImageUrls)
            featureUsagePrompts.push(cached.usagePrompt)
            continue
        }

        try {
            const featureOrError = await Feature.getFeature({ featureId, requesterContext: { userId: state.eventMeta.userId ?? '', workspaceId: state.eventMeta.workspaceId ?? state.workspaceId, organizationId: state.eventMeta.organizationId as string | undefined } })
            if ('error' in featureOrError) { info(`Feature ${featureId} not accessible: ${featureOrError.error}`); continue }

            const feature = featureOrError
            const samples: FeatureSampleReference[] = []

            if (natsService) {
                const bucketName = `workspace-${feature.workspaceId}-files`
                for (const sampleRef of feature.sampleImages.slice(0, MAX_REFERENCE_SAMPLES_PER_FEATURE)) {
                    const objectKey = sampleRef.fileId ?? `features/${featureId}/sample-${sampleRef.idx}.${sampleRef.ext}`
                    try {
                        const data = await natsService.getObject(bucketName, objectKey)
                        if (data) {
                            const mimeType = getSampleMimeType(sampleRef.ext)
                            samples.push({
                                idx: sampleRef.idx,
                                subject: sampleRef.subject,
                                imageUrl: `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`,
                                traceImageUrl: `/api/features/${encodeURIComponent(featureId)}/samples/${sampleRef.idx}?workspaceId=${encodeURIComponent(feature.workspaceId)}`,
                                kind: 'sample',
                            })
                        }
                    } catch {}
                }
            }

            const references = samples
            const definitionMessage = buildFeatureDefinitionMessage(featureId, feature.name, feature.category, feature.scope, feature.summary, feature.instructions, feature.parameters, references)
            const referenceMessage = buildFeatureReferenceMessage(feature.name, feature.category, references)
            const messages = referenceMessage ? [definitionMessage, referenceMessage] : [definitionMessage]
            const referenceImages = references.map((sample) => sample.imageUrl)
            const traceImageUrls = references.map((sample) => sample.traceImageUrl)
            const usagePrompt = buildFeatureUsagePrompt(feature, references)
            resolverCache.set(cacheKey, { messages, referenceImages, traceImageUrls, usagePrompt, cachedAt: Date.now() })
            featureMessages.push(...messages)
            featureReferenceImages.push(...referenceImages)
            featureReferenceImageTraceUrls.push(...traceImageUrls)
            featureUsagePrompts.push(usagePrompt)
        } catch (e) { err(`Failed to resolve feature ${featureId}:`, e) }
    }

    if (featureMessages.length === 0) return {}
    return {
        messages: [...featureMessages, ...state.messages],
        referenceImages: [...featureReferenceImages, ...(state.referenceImages ?? [])],
        featureReferenceImages,
        featureReferenceImageTraceUrls,
        featureUsagePrompt: featureUsagePrompts.join('\n\n'),
    }
}
