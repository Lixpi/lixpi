import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    CapabilityAgentRegistry,
    type CapabilityAgentEntry,
} from '@lixpi/capability-system/backend'
import {
    AgentRegistry,
    agentNativeToolRegistrations,
} from './agent-registry.ts'
import {
    AgentExecutionScope,
    type AgentExecution,
} from './agent-execution-scope.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'
import {
    createAgentPlatformTools,
    type AgentPlatformToolsOptions,
} from './agent-platform-tools.ts'

const denied = vi.hoisted(() => new Set<string>())
vi.mock('../../models/capability.ts', () => ({ getAuthorizedCapabilityRecords: async ({ capabilityIds }: { capabilityIds: string[] }) => new Map(capabilityIds.filter(id => !denied.has(id)).map(id => [id, { capabilityId: id }])) }))
beforeEach(() => denied.clear())

const fixture = async (extra: CapabilityAgentEntry[] = [], workflowExperts = false) => {
    const f = await createConversationExecutionFixture()
    const scope: AgentExecution = {
        owner: f.owner,
        turn: f.turn,
        responseMessageId: 'response',
        continuationEpoch: 0,
        permissions: {
            readOnly: true,
            allowedOperationFamilies: ['image'],
        },
        createdAssetIds: new Set(),
    }
    const registry = new AgentRegistry(new CapabilityAgentRegistry([
        ...agentNativeToolRegistrations().map(entry => ({
            ...entry,
            owner: { kind: 'platform' as const },
        })),
        ...extra,
    ]), f.owner, workflowExperts)
    await registry.refresh()

    return {
        ...f,
        scope,
        registry,
    }
}

// =============================================================================
// INVOCATION POLICY PROJECTION
// =============================================================================

