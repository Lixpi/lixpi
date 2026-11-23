import { v5 as uuidv5 } from 'uuid'
import { fetchPublicRemoteFile } from '../services/public-remote-file.ts'
import { ingestAssetFile } from '../services/asset-ingest.ts'
import { createHash } from 'node:crypto'
import {
    NATS_SUBJECTS,
    type Asset,
    type AssetRequesterContext,
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import {
    containsCanvasMediaUrl,
    type CanvasAgentAccess,
    type CanvasAgentSession,
} from '@lixpi/capability-system/backend'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
} from '@lixpi/prosemirror'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'
import { warn } from '@lixpi/debug-tools'

import AssetModel, {
    getWorkspaceMutationOperations,
    publishAssetEvent,
} from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import MediaGenerationRequestModel from '../models/media-generation-request.ts'
import { GeneratedOutputReviewService } from '../services/generated-output-review-service.ts'
import { MediaGenerationRequestService } from '../services/media-generation-request-service.ts'
import { planManagedCanvasRemoval } from './workspace-managed-removal.ts'
import { resolveCanvasPlacement } from './workspace-placement-geometry.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import { AssetProseMirrorStepTransport } from '../prosemirror/asset-prosemirror-step-transport.ts'
import { AccountRequestContext } from '../services/account-request-context.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import {
    isAssetAvailableInWorkspaceScope,
    scopeAssetRequesterToWorkspace,
} from '../services/workspace-reference-scope.ts'
import {
    canvasCollaboration,
    type CanvasAgentSession as CollaborationActor,
} from '../services/canvas-collaboration.ts'
import {
    AgentExecutionScope,
    type AgentExecution,
} from '../llm/agent/agent-execution-scope.ts'
import { AgentToolInvocation } from '../llm/agent/agent-tool-invocation.ts'
import {
    type ConversationOwner,
} from '../llm/agent/conversation-owner.ts'
import {
    apiDocumentKinds,
    documentKindForAsset,
} from '../prosemirror/document-kinds.ts'

const unwrap = <T>(result: T | { error: string }): T => {
    if (
        result
        && typeof result === 'object'
        && 'error' in result
    )
        throw new Error(
            String(result.error),
        )

    return result as T
}

const placementAssetId = (node: CanvasNode): string => {
    if (
        !('assetId' in node)
        || !node.assetId
    )
        throw new Error('CANVAS_NODE_HAS_NO_ASSET')

    return node.assetId
}

const workspaceMutation = (
    canvasState: CanvasState,
    expectedCanvasStateUpdatedAt: number,
) => ({
    canvasState,
    expectedCanvasStateUpdatedAt,
    canvasStateUpdatedAt: Math.max(
        Date.now(),
        expectedCanvasStateUpdatedAt + 1,
    ),
})

const resolveWorkspaceWrite = async <T>(write: () => Promise<T>): Promise<T> => {
    try {
        return await write()
    } catch (error) {
        if (isTransactionConditionalCheckFailure(error))
            throw new Error('STALE_CANVAS_STATE', { cause: error })

        throw error
    }
}

class CanvasAgentAdapter {
    private readonly actors = new WeakMap<ConversationOwner, Promise<CollaborationActor>>()

