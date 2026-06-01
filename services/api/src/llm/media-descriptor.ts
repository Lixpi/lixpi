'use strict'

import type NatsService from '@lixpi/nats-service'
import { MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH, type ProviderName } from '@lixpi/constants'

import { callStructuredVlm, type VlmCallArgs, type VlmCallResult, type VlmJsonSchema } from './extraction/vlm-client.ts'
import type { ChatMessage } from './graph/state.ts'

// Compact, model-friendly description of a single media still. Uploaded media
// has no generation metadata, so a cheap structured-VLM pass produces a summary
// and a few entity/style tags that let later features (the branch resolver, the
// canvas info panel) distinguish media objects without re-analyzing the pixels.
// For video the caller passes a representative still (mid-frame or poster), never
// the MP4 — so this is a single-image call regardless of media kind.
export type MediaDescriptorResult = {
    summary: string
    entityTags: string[]
    styleTags: string[]
}

type DescribeMediaStillArgs = {
    provider: ProviderName
    modelVersion: string
    imageUrl: string
    natsService: NatsService
    maxTokens?: number
    abortSignal?: AbortSignal
    callVlm?: (args: VlmCallArgs) => Promise<VlmCallResult<MediaDescriptorResult>>
}

const SYSTEM_PROMPT = [
    'You describe a single media still for a visual canvas. Produce a compact, neutral description that lets a person or model tell this media apart from others at a glance.',
    'Return: a one-to-two sentence summary naming the dominant subject(s) and overall look; a few entity tags (concrete subjects/objects); a few style tags (medium, palette, mood, lighting).',
    'Be specific and factual about what is visible. Do not speculate about intent, do not add commentary, and never invent text or watermarks that are not present.',
    `Keep the summary under ${MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH} characters.`,
].join(' ')

export const buildMediaDescriptorSchema = (): VlmJsonSchema => ({
    name: 'describe_media',
    description: 'Describe a single media still with a short summary and a few entity/style tags.',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            summary: {
                type: 'string',
                description: `One to two sentences naming the dominant subjects and overall look. Under ${MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH} characters.`,
            },
            entityTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'A few concrete subjects/objects visible in the media (e.g. "person", "city street", "red car").',
            },
            styleTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'A few style descriptors (medium, palette, mood, lighting — e.g. "cinematic", "warm", "night").',
            },
        },
        required: ['summary', 'entityTags', 'styleTags'],
    },
})

const buildDescriptorMessages = (imageUrl: string): ChatMessage[] => [
    {
        role: 'user',
        content: [
            { type: 'input_text', text: 'Describe this media still.' },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ],
    },
]

const sanitizeTags = (tags: unknown): string[] => {
    if (!Array.isArray(tags)) return []
    return Array.from(new Set(
        tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim())
            .filter(Boolean)
    ))
}

// Caption a single still (image file, or a video's representative frame/poster).
// `imageUrl` is a `nats-obj://workspace-{ws}-files/{fileId}` URI that the VLM
// client resolves to inline image bytes.
export const describeMediaStill = async (args: DescribeMediaStillArgs): Promise<MediaDescriptorResult> => {
    const callVlm = args.callVlm ?? ((vlmArgs: VlmCallArgs) => callStructuredVlm<MediaDescriptorResult>(vlmArgs))

    const result = await callVlm({
        provider: args.provider,
        modelVersion: args.modelVersion,
        systemPrompt: SYSTEM_PROMPT,
        userMessages: buildDescriptorMessages(args.imageUrl),
        schema: buildMediaDescriptorSchema(),
        natsService: args.natsService,
        temperature: 0.2,
        maxTokens: Math.min(args.maxTokens ?? 1024, 1024),
        abortSignal: args.abortSignal,
    })

    const parsed = result.parsed ?? ({} as MediaDescriptorResult)
    return {
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH) : '',
        entityTags: sanitizeTags(parsed.entityTags),
        styleTags: sanitizeTags(parsed.styleTags),
    }
}
