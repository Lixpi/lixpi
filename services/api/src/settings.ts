'use strict'

import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    workspacePersistenceSettings,
    type AiModelId,
    type AiModelInferenceCapabilities,
    type MediaGenerationLayoutSettings,
    type WorkspaceCollisionSettings,
    type WorkspacePersistenceSettings,
} from '@lixpi/constants'

export type ApiSettings = {
    aiModels: {
        defaultReasoningModelId: AiModelId
        defaultImageModelId: AiModelId
        defaultVideoModelId: AiModelId
    }
    // API-owned media descriptor settings for image and video summaries shown on the canvas.
    mediaDescriptor: {
        // Vision model used by the MEDIA_DESCRIBE endpoint for image files and video still frames.
        // Frontend model selection is intentionally ignored here so summaries are stable,
        // cheap, and always produced by a model that is approved for visual analysis.
        defaultVlmModelId: AiModelId
        // Max output tokens used when the local AI model catalog has not synced
        // the default VLM yet. This prevents stale local catalog data from
        // breaking media descriptions while still keeping the model choice here.
        defaultVlmMaxTokens: number
        // Inference contract used with the fixed descriptor model while the local
        // AI model catalog is unavailable or has not synchronized that model yet.
        defaultVlmInferenceCapabilities: AiModelInferenceCapabilities
    }
    // Canvas projection geometry used when persisting generated-media lineage.
    // Sourced from the shared mediaGenerationLayoutSettings in @lixpi/constants
    // so the API and the WebUI place nodes with identical dimensions and gaps.
    mediaGenerationCanvasProjection: MediaGenerationLayoutSettings
    // Shared collision settings used by API-owned generated-media geometry.
    workspaceCollision: WorkspaceCollisionSettings
    // Universal debounce for settled workspace persistence authored by the API.
    workspacePersistence: WorkspacePersistenceSettings
}

export const settings: ApiSettings = {
    aiModels: {
        defaultReasoningModelId: 'Anthropic:claude-haiku-4-5',
        defaultImageModelId: 'Stability:sd3.5-large',
        defaultVideoModelId: 'Google:veo-3.1-lite-generate-preview',
    },
    mediaDescriptor: {
        // Claude Haiku is the default VLM for reusable media descriptions.
        // Keep this id present in the synchronized AI model catalog and out of exclusion lists.
        // Change this only to another available, vision-capable, low-latency model.
        defaultVlmModelId: 'Anthropic:claude-haiku-4-5',
        // Claude Haiku's descriptor responses are short JSON payloads, but the
        // provider allows more room. Keep this aligned with the sync defaults.
        defaultVlmMaxTokens: 8192,
        defaultVlmInferenceCapabilities: {
            thinkingMode: 'none',
            requiresAutoToolChoiceWithThinking: false,
            supportsTemperature: true,
            supportsSystemPrompt: true,
            requiresClosedJsonSchema: false,
            supportedInputKinds: ['image', 'video-frame', 'document-text'],
        },
    },
    mediaGenerationCanvasProjection: mediaGenerationLayoutSettings,
    workspaceCollision: workspaceCollisionSettings,
    workspacePersistence: workspacePersistenceSettings,
}
