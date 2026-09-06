import { randomUUID } from 'node:crypto'

import {
    type AssetRequesterContext,
    type AssetDocumentPointer,
    type CanvasGeometryUpdate,
    type CapabilityJsonValue,
    type CapabilityReasoningModelVariant,
    type MediaGenerationRunMeta,
    type Workspace,
} from '@lixpi/constants'
import {
    ACTION_TIMELINE_ARTIFACT_TYPE_ID,
    ACTION_TIMELINE_SCHEMA_VERSION,
    ACTION_TIMELINE_TOOL_ID,
} from '@lixpi/capability-system'
import {
    type ActionTimelinePersistRequest,
    type ActionTimelinePersistResult,
} from '@lixpi/capability-system/backend'
import { PROSEMIRROR_SCHEMA_VERSION } from '@lixpi/prosemirror'

import AssetModel, { getAssetRecord } from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import OrganizationModel from '../models/organization.ts'
import WorkspaceModel from '../models/workspace.ts'
import {
    buildAssetCanvasGeometryUpdate,
    projectGeneratedArtifactNode,
} from '../services/asset-canvas-projection.ts'
import { enqueueBlobDeletion } from '../services/asset-maintenance-queue.ts'
import { capabilityArtifactBackendRegistry } from './capability-artifacts.ts'
import { buildActionTimelineLineageAssignment } from './action-timeline-lineage.ts'
import { createAssetRequesterForWorkspaceUser } from '../services/workspace-reference-scope.ts'

const MAX_CANVAS_ATTACH_ATTEMPTS = 5

const getActionTimelineRequester = async ({
    workspaceId,
    organizationId,
    userId,
}: {
    workspaceId: string
    organizationId: string
    userId: string
}): Promise<AssetRequesterContext> => {
    const workspace = await WorkspaceModel.getWorkspace({
        workspaceId,
        userId,
    })

    if (
        'error' in workspace
        || workspace.deletingAt
        || workspace.organizationId !== organizationId
    )
        throw new Error('WORKSPACE_ACCESS_DENIED')

    const organization = await OrganizationModel.getOrganization({
        organizationId,
        userId,
    })

    if ('error' in organization)
        throw new Error('ORGANIZATION_ACCESS_DENIED')

    const requester = createAssetRequesterForWorkspaceUser(
        workspace,
        userId,
        true,
    )

    if (!requester.editableWorkspaceIds.includes(workspaceId))
        throw new Error('PERMISSION_DENIED')

    return requester
}

