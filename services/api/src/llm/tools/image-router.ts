'use strict'

import { info, err } from '@lixpi/debug-tools'

import type { ProviderRegistry } from '../providers/provider-registry.ts'
import type { ProviderState } from '../graph/state.ts'

// Routes a generate_image tool call from a text model to the configured image-model provider.
// Spins up a transient provider keyed {ws}:{thread}:image with enableImageGeneration=true
// so it skips its own START_STREAM/END_STREAM — the parent text stream owns the lifecycle.
export class ImageRouter {
    constructor(private readonly registry: ProviderRegistry) {}

    async execute(state: ProviderState): Promise<Partial<ProviderState>> {
        const imageProvider = state.imageProviderName
        const imageModel = state.imageModelVersion
        const imageMeta = state.imageModelMetaInfo ?? ({} as any)
        const prompt = state.generatedImagePrompt ?? ''
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const imageSize = state.imageSize ?? 'auto'

        if (!imageProvider || !imageModel || !prompt) {
            err(
                `[ImageRouter] Missing provider, model, or prompt — provider=${imageProvider} ` +
                `model=${imageModel} promptLen=${prompt.length}`,
            )
            return {}
        }

        const instanceKey = `${workspaceId}:${aiChatThreadId}:image`
        const referenceImages = state.referenceImages ?? []

        info(
            `[ImageRouter] Routing provider=${imageProvider} model=${imageModel} ` +
            `promptLen=${prompt.length} refImages=${referenceImages.length} imageSize=${imageSize} ` +
            `instanceKey=${instanceKey}`,
        )

        try {
            const provider = this.registry.createTransient(instanceKey, imageProvider)

            // Build a fresh request: just the prompt + reference images, with
            // enableImageGeneration=true so the provider takes the image path
            // and skips its own stream lifecycle.
            const messages: ProviderState['messages'] = referenceImages.length > 0
                ? [{
                    role: 'user',
                    content: [
                        { type: 'input_text', text: prompt },
                        ...referenceImages.map(url => ({
                            type: 'input_image',
                            image_url: url,
                            detail: 'high',
                        })),
                    ],
                }]
                : [{ role: 'user', content: prompt }]

            const requestData = {
                messages,
                aiModelMetaInfo: { ...imageMeta, modelVersion: imageModel },
                workspaceId,
                aiChatThreadId,
                enableImageGeneration: true,
                imageSize,
                eventMeta: state.eventMeta,
            }

            await provider.process(requestData)

            info(`[ImageRouter] Completed successfully instanceKey=${instanceKey}`)
            return {
                imageUsage: { generatedCount: 1, size: imageSize, quality: 'high' },
            }
        } catch (e: any) {
            err(`[ImageRouter] Image generation failed: ${e?.message ?? e}`)
            return {}
        }
    }
}
