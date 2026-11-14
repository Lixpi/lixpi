import { DynamicStructuredTool } from '@langchain/core/tools'
import {
    validateJsonSchemaValue,
    type CapabilityAgentEntry,
    type CapabilityAgentRegistration,
    type CapabilityAgentRegistry,
    type CapabilityAgentTool,
} from '@lixpi/capability-system/backend'
import { getAuthorizedCapabilityRecords } from '../../models/capability.ts'
import { AgentExecutionScope } from './agent-execution-scope.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'

// The catalog owns identity and policy. This adapter only authorizes its scoped
// view and translates executable entries to the framework's native Tool type.
export class AgentRegistry {
    private scoped: CapabilityAgentRegistry

    constructor(
        private readonly registered: CapabilityAgentRegistry,
        private readonly owner: ConversationOwner,
        private readonly workflowExperts = false,
        private readonly sealedSkillIds?: ReadonlySet<string>,
    ) {
        this.scoped = registered.scope(entry => entry.owner.kind === 'platform')
    }

    async refresh(): Promise<void> {
        await this.owner.fences()
        const ids = [...new Set(
            this.registered.list().flatMap(
                entry => [
                    ...(entry.owner.kind === 'module' ? [entry.owner.capabilityId] : []),
                    ...(entry.kind === 'skill' ? [entry.capabilityId] : []),
                ],
            ),
        )]
        const records = ids.length ? await getAuthorizedCapabilityRecords({
            capabilityIds: ids,
            requester: {
                userId: this.owner.job.userId,
                organizationIds: [this.owner.job.organizationId],
            },
        }) : new Map()
        this.scoped = this.registered.scope(
            entry => (entry.owner.kind === 'platform' || records.has(entry.owner.capabilityId))
                && (entry.kind !== 'skill' || (records.has(entry.capabilityId)
                    && (!this.sealedSkillIds || this.sealedSkillIds.has(entry.capabilityId))))
                && (entry.kind !== 'expert' || entry.runtime.kind !== 'workflow' || this.workflowExperts),
        )
    }

    view(): CapabilityAgentRegistry {
        return this.scoped
    }

    async authorize(
        name: string,
        input: Readonly<Record<string, unknown>>,
    ): Promise<boolean> {
        const entry = this.scoped.get(name)

        if (
            !entry
            || entry.kind !== 'tool'
        )
            return false

        try {
            const execution = AgentExecutionScope.current()
            await execution.assertContextCurrent?.()
            await execution.owner.fences(execution.continuationEpoch)

            if (execution.owner !== this.owner)
                return false

            if (entry.permission === 'private-state') {
                const legacy = execution.permissions.legacyIntent

                if (
                    legacy
                    && !['plan', 'execute'].includes(legacy.intent)
                )
                    return false
            } else
                await AgentExecutionScope.authorize(entry.intent, entry.operationFamilies)

            return !entry.available || (await entry.available(input))
        } catch {
            return false
        }
    }

    tools(): DynamicStructuredTool[] {
        return this.scoped.tools().filter((entry): entry is CapabilityAgentEntry & CapabilityAgentTool & { kind: 'tool' } => 'execute' in entry).map(
            spec => new DynamicStructuredTool({
                name: spec.name,
                description: spec.description,
                verboseParsingErrors: true,
                schema: structuredClone(spec.schema) as ConstructorParameters<typeof DynamicStructuredTool>[0]['schema'],
                func: async input => {
                    if (!validateJsonSchemaValue(spec.schema, input).valid)
                        throw new Error('AGENT_TOOL_INPUT_INVALID')

                    await this.refresh()

                    if (!await this.authorize(spec.name, input))
                        throw new Error('AGENT_TOOL_SCOPE_DENIED')

                    const result = await spec.execute(input, await AgentExecutionScope.actionContext(spec.name))

                    return typeof result === 'string' ? result : JSON.stringify(result)
                },
            }),
        )
    }
}

export const agentToolRegistration = (
    tool: DynamicStructuredTool,
    policy: Pick<CapabilityAgentTool, 'intent' | 'operationFamilies' | 'permission' | 'available'>,
): CapabilityAgentRegistration => ({
    kind: 'tool',
    name: tool.name,
    description: tool.description,
    schema: tool.schema as Record<string, unknown>,
    ...policy,
    execute: async input => await tool.invoke(input),
})

export const agentNativeToolRegistrations = (): CapabilityAgentRegistration[] => [
    ...['read_file', 'ls', 'glob', 'grep'].map(
        name => ({
            kind: 'tool' as const,
            native: true as const,
            name,
            description: 'Read this invocation\'s sealed Skills and private scratch files.',
            schema: {},
            intent: 'inspect' as const,
            operationFamilies: [],
        }),
    ),
    ...['write_file', 'edit_file', 'write_todos'].map(
        name => ({
            kind: 'tool' as const,
            native: true as const,
            name,
            description: 'Update private planning state within this invocation.',
            schema: {},
            intent: 'plan' as const,
            permission: 'private-state' as const,
            operationFamilies: [],
        }),
    ),
]
