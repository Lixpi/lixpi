import { err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import {
    MEDIA_DESCRIPTOR_VERSION,
    NATS_SUBJECTS,
    type AiModelId,
    type Asset,
    type AssetDocumentRole,
    type ContentDescriptor,
    type ProviderName,
} from '@lixpi/constants'

import AssetModel, { canEditAssetMetadata } from '../../models/asset.ts'
import BlobModel from '../../models/blob.ts'
import AiModel from '../../models/ai-model.ts'
import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'
import {
    describeMediaStill,
    describeTextContent,
} from '../../llm/media-descriptor.ts'
import { settings } from '../../settings.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import { createAssetRequesterForWorkspaceUser } from '../../services/workspace-reference-scope.ts'
import { deriveDepictionMedium } from '../../services/asset-subject-identity-service.ts'

const { MEDIA_DESCRIBE } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

const plainTextFromProseMirror = (value: unknown): string => {
    if (
        !value
        || typeof value !== 'object'
    )
        return ''

    const node = value as {
        text?: unknown
        content?: unknown
    }
    const ownText = typeof node.text === 'string' ? node.text : ''
    const childText = Array.isArray(node.content)
        ? node.content.map(plainTextFromProseMirror).filter(Boolean).join(' ')
        : ''

    return [ownText, childText].filter(Boolean).join(' ')
}

const loadAssetText = async (asset: Awaited<ReturnType<typeof AssetModel.get>>): Promise<string> => {
    if ('error' in asset)
        return ''

    const role = (asset.documents.content ? 'content' : 'conversation') as AssetDocumentRole

    if (!asset.documents[role])
        return ''

    const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, role)

    return plainTextFromProseMirror(snapshot?.doc)
}

const selectDescriptorRendition = (asset: Asset) => {
    const renditions = asset.media?.renditions

    if (
        !renditions
        || !asset.media
    )
        return undefined

    const names = asset.media.kind === 'image'
        ? ['preview', 'original'] as const
        : asset.media.kind === 'video'
            ? ['representativeFrame', 'poster', 'thumbnail'] as const
            : asset.media.kind === 'document'
                ? ['poster', 'thumbnail'] as const
                : [] as const

    return names.map(name => renditions[name]).find(rendition => rendition?.status === 'ready' && rendition.blobHash)
}

const persistDescriptor = async ({
    assetId,
    requester,
    descriptor,
    title,
}: {
    assetId: string
    requester: Awaited<ReturnType<typeof getAssetRequesterContext>>
    descriptor: ContentDescriptor
    title?: string
}) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await AssetModel.get({
            assetId,
            requester,
        })

        if ('error' in current)
            return current

        const persisted = await AssetModel.updateMetadata({
            assetId,
            requester,
            expectedRevision: current.revision,
            descriptor,
            depictionMedium: deriveDepictionMedium({
                media: current.media,
                descriptor,
            }),
            ...(title ? { title } : {}),
        })

        if (
            !('error' in persisted)
            || persisted.error !== 'REVISION_CONFLICT'
        )
            return persisted
    }

    return { error: 'REVISION_CONFLICT' }
}

export const mediaDescriptorSubjects = [{
    subject: MEDIA_DESCRIBE,
    type: 'reply',
    payloadType: 'json',
    permissions: {
        pub: { allow: [MEDIA_DESCRIBE] },
        sub: { allow: [] },
    },
    handler: async (data: any) => {
        const userId = data.user.userId as string
        const assetId = data.assetId as string

        if (!assetId)
            return { error: 'ASSET_ID_REQUIRED' }

        const requester = typeof data.workspaceId === 'string'
            && data.workspaceId
            ? await (async () => {
                const workspace = await Workspace.getWorkspace({
                    workspaceId: data.workspaceId,
                    userId,
                })

                if (
                    'error' in workspace
                    || workspace.deletingAt
                )
                    return null

                const organization = await Organization.getOrganization({
                    organizationId: workspace.organizationId,
                    userId,
                })

                if ('error' in organization)
                    return null

                return createAssetRequesterForWorkspaceUser(
                    workspace,
                    userId,
                    true,
                )
            })()
            : await getAssetRequesterContext(userId)

        if (!requester)
            return { error: 'WORKSPACE_ACCESS_DENIED' }

        const asset = await AssetModel.get({
            assetId,
            requester,
        })

        if ('error' in asset)
            return asset

        if (!await canEditAssetMetadata(asset, requester))
            return { error: 'PERMISSION_DENIED' }

        const isMedia = Boolean(asset.media)
        const descriptorModelId = (isMedia ? settings.mediaDescriptor.defaultVlmModelId : data.aiModel) as AiModelId | undefined

        if (!descriptorModelId?.includes(':'))
            return { error: 'AI_MODEL_REQUIRED' }

        const [provider, modelVersion] = descriptorModelId.split(':')
        const aiModelMetaInfo = await AiModel.getAiModel({
            provider: provider!,
            model: modelVersion!,
            omitPricing: true,
        })
        const maxTokens = aiModelMetaInfo?.maxCompletionSize || (isMedia ? settings.mediaDescriptor.defaultVlmMaxTokens : undefined)
        const inferenceCapabilities = aiModelMetaInfo?.inferenceCapabilities
            ?? (isMedia ? settings.mediaDescriptor.defaultVlmInferenceCapabilities : undefined)

        if (
            !maxTokens
            || !inferenceCapabilities
        )
            return { error: `AI_MODEL_NOT_FOUND:${descriptorModelId}` }

        const natsService = NATS_Service.getInstance()

        if (!natsService)
            return { error: 'NATS_UNAVAILABLE' }

        try {
            let descriptor

            if (isMedia) {
                const rendition = selectDescriptorRendition(asset)

                if (
                    rendition?.status !== 'ready'
                    || !rendition.blobHash
                )
                    return { error: 'DESCRIPTOR_RENDITION_NOT_READY' }

                const blob = await BlobModel.get({
                    organizationId: asset.organizationId,
                    blobHash: rendition.blobHash,
                })

                if (!blob)
                    return { error: 'BLOB_NOT_FOUND' }

                descriptor = await describeMediaStill({
                    provider: provider as ProviderName,
                    modelVersion: modelVersion!,
                    inferenceCapabilities,
                    imageUrl: `nats-obj://${blob.bucketName}/${blob.objectKey}`,
                    natsService,
                    maxTokens,
                })
            } else {
                descriptor = await describeTextContent({
                    provider: provider as ProviderName,
                    modelVersion: modelVersion!,
                    inferenceCapabilities,
                    text: await loadAssetText(asset),
                    title: asset.title,
                    natsService,
                    maxTokens,
                })
            }

            if (!descriptor.summary.trim())
                return { error: 'ASSET_DESCRIPTOR_EMPTY' }

            const persisted = await persistDescriptor({
                assetId,
                requester,
                title: isMedia ? descriptor.title : undefined,
                descriptor: {
                    summary: descriptor.summary,
                    entityTags: descriptor.entityTags,
                    styleTags: descriptor.styleTags,
                    status: 'ready',
                    source: 'analysis',
                    version: MEDIA_DESCRIPTOR_VERSION,
                    updatedAt: Date.now(),
                },
            })

            return 'error' in persisted
                ? persisted
                : {
                    ...persisted.descriptor,
                    title: persisted.title,
                }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            err(`Asset descriptor failed for ${assetId}: ${message}`)

            return { error: message }
        }
    },
}]
