import * as process from 'node:process'

import {
    ACCESS_LEVEL,
    getDynamoDbTableStageName,
    type MediaGenerationRequest,
    type MediaGenerationRequestAccessList,
    type MediaGenerationRequestMeta,
} from '@lixpi/constants'
import Workspace from './workspace.ts'

const {
    ORG_NAME,
    STAGE,
} = process.env
const requestsTableName = (): string => getDynamoDbTableStageName(
    'MEDIA_GENERATION_REQUESTS',
    ORG_NAME,
    STAGE,
)
const metaTableName = (): string => getDynamoDbTableStageName(
    'MEDIA_GENERATION_REQUESTS_META',
    ORG_NAME,
    STAGE,
)
const accessTableName = (): string => getDynamoDbTableStageName(
    'MEDIA_GENERATION_REQUESTS_ACCESS_LIST',
    ORG_NAME,
    STAGE,
)

const userPrincipalId = (userId: string): string => `user#${userId}`
const workspacePrincipalId = (workspaceId: string): string => `workspace#${workspaceId}`

export const buildMediaGenerationRequestMeta = (request: MediaGenerationRequest): MediaGenerationRequestMeta => ({
    generationRequestId: request.generationRequestId,
    workspaceId: request.workspaceId,
    organizationId: request.organizationId,
    conversationAssetId: request.conversationAssetId,
    status: request.status,
    revision: request.revision,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    statusUpdatedAt: request.statusUpdatedAt,
})

export const createMediaGenerationRequest = async (request: MediaGenerationRequest): Promise<MediaGenerationRequest> => {
    const accessRows: MediaGenerationRequestAccessList[] = [userPrincipalId(request.userId), workspacePrincipalId(request.workspaceId)].map(
        principalId => ({
            generationRequestId: request.generationRequestId,
            principalId,
            accessLevel: ACCESS_LEVEL.OWNER,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
        }),
    )
    await dynamoDBService.transactWrite({
        operations: [
            {
                type: 'put',
                tableName: requestsTableName(),
                item: request,
                conditionExpression: 'attribute_not_exists(#generationRequestId)',
                expressionAttributeNames: { '#generationRequestId': 'generationRequestId' },
            },
            {
                type: 'put',
                tableName: metaTableName(),
                item: buildMediaGenerationRequestMeta(request),
                conditionExpression: 'attribute_not_exists(#generationRequestId)',
                expressionAttributeNames: { '#generationRequestId': 'generationRequestId' },
            },
            ...accessRows.map(
                item => ({
                    type: 'put' as const,
                    tableName: accessTableName(),
                    item,
                    conditionExpression: 'attribute_not_exists(#principalId)',
                    expressionAttributeNames: { '#principalId': 'principalId' },
                }),
            ),
        ],
        origin: 'MediaGenerationRequest.create',
    })

    return request
}

export const getMediaGenerationRequest = async ({
    generationRequestId,
    workspaceId,
}: {
    generationRequestId: string
    workspaceId: string
}): Promise<MediaGenerationRequest | undefined> =>
    (await dynamoDBService.getItem({
        tableName: requestsTableName(),
        key: {
            generationRequestId,
            workspaceId,
        },
        consistentRead: true,
        origin: 'MediaGenerationRequest.get',
    })) as MediaGenerationRequest | undefined

export const getAuthorizedMediaGenerationRequest = async ({
    generationRequestId,
    workspaceId,
    userId,
    requiredAccess = 'owner',
}: {
    generationRequestId: string
    workspaceId: string
    userId: string
    requiredAccess?: 'read' | 'owner'
}): Promise<MediaGenerationRequest | { error: 'NOT_FOUND' | 'PERMISSION_DENIED' }> => {
    const request = await getMediaGenerationRequest({
        generationRequestId,
        workspaceId,
    })

    if (!request)
        return { error: 'NOT_FOUND' }

    if (request.userId === userId)
        return request

    if (requiredAccess === 'read') {
        const workspaceAccess = (await dynamoDBService.getItem({
            tableName: accessTableName(),
            key: {
                generationRequestId,
                principalId: workspacePrincipalId(workspaceId),
            },
            consistentRead: true,
            origin: 'MediaGenerationRequest.getAuthorized:workspacePrincipal',
        })) as MediaGenerationRequestAccessList | undefined

        if (workspaceAccess) {
            const workspace = await Workspace.getWorkspace({
                workspaceId,
                userId,
            })

            if (!('error' in workspace))
                return request
        }
    }

    const access = (await dynamoDBService.getItem({
        tableName: accessTableName(),
        key: {
            generationRequestId,
            principalId: userPrincipalId(userId),
        },
        consistentRead: true,
        origin: 'MediaGenerationRequest.getAuthorized',
    })) as MediaGenerationRequestAccessList | undefined

    if (!access)
        return { error: 'PERMISSION_DENIED' }

    if (
        requiredAccess === 'owner'
        && access.accessLevel !== ACCESS_LEVEL.OWNER
    )
        return { error: 'PERMISSION_DENIED' }

    return request
}

