import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type AgentTurnBudget,
    type ConversationTurnDelegation,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'

const tree = vi.hoisted(() => ({
    metas: new Map<string, Record<string, unknown>>(),
    levels: new Map<string, 'owner' | 'editor' | 'viewer'>(),
    rows: new Map<string, Array<Record<string, unknown>>>(),
}))

vi.mock('../../services/workspace-tree.ts', () => ({
    workspaceTreeRepository: () => ({
        readNavigationFences: async (organizationIds: string[]) => new Map(organizationIds.map(organizationId => [organizationId, {
            locked: false,
            revisionId: 'navigation-1',
        }])),
        getWorkspaceMeta: async (workspaceId: string) => tree.metas.get(workspaceId),
        getWorkspaceMetas: async (workspaceIds: string[]) => workspaceIds.flatMap(id => tree.metas.has(id) ? [tree.metas.get(id)] : []),
        listChildRows: async (_organizationId: string, parentWorkspaceId: string) => tree.rows.get(parentWorkspaceId) ?? [],
    }),
    workspaceAccessResolver: () => ({
        resolve: async ({ workspaceId }: { workspaceId: string }) => tree.levels.has(workspaceId)
            ? {
                status: 'granted',
                grant: { accessLevel: tree.levels.get(workspaceId) },
            }
            : { status: 'denied' },
    }),
}))

import { AgentConfiguration } from './agent-configuration.ts'
import {
    AgentDelegation,
    combineConversationOperations,
} from './agent-delegation.ts'
import { AgentExecutionScope } from './agent-execution-scope.ts'
import {
    type AgentIntent,
} from './agent-harness.ts'
import {
    ConversationRepository,
    conversationPartition,
} from './conversation-repository.ts'
import { narrowDelegatedIntent } from './conversation-runtime.ts'

// =============================================================================
// HARNESS
// =============================================================================

class MemoryDatabase {
    readonly rows = new Map<string, Record<string, unknown>>()

    private key(item: Record<string, unknown>): string {
        return `${item.pk}|${item.sk}`
    }

    readonly getItem = async ({ key }: { key: Record<string, unknown> }) => structuredClone(this.rows.get(this.key(key)))

    readonly queryItems = async (request: {
        keyConditions: { pk: string }
        sortKeyCondition?: { value: string }
    }) => ({
        items: [...this.rows.values()]
            .filter(row => row.pk === request.keyConditions.pk && String(row.sk).startsWith(request.sortKeyCondition?.value ?? ''))
            .sort((left, right) => String(left.sk) < String(right.sk) ? -1 : 1)
            .map(row => structuredClone(row)),
    })

    readonly transactWrite = async ({ operations }: { operations: TransactOperation[] }) => {
        for (const operation of operations) {
            if (operation.type === 'put')
                this.rows.set(this.key(operation.item), structuredClone(operation.item))

            if (operation.type === 'delete')
                this.rows.delete(this.key(operation.key))
        }
    }
}

const configuration = new AgentConfiguration({ AGENT_DELEGATION_WAIT_MS: '1' })

const budget = (overrides: Partial<AgentTurnBudget> = {}): AgentTurnBudget => ({
    modelCalls: 2,
    toolCalls: 3,
    specialistCalls: 0,
    delegationCalls: 0,
    maxModelCalls: 24,
    maxToolCalls: 64,
    maxSpecialistCalls: 4,
    maxDelegationCalls: 8,
    ...overrides,
})

const intent = (overrides: Partial<AgentIntent> = {}): AgentIntent => ({
    intent: 'inspect',
    operationFamilies: [],
    targetAssetIds: [],
    confidence: 1,
    needsClarification: false,
    ...overrides,
})

let database: MemoryDatabase
let repository: ConversationRepository
let service: {
    create: ReturnType<typeof vi.fn>
    submit: ReturnType<typeof vi.fn>
    stopConversationBySystem: ReturnType<typeof vi.fn>
}
let meta: {
    run: {
        runId: string
        turnId: string
        budget: AgentTurnBudget
    }
    epoch: number
}
let events: Array<{
    type: string
    payload: { state?: string }
}>

const childPartition = conversationPartition('org-1', 'child-conversation')