describe('AgentRegistry', () => {
    it('permits private scratch for a read-only invocation but denies workspace mutation', async () => {
        const available = vi.fn(async () => true)
        const f = await fixture([{
            kind: 'tool',
            name: 'generate_image',
            description: 'Generate the requested image.',
            schema: {
                type: 'object',
                properties: {},
            },
            intent: 'execute',
            operationFamilies: ['image'],
            available,
            execute: vi.fn(),
            owner: { kind: 'platform' },
        }])
        await AgentExecutionScope.run(f.scope, async () => {
            expect(await f.registry.authorize('write_file', {})).toBe(true)
            expect(await f.registry.authorize('write_todos', {})).toBe(true)
            expect(await f.registry.authorize('generate_image', {})).toBe(false)
        })
        expect(available).not.toHaveBeenCalled()
    })

    it('preserves old inspect-only scratch restrictions', async () => {
        const f = await fixture()
        f.scope.permissions.legacyIntent = {
            intent: 'inspect',
            operationFamilies: [],
            targetAssetIds: [],
            needsClarification: false,
        }
        await AgentExecutionScope.run(f.scope, async () => {
            expect(await f.registry.authorize('read_file', {})).toBe(true)
            expect(await f.registry.authorize('write_file', {})).toBe(false)
        })
    })

    it('rejects executable tools claiming native private-state authority', () => {
        expect(() => new CapabilityAgentRegistry([{
            kind: 'tool',
            name: 'write_file',
            description: 'Invalid replacement.',
            schema: {},
            intent: 'plan',
            permission: 'private-state',
            operationFamilies: [],
            execute: vi.fn(),
            owner: { kind: 'platform' },
        }])).toThrow('CAPABILITY_AGENT_PRIVATE_STATE_INVALID')
    })

    it('hides workflow experts when no executor is installed', async () => {
        const f = await fixture([{
            kind: 'expert',
            name: 'workflow-expert',
            description: 'Run a compiled graph.',
            operationFamilies: ['image'],
            runtime: {
                kind: 'workflow',
                capabilityId: 'workflow',
                schema: {},
                execution: 'media',
            },
            owner: {
                kind: 'module',
                moduleId: 'workflow',
                capabilityId: 'workflow',
            },
        }])
        expect(f.registry.view().experts()).toEqual([])
    })

    it('hides an inaccessible Skill package and its dependent expert while retaining allowed module tools', async () => {
        const owner = {
            kind: 'module' as const,
            moduleId: 'test-module',
            capabilityId: 'module-entry',
        }
        denied.add('private-skill')
        const f = await fixture([{
            kind: 'tool',
            name: 'module-tool',
            description: 'Read installed state.',
            schema: {},
            intent: 'inspect',
            operationFamilies: [],
            execute: vi.fn(),
            owner,
        }, {
            kind: 'skill',
            name: 'private-skill',
            description: 'Private instructions.',
            capabilityId: 'private-skill',
            bundle: {
                name: 'private-skill',
                files: { instructions: 'SKILL.md' },
            },
            owner,
        }, {
            kind: 'expert',
            name: 'dependent-expert',
            description: 'Requires the private Skill.',
            operationFamilies: ['image'],
            runtime: {
                kind: 'agent',
                instructions: 'Use the Skill.',
                toolNames: ['module-tool'],
                skillIds: ['private-skill'],
            },
            owner,
        }])
        expect(f.registry.view().get('module-tool')).toBeDefined()
        expect(f.registry.view().skills()).toEqual([])
        expect(f.registry.view().experts()).toEqual([])
    })

    it.each([true, false])('discovers workflow arguments only when its executor is bound (%s)', async bound => {
        const schema = {
            type: 'object',
            required: ['prompt'],
            properties: { prompt: { type: 'string' } },
            additionalProperties: false,
        }
        const f = await fixture([{
            kind: 'expert',
            name: 'workflow-expert',
            description: 'Run a compiled graph.',
            operationFamilies: ['image'],
            runtime: {
                kind: 'workflow',
                capabilityId: 'workflow',
                schema,
                execution: 'media',
            },
            owner: {
                kind: 'module',
                moduleId: 'workflow',
                capabilityId: 'workflow',
            },
        }], bound)
        const registrations = createAgentPlatformTools({
            registry: () => f.registry,
            skillTools: [],
            delegationTools: [],
            discover: false,
        } as unknown as AgentPlatformToolsOptions)
        const search = registrations.find(entry => entry.name === 'search_capabilities')!

        if (
            search.kind !== 'tool'
            || !('execute' in search)
        )
            throw new Error('Expected executable discovery tool')

        const result = await search.execute({ query: 'workflow-expert' }, {} as never)
        expect(result).toMatchObject({ data: bound ? [{
            name: 'workflow-expert',
            argumentsSchema: schema,
        }] : [] })
    })

    it('names the invalid field and allowed values without exposing instruction text', async () => {
        const execute = vi.fn(async () => 'accepted')
        const f = await fixture([{
            kind: 'tool',
            name: 'prepare_matrix_sample',
            description: 'Prepare a matrix sample.',
            schema: {
                type: 'object',
                additionalProperties: false,
                required: ['imageSize', 'instruction'],
                properties: {
                    imageSize: { enum: ['1:1', '16:9'] },
                    instruction: { type: 'string' },
                },
            },
            intent: 'inspect',
            operationFamilies: [],
            execute,
            owner: { kind: 'platform' },
        }])
        const tool = f.registry.tools().find(candidate => candidate.name === 'prepare_matrix_sample')

        if (!tool)
            throw new Error('Expected registered tool')

        await AgentExecutionScope.run(f.scope, async () => {
            let invalidError: Error | undefined

            try {
                await tool.invoke({
                    imageSize: 'auto',
                    instruction: 'private prompt material',
                })
            } catch (error) {
                invalidError = error as Error
            }

            expect(invalidError?.message).toContain('#/properties/imageSize/enum')
            expect(invalidError?.message).toContain('["1:1","16:9"]')
            expect(invalidError?.message).not.toContain('private prompt material')
            expect(execute).not.toHaveBeenCalled()
            expect(await tool.invoke({
                imageSize: '16:9',
                instruction: 'private prompt material',
            })).toBe('accepted')
        })
        expect(execute).toHaveBeenCalledOnce()
    })

    it('checks context changes before authorizing native private-state tools', async () => {
        const f = await fixture()
        f.scope.assertContextCurrent = async () => { throw new Error('AGENT_CONTEXT_CHANGED') }
        await AgentExecutionScope.run(f.scope, async () => void expect(await f.registry.authorize('write_file', {})).toBe(false))
    })
})
