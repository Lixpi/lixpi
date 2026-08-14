'use strict'

import { createHash } from 'node:crypto'

import type NatsService from '@lixpi/nats-service'

import { parseDataUrl, resolveImageUrls } from './utils/attachments.ts'

export type ImageGenerationReferenceRole =
    | 'capability-reference'
    | 'edit-target'
    | 'edit-target-identity'
    | 'source-reference'
    | 'original-source'
    | 'face-crop'
    | 'body-outfit-crop'
    | 'canonical-anchor'
    | 'adjacent-angle'
    | 'opposite-angle'
    | 'prop-crop'
    | 'pose-reference'
    | 'structure-reference'

export type ImageGenerationReference = {
    url: string
    role: ImageGenerationReferenceRole
    fileName: string
}

export type ResolvedImageGenerationReference = ImageGenerationReference & {
    bytes: Buffer
    dataUrl: string
    mediaType: string
    byteLength: number
    sha256: string
}

type BuildImageGenerationReferencesInput = {
    sourceReferenceImages: readonly string[]
    capabilityReferenceImages: readonly string[]
    capabilityUsageMode?: 'visual-style' | 'character-creator'
}

const MIME_EXTENSION: Readonly<Record<string, string>> = {
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}

const sanitizeFileName = (fileName: string, mediaType: string): string => {
    const safeStem = fileName
        .replace(/\.[a-zA-Z0-9]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'reference'
    const extension = MIME_EXTENSION[mediaType] ?? mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
    return `${safeStem}.${extension}`
}

export const buildImageGenerationReferences = ({
    sourceReferenceImages,
    capabilityReferenceImages,
    capabilityUsageMode: _capabilityUsageMode,
}: BuildImageGenerationReferencesInput): ImageGenerationReference[] => {
    return [
        ...capabilityReferenceImages.map((url, index) => ({
            url,
            role: 'capability-reference' as const,
            fileName: `capability-reference-${index + 1}`,
        })),
        ...sourceReferenceImages.map((url, index) => ({
            url,
            role: 'source-reference' as const,
            fileName: `source-reference-${index + 1}`,
        })),
    ]
}

export const resolveImageGenerationReferences = async (
    references: readonly ImageGenerationReference[],
    natsClient?: NatsService,
): Promise<ResolvedImageGenerationReference[]> => {
    if (references.length === 0) return []

    const unresolvedBlocks = references.map((reference, index) => ({
        type: 'input_image',
        image_url: reference.url,
        image_generation_reference_index: index,
    }))
    const resolvedContent = await resolveImageUrls(unresolvedBlocks, natsClient)
    if (!Array.isArray(resolvedContent)) {
        throw new Error('Image generation references did not resolve to image content')
    }

    const resolvedByIndex = new Map<number, Record<string, any>>()
    for (const block of resolvedContent) {
        const index = block.image_generation_reference_index
        if (typeof index === 'number') resolvedByIndex.set(index, block)
    }

    return references.map((reference, index) => {
        const resolvedBlock = resolvedByIndex.get(index)
        const dataUrl = resolvedBlock?.image_url
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            throw new Error(
                `Image generation reference ${reference.fileName} (${reference.role}) ` +
                'could not be resolved to inline image bytes',
            )
        }

        const { mediaType, base64 } = parseDataUrl(dataUrl)
        const bytes = Buffer.from(base64, 'base64')
        if (bytes.byteLength === 0) {
            throw new Error(`Image generation reference ${reference.fileName} (${reference.role}) is empty`)
        }

        return {
            ...reference,
            fileName: sanitizeFileName(reference.fileName, mediaType),
            bytes,
            dataUrl,
            mediaType,
            byteLength: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        }
    })
}