const owner = () => ({
    job: {
        organizationId: 'org-1',
        workspaceId: 'parent',
        conversationAssetId: 'parent-conversation',
        userId: 'user-1',
    },
    partition: conversationPartition('org-1', 'parent-conversation'),
    abort: new AbortController(),
    read: async () => structuredClone(meta),
    fences: async () => [],
    event: async (type: string, payload: { state?: string }) => void events.push({
        type,
        payload,
    }),
    consumeBudget: async (kind: 'delegationCalls') => {
        if (meta.run.budget[kind] >= meta.run.budget.maxDelegationCalls)
            throw new Error(`AGENT_BUDGET_EXHAUSTED:${kind}`)

        meta.run.budget[kind] += 1
    },
    mutate: async (
        change: (current: typeof meta) => typeof meta,
        extra: () => Promise<TransactOperation[]>,
    ) => {
        meta = change(structuredClone(meta))
        await repository.commit(await extra())

        return meta
    },
})

// Finishes the child turn with an answer and the child run's own use.
const finishChild = (
    state: 'completed' | 'failed' | 'stopped',
    used: Partial<AgentTurnBudget> = {},
): void => {
    database.rows.set(`${childPartition}|TURN#child-turn`, {
        pk: childPartition,
        sk: 'TURN#child-turn',
        turnId: 'child-turn',
        state,
    })
    database.rows.set(`${childPartition}|RUN#run-child-turn`, {
        pk: childPartition,
        sk: 'RUN#run-child-turn',
        budget: budget({
            modelCalls: 0,
            toolCalls: 0,
            ...used,
        }),
        ...(state === 'failed'
            ? {
                error: {
                    code: 'AGENT_BUDGET_EXHAUSTED:toolCalls',
                    message: 'limit',
                },
            }
            : {}),
    })
    database.rows.set(`${childPartition}|MESSAGE#1`, {
        pk: childPartition,
        sk: 'MESSAGE#1',
        turnId: 'child-turn',
        role: 'assistant',
        text: 'The storyboard has six shots.',
    })
}

const delegate = async (
    delegation: AgentDelegation,
    currentOwner: ReturnType<typeof owner>,
    input: {
        workspaceId: string
        instruction: string
        access: 'read' | 'act'
    },
    executionIntent = intent(),
): Promise<Record<string, any>> => JSON.parse(await AgentExecutionScope.run(
    {
        owner: currentOwner as never,
        turn: { turnId: 'parent-turn' } as never,
        intent: executionIntent,
        responseMessageId: 'response-1',
        continuationEpoch: 0,
        createdAssetIds: new Set(),
    },
    async () => await delegation.delegate(currentOwner as never, input),
))

beforeEach(() => {
    database = new MemoryDatabase()
    repository = new ConversationRepository(database as never, 'Conversations')
    tree.metas.clear()
    tree.levels.clear()
    tree.rows.clear()
    tree.metas.set('parent', {
        workspaceId: 'parent',
        organizationId: 'org-1',
        name: 'Campaign',
        ancestorIds: [],
    })
    tree.metas.set('storyboard', {
        workspaceId: 'storyboard',
        organizationId: 'org-1',
        name: 'Storyboard',
        ancestorIds: ['parent'],
    })
    tree.metas.set('sibling', {
        workspaceId: 'sibling',
        organizationId: 'org-1',
        name: 'Sibling',
        ancestorIds: [],
    })
    tree.levels.set('storyboard', 'editor')
    meta = {
        run: {
            runId: 'run-parent-turn',
            turnId: 'parent-turn',
            budget: budget(),
        },
        epoch: 1,
    }
    events = []
    service = {
        create: vi.fn(async () => ({
            conversationAssetId: 'child-conversation',
            settingsRevision: 1,
        })),
        submit: vi.fn(async () => ({
            status: 'accepted',
            turnId: 'child-turn',
        })),
        stopConversationBySystem: vi.fn(async () => true),
    }
})

const createDelegation = () => new AgentDelegation(
    repository,
    configuration,
    () => service as never,
    async () => undefined,
)

// =============================================================================
// REJECTIONS
// =============================================================================

