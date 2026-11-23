import { createHash } from 'node:crypto'
import {
    AGENT_CONVERSATION_PROTOCOL_VERSION,
    type ConversationTurn,
} from '@lixpi/constants'
import {
    type CanvasComposerAccess,
} from '@lixpi/capability-system/backend'
import { collectProseMirrorPromptReferences } from '@lixpi/prosemirror/shared/thread-doc'
import AiModel from '../models/ai-model.ts'
import AssetModel from '../models/asset.ts'
import Workspace from '../models/workspace.ts'
import { AgentConfiguration } from '../llm/agent/agent-configuration.ts'
import { AgentDelegation } from '../llm/agent/agent-delegation.ts'
import {
    AgentExecutionScope,
    AgentReadTargetNotInContext,
    type AgentExecution,
} from '../llm/agent/agent-execution-scope.ts'
import { AgentToolInvocation } from '../llm/agent/agent-tool-invocation.ts'
import { ConversationAdapters } from '../llm/agent/conversation-adapters.ts'
import {
    assertConversationId,
    ConversationProtocol,
} from '../llm/agent/conversation-protocol.ts'
import {
    conversationPartition,
    ConversationRepository,
    type ConversationMeta,
} from '../llm/agent/conversation-repository.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import { canvasLeaseTransaction } from '../services/canvas-collaboration-transaction.ts'
import { scopeAssetRequesterToWorkspace } from '../services/workspace-reference-scope.ts'
import { canvasAgentAccess } from './canvas-agent-adapter.ts'

const ancestry = async (
    execution: AgentExecution,
    repository: ConversationRepository,
): Promise<string[]> => {
    const {
        organizationId,
        conversationAssetId,
    } = execution.owner.job
    const chain = [conversationAssetId]
    let parent = execution.turn.delegation

    while (parent) {
        if (
            chain.includes(parent.parentConversationAssetId)
            || chain.length >= 64
        )
            throw new Error('CANVAS_COMPOSER_DISPATCH_ANCESTRY_INVALID')

        const pk = conversationPartition(organizationId, parent.parentConversationAssetId)
        const [meta, turn] = await Promise.all([
            repository.read<ConversationMeta>(pk, 'META'),
            repository.read<ConversationTurn>(pk, `TURN#${parent.parentTurnId}`),
        ])

        if (
            !meta
            || meta.workspaceId !== parent.parentWorkspaceId
            || !turn
        )
            throw new Error('CANVAS_COMPOSER_DISPATCH_ANCESTRY_INVALID')

        chain.push(parent.parentConversationAssetId)
        parent = turn.delegation
    }

    return chain
}

