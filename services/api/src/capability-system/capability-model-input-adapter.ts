'use strict'

import type {
    Asset,
    AssetRequesterContext,
    CapabilityReasoningModelVariant,
} from '@lixpi/constants'
import {
    CapabilityError,
    type CapabilityActionExecutionContext,
    type CapabilityResolvedModelInput,
    type CapabilityStructuredModelBudgetRequest,
    type CapabilityStructuredModelPort,
} from '@lixpi/capability-system/backend'
import NATS_Service from '@lixpi/nats-service'

import AssetModel from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'
import { callStructuredVlm } from '../llm/structured-vlm/structured-vlm-client.ts'
import { detectCapabilities } from '../llm/providers/provider-capabilities.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import { collectDocumentText } from '../services/prosemirror-text.ts'
import {
    createAssetRequesterForWorkspaceUser,
    isAssetAvailableInWorkspaceScope,
} from '../services/workspace-reference-scope.ts'

export async function resolveCapabilityModelInputs(request: {
    assetIds: string[]
    context: CapabilityActionExecutionContext
}): Promise<CapabilityResolvedModelInput[]> {
    const workspace = await Workspace.getWorkspace({
        workspaceId: request.context.workspaceId,
        userId: request.context.userId,
    })
    if ('error' in workspace || workspace.deletingAt
        || workspace.organizationId !== request.context.organizationId) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Capability Workspace is unavailable')
    }
    const organization = await Organization.getOrganization({
        organizationId: workspace.organizationId,
        userId: request.context.userId,
    })
    if ('error' in organization) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Capability Organization is unavailable')
    }
    const requester = createAssetRequesterForWorkspaceUser(workspace, request.context.userId, true)
    return await Promise.all(request.assetIds.map(async (assetId) => {
        const asset = await AssetModel.get({ assetId, requester })
        if ('error' in asset || asset.states.lifecycle !== 'active'
            || !isAssetAvailableInWorkspaceScope(asset, workspace)) {
            throw new CapabilityError(
                'CAPABILITY_ACTION_INPUT_INVALID',
                `Referenced Asset ${assetId} is missing, inactive, or unavailable`,
                { assetId, reason: 'ASSET_UNAVAILABLE' },
            )
        }
        return await resolveAuthorizedAssetModelInput(asset, requester)
    }))
}

export function createCapabilityStructuredModelPort(): CapabilityStructuredModelPort {
    return {
        assertSupportedInputs: (variant, inputs) => {
            const supported = detectCapabilities(variant.provider, variant.modelVersion).supportedInputKinds
            for (const input of inputs) {
                if (supported.has(input.kind)) continue
                throw new CapabilityError(
                    'MODEL_INPUT_KIND_UNSUPPORTED',
                    `${variant.reasoningModelId} does not support ${input.kind} input from Asset ${input.assetId}`,
                    {
                        modelId: variant.reasoningModelId,
                        modelVersion: variant.modelVersion,
                        inputKind: input.kind,
                        assetId: input.assetId,
                    },
                )
            }
        },
        assessInputBudget: async request => assessCapabilityModelInputBudget(request),
        call: async request => {
            const natsService = NATS_Service.getInstance()
            if (!natsService) throw new Error('NATS service unavailable')
            const result = await callStructuredVlm({
                provider: request.variant.provider,
                modelVersion: request.variant.modelVersion,
                systemPrompt: request.systemPrompt,
                userMessages: [{ role: 'user', content: buildModelContent(request.userPrompt, request.inputs) }],
                schema: {
                    name: 'action_timeline_batch',
                    description: 'A complete Action Timeline segment batch.',
                    schema: request.schema,
                },
                natsService,
                maxTokens: request.maxTokens,
                abortSignal: request.abortSignal,
                enableThinking: true,
            })
            return {
                parsed: result.parsed,
                rawText: result.rawText,
                usage: {
                    promptTokens: result.promptTokens,
                    completionTokens: result.completionTokens,
                },
            }
        },
    }
}

export function assessCapabilityModelInputBudget(
    request: CapabilityStructuredModelBudgetRequest,
): { inputTokens: number; reservedCompletionTokens: number; contextWindow: number } {
    const textCharacters = request.systemPrompt.length
        + request.userPrompt.length
        + JSON.stringify(request.schema).length
        + request.inputs.reduce((total, input) => total + input.marker.length
            + (input.kind === 'document-text' ? input.title.length + input.text.length : 0), 0)
    const textTokens = Math.ceil(textCharacters / 3)
    const mediaTokens = request.inputs.reduce((total, input) => {
        if (input.kind === 'document-text') return total
        if (input.kind === 'audio') return total + Math.ceil(input.bytes.byteLength / 24)
        return total + 1_600
    }, 0)
    const inputTokens = textTokens + mediaTokens
    const reservedCompletionTokens = request.maxTokens
    const contextWindow = request.variant.contextWindow
    if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0
        || inputTokens + reservedCompletionTokens > contextWindow) {
        throw new CapabilityError(
            'MODEL_INPUT_CONTEXT_EXCEEDED',
            `${request.variant.reasoningModelId} cannot fit the complete translated request in its context window`,
            {
                modelId: request.variant.reasoningModelId,
                inputTokens,
                reservedCompletionTokens,
                contextWindow,
            },
        )
    }
    return { inputTokens, reservedCompletionTokens, contextWindow }
}