describe('delegate_to_workspace rejections', () => {
    it('refuses a target that is not a strict descendant, being deleted or not editable', async () => {
        const delegation = createDelegation()

        for (const workspaceId of ['sibling', 'parent', 'missing'])
            expect((await delegate(delegation, owner(), {
                workspaceId,
                instruction: 'Hi',
                access: 'read',
            })).error.code).toBe('DELEGATION_TARGET_NOT_DESCENDANT')

        tree.levels.set('storyboard', 'viewer')
        expect((await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Hi',
            access: 'read',
        })).error.code).toBe('DELEGATION_TARGET_NOT_DESCENDANT')

        tree.metas.set('storyboard', {
            ...tree.metas.get('storyboard'),
            deletingAt: 5,
        })
        expect((await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Hi',
            access: 'read',
        })).error.code).toBe('DELEGATION_TARGET_DELETING')
        expect(service.submit).not.toHaveBeenCalled()
    })

    it('refuses act without an execute scope and a call with no delegations left', async () => {
        const delegation = createDelegation()

        expect((await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Generate a cover',
            access: 'act',
        })).error.code).toBe('DELEGATION_ACTION_NOT_AUTHORIZED')

        meta.run.budget = budget({ delegationCalls: 8 })
        expect((await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Hi',
            access: 'read',
        })).error.code).toBe('AGENT_BUDGET_EXHAUSTED:delegationCalls')
        expect(service.create).not.toHaveBeenCalled()
    })
})

// =============================================================================
// RUNNING A DELEGATION
// =============================================================================

describe('delegate_to_workspace', () => {
    it('starts a linked child conversation in Discovery mode with the remaining allowance as its limit', async () => {
        const delegation = createDelegation()
        finishChild('completed')

        const result = await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'What is in the storyboard?',
            access: 'read',
        })

        expect(result).toMatchObject({
            status: 'succeeded',
            data: {
                state: 'completed',
                answer: 'The storyboard has six shots.',
                childConversationAssetId: 'child-conversation',
            },
        })
        expect(service.create).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'storyboard',
                clientConversationId: 'delegation:parent-conversation:storyboard',
                settings: {
                    contextMode: 'discovery',
                    midRunPolicy: 'queue',
                },
            }),
            'user-1',
            { delegatedBy: expect.objectContaining({
                workspaceId: 'parent',
                workspaceName: 'Campaign',
                conversationAssetId: 'parent-conversation',
                turnId: 'parent-turn',
            }) },
        )
        const delegationOption: ConversationTurnDelegation = service.submit.mock.calls[0][2].delegation
        expect(delegationOption).toMatchObject({
            access: 'read',
            allowedOperationFamilies: [],
            budgetLimits: {
                maxModelCalls: 22,
                maxToolCalls: 61,
                maxSpecialistCalls: 4,
                maxDelegationCalls: 7,
            },
        })
    })

    it('reuses the operation and the child turn when the same call is retried', async () => {
        const delegation = createDelegation()

        const first = await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Same request',
            access: 'read',
        })
        const second = await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Same request',
            access: 'read',
        })

        expect(first.status).toBe('pending')
        expect(second.operationId).toBe(first.operationId)
        expect(service.submit).toHaveBeenCalledTimes(1)
        expect(meta.run.budget.delegationCalls).toBe(1)
    })

    it('passes the caller families to an act delegation', async () => {
        const delegation = createDelegation()

        await delegate(
            delegation,
            owner(),
            {
                workspaceId: 'storyboard',
                instruction: 'Generate a cover image',
                access: 'act',
            },
            intent({
                intent: 'execute',
                operationFamilies: ['image'],
            }),
        )

        expect(service.submit.mock.calls[0][2].delegation).toMatchObject({
            access: 'act',
            allowedOperationFamilies: ['image'],
        })
    })
})

// =============================================================================
// CONTINUATION, CHARGE-BACK AND STOP
// =============================================================================

