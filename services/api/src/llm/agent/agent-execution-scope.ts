import { AsyncLocalStorage } from 'node:async_hooks'
import {
    type AssetDocumentPointer,
    type ConversationTurn,
} from '@lixpi/constants'
import {
    type CapabilityActionAuthorizationContext,
} from '@lixpi/capability-system/backend'
import {
    type ConversationOwner,
} from './conversation-owner.ts'

// Saved classifier decisions still constrain turns and operations started before the agent-first runtime.
export type LegacyAgentIntent = {
    intent: 'chat' | 'inspect' | 'plan' | 'execute'
    operationFamilies: string[]
    targetAssetIds: string[]
    needsClarification: boolean
    question?: string
}

export type AgentExecutionPermissions = {
    readOnly: boolean
    allowedOperationFamilies: readonly string[]
    legacyIntent?: LegacyAgentIntent
}

type OperationAccess = 'inspect' | 'plan' | 'execute'

export type AgentArtifactEdit = {
    previous: Pick<AssetDocumentPointer, 'version' | 'blobHash'>
    next: Pick<AssetDocumentPointer, 'version' | 'blobHash'>
}

export const agentArtifactEditKey = (
    turnId: string,
    assetId: string,
    version: number,
): string => `ARTIFACT_EDIT#${turnId}#${assetId}#${version}`

const accessRank = {
    chat: 0,
    inspect: 1,
    plan: 2,
    execute: 3,
}

export type AgentExecution = {
    owner: ConversationOwner
    turn: ConversationTurn
    permissions: AgentExecutionPermissions
    responseMessageId: string
    continuationEpoch: number
    invocationId?: string
    createdAssetIds: Set<string>
    assertReadTarget?: (assetId: string) => Promise<void>
    assertContextCurrent?: () => Promise<void>
}

export class AgentReadTargetNotInContext extends Error {
    constructor() {
        super('AGENT_READ_TARGET_NOT_IN_CONTEXT')
    }
}

export class AgentExecutionScope {
    private static readonly context = new AsyncLocalStorage<AgentExecution>()

    static async run<T>(
        execution: AgentExecution,
        work: () => Promise<T>,
    ): Promise<T> {
        return await this.context.run(execution, work)
    }

    static current(): AgentExecution {
        const execution = this.context.getStore()

        if (!execution)
            throw new Error('AGENT_EXECUTION_SCOPE_REQUIRED')

        return execution
    }

    static async authorize(
        access: OperationAccess,
        families: readonly string[] = [],
        targets: readonly string[] = [],
    ): Promise<AgentExecution> {
        const execution = this.current()
        const { permissions } = execution
        const legacy = permissions.legacyIntent
        await execution.assertContextCurrent?.()
        await execution.owner.fences(execution.continuationEpoch)

        if (
            access !== 'inspect'
            && permissions.readOnly
        )
            throw new Error('AGENT_EXECUTION_READ_ONLY')

        if (
            legacy
            && accessRank[legacy.intent] < accessRank[access]
        )
            throw new Error('AGENT_INTENT_DOES_NOT_AUTHORIZE_OPERATION')

        if (
            access !== 'inspect'
            && families.some(family => !permissions.allowedOperationFamilies.includes(family))
        )
            throw new Error('AGENT_OPERATION_FAMILY_NOT_AUTHORIZED')

        if (
            legacy
            && access === 'execute'
            && families.some(family => !legacy.operationFamilies.includes(family))
        )
            throw new Error('AGENT_OPERATION_FAMILY_NOT_AUTHORIZED')

        if (
            legacy
            && access !== 'inspect'
            && targets.some(assetId => !legacy.targetAssetIds.includes(assetId) && !execution.createdAssetIds.has(assetId))
        )
            throw new Error('AGENT_MUTATION_TARGET_NOT_AUTHORIZED')

        await this.assertTargets(execution, targets)

        return execution
    }

    static async assertReadTargets(targets: readonly string[]): Promise<void> {
        const execution = this.current()
        await execution.assertContextCurrent?.()
        await execution.owner.fences(execution.continuationEpoch)
        await this.assertTargets(execution, targets)
    }

    private static async assertTargets(
        execution: AgentExecution,
        targets: readonly string[],
    ): Promise<void> {
        for (const assetId of targets) {
            if (execution.createdAssetIds.has(assetId))
                continue

            if (execution.assertReadTarget) {
                await execution.assertReadTarget(assetId)

                continue
            }

            if (!execution.turn.references.some(source => source.assetId === assetId))
                throw new AgentReadTargetNotInContext()
        }
    }

    static async actionContext(toolName: string): Promise<CapabilityActionAuthorizationContext> {
        const execution = this.current()
        const meta = await execution.owner.read()

        return {
            userId: execution.owner.job.userId,
            organizationId: execution.owner.job.organizationId,
            workspaceId: execution.owner.job.workspaceId,
            conversationAssetId: execution.owner.job.conversationAssetId,
            rootCapabilityId: toolName,
            runId: meta.run!.runId,
            origin: 'model',
            variant: {
                axis: 'request',
                variantKey: 'request',
            },
        }
    }
}
