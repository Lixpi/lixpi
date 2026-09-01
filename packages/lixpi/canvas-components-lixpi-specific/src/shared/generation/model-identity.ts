import {
    type AiModelId,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'

export function uniqueAiModelIds(modelIds: Array<string | undefined>): AiModelId[] {
    const seen = new Set<string>()
    const unique: AiModelId[] = []
    for (const modelId of modelIds) {
        const trimmed = modelId?.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        unique.push(trimmed as AiModelId)
    }
    return unique
}

export function splitAiModelId(modelId: string): { provider: string; model: string } {
    const separatorIndex = modelId.indexOf(':')
    if (separatorIndex < 0) return { provider: '', model: modelId }
    return {
        provider: modelId.slice(0, separatorIndex),
        model: modelId.slice(separatorIndex + 1),
    }
}

export function buildAiModelId(provider: string, model: string): string {
    if (!model) return ''
    return model.includes(':') || !provider ? model : `${provider}:${model}`
}

export function getGeneratedMediaModelId(node: ImageCanvasNode | VideoCanvasNode): string {
    const generatedBy = node.generatedBy
    if (!generatedBy) return String(node.generationProgress?.mediaModelId ?? '')
    if (generatedBy.mediaModelId) return String(generatedBy.mediaModelId)
    if (node.type === 'video') return String((generatedBy as VideoCanvasNode['generatedBy'])?.videoModel ?? '')
    return String((generatedBy as ImageCanvasNode['generatedBy'])?.aiModel ?? '')
}

export function getGeneratedMediaModelProvider(node: ImageCanvasNode | VideoCanvasNode, modelId: string): string {
    const generatedBy = node.generatedBy
    const persistedProvider = node.type === 'video'
        ? (generatedBy as VideoCanvasNode['generatedBy'])?.videoModelProvider
        : (generatedBy as ImageCanvasNode['generatedBy'])?.imageModelProvider
    if (persistedProvider) return persistedProvider
    if (node.generationProgress?.mediaModelProvider) return node.generationProgress.mediaModelProvider
    return splitAiModelId(modelId).provider
}
