import {
    type ProviderName,
} from '@lixpi/constants'
import {
    CapabilityError,
    type CapabilityActionExecutionContext,
} from '@lixpi/capability-system/backend'

import AiModel from '../../models/ai-model.ts'
import AssetModel from '../../models/asset.ts'
import BlobModel from '../../models/blob.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import {
    type StyleExtractionInput,
} from './pipeline/types.ts'

export const resolveStyleExtractionInput = async (
    input: Readonly<Record<string, unknown>>,
    context: CapabilityActionExecutionContext,
): Promise<StyleExtractionInput> => {
    const prompt = readString(input.prompt, 'prompt')
    const analysisModelId = readString(input.analysisModelId, 'analysisModelId')
    const sourceAssetIds = readStringArray(input.sourceAssetIds, 'sourceAssetIds')
    const requester = await getAssetRequesterContext(context.userId)
    let organizationId = context.organizationId
    const imageBlocks: Array<Record<string, unknown>> = []

    for (const assetId of sourceAssetIds) {
        const asset = await AssetModel.get({
            assetId,
            requester,
        })

        if (
            'error' in asset
            || asset.media?.kind !== 'image'
        )
            throw new CapabilityError('CAPABILITY_ACTION_NOT_ALLOWED', `Image Asset ${assetId} is unavailable`)

        if (
            organizationId
            && asset.organizationId !== organizationId
        )
            throw new CapabilityError('CAPABILITY_ACTION_NOT_ALLOWED', `Image Asset ${assetId} is outside the run organization`)

        organizationId ??= asset.organizationId
        const rendition = asset.media.renditions.canonical?.status === 'ready'
            ? asset.media.renditions.canonical
            : asset.media.modelSafe
                && asset.media.renditions.original?.status === 'ready'
                ? asset.media.renditions.original
                : undefined

        if (!rendition?.blobHash)
            throw new CapabilityError('CAPABILITY_ACTION_FAILED', `Image Asset ${assetId} is not ready`)

        const blob = await BlobModel.get({
            organizationId: asset.organizationId,
            blobHash: rendition.blobHash,
        })

        if (!blob)
            throw new CapabilityError('CAPABILITY_ACTION_FAILED', `Image Asset ${assetId} content is unavailable`)

        imageBlocks.push({
            type: 'input_image',
            image_url: `nats-obj://${blob.bucketName}/${blob.objectKey}`,
        })
    }

    const analysis = await resolveModel(analysisModelId)
    const imageModelId = typeof input.imageModelId === 'string'
        && input.imageModelId
        ? input.imageModelId
        : undefined
    const image = imageModelId ? await resolveModel(imageModelId) : undefined
    const styleExtractionRunId = context.conversationAssetId ?? context.runId
    const intent = typeof input.intent === 'string'
        && input.intent.trim()
        ? input.intent.trim()
        : prompt

    return {
        styleExtractionRunId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        organizationId,
        intent,
        messages: [{
            role: 'user',
            content: [{
                type: 'input_text',
                text: prompt,
            }, ...imageBlocks],
        }],
        sourceAssetIds,
        analysisProvider: analysis.provider,
        analysisModel: analysis.model,
        imageProvider: image?.provider,
        imageModel: image?.model,
    }
}

async function resolveModel(modelId: string): Promise<{
    provider: ProviderName
    model: NonNullable<StyleExtractionInput['analysisModel']>
}> {
    const [provider, ...modelParts] = modelId.split(':')
    const modelName = modelParts.join(':')

    if (
        !provider
        || !modelName
    )
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `Invalid AI model id ${modelId}`)

    const model = await AiModel.getAiModel({
        provider,
        model: modelName,
        omitPricing: false,
    })

    if (!model)
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `AI model ${modelId} was not found`)

    return {
        provider: provider as ProviderName,
        model,
    }
}

function readString(
    value: unknown,
    name: string,
): string {
    if (
        typeof value !== 'string'
        || !value.trim()
    )
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${name} is required`)

    return value.trim()
}

function readStringArray(
    value: unknown,
    name: string,
): string[] {
    if (
        !Array.isArray(value)
        || value.length === 0
        || value.some(item => typeof item !== 'string' || !item)
    )
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${name} must contain Asset ids`)

    return [...new Set(value)]
}