describe('delegation continuation', () => {
    it('reports a long child answer through advance once and charges its use to the caller', async () => {
        const delegation = createDelegation()
        const operations = combineConversationOperations(delegation.operations())
        const currentOwner = owner()
        const pending = await delegate(delegation, currentOwner, {
            workspaceId: 'storyboard',
            instruction: 'Summarize everything',
            access: 'read',
        })

        expect(pending.status).toBe('pending')
        expect(await operations.advance(currentOwner as never)).toEqual({
            pending: true,
            completed: [],
        })

        // The child itself delegated once and its grandchild's use was
        // charged to it, so the charge carries the whole chain's use.
        finishChild('completed', {
            modelCalls: 5,
            toolCalls: 7,
            delegationCalls: 1,
        })

        const advanced = await operations.advance(currentOwner as never)
        expect(advanced.pending).toBe(false)
        expect(advanced.completed).toEqual([{
            operationId: pending.operationId,
            result: expect.objectContaining({ data: expect.objectContaining({ answer: 'The storyboard has six shots.' }) }),
        }])
        expect(meta.run.budget).toMatchObject({
            modelCalls: 7,
            toolCalls: 10,
            delegationCalls: 2,
        })

        await operations.acknowledge(currentOwner as never, pending.operationId)
        expect((await operations.advance(currentOwner as never)).completed).toEqual([])
        expect(events.map(event => event.payload.state)).toEqual(['running', 'succeeded'])
    })

    it('returns a typed failure when the child turn fails', async () => {
        const delegation = createDelegation()
        finishChild('failed')

        expect(await delegate(delegation, owner(), {
            workspaceId: 'storyboard',
            instruction: 'Do a lot',
            access: 'read',
        })).toMatchObject({
            status: 'error',
            error: { code: 'AGENT_BUDGET_EXHAUSTED:toolCalls' },
        })
    })

    it('stops every running child when the calling run stops', async () => {
        const delegation = createDelegation()
        const operations = combineConversationOperations(delegation.operations())
        const currentOwner = owner()
        await delegate(delegation, currentOwner, {
            workspaceId: 'storyboard',
            instruction: 'Long work',
            access: 'read',
        })

        await operations.cancel(currentOwner as never)

        expect(service.stopConversationBySystem).toHaveBeenCalledWith('org-1', 'child-conversation')
    })

    it('records a child result that arrives after the caller stopped without resuming it', async () => {
        const delegation = createDelegation()
        const currentOwner = owner()
        const pending = await delegate(delegation, currentOwner, {
            workspaceId: 'storyboard',
            instruction: 'Long work',
            access: 'read',
        })
        // The caller stopped, so its run is gone and nothing advances it.
        meta.run.runId = 'run-next-turn'
        finishChild('completed')

        expect(await delegation.operations().advance(currentOwner as never)).toEqual({
            pending: false,
            completed: [],
        })
        expect(database.rows.get(`${currentOwner.partition}|OPERATION#${pending.operationId}`)).toMatchObject({ state: 'running' })
    })
})

// =============================================================================
// OUTLINE AND SCOPE
// =============================================================================

describe('delegation outline and scope', () => {
    it('puts the subtree outline and guidance in the system prompt', async () => {
        tree.rows.set('parent', [{
            entryType: 'workspace',
            entryId: 'storyboard',
        }])

        const prompt = await createDelegation().systemPrompt(owner() as never)

        expect(prompt).toContain('delegate_to_workspace')
        expect(prompt).toContain('- Storyboard [workspace storyboard]')
    })

    it('gives a read delegation no action scope and narrows an act delegation to the caller families', () => {
        const delegation = {
            access: 'read',
            allowedOperationFamilies: [],
        } as unknown as ConversationTurnDelegation

        expect(narrowDelegatedIntent(intent({
            intent: 'execute',
            operationFamilies: ['image'],
        }), delegation)).toMatchObject({
            intent: 'inspect',
            operationFamilies: [],
        })
        expect(narrowDelegatedIntent(intent({
            intent: 'execute',
            operationFamilies: ['image', 'video'],
        }), {
            ...delegation,
            access: 'act',
            allowedOperationFamilies: ['image'],
        })).toMatchObject({
            intent: 'execute',
            operationFamilies: ['image'],
        })
        expect(narrowDelegatedIntent(intent({
            intent: 'execute',
            operationFamilies: ['video'],
        }), {
            ...delegation,
            access: 'act',
            allowedOperationFamilies: ['image'],
        }).intent).toBe('inspect')
    })
})
