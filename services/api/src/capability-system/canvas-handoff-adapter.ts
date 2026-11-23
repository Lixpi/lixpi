import { randomUUID } from 'node:crypto'
import {
    getDynamoDbTableStageName,
    type Asset,
    type AssetSubjectIdentityAttestation,
    type ConversationHumanAction,
    type ConversationHumanActionAnswer,
    type ConversationHumanActionResult,
} from '@lixpi/constants'
import {
    type CanvasHandoffAccess,
} from '@lixpi/capability-system/backend'

import AssetModel, { canEditAssetMetadata } from '../models/asset.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
import {
    ConversationRepository,
    conversationPartition,
    type ConversationMeta,
} from '../llm/agent/conversation-repository.ts'
import { canvasLeaseTransaction } from '../services/canvas-collaboration-transaction.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import {
    isAssetAvailableInWorkspaceScope,
    scopeAssetRequesterToWorkspace,
} from '../services/workspace-reference-scope.ts'

type Principal = {
    userId: string
    workspaceId: string
    organizationId: string
}

const readScopedAsset = async (
    principal: Principal,
    assetId: string,
) => {
    const requester = scopeAssetRequesterToWorkspace(await getAssetRequesterContext(principal.userId), principal)

    if (!requester.editableWorkspaceIds.includes(principal.workspaceId))
        throw new Error('WORKSPACE_ACCESS_DENIED')

    const asset = await AssetModel.get({
        assetId,
        requester,
    })

    if (
        'error' in asset
        || !isAssetAvailableInWorkspaceScope(asset, principal)
    )
        return undefined

    return {
        asset,
        requester,
    }
}

const done = (
    action: Exclude<ConversationHumanAction, { kind: 'workspace-export' }>,
    assetId: string,
): ConversationHumanActionAnswer => ({
    kind: action.kind,
    assetId,
})

export const canvasHandoffAccess: CanvasHandoffAccess = async (
    context,
    request,
) => {
    const execution = AgentExecutionScope.current()
    const { owner } = execution
    const principal = owner.job

    await owner.fences(execution.continuationEpoch)

    if (
        context.origin !== 'model'
        || context.userId !== principal.userId
        || context.workspaceId !== principal.workspaceId
        || context.conversationAssetId !== principal.conversationAssetId
    )
        throw new Error('CANVAS_HANDOFF_SCOPE_DENIED')

    const userId = principal.userId
    const issuedAt = Date.now()

    if (request.kind === 'workspace-export')
        return {
            kind: request.kind,
            userId,
            issuedAt,
            workspaceId: principal.workspaceId,
        }

    if (request.kind === 'file')
        return {
            kind: 'file',
            userId,
            issuedAt,
            assetId: randomUUID(),
        }

    const scoped = await readScopedAsset(principal, request.assetId)

    if (!scoped)
        throw new Error('CANVAS_HANDOFF_ASSET_UNAVAILABLE')

    if (request.kind === 'download') {
        if (scoped.asset.media?.renditions[request.rendition]?.status !== 'ready')
            throw new Error('CANVAS_HANDOFF_ASSET_UNAVAILABLE')

        return {
            ...request,
            userId,
            issuedAt,
            title: scoped.asset.title,
        }
    }

    if (request.kind === 'attestation') {
        const {
            asset,
            requester,
        } = scoped

        if (
            (asset.media?.kind !== 'image' && asset.media?.kind !== 'video')
            || !(await canEditAssetMetadata(asset, requester))
        )
            throw new Error('CANVAS_HANDOFF_ATTESTATION_UNAVAILABLE')

        return {
            ...request,
            userId,
            issuedAt,
            assetRevision: asset.revision,
            title: asset.title,
        }
    }

    const generation = await MediaGenerationRequestModel.getAuthorized({
        generationRequestId: request.generationRequestId,
        workspaceId: principal.workspaceId,
        userId,
    })

    if (
        'error' in generation
        || generation.userId !== userId
        || generation.organizationId !== principal.organizationId
    )
        throw new Error('CANVAS_HANDOFF_VERIFICATION_UNAVAILABLE')

    const run = generation.runs.find(item => item.generationRun === request.generationRun)

    if (
        !run?.requiredVerificationAssetIds?.includes(request.assetId)
        || run.status !== 'awaiting-provider-verification'
    )
        throw new Error('CANVAS_HANDOFF_VERIFICATION_UNAVAILABLE')

    return {
        ...request,
        userId,
        issuedAt,
        requestRevision: generation.revision,
    }
}

