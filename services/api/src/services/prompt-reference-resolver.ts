'use strict'

import type {
    Asset,
    AssetRequesterContext,
    CanvasNode,
    CapabilityPromptReference,
    MediaBranchCandidateImage,
    MessageContent,
    MessageContentBlock,
    PromptReference,
    PromptReferenceAtomAttrs,
    Workspace,
} from '@lixpi/constants'
import type {
    CapabilityModuleCatalog,
    CapabilityResolvedModelInput,
} from '@lixpi/capability-system/backend'
import {
    findAiChatThreadContentNode,
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    normalizeLegacyCapabilityReferenceAttrs,
    normalizePromptReferenceAttrs,
    parseProseMirrorJsonContent,
    PROMPT_REFERENCE_NODE_TYPE,
    toPromptReference,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'

import AssetModel from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import CapabilityModel, { type CapabilityRequesterContext } from '../models/capability.ts'
import AssetDocumentService from './asset-document-service.ts'
import { capabilityArtifactBackendRegistry } from '../capability-system/capability-artifacts.ts'
import { resolveAuthorizedAssetModelInput } from '../capability-system/capability-model-input-adapter.ts'
import { collectDocumentText } from './prosemirror-text.ts'

export type AuthorizedPromptReferenceResolution = {
    references: PromptReference[]
    capabilityReferences: CapabilityPromptReference[]
    assetIds: string[]
    mediaCandidates: MediaBranchCandidateImage[]
    documentContext: string[]
    modelInputs: CapabilityResolvedModelInput[]
}

type PromptReferenceProviderMessage = {
    role: 'user' | 'assistant'
    content: MessageContent
}

export function extractLatestUserPromptReferences(
    doc: object,
    conversationAssetId: string,
): PromptReference[] {
    const root = parseProseMirrorJsonContent(doc)
    const thread = root ? findAiChatThreadContentNode(root, conversationAssetId) : null
    if (!thread) throw new Error('CONVERSATION_THREAD_NOT_FOUND')
    const latestUserMessage = [...(thread.content ?? [])]
        .reverse()
        .find((node) => node.type === 'aiUserMessage')
    if (!latestUserMessage) throw new Error('CONVERSATION_USER_MESSAGE_NOT_FOUND')

    const references: PromptReference[] = []
    const seen = new Set<string>()
    const visit = (node: ProseMirrorJsonNode): void => {
        if (node.type === PROMPT_REFERENCE_NODE_TYPE
            || node.type === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE) {
            const attrs = (node.type === PROMPT_REFERENCE_NODE_TYPE
                ? normalizePromptReferenceAttrs(node.attrs)
                : normalizeLegacyCapabilityReferenceAttrs(node.attrs)) as PromptReferenceAtomAttrs | null
            if (!attrs) throw new Error('INVALID_PROMPT_REFERENCE_ATOM')
            const reference = toPromptReference(attrs)
            const key = getPromptReferenceSelectionKey(reference)
            if (!seen.has(key)) {
                seen.add(key)
                references.push(reference)
            }
        }
        for (const child of node.content ?? []) visit(child)
    }
    visit(latestUserMessage)
    return references
}

export async function authorizePromptReferences({
    references,
    requester,
    workspace,
    moduleCatalog,
}: {
    references: PromptReference[]
    requester: AssetRequesterContext
    workspace: Workspace
    moduleCatalog: CapabilityModuleCatalog
}): Promise<AuthorizedPromptReferenceResolution> {
    const capabilityRequester: CapabilityRequesterContext = {
        userId: requester.userId,
        organizationIds: requester.organizationIds,
        canManageGlobalCapabilities: false,
    }
    const capabilityReferences: CapabilityPromptReference[] = []
    const assetIds: string[] = []
    const mediaCandidates: MediaBranchCandidateImage[] = []
    const documentContext: string[] = []
    const modelInputAssets = new Map<string, Asset>()

    for (const reference of references) {
        if (reference.referenceType === 'capability-module') {
            const entry = moduleCatalog.resolveEntry(reference.moduleId)
            if (!entry) throw new Error(`PROMPT_REFERENCE_MODULE_NOT_FOUND:${reference.moduleId}`)
            const record = await CapabilityModel.authorize({ capabilityId: entry.capabilityId, requester: capabilityRequester })
            if ('error' in record || record.status !== 'active'
                || record.kind !== entry.kind
                || record.parentModuleId !== reference.moduleId
                || record.catalogExposure !== 'module-internal') {
                throw new Error(`PROMPT_REFERENCE_MODULE_UNAVAILABLE:${reference.moduleId}`)
            }
            capabilityReferences.push(entry)
            continue
        }
        if (reference.referenceType === 'tool' || reference.referenceType === 'skill') {
            const record = await CapabilityModel.authorize({ capabilityId: reference.capabilityId, requester: capabilityRequester })
            if ('error' in record || record.status !== 'active'
                || record.kind !== reference.referenceType
                || record.catalogExposure !== 'standalone'
                || record.parentModuleId !== undefined) {
                throw new Error(`PROMPT_REFERENCE_CAPABILITY_UNAVAILABLE:${reference.capabilityId}`)
            }
            capabilityReferences.push({ capabilityId: record.capabilityId, kind: record.kind })
            continue
        }

        const asset = await AssetModel.get({ assetId: reference.assetId, requester })
        if ('error' in asset || asset.organizationId !== workspace.organizationId
            || asset.states.lifecycle !== 'active' || asset.documents.conversation) {
            throw new Error(`PROMPT_REFERENCE_ASSET_UNAVAILABLE:${reference.assetId}`)
        }
        if (reference.referenceType === 'capability-artifact') {
            if (asset.artifact?.artifactTypeId !== reference.artifactTypeId
                || !asset.documents.capabilityArtifact) {
                throw new Error(`PROMPT_REFERENCE_ARTIFACT_TYPE_MISMATCH:${reference.assetId}`)
            }
            capabilityArtifactBackendRegistry.require(reference.artifactTypeId)
            const node = reference.nodeId
                ? workspace.canvasState.nodes.find(candidate => candidate.nodeId === reference.nodeId)
                : undefined
            if (reference.nodeId && (!node || node.type !== 'capabilityArtifact'
                || node.assetId !== asset.assetId || node.artifactTypeId !== reference.artifactTypeId)) {
                throw new Error(`PROMPT_REFERENCE_NODE_ASSET_MISMATCH:${reference.nodeId}`)
            }
            const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, 'capabilityArtifact')
            if (!snapshot) throw new Error(`PROMPT_REFERENCE_ARTIFACT_NOT_READY:${reference.assetId}`)
            const definition = capabilityArtifactBackendRegistry.require(reference.artifactTypeId).shared
            definition.assertInitialDocument(snapshot.doc)
            const citedAssetIds = definition.collectReferencedAssetIds(snapshot.doc)
            const citedAssets = await Promise.all(citedAssetIds.map(async assetId => {
                const cited = await AssetModel.get({ assetId, requester })
                if ('error' in cited || cited.organizationId !== workspace.organizationId
                    || cited.states.lifecycle !== 'active') {
                    throw new Error(`PROMPT_REFERENCE_ARTIFACT_CITED_ASSET_UNAVAILABLE:${assetId}`)
                }
                return cited
            }))
            const labels = new Map(citedAssets.map(cited => [cited.assetId, cited.title]))
            const serialized = definition.serializeForModel(snapshot.doc, labels)
            documentContext.push(`Referenced ${definition.displayName} ${asset.title}:\n${serialized.text}`)
            assetIds.push(asset.assetId)
            for (const cited of citedAssets) {
                assetIds.push(cited.assetId)
                modelInputAssets.set(cited.assetId, cited)
                if (cited.media?.kind === 'image' || cited.media?.kind === 'video') {
                    mediaCandidates.push(await toMediaCandidate(cited))
                }
            }
            continue
        }
        const mediaKind = asset.media?.kind ?? (asset.documents.content ? 'document' : undefined)
        if (!mediaKind || mediaKind !== reference.mediaKind) {
            throw new Error(`PROMPT_REFERENCE_MEDIA_KIND_MISMATCH:${reference.assetId}`)
        }
        assetIds.push(asset.assetId)
        const node = reference.nodeId
            ? workspace.canvasState.nodes.find((candidate) => candidate.nodeId === reference.nodeId)
            : undefined
        if (reference.nodeId && (!node || !isMatchingMediaNode(node, reference.assetId, mediaKind))) {
            throw new Error(`PROMPT_REFERENCE_NODE_ASSET_MISMATCH:${reference.nodeId}`)
        }
        modelInputAssets.set(asset.assetId, asset)

        if (mediaKind === 'document') {
            const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, 'content')
            if (!snapshot) throw new Error(`PROMPT_REFERENCE_DOCUMENT_NOT_READY:${reference.assetId}`)
            documentContext.push(`Referenced document ${asset.title}:\n${collectDocumentText(snapshot.doc)}`)
            continue
        }
        if (mediaKind === 'audio') {
            continue
        }

        const renditionNames = mediaKind === 'image'
            ? ['canonical', 'preview', 'original'] as const
            : ['representativeFrame', 'poster', 'thumbnail'] as const
        const rendition = renditionNames
            .map((name) => asset.media!.renditions[name])
            .find((candidate) => candidate?.status === 'ready' && candidate.blobHash)
        if (rendition?.status !== 'ready' || !rendition.blobHash) {
            throw new Error(`PROMPT_REFERENCE_ASSET_NOT_READY:${reference.assetId}`)
        }
        const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: rendition.blobHash })
        if (!blob) throw new Error(`PROMPT_REFERENCE_BLOB_NOT_FOUND:${reference.assetId}`)
        mediaCandidates.push({
            candidateId: reference.nodeId ? `node:${reference.nodeId}` : `asset:${reference.assetId}`,
            ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
            assetId: reference.assetId,
            imageUrl: `nats-obj://${blob.bucketName}/${blob.objectKey}`,
            mediaKind,
            roleHints: ['base-context'],
            ancestorNodeIds: reference.nodeId ? [reference.nodeId] : [],
            sourceContextNodeIds: reference.nodeId ? [reference.nodeId] : [],
            ...(asset.descriptor?.summary ? {
                visualEntitySummary: asset.descriptor.summary,
                visualStyleSummary: asset.descriptor.summary,
            } : {}),
            entityTags: asset.descriptor?.entityTags ?? [],
            styleTags: asset.descriptor?.styleTags ?? [],
            createdAt: asset.createdAt,
        })
    }

    const modelInputs = await Promise.all([...modelInputAssets.values()].map(async asset =>
        await resolveAuthorizedAssetModelInput(asset, requester)))
    const deduplicatedMediaCandidates = [...new Map(
        mediaCandidates.map(candidate => [candidate.assetId, candidate]),
    ).values()]

    return {
        references,
        capabilityReferences: dedupeCapabilityReferences(capabilityReferences),
        assetIds: [...new Set(assetIds)],
        mediaCandidates: deduplicatedMediaCandidates,
        documentContext,
        modelInputs,
    }
}