export const transitionMediaGenerationRequest = async ({
    request,
    expectedRevision,
}: {
    request: MediaGenerationRequest
    expectedRevision: number
}): Promise<MediaGenerationRequest> => {
    if (request.revision !== expectedRevision + 1)
        throw new Error('MEDIA_REQUEST_REVISION_INCREMENT_REQUIRED')

    await dynamoDBService.transactWrite({
        operations: [
            {
                type: 'put',
                tableName: requestsTableName(),
                item: request,
                conditionExpression: '#revision = :expectedRevision AND attribute_not_exists(#deletingAt)',
                expressionAttributeNames: {
                    '#revision': 'revision',
                    '#deletingAt': 'deletingAt',
                },
                expressionAttributeValues: { ':expectedRevision': expectedRevision },
            },
            {
                type: 'put',
                tableName: metaTableName(),
                item: buildMediaGenerationRequestMeta(request),
                conditionExpression: '#revision = :expectedRevision',
                expressionAttributeNames: { '#revision': 'revision' },
                expressionAttributeValues: { ':expectedRevision': expectedRevision },
            },
        ],
        logConditionalCheckFailures: false,
        origin: 'MediaGenerationRequest.transition',
    })

    return request
}

export const deleteMediaGenerationRequest = async (request: MediaGenerationRequest): Promise<void> => {
    await dynamoDBService.transactWrite({
        operations: [
            {
                type: 'delete',
                tableName: requestsTableName(),
                key: {
                    generationRequestId: request.generationRequestId,
                    workspaceId: request.workspaceId,
                },
                conditionExpression: '#revision = :expectedRevision',
                expressionAttributeNames: { '#revision': 'revision' },
                expressionAttributeValues: { ':expectedRevision': request.revision },
            },
            {
                type: 'delete',
                tableName: metaTableName(),
                key: {
                    workspaceId: request.workspaceId,
                    generationRequestId: request.generationRequestId,
                },
                conditionExpression: '#revision = :expectedRevision',
                expressionAttributeNames: { '#revision': 'revision' },
                expressionAttributeValues: { ':expectedRevision': request.revision },
            },
            {
                type: 'delete',
                tableName: accessTableName(),
                key: {
                    generationRequestId: request.generationRequestId,
                    principalId: userPrincipalId(request.userId),
                },
            },
            {
                type: 'delete',
                tableName: accessTableName(),
                key: {
                    generationRequestId: request.generationRequestId,
                    principalId: workspacePrincipalId(request.workspaceId),
                },
            },
        ],
        logConditionalCheckFailures: false,
        origin: 'MediaGenerationRequest.delete',
    })
}

export const listWorkspaceMediaGenerationRequests = async (workspaceId: string): Promise<MediaGenerationRequestMeta[]> => {
    const result = await dynamoDBService.queryItems({
        tableName: metaTableName(),
        indexName: 'updatedAt',
        keyConditions: { workspaceId },
        limit: 100,
        fetchAllItems: true,
        scanIndexForward: false,
        consistentRead: true,
        origin: 'MediaGenerationRequest.listWorkspace',
    })

    return (result?.items ?? []) as MediaGenerationRequestMeta[]
}

export const deleteWorkspaceMediaGenerationRequests = async (workspaceId: string): Promise<MediaGenerationRequest[]> => {
    const metas = await listWorkspaceMediaGenerationRequests(workspaceId)
    const requests = (await Promise.all(
        metas.map(
            meta =>
                getMediaGenerationRequest({
                    generationRequestId: meta.generationRequestId,
                    workspaceId,
                }),
        ),
    )).filter((request): request is MediaGenerationRequest => Boolean(request))

    for (const request of requests) {
        const access = await dynamoDBService.queryItems({
            tableName: accessTableName(),
            keyConditions: { generationRequestId: request.generationRequestId },
            limit: 100,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'MediaGenerationRequest.deleteWorkspace:listAccess',
        })
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'delete',
                    tableName: requestsTableName(),
                    key: {
                        generationRequestId: request.generationRequestId,
                        workspaceId,
                    },
                },
                {
                    type: 'delete',
                    tableName: metaTableName(),
                    key: {
                        workspaceId,
                        generationRequestId: request.generationRequestId,
                    },
                },
                ...(access?.items ?? []).map(
                    (row: MediaGenerationRequestAccessList) => ({
                        type: 'delete' as const,
                        tableName: accessTableName(),
                        key: {
                            generationRequestId: request.generationRequestId,
                            principalId: row.principalId,
                        },
                    }),
                ),
            ],
            origin: 'MediaGenerationRequest.deleteWorkspace',
        })
    }

    return requests
}

const MediaGenerationRequestModel = {
    create: createMediaGenerationRequest,
    get: getMediaGenerationRequest,
    getAuthorized: getAuthorizedMediaGenerationRequest,
    transition: transitionMediaGenerationRequest,
    delete: deleteMediaGenerationRequest,
    listWorkspace: listWorkspaceMediaGenerationRequests,
    deleteWorkspace: deleteWorkspaceMediaGenerationRequests,
}

export default MediaGenerationRequestModel