export const bindCanvasFileUpload = async (
    principal: Principal,
    conversationAssetId: string,
    interruptId: string,
) => {
    const repository = new ConversationRepository()
    const partition = conversationPartition(principal.organizationId, conversationAssetId)
    const meta = await repository.read<ConversationMeta>(partition, 'META')
    const action = meta?.run?.humanAction

    if (
        meta?.workspaceId !== principal.workspaceId
        || meta.run?.state !== 'waiting-input'
        || meta.run.interruptId !== interruptId
        || action?.kind !== 'file'
        || action.userId !== principal.userId
    )
        throw new Error('CONVERSATION_FILE_UPLOAD_UNAVAILABLE')

    return {
        assetId: action.assetId,
        withAssetWrite: async <T>(write: () => Promise<T>): Promise<T> => await canvasLeaseTransaction.run(
            async () => [{
                type: 'check',
                tableName: repository.tableName,
                key: {
                    pk: partition,
                    sk: 'META',
                },
                conditionExpression: '#run.#interrupt = :interrupt AND #run.#state = :waiting AND #run.#action.#asset = :asset AND #run.#action.#user = :user',
                expressionAttributeNames: {
                    '#run': 'run',
                    '#interrupt': 'interruptId',
                    '#state': 'state',
                    '#action': 'humanAction',
                    '#asset': 'assetId',
                    '#user': 'userId',
                },
                expressionAttributeValues: {
                    ':interrupt': interruptId,
                    ':waiting': 'waiting-input',
                    ':asset': action.assetId,
                    ':user': principal.userId,
                },
            }],
            write,
        ),
    }
}

const latestAttestation = async (asset: Asset): Promise<AssetSubjectIdentityAttestation | undefined> => {
    const attestationId = asset.subjectIdentity.currentAttestationId

    if (!attestationId)
        return undefined

    return (await dynamoDBService.getItem({
        tableName: getDynamoDbTableStageName(
            'ASSET_SUBJECT_IDENTITY_ATTESTATIONS',
            process.env.ORG_NAME,
            process.env.STAGE,
        ),
        key: {
            assetId: asset.assetId,
            attestationId,
        },
        consistentRead: true,
        origin: 'verifyCanvasHumanAction.attestation',
    })) as AssetSubjectIdentityAttestation | undefined
}

export const verifyCanvasHumanAction = async (
    action: ConversationHumanAction,
    result: ConversationHumanActionResult,
    principal: Principal,
): Promise<ConversationHumanActionAnswer | undefined> => {
    if (action.userId !== principal.userId)
        return undefined

    if (action.kind === 'workspace-export')
        return result.assetId === undefined
            && action.workspaceId === principal.workspaceId
            ? {
                kind: action.kind,
                workspaceId: action.workspaceId,
            }
            : undefined

    const assetId = action.kind === 'file' ? result.assetId : action.assetId

    if (
        !assetId
        || (action.kind === 'file' ? assetId !== action.assetId : result.assetId !== undefined)
    )
        return undefined

    const scoped = await readScopedAsset(principal, assetId)

    if (!scoped)
        return undefined

    const { asset } = scoped

    if (action.kind === 'file')
        return asset.ownerUserId === principal.userId
            && asset.originWorkspaceId === principal.workspaceId
            && asset.createdAt >= action.issuedAt
            && ['creating', 'active'].includes(asset.states.lifecycle)
            && asset.media?.renditions.original?.status === 'ready'
            ? done(action, assetId)
            : undefined

    if (action.kind === 'download')
        return asset.media?.renditions[action.rendition]?.status === 'ready' ? done(action, assetId) : undefined

    if (action.kind === 'attestation') {
        const attestation = await latestAttestation(asset)

        return attestation?.attestedByUserId === principal.userId
            && attestation.organizationId === principal.organizationId
            && attestation.assetId === action.assetId
            && attestation.createdAt >= action.issuedAt
            && attestation.assetRevision > action.assetRevision
            && attestation.status === 'active'
            && attestation.classification === action.classification
            ? done(action, assetId)
            : undefined
    }

    const generation = await MediaGenerationRequestModel.getAuthorized({
        generationRequestId: action.generationRequestId,
        workspaceId: principal.workspaceId,
        userId: principal.userId,
    })

    if (
        'error' in generation
        || generation.userId !== principal.userId
        || generation.organizationId !== principal.organizationId
        || generation.revision <= action.requestRevision
    )
        return undefined

    const session = generation.verificationSessions?.find(
        item =>
            item.status === 'consumed'
            && item.requestedByUserId === principal.userId
            && item.assetId === assetId
            && item.generationRun === action.generationRun
            && item.createdAt >= action.issuedAt
            && (item.consumedAt ?? 0) >= action.issuedAt,
    )
    const run = generation.runs.find(item => item.generationRun === action.generationRun)

    return session
        && run
        && !run.requiredVerificationAssetIds?.includes(assetId)
        && asset.subjectIdentity.providerVerifications.some(
            item =>
                item.provider === session.provider
                && item.providerAccountScope === session.providerAccountScope
                && item.status === 'valid'
                && (item.expiresAt ?? Infinity) > Date.now(),
        )
        ? done(action, assetId)
        : undefined
}
