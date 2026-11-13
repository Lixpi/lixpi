import {
    getDynamoDbTableStageName,
    getNatsUserSubjectToken,
    NATS_SUBJECTS,
    type ConversationEvent,
    type ConversationReference,
    type ConversationSourceSnapshot,
} from '@lixpi/constants'
import { warn } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { PROSEMIRROR_SCHEMA_VERSION } from '@lixpi/prosemirror'
import { canEditWorkspace } from '../../services/workspace-navigation/access.ts'
import Workspace from '../../models/workspace.ts'
import AssetModel, {
    publishAssetEvent,
    getAssetRecord,
} from '../../models/asset.ts'
import BlobModel, { buildBlobReferenceBatchOperations } from '../../models/blob.ts'
import { AccountRequestContext } from '../../services/account-request-context.ts'
import {
    workspaceAccessResolver,
    workspaceTreeRepository,
} from '../../services/workspace-tree.ts'
import { ConversationDispatcher } from './conversation-dispatcher.ts'
import { ConversationMigration } from './conversation-migration.ts'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    ConversationService,
    conversationServiceClock,
    type ConversationAccess,
    type ConversationServicePorts,
} from './conversation-service.ts'

const tableName = (key: string): string => getDynamoDbTableStageName(
    key,
    process.env.ORG_NAME!,
    process.env.STAGE!,
)

export const conversationEventSubject = (
    userId: string,
    workspaceId: string,
    conversationAssetId: string,
): string => `${NATS_SUBJECTS.CONVERSATION_SUBJECTS.STATUS}.${getNatsUserSubjectToken(userId)}.${workspaceId}.${conversationAssetId}`

export class ConversationAdapters {
    constructor(private readonly repository: ConversationRepository) {}

    service(): ConversationService {
        const ports: ConversationServicePorts = {
            ...conversationServiceClock,
            migrate: async access => (await new ConversationMigration(this.repository).migrateWorkspace(access)).complete,
            title: async meta => {
                if (!meta.activated)
                    return undefined

                const asset = await getAssetRecord(meta.conversationAssetId)

                return asset?.organizationId === meta.organizationId
                    && asset.originWorkspaceId === meta.workspaceId
                    ? asset.title
                    : undefined
            },
            authorize: this.authorize,
            resolveReferences: this.resolveReferences,
            retainReferences: async (
                access,
                conversationAssetId,
                turn,
            ) => {
                const additions = []
                const fences = new Map()

                for (const [index, source] of turn.references.entries()) {
                    if (!source.blobHash)
                        throw new Error('CONVERSATION_SOURCE_UNAVAILABLE')

                    const blob = await BlobModel.get({
                        organizationId: access.organizationId,
                        blobHash: source.blobHash,
                    })

                    if (!blob)
                        throw new Error('CONVERSATION_SOURCE_UNAVAILABLE')

                    additions.push({
                        blob,
                        reference: {
                            blobKey: blob.blobKey,
                            blobHash: blob.blobHash,
                            organizationId: access.organizationId,
                            referenceKey: `asset#${conversationAssetId}#turn#${turn.turnId}#source#${index}`,
                            ownerType: 'asset' as const,
                            ownerId: conversationAssetId,
                            createdAt: Date.now(),
                        },
                    })
                    fences.set(
                        source.assetId,
                        {
                            type: 'check' as const,
                            tableName: tableName('ASSETS'),
                            key: { assetId: source.assetId },
                            conditionExpression: '#revision = :revision AND #organization = :organization',
                            expressionAttributeNames: {
                                '#revision': 'revision',
                                '#organization': 'organizationId',
                            },
                            expressionAttributeValues: {
                                ':revision': source.revision,
                                ':organization': access.organizationId,
                            },
                        },
                    )
                }

                return [...fences.values(), ...buildBlobReferenceBatchOperations({ additions }).operations]
            },
            activate: async (meta, operations) => {
                const bytes = Buffer.from(
                    JSON.stringify({
                        type: 'doc',
                        content: [{
                            type: 'aiChatThread',
                            attrs: { threadId: meta.conversationAssetId },
                            content: [],
                        }],
                    }),
                )
                const blob = await BlobModel.store({
                    organizationId: meta.organizationId,
                    bytes,
                    mimeType: 'application/json',
                    description: 'Conversation document',
                })
                const prepared = await AssetModel.prepareCreate({
                    assetId: meta.conversationAssetId,
                    organizationId: meta.organizationId,
                    title: meta.title,
                    scope: 'workspace',
                    scopeOwnerId: meta.workspaceId,
                    originWorkspaceId: meta.workspaceId,
                    ownerUserId: meta.ownerUserId,
                    conversationRuntime: 'deep-agents',
                    documents: {
                        conversation: {
                            role: 'conversation',
                            blobHash: blob.blobHash,
                            version: 0,
                            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                            byteSize: bytes.byteLength,
                            updatedAt: meta.updatedAt,
                        },
                    },
                    workspaceReference: {
                        workspaceId: meta.workspaceId,
                        nodeIds: [],
                        surfaceIds: [`conversation:${meta.conversationAssetId}`],
                    },
                })
                // Acceptance already fences this workspace's organization,
                // the grant it was authorized by, its ancestors and its
                // deletion state in the same transaction.
                await this.repository.commit([
                    ...prepared.operations.filter(operation => operation.tableName !== tableName('WORKSPACES')),
                    ...operations,
                ])
                publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.CREATED, prepared.asset)
            },
            publish: this.publish,
            dispatchScheduled: dueAt => ConversationDispatcher.scheduled(dueAt),
        }

