import {
    estimateProviderUsageForRun,
    type ProviderUsageEstimate,
    type MeteredAiModel,
} from '@lixpi/usage-reporter'

import {
    type ProviderState,
} from '../graph/state.ts'
import { getSystemPrompt } from '../prompts/load-prompts.ts'
import { estimateInputTokens } from '../providers/provider-input-budget.ts'

// Adapt graph state to a provider-usage estimate using the input-token heuristic.
export const estimateProviderUsageForGraphRun = (state: ProviderState): ProviderUsageEstimate => {
    // Reproduces getSystemPrompt(hasImageModel, hasVideoModel) as the reasoning
    // adapters call it. The image and video instruction blocks dwarf the base
    // prompt, so omitting them when a media model is attached would understate the
    // prompt by thousands of tokens.
    const promptTokensMeasured = estimateInputTokens({
        messages: state.messages ?? [],
        systemPrompt: getSystemPrompt(!!state.imageModelVersion, !!state.videoModelVersion),
    }).inputTokens

    return estimateProviderUsageForRun({
        model: state.aiModelMetaInfo as MeteredAiModel,
        promptTokensMeasured,
        maxCompletionSize: state.maxCompletionSize,
        videoResolution: state.videoResolution,
        videoAspectRatio: state.videoAspectRatio,
        videoDurationSeconds: state.videoDurationSeconds,
        videoSourceForExtension: state.videoSourceForExtension,
        videoSourceDurationSeconds: state.videoSourceDurationSeconds,
    })
}