export const persistActionTimelineArtifact = async (request: ActionTimelinePersistRequest): Promise<ActionTimelinePersistResult> => {
    const { context } = request
    const organizationId = requireString(context.organizationId, 'ORGANIZATION_ID_REQUIRED')
    const conversationAssetId = requireString(context.conversationAssetId, 'CONVERSATION_ASSET_ID_REQUIRED')

    if (context.variant.axis !== 'reasoning-model')
        throw new Error('ACTION_TIMELINE_VARIANT_REQUIRED')

    const definition = capabilityArtifactBackendRegistry.require(ACTION_TIMELINE_ARTIFACT_TYPE_ID)
    definition.shared.assertInitialDocument(request.document)
    const requester = await getActionTimelineRequester({
        workspaceId: context.workspaceId,
        organizationId,
        userId: context.userId,
    })

    const sourceAssetIds = [...new Set(request.input.referenceAssetIds)]
    const referencedAssetIds = [...new Set(request.referencedAssetIds)]
    const sourceAssetIdSet = new Set(sourceAssetIds)

    if (referencedAssetIds.some(referencedAssetId => !sourceAssetIdSet.has(referencedAssetId)))
        throw new Error('ACTION_TIMELINE_DOCUMENT_REFERENCE_NOT_IN_SOURCE_INPUT')

    const assetId = randomUUID()
    const generationRequestId = context.invocationGenerationRequestId ?? `capability-${context.runId}`
    const reasoningRunId = `${generationRequestId}:reasoning:${context.variant.reasoningIndex}`
    const now = Date.now()
    const lineageAssignment = buildActionTimelineLineageAssignment({
        assetId,
        generationRequestId,
        reasoningRunId,
        variant: context.variant,
        prompt: request.input.prompt,
        referenceAssetIds: sourceAssetIds,
        createdAt: now,
    })
    const generationRun: MediaGenerationRunMeta = {
        requestKind: 'capability-output',
        generationRequestId,
        reasoningRunId,
        reasoningModelId: context.variant.reasoningModelId,
        reasoningIndex: context.variant.reasoningIndex,
        variantIndex: context.variant.reasoningIndex,
        lineageAssignment,
    }
    const artifactBlob = await storeJsonBlob({
        organizationId,
        value: request.document,
        description: `Action Timeline ${assetId}`,
    })
    const provenanceDocument = buildProvenanceDocument({
        request,
        assetId,
        generationRun,
    })
    const provenanceBlob = await storeJsonBlob({
        organizationId,
        value: provenanceDocument,
        description: `Action Timeline provenance ${assetId}`,
    })
    const artifactPointer = buildDocumentPointer(
        'capabilityArtifact',
        artifactBlob.blobHash,
        artifactBlob.byteSize,
        ACTION_TIMELINE_SCHEMA_VERSION,
        now,
    )
    const provenancePointer = {
        ...buildDocumentPointer(
            'provenance',
            provenanceBlob.blobHash,
            provenanceBlob.byteSize,
            PROSEMIRROR_SCHEMA_VERSION,
            now,
        ),
        sealedAt: now,
    } satisfies AssetDocumentPointer
    const embeddedSurfaceId = `capabilityArtifact#${assetId}`
    const attachedSourceAssetIds: string[] = []
    let created = false

    try {
        await AssetModel.create({
            assetId,
            organizationId,
            title: definition.shared.displayName,
            scope: 'workspace',
            scopeOwnerId: context.workspaceId,
            originWorkspaceId: context.workspaceId,
            ownerUserId: context.userId,
            documents: {
                capabilityArtifact: artifactPointer,
                provenance: provenancePointer,
            },
            artifact: {
                artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
                schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
            },
            lineage: {
                sourceConversationAssetId: conversationAssetId,
                sourceAssetIds,
                generationRequestId,
                reasoningRunId,
                reasoningModelId: context.variant.reasoningModelId,
                promptFingerprint: lineageAssignment.promptFingerprint,
            },
            generatedOutputReview: { status: 'candidate' },
            states: {
                lifecycle: 'creating',
                media: 'none',
                conversation: 'none',
                provenance: 'sealed',
            },
        })
        created = true

        for (const sourceAssetId of sourceAssetIds) {
            const attached = await AssetModel.attachWorkspaceReference({
                assetId: sourceAssetId,
                workspaceId: context.workspaceId,
                requester,
                surfaceId: embeddedSurfaceId,
            })

            if ('error' in attached)
                throw new Error(`EMBEDDED_ASSET_ATTACH_FAILED:${sourceAssetId}:${attached.error}`)

            attachedSourceAssetIds.push(sourceAssetId)
        }

        return { assetId }
    } catch (error) {
        await Promise.allSettled(
            attachedSourceAssetIds.map(async sourceAssetId => {
                await AssetModel.detachWorkspaceReference({
                    assetId: sourceAssetId,
                    workspaceId: context.workspaceId,
                    requester,
                    surfaceId: embeddedSurfaceId,
                })
            }),
        )

        if (created)
            await AssetModel.detachCatalogReference({
                assetId,
                requester,
            }).catch(() => undefined)
        else {
            await Promise.allSettled(
                [artifactBlob.blobHash, provenanceBlob.blobHash].map(
                    async blobHash => void (await enqueueBlobDeletion({
                        organizationId,
                        blobHash,
                    })),
                ),
            )
        }

        throw error
    }
}