export function addPromptReferenceMediaToLatestUserMessage(
    messages: PromptReferenceProviderMessage[],
    candidates: MediaBranchCandidateImage[],
): PromptReferenceProviderMessage[] {
    if (candidates.length === 0) return messages
    let latestUserIndex = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') {
            latestUserIndex = index
            break
        }
    }
    if (latestUserIndex < 0) return messages
    const referenceBlocks = candidates.flatMap((candidate): MessageContentBlock[] => [
        {
            type: 'input_text',
            text: JSON.stringify({
                type: 'prompt_reference_media',
                candidateId: candidate.candidateId,
                assetId: candidate.assetId,
                mediaKind: candidate.mediaKind,
            }),
        },
        { type: 'input_image', image_url: candidate.imageUrl, detail: 'high' },
    ])
    return messages.map((message, index) => {
        if (index !== latestUserIndex) return message
        const existingBlocks: MessageContentBlock[] = typeof message.content === 'string'
            ? [{ type: 'input_text', text: message.content }]
            : message.content
        return { ...message, content: [...existingBlocks, ...referenceBlocks] }
    })
}

export function addPromptReferenceAudioToLatestUserMessage<T extends {
    role: string
    content: string | Array<Record<string, unknown>>
}>(messages: T[], inputs: readonly CapabilityResolvedModelInput[]): T[] {
    const audioInputs = inputs.filter((input): input is Extract<CapabilityResolvedModelInput, { kind: 'audio' }> =>
        input.kind === 'audio')
    if (audioInputs.length === 0) return messages
    let latestUserIndex = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') {
            latestUserIndex = index
            break
        }
    }
    if (latestUserIndex < 0) return messages
    return messages.map((message, index) => {
        if (index !== latestUserIndex) return message
        const existing = typeof message.content === 'string'
            ? [{ type: 'input_text', text: message.content }]
            : message.content
        const blocks = audioInputs.flatMap(input => [
            { type: 'input_text', text: input.marker },
            {
                type: 'input_audio',
                input_audio: {
                    data: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString('base64')}`,
                    format: input.mimeType.split('/')[1]?.split(';')[0] ?? 'wav',
                },
            },
        ])
        return { ...message, content: [...existing, ...blocks] }
    })
}

function getPromptReferenceSelectionKey(reference: PromptReference): string {
    if (reference.referenceType === 'media') return `media#${reference.assetId}#${reference.nodeId ?? ''}`
    if (reference.referenceType === 'capability-artifact') {
        return `capability-artifact#${reference.artifactTypeId}#${reference.assetId}#${reference.nodeId ?? ''}`
    }
    if (reference.referenceType === 'capability-module') return `capability-module#${reference.moduleId}`
    return `${reference.referenceType}#${reference.capabilityId}`
}

function dedupeCapabilityReferences(references: CapabilityPromptReference[]): CapabilityPromptReference[] {
    const byId = new Map<string, CapabilityPromptReference>()
    for (const reference of references) {
        if (!byId.has(reference.capabilityId)) byId.set(reference.capabilityId, reference)
    }
    return [...byId.values()]
}

function isMatchingMediaNode(node: CanvasNode, assetId: string, mediaKind: string): boolean {
    if (!('assetId' in node) || node.assetId !== assetId) return false
    if (mediaKind === 'document') return node.type === 'mediaDocument' || node.type === 'document'
    return node.type === mediaKind
}

async function toMediaCandidate(asset: Asset): Promise<MediaBranchCandidateImage> {
    if (asset.media?.kind !== 'image' && asset.media?.kind !== 'video') {
        throw new Error(`PROMPT_REFERENCE_MEDIA_KIND_MISMATCH:${asset.assetId}`)
    }
    const renditionNames = asset.media.kind === 'image'
        ? ['canonical', 'preview', 'original'] as const
        : ['representativeFrame', 'poster', 'thumbnail'] as const
    const rendition = renditionNames.map(name => asset.media!.renditions[name])
        .find(candidate => candidate?.status === 'ready' && candidate.blobHash)
    if (rendition?.status !== 'ready' || !rendition.blobHash) {
        throw new Error(`PROMPT_REFERENCE_ASSET_NOT_READY:${asset.assetId}`)
    }
    const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: rendition.blobHash })
    if (!blob) throw new Error(`PROMPT_REFERENCE_BLOB_NOT_FOUND:${asset.assetId}`)
    return {
        candidateId: `asset:${asset.assetId}`,
        assetId: asset.assetId,
        imageUrl: `nats-obj://${blob.bucketName}/${blob.objectKey}`,
        mediaKind: asset.media.kind,
        roleHints: ['base-context'],
        ancestorNodeIds: [],
        sourceContextNodeIds: [],
        ...(asset.descriptor?.summary ? {
            visualEntitySummary: asset.descriptor.summary,
            visualStyleSummary: asset.descriptor.summary,
        } : {}),
        entityTags: asset.descriptor?.entityTags ?? [],
        styleTags: asset.descriptor?.styleTags ?? [],
        createdAt: asset.createdAt,
    }
}

export { collectDocumentText } from './prosemirror-text.ts'
