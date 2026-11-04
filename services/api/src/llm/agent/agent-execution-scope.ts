import { AsyncLocalStorage } from 'node:async_hooks'
import {
    type ConversationTurn,
} from '@lixpi/constants'
import {
    type CapabilityActionAuthorizationContext,
} from '@lixpi/capability-system/backend'
import {
    type AgentIntent,
} from './agent-harness.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'

export type AgentExecution = {
    owner: ConversationOwner
    turn: ConversationTurn
    intent: AgentIntent
    responseMessageId: string
    continuationEpoch: number
    createdAssetIds: Set<string>
    assertReadTarget?: (assetId: string) => Promise<void>
    assertContextCurrent?: () => Promise<void>
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
        intent: 'inspect' | 'plan' | 'execute',
        families: string[] = [],
        targets: string[] = [],
    ): Promise<AgentExecution> {
        const execution = this.current()
        await execution.assertContextCurrent?.()
        await execution.owner.fences(execution.continuationEpoch)
        const rank = {
            chat: 0,
            inspect: 1,
            plan: 2,
            execute: 3,
        }

        if (rank[execution.intent.intent] < rank[intent])
            throw new Error('AGENT_INTENT_DOES_NOT_AUTHORIZE_OPERATION')

        if (
            intent === 'execute'
            && families.some(family => !execution.intent.operationFamilies.includes(family))
        )
            throw new Error('AGENT_OPERATION_FAMILY_NOT_AUTHORIZED')

        if (
            intent !== 'inspect'
            && targets.some(assetId => !execution.intent.targetAssetIds.includes(assetId) && !execution.createdAssetIds.has(assetId))
        )
            throw new Error('AGENT_MUTATION_TARGET_NOT_AUTHORIZED')

        await this.assertReadTargets(targets)

        return execution
    }

    static async assertReadTargets(targets: string[]): Promise<void> {
        const execution = this.current()
        await execution.assertContextCurrent?.()
        await execution.owner.fences(execution.continuationEpoch)

        for (const assetId of targets) {
            if (execution.createdAssetIds.has(assetId))
                continue

            if (execution.assertReadTarget) {
                await execution.assertReadTarget(assetId)

                continue
            }

            if (!execution.turn.references.some(source => source.assetId === assetId))
                throw new Error('AGENT_READ_TARGET_NOT_IN_CONTEXT')
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