export const finalizeActionTimelineArtifact = async (request: {
    assetId: string
    capabilityRunId: string
    input: Record<string, CapabilityJsonValue>
    variant: CapabilityReasoningModelVariant
    generationRun: MediaGenerationRunMeta
    workspaceId: string
    userId: string
    organizationId: string
    conversationAssetId: string
}): Promise<{
    canvasGeometry: CanvasGeometryUpdate
    generationRun: MediaGenerationRunMeta
}> => {
    const asset = await getAssetRecord(request.assetId)

    if (!asset)
        throw new Error(`ACTION_TIMELINE_STAGED_ASSET_NOT_FOUND:${request.assetId}`)

    const lineage = asset.lineage

    if (
        asset.organizationId !== request.organizationId
        || asset.originWorkspaceId !== request.workspaceId
        || lineage?.sourceConversationAssetId !== request.conversationAssetId
        || asset.artifact?.artifactTypeId !== ACTION_TIMELINE_ARTIFACT_TYPE_ID
    )
        throw new Error(`ACTION_TIMELINE_STAGED_ASSET_MISMATCH:${request.assetId}`)

    if (asset.states.lifecycle !== 'creating')
        throw new Error(`ACTION_TIMELINE_STAGED_ASSET_NOT_CREATING:${request.assetId}`)

    if (
        lineage.generationRequestId !== request.generationRun.generationRequestId
        || lineage.reasoningRunId !== request.generationRun.reasoningRunId
        || lineage.reasoningModelId !== request.variant.reasoningModelId
    )
        throw new Error(`ACTION_TIMELINE_STAGED_LINEAGE_MISMATCH:${request.assetId}`)

    const prompt = requireCapabilityInputString(request.input.prompt, 'ACTION_TIMELINE_PROMPT_REQUIRED')
    const referenceAssetIds = [
        ...new Set(
            requireCapabilityInputStringArray(request.input.referenceAssetIds, 'ACTION_TIMELINE_REFERENCE_ASSET_IDS_INVALID'),
        ),
    ]

    if (!sameStringArray(referenceAssetIds, lineage.sourceAssetIds))
        throw new Error(`ACTION_TIMELINE_STAGED_REFERENCES_MISMATCH:${request.assetId}`)

    const generationRun: MediaGenerationRunMeta = {
        ...request.generationRun,
        requestKind: 'capability-output',
        generationRequestId: lineage.generationRequestId,
        reasoningRunId: lineage.reasoningRunId,
        reasoningModelId: request.variant.reasoningModelId,
        reasoningIndex: request.variant.reasoningIndex,
        variantIndex: request.variant.reasoningIndex,
        lineageAssignment: buildActionTimelineLineageAssignment({
            assetId: request.assetId,
            generationRequestId: lineage.generationRequestId,
            reasoningRunId: lineage.reasoningRunId,
            variant: request.variant,
            prompt,
            referenceAssetIds,
            createdAt: asset.createdAt,
        }),
    }

    const requester = await getActionTimelineRequester({
        workspaceId: request.workspaceId,
        organizationId: request.organizationId,
        userId: request.userId,
    })
    const definition = capabilityArtifactBackendRegistry.require(ACTION_TIMELINE_ARTIFACT_TYPE_ID)
    const canvasGeometry = await attachArtifactToCanvas({
        assetId: request.assetId,
        generationRun,
        workspaceId: request.workspaceId,
        userId: request.userId,
        conversationAssetId: request.conversationAssetId,
        capabilityRunId: request.capabilityRunId,
        input: request.input,
        requester,
        dimensions: definition.initialCanvasDimensions,
    })

    return {
        canvasGeometry,
        generationRun,
    }
}

export const discardStagedActionTimelineArtifact = async (request: {
    assetId: string
    workspaceId: string
    userId: string
    organizationId: string
}): Promise<void> => {
    const asset = await getAssetRecord(request.assetId)

    if (
        !asset
        || asset.states.lifecycle !== 'creating'
    )
        return

    if (
        asset.organizationId !== request.organizationId
        || asset.originWorkspaceId !== request.workspaceId
    )
        throw new Error(`ACTION_TIMELINE_STAGED_ASSET_MISMATCH:${request.assetId}`)

    const requester = await getActionTimelineRequester({
        workspaceId: request.workspaceId,
        organizationId: request.organizationId,
        userId: request.userId,
    })
    const embeddedSurfaceId = `capabilityArtifact#${request.assetId}`
    await Promise.allSettled(
        (asset.lineage.sourceAssetIds ?? []).map(async sourceAssetId => {
            await AssetModel.detachWorkspaceReference({
                assetId: sourceAssetId,
                workspaceId: request.workspaceId,
                requester,
                surfaceId: embeddedSurfaceId,
            })
        }),
    )
    await AssetModel.detachCatalogReference({
        assetId: request.assetId,
        requester,
    })
}