export const canvasComposerAccess: CanvasComposerAccess = async context => {
    const execution = AgentExecutionScope.current()
    const {
        owner,
        continuationEpoch,
    } = execution
    const {
        userId,
        workspaceId,
        organizationId,
        conversationAssetId,
    } = owner.job
    const scope = {
        workspaceId,
        organizationId,
    }
    const meta = await owner.read()

    if (
        context.origin !== 'model'
        || context.userId !== userId
        || context.workspaceId !== workspaceId
        || context.organizationId !== organizationId
        || context.conversationAssetId !== conversationAssetId
        || context.runId !== meta.run?.runId
    )
        throw new Error('AGENT_CANVAS_COMPOSER_SCOPE_DENIED')

    const requestId = createHash('sha256')
        .update(
            JSON.stringify([workspaceId, conversationAssetId, context.runId, AgentToolInvocation.current()]),
        )
        .digest('hex')
    const repository = new ConversationRepository()
    const service = new ConversationAdapters(repository).service()
    const protocol = new ConversationProtocol()
    const base = {
        protocolVersion: AGENT_CONVERSATION_PROTOCOL_VERSION,
        workspaceId,
    } as const

    const sourceFences = async () => {
        owner.abort.signal.throwIfAborted()
        await execution.assertContextCurrent?.()

        return await owner.fences(continuationEpoch)
    }

    const inspect = async <T>(read: () => Promise<T>): Promise<T> => {
        await sourceFences()

        return await read()
    }

    const write = async <T>(command: () => Promise<T>): Promise<T> => {
        await sourceFences()

        return await canvasLeaseTransaction.run(sourceFences, command)
    }

    const readConversation = async (targetId: string) =>
        await inspect(
            async () => await service.get(
                protocol.parse(
                    'get',
                    {
                        ...base,
                        conversationAssetId: targetId,
                    },
                ),
                userId,
            ),
        )

    return {
        conversationAssetId,
        requestId,
        signal: owner.abort.signal,
        listConversations: async cursor => await inspect(
            async () => await service.list(
                protocol.parse(
                    'list',
                    {
                        ...base,
                        ...(cursor !== undefined ? { cursor } : {}),
                    },
                ),
                userId,
            ),
        ),
        readConversation,
        readMessages: async (targetId, cursor) => await inspect(
            async () => await service.messages(
                protocol.parse(
                    'messages',
                    {
                        ...base,
                        conversationAssetId: targetId,
                        ...(cursor !== undefined ? { cursor } : {}),
                    },
                ),
                userId,
            ),
        ),
        readModelCatalog: async () => await inspect(AiModel.getAvailableAiModels),
        dispatchAncestry: async () => await inspect(async () => await ancestry(execution, repository)),
        readTurnOrigin: async (targetId, turnId) => {
            await readConversation(targetId)
            assertConversationId(turnId)

            const turn = await repository.read<ConversationTurn>(
                conversationPartition(organizationId, targetId),
                `TURN#${turnId}`,
            )

            return turn?.delegation ? { dispatchedBy: turn.delegation.parentConversationAssetId } : undefined
        },
        createConversation: async settings => await write(
            async () => await service.create(
                protocol.parse(
                    'create',
                    {
                        ...base,
                        clientConversationId: requestId,
                        settings,
                    },
                ),
                userId,
            ),
        ),
        updateSettings: async (
            targetId,
            expectedRevision,
            patch,
        ) => await write(
            async () => await service.settings(
                protocol.parse(
                    'settings',
                    {
                        ...base,
                        conversationAssetId: targetId,
                        expectedRevision,
                        patch,
                    },
                ),
                userId,
            ),
        ),
        renameConversation: async (targetId, title) => {
            await readConversation(targetId)

            const requester = scopeAssetRequesterToWorkspace(await getAssetRequesterContext(userId), scope)
            const asset = await AssetModel.get({
                assetId: targetId,
                requester,
            })

            if (
                'error' in asset
                || asset.originWorkspaceId !== workspaceId
                || asset.organizationId !== organizationId
            )
                throw new Error('CONVERSATION_NOT_FOUND')

            const canvas = await canvasAgentAccess(context)
            const lease = await canvas.acquire(`asset:${targetId}`)

            try {
                await canvas.renameAsset(
                    targetId,
                    title,
                    asset.revision,
                    lease,
                )
            } finally {
                await canvas.release(lease)
            }

            return await readConversation(targetId)
        },
        dispatchMessage: async dispatch => {
            const parsed = protocol.parse(
                'submit',
                {
                    ...base,
                    ...dispatch,
                    clientMessageId: requestId,
                    midRunPolicy: 'queue',
                },
            )

            const references = [...parsed.references]
            const attached = new Set(
                references.map(reference => reference.assetId),
            )

            for (const reference of collectProseMirrorPromptReferences(parsed.fragment)) {
                if (
                    !('assetId' in reference)
                    || attached.has(reference.assetId)
                )
                    continue

                attached.add(reference.assetId)
                references.push({
                    assetId: reference.assetId,
                    role: reference.referenceType === 'capability-artifact' ? 'artifact' : 'media',
                })
            }

            const request = protocol.parse(
                'submit',
                {
                    ...parsed,
                    references,
                },
            )

            if ((await ancestry(execution, repository)).includes(request.conversationAssetId))
                throw new Error('CANVAS_COMPOSER_RECURSIVE_DISPATCH')

            await readConversation(request.conversationAssetId)
            const workspace = await Workspace.getWorkspace({
                workspaceId,
                userId,
            })

            if (
                'error' in workspace
                || workspace.deletingAt
                || workspace.organizationId !== organizationId
            )
                throw new Error('WORKSPACE_ACCESS_DENIED')

            const placedAssets = new Set(
                workspace.canvasState.nodes.flatMap(
                    node => 'assetId' in node
                        && node.assetId
                        ? [node.assetId]
                        : [],
                ),
            )

            try {
                await AgentExecutionScope.assertReadTargets(
                    request.references.filter(reference => !placedAssets.has(reference.assetId)).map(reference => reference.assetId),
                )
            } catch (error) {
                if (error instanceof AgentReadTargetNotInContext)
                    throw new Error('CANVAS_COMPOSER_SOURCE_NOT_ADMITTED')

                throw error
            }

            const delegation = new AgentDelegation(
                repository,
                new AgentConfiguration(process.env),
                () => service,
            )

            return await write(
                async () => await delegation.dispatchToConversation(
                    owner,
                    request,
                    workspace.name,
                ),
            )
        },
        stopRun: async (targetId, runId) => await write(
            async () => await service.stop(
                protocol.parse(
                    'stop',
                    {
                        ...base,
                        conversationAssetId: targetId,
                        runId,
                        clientCommandId: requestId,
                    },
                ),
                userId,
            ),
        ),
        cancelQueued: async (
            targetId,
            expectedRevision,
            turnIds,
        ) => await write(
            async () => await service.queue(
                protocol.parse(
                    'queue',
                    {
                        ...base,
                        conversationAssetId: targetId,
                        expectedRevision,
                        turnIds,
                        clientCommandId: requestId,
                        action: 'cancel-message',
                    },
                ),
                userId,
            ),
        ),
        resumeQueue: async (targetId, expectedRevision) => await write(
            async () => await service.queue(
                protocol.parse(
                    'queue',
                    {
                        ...base,
                        conversationAssetId: targetId,
                        expectedRevision,
                        turnIds: [],
                        clientCommandId: requestId,
                        action: 'resume',
                    },
                ),
                userId,
            ),
        ),
    }
}