    readonly access: CanvasAgentAccess = async context => {
        const execution = AgentExecutionScope.current()
        const { owner } = execution
        const {
            userId,
            workspaceId,
            organizationId,
            conversationAssetId,
        } = owner.job

        if (
            context.origin !== 'model'
            || context.userId !== userId
            || context.workspaceId !== workspaceId
            || context.organizationId !== organizationId
            || context.conversationAssetId !== conversationAssetId
        )
            throw new Error('AGENT_CANVAS_SCOPE_DENIED')

        const scope = {
            workspaceId,
            organizationId,
        }
        const requester = async () => {
            const result = scopeAssetRequesterToWorkspace(await getAssetRequesterContext(userId), scope)

            if (
                !result.editableWorkspaceIds.includes(workspaceId)
                || !result.organizationIds.includes(organizationId)
            )
                throw new Error('WORKSPACE_ACCESS_DENIED')

            return result
        }
        const requestId = createHash('sha256').update(
            JSON.stringify([
                workspaceId,
                conversationAssetId,
                context.runId,
                AgentToolInvocation.current(),
            ]),
        ).digest('hex')
        const actor = await this.actor(owner)
        const assertCurrent = async () => {
            owner.abort.signal.throwIfAborted()
            await execution.assertContextCurrent?.()

            return await owner.fences(execution.continuationEpoch)
        }

        const verify = async <T>(work: () => Promise<T>): Promise<T> => {
            await assertCurrent()

            return await work()
        }

        const session: CanvasAgentSession = {
            requestId,
            signal: owner.abort.signal,
            importPublicMedia: async url => {
                if (!containsCanvasMediaUrl(execution.turn.fragment, url))
                    throw new Error('CANVAS_MEDIA_SOURCE_REQUIRED')

                const assetId = uuidv5(`canvas-import:${requestId}:${url}`, uuidv5.URL)
                const lease = await session.acquire(`asset:${assetId}`)

                try {
                    const identity = await requester()
                    const existing = await AssetModel.get({
                        assetId,
                        requester: identity,
                    })

                    if ('error' in existing) {
                        if (existing.error !== 'NOT_FOUND')
                            throw new Error(existing.error)

                        await assertCurrent()
                        const remote = await fetchPublicRemoteFile(url)
                        await assertCurrent()
                        await ingestAssetFile({
                            assetId,
                            workspaceId,
                            organizationId,
                            ownerUserId: userId,
                            ...remote,
                            withAssetWrite: write => canvasCollaboration.withAgentLease(
                                actor,
                                lease,
                                write,
                                assertCurrent,
                            ),
                        })
                    }

                    execution.createdAssetIds.add(assetId)

                    return { assetId }
                } finally {
                    await session.release(lease)
                }
            },
            inspect: async () => await verify(async () => await canvasCollaboration.syncAgentCanvas(actor)),
            updatePresence: async presence => await verify(async () => await canvasCollaboration.updateAgentPresence(actor, presence)),
            follow: async actorId => await verify(async () => await canvasCollaboration.followAsAgent(actor, actorId)),
            acquire: async target => await verify(
                async () => await canvasCollaboration.acquireAgentLease(
                    actor,
                    target,
                    createHash('sha256').update(
                        JSON.stringify([requestId, target]),
                    ).digest('hex'),
                    owner.abort.signal,
                ),
            ),
            release: async lease => await canvasCollaboration.releaseAgentLease(actor, lease),
            commit: async (
                revision,
                changes,
                leases,
            ) => await verify(
                async () => await canvasCollaboration.commitAgent(
                    actor,
                    {
                        requestId,
                        baseCanvasRevision: revision,
                        changes,
                        leases: Object.fromEntries(
                            leases.map(lease => [lease.target, lease.leaseId]),
                        ),
                    },
                    assertCurrent,
                ),
            ),
            createDocument: async (
                {
                    node,
                    state,
                    revision,
                    leases,
                },
                title,
                doc,
            ) => {
                const assetId = placementAssetId(node)

                await resolveWorkspaceWrite(
                    async () => await canvasCollaboration.withAgentLeases(
                        actor,
                        leases,
                        async () => {
                            const engine = new HeadlessProseMirrorEngine({
                                registry: apiDocumentKinds(),
                                kindId: DOCUMENT_TYPE.ASSET_CONTENT,
                                doc,
                            })
                            engine.doc.check()
                            const bytes = Buffer.from(
                                JSON.stringify(
                                    engine.snapshot(),
                                ),
                                'utf8',
                            )
                            const blob = await BlobModel.store({
                                organizationId,
                                bytes,
                                mimeType: 'application/json',
                                description: `Initial content snapshot for Asset ${assetId}`,
                            })
                            const prepared = await AssetModel.prepareCreate({
                                assetId,
                                organizationId,
                                title,
                                scope: 'workspace',
                                scopeOwnerId: workspaceId,
                                originWorkspaceId: workspaceId,
                                ownerUserId: userId,
                                documents: {
                                    content: {
                                        role: 'content',
                                        blobHash: blob.blobHash,
                                        version: 0,
                                        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                                        byteSize: bytes.byteLength,
                                        updatedAt: Date.now(),
                                    },
                                },
                                workspaceReference: {
                                    workspaceId,
                                    nodeIds: [node.nodeId],
                                    surfaceIds: [`document#${assetId}`],
                                },
                            })
                            const operations = await getWorkspaceMutationOperations({
                                workspaceId,
                                assetId,
                                nodeId: node.nodeId,
                                operation: 'attach',
                                mutation: workspaceMutation(state, revision),
                            })
                            await dynamoDBService.transactWrite({
                                operations: [...prepared.operations, ...operations],
                                origin: 'CanvasAgentAdapter.createDocument',
                            })
                            publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.CREATED, prepared.asset)
                            execution.createdAssetIds.add(assetId)
                        },
                        assertCurrent,
                    ),
                )
            },
            resolvePlacement: resolveCanvasPlacement,
            prepareManagedRemoval: async (state, node) => {
                const identity = await requester()
                const asset = 'generatedBy' in node
                    && node.generatedBy
                    ? await this.asset(
                        node.assetId,
                        identity,
                        execution,
                    )
                    : undefined
                const plan = planManagedCanvasRemoval(
                    state,
                    node,
                    asset,
                )

                if (!plan)
                    return undefined

                return {
                    targets: plan.targets,
                    execute: async leases => await resolveWorkspaceWrite(
                        async () => await canvasCollaboration.withAgentLeases(
                            actor,
                            leases,
                            async () => {
                                const current = await requester()

                                if ('scope' in plan) {
                                    unwrap(
                                        await new GeneratedOutputReviewService().review({
                                            request: {
                                                workspaceId,
                                                scope: plan.scope,
                                                action: 'reject',
                                                nodeId: node.nodeId,
                                            },
                                            requester: current,
                                        }),
                                    )

                                    return true
                                }

                                const request = await MediaGenerationRequestModel.getAuthorized({
                                    workspaceId,
                                    userId,
                                    generationRequestId: plan.generationRequestId,
                                })

                                if (
                                    'error' in request
                                    && request.error === 'NOT_FOUND'
                                )
                                    return false

                                const active = unwrap(request)

                                if (['completed', 'completed-with-errors', 'failed', 'cancelled'].includes(active.status))
                                    return false

                                await new MediaGenerationRequestService().cancel({
                                    workspaceId,
                                    userId,
                                    generationRequestId: plan.generationRequestId,
                                    requestRevision: plan.requestRevision ?? active.revision,
                                })

                                return true
                            },
                            assertCurrent,
                        ),
                    ),
                }
            },
            attachAsset: async ({
                node,
                state,
                revision,
                leases,
            }) => {
                const assetId = placementAssetId(node)
                const current = await session.inspect()

                if (!current.canvasState?.nodes.some(item => 'assetId' in item && item.assetId === assetId))
                    await AgentExecutionScope.assertReadTargets([assetId])

                await resolveWorkspaceWrite(
                    async () => await canvasCollaboration.withAgentLeases(
                        actor,
                        leases,
                        async () => unwrap(
                            await AssetModel.attachWorkspaceReference({
                                assetId,
                                workspaceId,
                                nodeId: node.nodeId,
                                requester: await requester(),
                                workspaceMutation: workspaceMutation(state, revision),
                            }),
                        ),
                        assertCurrent,
                    ),
                )
            },
            detachAsset: async ({
                node,
                state,
                revision,
                leases,
            }) => {
                await resolveWorkspaceWrite(
                    async () => await canvasCollaboration.withAgentLeases(
                        actor,
                        leases,
                        async () => unwrap(
                            await AssetModel.detachWorkspaceReference({
                                assetId: placementAssetId(node),
                                workspaceId,
                                nodeId: node.nodeId,
                                requester: await requester(),
                                workspaceMutation: workspaceMutation(state, revision),
                            }),
                        ),
                        assertCurrent,
                    ),
                )
            },
            replaceAsset: async ({
                nodeId,
                previousAssetId,
                assetId,
                revision,
                leases,
            }) => {
                const current = await session.inspect()

                if (!current.canvasState?.nodes.some(node => 'assetId' in node && node.assetId === assetId))
                    await AgentExecutionScope.assertReadTargets([assetId])

                await resolveWorkspaceWrite(
                    async () => await canvasCollaboration.withAgentLeases(
                        actor,
                        leases,
                        async () => unwrap(
                            await AssetModel.replaceCanvasPlacement({
                                workspaceId,
                                nodeId,
                                previousAssetId,
                                assetId,
                                expectedCanvasStateUpdatedAt: revision,
                                requester: await requester(),
                            }),
                        ),
                        assertCurrent,
                    ),
                )
            },
            readAsset: async assetId => await this.asset(
                assetId,
                await requester(),
                execution,
            ),
            renameAsset: async (
                assetId,
                title,
                expectedRevision,
                lease,
            ) => await canvasCollaboration.withAgentLeases(
                actor,
                [lease],
                async () => unwrap(await AssetModel.updateMetadata({
                    assetId,
                    requester: await requester(),
                    expectedRevision,
                    title,
                })),
                assertCurrent,
            ),
            readDocument: async (assetId, role) => {
                const asset = await this.asset(
                    assetId,
                    await requester(),
                    execution,
                )
                const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, role)

                if (!snapshot)
                    throw new Error('DOCUMENT_ROLE_NOT_FOUND')

                return {
                    doc: snapshot.doc,
                    version: snapshot.version,
                }
            },
            editDocument: async (
                assetId,
                role,
                expectedVersion,
                prepare,
                lease,
            ) => {
                const identity = await requester()
                const asset = await this.asset(
                    assetId,
                    identity,
                    execution,
                )
                const holderId = `canvas-agent:${actor.sessionId}:${requestId}`
                const editLease = unwrap(await AssetModel.acquireLease({
                    assetId,
                    workspaceId,
                    requester: identity,
                    holderId,
                }))

                if (!editLease)
                    throw new Error('LEASE_INVALID')

                const release = AccountRequestContext.prepareCleanup(async () => {
                    try {
                        await AssetModel.releaseLease({
                            assetId,
                            workspaceId,
                            leaseId: editLease.leaseId,
                            holderId,
                        })
                    } catch (error) {
                        warn('Canvas agent Asset lease release failed', error)
                    }
                })

                try {
                    const current = await AssetDocumentService.loadCurrentSnapshot(asset, role)

                    if (!current)
                        throw new Error('DOCUMENT_ROLE_NOT_FOUND')

                    if (current.version !== expectedVersion) {
                        const replay = await AssetProseMirrorStepTransport.fromSingleton().replay(
                            {
                                organizationId,
                                assetId,
                                role,
                            },
                            1,
                            10000,
                        )
                        const accepted = replay.find(event => event.kind === 'STEP' && event.msgId === requestId)

                        if (accepted)
                            return {
                                doc: current.doc,
                                version: accepted.version,
                            }

                        throw new Error('CANVAS_DOCUMENT_VERSION_CONFLICT')
                    }

                    const engine = new HeadlessProseMirrorEngine({
                        registry: apiDocumentKinds(),
                        kindId: documentKindForAsset(asset, role),
                        doc: current.doc,
                        version: current.version,
                    })
                    const prepared = prepare(engine)

                    if (!prepared)
                        return {
                            doc: current.doc,
                            version: current.version,
                        }

                    await AssetDocumentService.assertValidLiveEdit({
                        asset,
                        role,
                        before: prepared.before,
                        after: prepared.after,
                        requester: identity,
                    })
                    const settlement = {
                        assetId,
                        organizationId,
                        role,
                        workspaceId,
                        leaseId: editLease.leaseId,
                        holderId,
                        requester: identity,
                    }
                    const result = await canvasCollaboration.withAgentDocumentPublish(
                        actor,
                        lease,
                        async () => {
                            await assertCurrent()

                            return unwrap(
                                await AssetDocumentService.submitSteps({
                                    requester: identity,
                                    payload: {
                                        ...settlement,
                                        baseVersion: asset.documents[role]?.version ?? 0,
                                        expectedVersion,
                                        steps: [{
                                            step: prepared.step,
                                            msgId: requestId,
                                            clientId: holderId,
                                        }],
                                    },
                                }),
                            )
                        },
                    )

                    if (result.status !== 'ACCEPTED')
                        throw new Error('CANVAS_DOCUMENT_VERSION_CONFLICT')

                    await AssetDocumentService.settle(settlement)

                    return {
                        doc: prepared.after,
                        version: result.version,
                    }
                } finally {
                    await release()
                }
            },
        }

        return session
    }

    private async actor(owner: ConversationOwner): Promise<CollaborationActor> {
        const existing = this.actors.get(owner)

        if (existing)
            return await existing

        const actor = {
            workspaceId: owner.job.workspaceId,
            userId: owner.job.userId,
            sessionId: owner.ownerId,
            name: 'Canvas agent',
        }
        const signal = owner.abort.signal
        signal.throwIfAborted()
        const leave = AccountRequestContext.prepareCleanup(async () => {
            try {
                await canvasCollaboration.leaveAgent(actor)
            } catch (error) {
                warn('Canvas agent departure failed', error)
            }
        })
        const renew = async () => {
            try {
                await canvasCollaboration.syncAgentCanvas(actor)
            } catch (error) {
                warn('Canvas agent heartbeat failed', error)
            }
        }
        const joined = (async () => {
            await canvasCollaboration.joinAgent(actor)

            if (signal.aborted) {
                await leave()
                signal.throwIfAborted()
            }

            const heartbeat = setInterval(() => void renew(), 20_000)
            heartbeat.unref()
            signal.addEventListener(
                'abort',
                () => {
                    clearInterval(heartbeat)
                    void leave()
                },
                { once: true },
            )

            return actor
        })()
        this.actors.set(owner, joined)

        try {
            return await joined
        } catch (error) {
            this.actors.delete(owner)

            throw error
        }
    }

    private async asset(
        assetId: string,
        requester: AssetRequesterContext,
        execution: AgentExecution,
    ): Promise<Asset> {
        const asset = unwrap(await AssetModel.get({
            assetId,
            requester,
            origin: 'CanvasAgentAdapter.asset',
        }))

        if (!isAssetAvailableInWorkspaceScope(asset, execution.owner.job))
            throw new Error('NOT_FOUND')

        return asset
    }
}

export const canvasAgentAccess = new CanvasAgentAdapter().access
