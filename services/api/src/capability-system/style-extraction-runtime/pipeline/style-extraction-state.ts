'use strict'

import type {
    StyleExtractionInput,
    StyleExtractionState,
    ReferenceImage,
} from './types.ts'

export function extractStyleReferenceImagesFromMessages(
    messages: StyleExtractionInput['messages'],
    sourceAssetIds: string[] = [],
): ReferenceImage[] {
    const references: ReferenceImage[] = []
    let index = 0
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue
        for (const block of message.content) {
            if (!block || typeof block !== 'object' || block.type !== 'input_image') continue
            const url = block.image_url
            if (typeof url !== 'string' || !url) continue
            const assetId = sourceAssetIds[index]
            references.push({
                imageRef: `input-${index}`,
                url,
                ...(assetId ? { assetId } : {}),
            })
            index += 1
        }
    }
    return references
}

export function mergeStyleExtractionState(state: StyleExtractionState, update: Partial<StyleExtractionState>): void {
    for (const [key, value] of Object.entries(update)) {
        if (value !== undefined) (state as any)[key] = value
    }
}
