'use strict'

import { randomUUID } from 'node:crypto'

import type {
    AssetDocumentPointer,
    CanvasGeometryUpdate,
    CapabilityJsonValue,
    MediaGenerationRunMeta,
    Workspace,
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

import AssetModel from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import WorkspaceModel from '../models/workspace.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import {
    buildAssetCanvasGeometryUpdate,
    projectGeneratedArtifactNode,
} from '../services/asset-canvas-projection.ts'
import {
    enqueueBlobDeletion,
} from '../services/asset-maintenance-queue.ts'
import { capabilityArtifactBackendRegistry } from './capability-artifacts.ts'
import { buildActionTimelineLineageAssignment } from './action-timeline-lineage.ts'

const MAX_CANVAS_ATTACH_ATTEMPTS = 5

export async function persistActionTimelineArtifact(
    request: ActionTimelinePersistRequest,
): Promise<ActionTimelinePersistResult> {
    const { context } = request
    const organizationId = requireString(context.organizationId, 'ORGANIZATION_ID_REQUIRED')
    const conversationAssetId = requireString(context.conversationAssetId, 'CONVERSATION_ASSET_ID_REQUIRED')
    if (context.variant.axis !== 'reasoning-model') throw new Error('ACTION_TIMELINE_VARIANT_REQUIRED')

    const definition = capabilityArtifactBackendRegistry.require(ACTION_TIMELINE_ARTIFACT_TYPE_ID)
    definition.shared.assertInitialDocument(request.document)
    const requester = await getAssetRequesterContext(context.userId)
    if (!requester.editableWorkspaceIds.includes(context.workspaceId)) throw new Error('PERMISSION_DENIED')

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
        referenceAssetIds: request.referencedAssetIds,
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
    const provenanceDocument = buildProvenanceDocument({ request, assetId, generationRun })
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
                sourceAssetIds: request.referencedAssetIds,
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
        for (const sourceAssetId of request.referencedAssetIds) {
            const attached = await AssetModel.attachWorkspaceReference({
                assetId: sourceAssetId,
                workspaceId: context.workspaceId,
                requester,
                surfaceId: embeddedSurfaceId,
            })
            if ('error' in attached) throw new Error(`EMBEDDED_ASSET_ATTACH_FAILED:${sourceAssetId}:${attached.error}`)
            attachedSourceAssetIds.push(sourceAssetId)
        }
        const canvasGeometry = await attachArtifactToCanvas({
            assetId,
            generationRun,
            request,
            requester,
            dimensions: definition.initialCanvasDimensions,
        })
        return { assetId, canvasGeometry }
    } catch (error) {
        await Promise.allSettled(attachedSourceAssetIds.map(async sourceAssetId => {
            await AssetModel.detachWorkspaceReference({
                assetId: sourceAssetId,
                workspaceId: context.workspaceId,
                requester,
                surfaceId: embeddedSurfaceId,
            })
        }))
        if (created) {
            await AssetModel.detachCatalogReference({ assetId, requester }).catch(() => undefined)
        } else {
            await Promise.allSettled([artifactBlob.blobHash, provenanceBlob.blobHash].map(async blobHash => {
                await enqueueBlobDeletion({ organizationId, blobHash })
            }))
        }
        throw error
    }
}

async function attachArtifactToCanvas(args: {
    assetId: string
    generationRun: MediaGenerationRunMeta
    request: ActionTimelinePersistRequest
    requester: Awaited<ReturnType<typeof getAssetRequesterContext>>
    dimensions: { width: number; height: number }
}): Promise<CanvasGeometryUpdate> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_CANVAS_ATTACH_ATTEMPTS; attempt += 1) {
        const workspace = await WorkspaceModel.getWorkspace({
            workspaceId: args.request.context.workspaceId,
            userId: args.request.context.userId,
        })
        if ('error' in workspace) throw new Error(workspace.error)
        const persistedRevision = getWorkspaceCanvasRevision(workspace)
        const projection = projectGeneratedArtifactNode({
            canvasState: workspace.canvasState,
            assetId: args.assetId,
            artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
            generationRun: args.generationRun,
            conversationAssetId: requireString(args.request.context.conversationAssetId, 'CONVERSATION_ASSET_ID_REQUIRED'),
            capabilityRunId: args.request.context.runId,
            capabilityId: ACTION_TIMELINE_TOOL_ID,
            toolId: ACTION_TIMELINE_TOOL_ID,
            input: toCapabilityInput(args.request),
            dimensions: args.dimensions,
        })
        const nextRevision = Math.max(Date.now(), persistedRevision + 1)
        try {
            const attached = await AssetModel.attachWorkspaceReference({
                assetId: args.assetId,
                workspaceId: args.request.context.workspaceId,
                requester: args.requester,
                nodeId: projection.nodeId,
                activateOnAttach: true,
                workspaceMutation: {
                    expectedCanvasStateUpdatedAt: persistedRevision,
                    canvasStateUpdatedAt: nextRevision,
                    canvasState: projection.canvasState,
                },
            })
            if ('error' in attached) throw new Error(attached.error)
            return buildAssetCanvasGeometryUpdate({
                state: projection.canvasState,
                layoutRevision: nextRevision,
                generationRequestId: args.generationRun.generationRequestId,
                geometryNodes: projection.geometryNodes,
            })
        } catch (error) {
            lastError = error
            if (!/STALE_CANVAS_STATE|conditional/i.test(error instanceof Error ? error.message : String(error))) throw error
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
                attrs: { id: `${args.assetId}-provenance`, createdAt: Date.now(), referenceNodeIds: [] },
                content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
            }],
        }],
    }
}

async function storeJsonBlob(args: {
    organizationId: string
    value: object
    description: string
}): Promise<{ blobHash: string; byteSize: number }> {
    const bytes = Buffer.from(JSON.stringify(args.value), 'utf8')
    const blob = await BlobModel.store({
        organizationId: args.organizationId,
        bytes,
        mimeType: 'application/json',
        description: args.description,
    })
    return { blobHash: blob.blobHash, byteSize: bytes.byteLength }
}

function buildDocumentPointer(
    role: AssetDocumentPointer['role'],
    blobHash: string,
    byteSize: number,
    schemaVersion: string,
    updatedAt: number,
): AssetDocumentPointer {
    return { role, blobHash, version: 0, schemaVersion, byteSize, updatedAt }
}

function toCapabilityInput(request: ActionTimelinePersistRequest): Record<string, CapabilityJsonValue> {
    return {
        prompt: request.input.prompt,
        referenceAssetIds: request.input.referenceAssetIds,
        durationMs: request.input.durationMs,
        precisionMs: request.input.precisionMs,
    }
}

function getWorkspaceCanvasRevision(workspace: Workspace): number {
    const withCanvasRevision = workspace as Workspace & { canvasStateUpdatedAt?: number }
    return withCanvasRevision.canvasStateUpdatedAt ?? workspace.updatedAt
}

function requireString(value: string | undefined, error: string): string {
    if (!value) throw new Error(error)
    return value
}