function buildModelContent(
    userPrompt: string,
    inputs: readonly CapabilityResolvedModelInput[],
): Array<Record<string, unknown>> {
    const blocks: Array<Record<string, unknown>> = [{ type: 'input_text', text: userPrompt }]
    for (const input of inputs) {
        blocks.push({ type: 'input_text', text: input.marker })
        if (input.kind === 'document-text') {
            blocks.push({ type: 'input_text', text: input.text })
            continue
        }
        const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString('base64')}`
        if (input.kind === 'audio') {
            blocks.push({
                type: 'input_audio',
                input_audio: { data: dataUrl, format: audioFormat(input.mimeType) },
            })
            continue
        }
        blocks.push({ type: 'input_image', image_url: dataUrl, detail: 'high' })
    }
    return blocks
}

export async function resolveAuthorizedAssetModelInput(
    asset: Asset,
    requester: AssetRequesterContext,
): Promise<CapabilityResolvedModelInput> {
    const marker = `<ref asset:${asset.assetId} "${asset.title.replaceAll('"', '\\"')}">`
    if (asset.primaryCategory === 'capabilityArtifact' || asset.artifact) {
        throw new CapabilityError(
            'CAPABILITY_ACTION_INPUT_INVALID',
            `Action Timeline cannot cite nested Capability Artifact ${asset.assetId}`,
            { assetId: asset.assetId, reason: 'NESTED_ARTIFACT_FORBIDDEN' },
        )
    }
    if (asset.media?.kind === 'image') {
        const loaded = await loadRendition(asset, ['canonical', 'preview', 'original'])
        assertImagePayload(loaded.bytes, loaded.mimeType, asset.assetId)
        return { kind: 'image', marker, assetId: asset.assetId, title: asset.title, ...loaded }
    }
    if (asset.media?.kind === 'video') {
        const loaded = await loadRendition(asset, ['representativeFrame', 'poster', 'thumbnail'])
        assertImagePayload(loaded.bytes, loaded.mimeType, asset.assetId)
        return { kind: 'video-frame', marker, assetId: asset.assetId, title: asset.title, ...loaded }
    }
    if (asset.media?.kind === 'audio') {
        const loaded = await loadRendition(asset, ['original'])
        if (!loaded.mimeType.startsWith('audio/') || loaded.bytes.byteLength === 0) {
            throw inputFailure(asset.assetId, 'CORRUPT_AUDIO_INPUT')
        }
        return { kind: 'audio', marker, assetId: asset.assetId, title: asset.title, ...loaded }
    }
    if (asset.media?.kind === 'document' || asset.documents.content) {
        const authorized = await AssetModel.get({ assetId: asset.assetId, requester })
        if ('error' in authorized) throw inputFailure(asset.assetId, authorized.error)
        const snapshot = await AssetDocumentService.loadCurrentSnapshot(authorized, 'content')
        if (!snapshot) throw inputFailure(asset.assetId, 'DOCUMENT_NOT_READY')
        return {
            kind: 'document-text',
            marker,
            assetId: asset.assetId,
            title: asset.title,
            text: collectDocumentText(snapshot.doc),
        }
    }
    throw inputFailure(asset.assetId, 'MODEL_INPUT_REPRESENTATION_UNAVAILABLE')
}

async function loadRendition(
    asset: Asset,
    names: Array<'canonical' | 'preview' | 'original' | 'representativeFrame' | 'poster' | 'thumbnail'>,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const rendition = names.map(name => asset.media?.renditions[name])
        .find(candidate => candidate?.status === 'ready' && candidate.blobHash && candidate.mimeType)
    if (!rendition || rendition.status !== 'ready' || !rendition.blobHash || !rendition.mimeType) {
        throw inputFailure(asset.assetId, `RENDITION_NOT_READY:${names.join(',')}`)
    }
    const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: rendition.blobHash })
    if (!blob) throw inputFailure(asset.assetId, 'BLOB_NOT_FOUND')
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service unavailable')
    const bytes = await natsService.getObject(blob.bucketName, blob.objectKey)
    if (!bytes) throw inputFailure(asset.assetId, 'OBJECT_NOT_FOUND')
    return { bytes, mimeType: rendition.mimeType }
}

function assertImagePayload(bytes: Uint8Array, mimeType: string, assetId: string): void {
    const validMime = mimeType === 'image/png' || mimeType === 'image/jpeg'
        || mimeType === 'image/gif' || mimeType === 'image/webp'
    const validMagic = bytes.byteLength >= 3 && (
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
        || bytes[0] === 0xff && bytes[1] === 0xd8
        || bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
        || bytes.byteLength >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57
    )
    if (!validMime || !validMagic) throw inputFailure(assetId, 'CORRUPT_IMAGE_INPUT')
}

function inputFailure(assetId: string, reason: string): CapabilityError {
    return new CapabilityError(
        'CAPABILITY_ACTION_INPUT_INVALID',
        `Referenced Asset ${assetId} cannot be materialized: ${reason}`,
        { assetId, reason },
    )
}

function audioFormat(mimeType: string): string {
    return mimeType.split('/')[1]?.split(';')[0] ?? 'wav'
}
