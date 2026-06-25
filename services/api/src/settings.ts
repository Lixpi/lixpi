'use strict'

import type { AiModelId } from '@lixpi/constants'

export type ApiSettings = {
    // API-owned media descriptor settings for image and video summaries shown on the canvas.
    mediaDescriptor: {
        // Vision model used by the MEDIA_DESCRIBE endpoint for image files and video still frames.
        // Frontend model selection is intentionally ignored here so summaries are stable,
        // cheap, and always produced by a model that is approved for visual analysis.
        defaultVlmModelId: AiModelId
    }
}

export const settings: ApiSettings = {
    mediaDescriptor: {
        // Claude Haiku is the default VLM for reusable media descriptions.
        // Keep this id present in the synchronized AI model catalog and out of exclusion lists.
        // Change this only to another available, vision-capable, low-latency model.
        defaultVlmModelId: 'Anthropic:claude-haiku-4-5',
    },
}
