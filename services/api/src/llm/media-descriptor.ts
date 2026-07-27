'use strict'

import type NatsService from '@lixpi/nats-service'
import {
    MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH,
    MEDIA_DESCRIPTOR_TITLE_MAX_WORDS,
    type ProviderName,
} from '@lixpi/constants'

import { callStructuredVlm, type VlmCallArgs, type VlmCallResult, type VlmJsonSchema } from './structured-vlm/structured-vlm-client.ts'
import type { ChatMessage } from './graph/state.ts'

// Compact, model-friendly description of a single media still. Generated and
// uploaded media both use this structured-VLM pass so descriptions describe the
// actual pixels, never the generation prompt. For video the caller passes a
// representative still (mid-frame or poster), never the MP4 — so this is a
// single-image call regardless of media kind.
export type MediaDescriptorResult = {
    title: string
    summary: string
    entityTags: string[]
    styleTags: string[]
}

// Document and chat-thread nodes carry the same descriptor shape as media — the
// relevance engine ranks every node type on summary + tags. The only difference
// is how it's produced: a text summary (no pixels) instead of a VLM caption.
export type ContentDescriptorResult = MediaDescriptorResult

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
    'Return: a specific title of two or three words; a one-to-two sentence summary naming the dominant subject(s) and overall look; a few entity tags (concrete subjects/objects); a few style tags (medium, palette, mood, lighting).',
    'The title must describe the visible media, use title case, contain no punctuation, and never exceed three words.',
    'Be specific and factual about what is visible. Do not speculate about intent, do not add commentary, and never invent text or watermarks that are not present.',
    `Keep the summary under ${MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH} characters.`,
].join(' ')

export const buildMediaDescriptorSchema = (): VlmJsonSchema => ({
    name: 'describe_media',
    description: 'Title and describe a single media still with a short summary and a few entity/style tags.',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            title: {
                type: 'string',
                maxLength: 120,
                description: 'A specific two-to-three-word title in title case, with no punctuation.',
            },
            summary: {
                type: 'string',
                maxLength: MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH,
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
        required: ['title', 'summary', 'entityTags', 'styleTags'],
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

const normalizeDescriptorResult = (parsed: MediaDescriptorResult | undefined): MediaDescriptorResult => {
    const safe = parsed ?? ({} as MediaDescriptorResult)
    const title = typeof safe.title === 'string' ? safe.title.trim() : ''
    const summary = typeof safe.summary === 'string' ? safe.summary.trim() : ''
    if (title.split(/\s+/).filter(Boolean).length > MEDIA_DESCRIPTOR_TITLE_MAX_WORDS) {
        throw new Error('MEDIA_DESCRIPTOR_TITLE_TOO_LONG')
    }
    if (summary.length > MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH) {
        throw new Error('MEDIA_DESCRIPTOR_SUMMARY_TOO_LONG')
    }
    return {
        title,
        summary,
        entityTags: sanitizeTags(safe.entityTags),
        styleTags: sanitizeTags(safe.styleTags),
    }
}

// Caption a single still (image file, or a video's representative frame/poster).
// `imageUrl` is an organization Blob Object Store URI that the VLM client
// resolves to inline image bytes.
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

    return normalizeDescriptorResult(result.parsed)
}

// ─── Text nodes (documents / chat threads) ──────────────────────────────────────

// Compact description of a document or chat-thread node, summarized from its plain
// text — no pixels. Lets the relevance engine rank text nodes alongside media on
// the same summary + tags contract. The caller passes already-extracted plain text
// (the browser flattens the node's ProseMirror content) so this stays a single
// text-only structured call regardless of node type.
type DescribeTextContentArgs = {
    provider: ProviderName
    modelVersion: string
    text: string
    title?: string
    natsService: NatsService
    maxTokens?: number
    abortSignal?: AbortSignal
    callVlm?: (args: VlmCallArgs) => Promise<VlmCallResult<MediaDescriptorResult>>
}

const TEXT_SYSTEM_PROMPT = [
    'You summarize a text node (a document or an AI chat transcript) for a visual canvas. Produce a compact, neutral description that lets a person or model tell this node apart from others at a glance.',
    'Return: a specific title of two or three words; a one-to-two sentence summary of what the text is about; a few entity tags (key subjects, names, or topics mentioned); a few style tags (the kind/format/tone — e.g. "notes", "spec", "transcript", "outline", "formal").',
    'Be specific and factual about the content. Do not speculate about intent, do not add commentary, and never invent topics that are not present.',
    `Keep the summary under ${MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH} characters.`,
].join(' ')

export const buildTextDescriptorSchema = (): VlmJsonSchema => ({
    name: 'describe_text',
    description: 'Summarize a text node (document or chat transcript) with a short summary and a few entity/topic and style tags.',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            title: {
                type: 'string',
                maxLength: 120,
                description: 'A specific two-to-three-word title in title case, with no punctuation.',
            },
            summary: {
                type: 'string',
                maxLength: MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH,
                description: `One to two sentences describing what the text is about. Under ${MEDIA_DESCRIPTOR_SUMMARY_MAX_LENGTH} characters.`,
            },
            entityTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'A few key subjects, names, or topics mentioned in the text (e.g. "budget", "Q3 roadmap", "Acme Corp").',
            },
            styleTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'A few descriptors of the kind/format/tone (e.g. "notes", "spec", "transcript", "formal").',
            },
        },
        required: ['title', 'summary', 'entityTags', 'styleTags'],
    },
})

const buildTextDescriptorMessages = (text: string, title?: string): ChatMessage[] => {
    const header = title?.trim() ? `Title: ${title.trim()}\n\n` : ''
    return [
        {
            role: 'user',
            content: [
                { type: 'input_text', text: `Summarize this text node.\n\n${header}${text}` },
            ],
        },
    ]
}

// Summarize a document/thread node from its plain text. Returns empty fields when
// there is nothing to summarize (caller treats that as "skip", not "failed").
export const describeTextContent = async (args: DescribeTextContentArgs): Promise<MediaDescriptorResult> => {
    const text = args.text.trim()
    if (!text) return { title: '', summary: '', entityTags: [], styleTags: [] }

    const callVlm = args.callVlm ?? ((vlmArgs: VlmCallArgs) => callStructuredVlm<MediaDescriptorResult>(vlmArgs))

    const result = await callVlm({
        provider: args.provider,
        modelVersion: args.modelVersion,
        systemPrompt: TEXT_SYSTEM_PROMPT,
        userMessages: buildTextDescriptorMessages(text, args.title),
        schema: buildTextDescriptorSchema(),
        natsService: args.natsService,
        temperature: 0.2,
        maxTokens: Math.min(args.maxTokens ?? 1024, 1024),
        abortSignal: args.abortSignal,
    })

    return normalizeDescriptorResult(result.parsed)
}