async function attachArtifactToCanvas(args: {
    assetId: string
    generationRun: MediaGenerationRunMeta
    workspaceId: string
    userId: string
    conversationAssetId: string
    capabilityRunId: string
    input: Record<string, CapabilityJsonValue>
    requester: AssetRequesterContext
    dimensions: {
        width: number
        height: number
    }
}): Promise<CanvasGeometryUpdate> {
    let lastError: unknown

    for (let attempt = 0; attempt < MAX_CANVAS_ATTACH_ATTEMPTS; attempt += 1) {
        const workspace = await WorkspaceModel.getWorkspace({
            workspaceId: args.workspaceId,
            userId: args.userId,
        })

        if ('error' in workspace)
            throw new Error(workspace.error)

        const persistedRevision = getWorkspaceCanvasRevision(workspace)
        const projection = projectGeneratedArtifactNode({
            canvasState: workspace.canvasState,
            assetId: args.assetId,
            artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
            generationRun: args.generationRun,
            conversationAssetId: args.conversationAssetId,
            capabilityRunId: args.capabilityRunId,
            capabilityId: ACTION_TIMELINE_TOOL_ID,
            toolId: ACTION_TIMELINE_TOOL_ID,
            input: args.input,
            dimensions: args.dimensions,
        })
        const nextRevision = Math.max(
            Date.now(),
            persistedRevision + 1,
        )

        try {
            const attached = await AssetModel.attachWorkspaceReference({
                assetId: args.assetId,
                workspaceId: args.workspaceId,
                requester: args.requester,
                nodeId: projection.nodeId,
                activateOnAttach: true,
                workspaceMutation: {
                    expectedCanvasStateUpdatedAt: persistedRevision,
                    canvasStateUpdatedAt: nextRevision,
                    canvasState: projection.canvasState,
                },
            })

            if ('error' in attached)
                throw new Error(attached.error)

            return buildAssetCanvasGeometryUpdate({
                state: projection.canvasState,
                layoutRevision: nextRevision,
                generationRequestId: args.generationRun.generationRequestId,
                geometryNodes: projection.geometryNodes,
            })
        } catch (error) {
            lastError = error

            if (!/STALE_CANVAS_STATE|conditional/i.test(error instanceof Error ? error.message : String(error)))
                throw error
        }
    }

    throw lastError ?? new Error(`ACTION_TIMELINE_CANVAS_ATTACH_EXHAUSTED:${args.assetId}`)
}

function buildProvenanceDocument(args: {
    request: ActionTimelinePersistRequest
    assetId: string
    generationRun: MediaGenerationRunMeta
}): object {
    const text = JSON.stringify({
        assetId: args.assetId,
        capabilityId: ACTION_TIMELINE_TOOL_ID,
        capabilityRunId: args.request.context.runId,
        generationRun: args.generationRun,
        input: args.request.input,
        referencedAssetIds: args.request.referencedAssetIds,
    })

    return {
        type: 'doc',
        content: [{
            type: 'aiChatThread',
            attrs: { threadId: args.request.context.conversationAssetId ?? '' },
            content: [{
                type: 'aiUserMessage',
                attrs: {
                    id: `${args.assetId}-provenance`,
                    createdAt: Date.now(),
                    referenceNodeIds: [],
                },
                content: [{
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text,
                    }],
                }],
            }],
        }],
    }
}

async function storeJsonBlob(args: {
    organizationId: string
    value: object
    description: string
}): Promise<{
    blobHash: string
    byteSize: number
}> {
    const bytes = Buffer.from(
        JSON.stringify(args.value),
        'utf8',
    )
    const blob = await BlobModel.store({
        organizationId: args.organizationId,
        bytes,
        mimeType: 'application/json',
        description: args.description,
    })

    return {
        blobHash: blob.blobHash,
        byteSize: bytes.byteLength,
    }
}

function buildDocumentPointer(
    role: AssetDocumentPointer['role'],
    blobHash: string,
    byteSize: number,
    schemaVersion: string,
    updatedAt: number,
): AssetDocumentPointer {
    return {
        role,
        blobHash,
        version: 0,
        schemaVersion,
        byteSize,
        updatedAt,
    }
}

function getWorkspaceCanvasRevision(workspace: Workspace): number {
    const withCanvasRevision = workspace as Workspace & { canvasStateUpdatedAt?: number }

    return withCanvasRevision.canvasStateUpdatedAt ?? workspace.updatedAt
}

function requireString(
    value: string | undefined,
    error: string,
): string {
    if (!value)
        throw new Error(error)

    return value
}

function requireCapabilityInputString(
    value: CapabilityJsonValue | undefined,
    error: string,
): string {
    if (
        typeof value !== 'string'
        || !value.trim()
    )
        throw new Error(error)

    return value.trim()
}

function requireCapabilityInputStringArray(
    value: CapabilityJsonValue | undefined,
    error: string,
): string[] {
    if (
        !Array.isArray(value)
        || !value.every(item => typeof item === 'string')
    )
        throw new Error(error)

    return value
}

function sameStringArray(
    left: readonly string[],
    right: readonly string[],
): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}