        return new ConversationService(this.repository, ports)
    }

    readonly authorize = async (
        workspaceId: string,
        userId: string,
        write: boolean,
    ): Promise<ConversationAccess> => {
        const workspace = await Workspace.getWorkspace({
            workspaceId,
            userId,
        })

        if (
            'error' in workspace
            || workspace.deletingAt
        )
            throw new Error('CONVERSATION_WORKSPACE_ACCESS_DENIED')

        if (
            write
            && !canEditWorkspace(workspace.accessLevel)
        )
            throw new Error('CONVERSATION_WORKSPACE_ACCESS_DENIED')

        AccountRequestContext.assertActive()
        const account = AccountRequestContext.workContext()

        return {
            userId,
            organizationId: workspace.organizationId,
            workspaceId,
            ...(account ? { account } : {}),
            // A revoked or changed grant, a move or a deletion of this
            // workspace or an ancestor fences out later agent writes.
            fences: workspaceTreeRepository().accessFenceOperations({
                userId,
                workspaceId,
                organizationId: workspace.organizationId,
                grant: workspace.accessGrant,
            }),
        }
    }

    readonly resolveReferences = async (
        access: ConversationAccess,
        references: ConversationReference[],
    ): Promise<ConversationSourceSnapshot[]> => {
        const sources: ConversationSourceSnapshot[] = []

        for (const reference of references) {
            const asset = await AssetModel.get({
                assetId: reference.assetId,
                requester: {
                    userId: access.userId,
                    workspaceIds: [access.workspaceId],
                    editableWorkspaceIds: [],
                    organizationIds: [access.organizationId],
                },
            })

            if (
                'error' in asset
                || asset.organizationId !== access.organizationId
                || asset.states.lifecycle === 'deleting'
            )
                throw new Error('CONVERSATION_SOURCE_UNAVAILABLE')

            if (
                reference.revision !== undefined
                && reference.revision !== asset.revision
            )
                throw new Error('CONVERSATION_SOURCE_CONFLICT')

            const pointer = reference.role === 'media'
                ? Object.values(asset.media?.renditions ?? {}).find(rendition => rendition?.name === (reference.renditionId ?? 'original'))
                : asset.documents[reference.role === 'artifact' ? 'capabilityArtifact' : reference.role]

            if (
                !pointer?.blobHash
                || ('status' in pointer && pointer.status !== 'ready')
            )
                throw new Error('CONVERSATION_SOURCE_UNAVAILABLE')

            sources.push({
                ...reference,
                revision: asset.revision,
                blobHash: pointer.blobHash,
                ...('version' in pointer ? { documentVersion: pointer.version } : {}),
                acquiredBy: 'explicit',
                relationshipPath: [reference.assetId],
            })
        }

        return sources
    }

    readonly publish = async (event: ConversationEvent): Promise<void> => {
        try {
            const workspace = await workspaceTreeRepository().getWorkspaceMeta(event.workspaceId)

            if (
                !workspace
                || workspace.deletingAt
            )
                return

            // Everyone with a grant on this workspace or an ancestor can open
            // its conversations, so each of them receives the event.
            for (const userId of await workspaceAccessResolver().listUsersWithAccess(workspace))
                NATS_Service.getInstance()?.publish(
                    conversationEventSubject(
                        userId,
                        event.workspaceId,
                        event.conversationAssetId,
                    ),
                    event,
                )
        } catch (error) {
            // The durable event remains available for replay after a disconnect.
            warn('Conversation event delivery deferred to replay', error)
        }
    }
}
