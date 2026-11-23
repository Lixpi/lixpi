import { createECDH } from 'node:crypto'
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    createWorkspaceCanvasModule,
    type CanvasAgentSession as CanvasAgentToolSession,
} from '@lixpi/capability-system/backend'
import {
    type CanvasState,
} from '@lixpi/constants'
import {
    canvasCollaboration,
    type CanvasAgentSession,
} from './canvas-collaboration.ts'
import { appendCanvasTransactionFences } from './canvas-collaboration-transaction.ts'

const mocks = vi.hoisted(() => ({
    workspace: vi.fn(),
    updateCanvasState: vi.fn(),
    resolveAccess: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
}))

vi.mock('../models/workspace.ts', () => ({
    default: {
        getWorkspace: mocks.workspace,
        updateCanvasState: mocks.updateCanvasState,
    },
}))
vi.mock('../models/user.ts', () => ({ default: { get: vi.fn(async () => ({ name: 'Human' })) } }))
vi.mock('@lixpi/nats-service', () => ({ default: { getInstance: vi.fn() } }))
vi.mock('./workspace-tree.ts', () => ({
    workspaceAccessResolver: () => ({ resolve: mocks.resolveAccess }),
    workspaceTreeRepository: () => ({ accessFenceOperations: () => [] }),
}))

beforeEach(() => {
    vi.clearAllMocks()
    const rows = new Map<string, Record<string, unknown>>()

    mocks.read.mockImplementation(async ({ key }) => rows.get(key.pk))
    mocks.write.mockImplementation(async ({ operations }: { operations: TransactOperation[] }) => {
        for (const operation of operations)
            if (operation.type === 'put')
                rows.set(operation.item.pk as string, structuredClone(operation.item))
    })
    mocks.workspace.mockImplementation(async ({ workspaceId }) => ({
        workspaceId,
        organizationId: 'organization',
        accessLevel: 'editor',
        canvasStateUpdatedAt: 17,
        canvasState: {
            viewport: {
                x: 0,
                y: 0,
                zoom: 1,
            },
            nodes: [],
            edges: [],
        },
    }))
    mocks.resolveAccess.mockResolvedValue({ status: 'granted' })

    vi.stubGlobal('dynamoDBService', {
        getItem: mocks.read,
        transactWrite: mocks.write,
    })
})

describe('Canvas collaboration requests', () => {

    it('shares the main camera by account, drops stale input, and restores it after rejoin', async () => {
        const workspaceId = 'shared-main-camera'
        const first = {
            workspaceId,
            sessionId: 'desktop',
        }
        const second = {
            workspaceId,
            sessionId: 'browser',
        }
        const remote = {
            workspaceId,
            sessionId: 'other',
        }
        const account = 'same-user'
        const otherAccount = 'other-user'
        const firstCamera = {
            x: -480,
            y: 225,
            zoom: 0.7,
        }
        const finalCamera = {
            x: 340,
            y: -170,
            zoom: 1.6,
        }
        const independentCamera = {
            x: 900,
            y: 180,
            zoom: 0.55,
        }
        const changedAt = Date.now()
        const firstView = await canvasCollaboration.handle(account, {
            ...first,
            action: 'join',
        })
        const secondView = await canvasCollaboration.handle(account, {
            ...second,
            action: 'join',
        })
        const remoteView = await canvasCollaboration.handle(otherAccount, {
            ...remote,
            action: 'join',
        })

        if (
            !('actorId' in firstView)
            || !('actorId' in secondView)
            || !('actorId' in remoteView)
        )
            throw new Error('Test participants failed to join')

        mocks.write.mockClear()
        await canvasCollaboration.handle(account, {
            ...first,
            action: 'presence',
            sequence: 1,
            camera: firstCamera,
            mainCameraAt: changedAt - 100,
        })
        await canvasCollaboration.handle(account, {
            ...second,
            action: 'presence',
            sequence: 2,
            camera: finalCamera,
            mainCameraAt: changedAt - 50,
        })
        await canvasCollaboration.handle(account, {
            ...first,
            action: 'presence',
            sequence: 3,
            camera: firstCamera,
            mainCameraAt: changedAt - 75,
        })
        await canvasCollaboration.handle(otherAccount, {
            ...remote,
            action: 'presence',
            sequence: 1,
            camera: independentCamera,
            mainCameraAt: changedAt,
        })
        expect(mocks.write).not.toHaveBeenCalled()

        const heartbeat = await canvasCollaboration.handle(account, {
            ...first,
            action: 'presence',
            sequence: 4,
            camera: independentCamera,
            mainCameraAt: changedAt,
            knownCanvasRevision: 17,
        })
        expect(heartbeat).toHaveProperty('mainCamera', expect.objectContaining({
            actorId: secondView.actorId,
            sequence: 2,
            camera: finalCamera,
        }))
        expect(heartbeat).toHaveProperty('actors', expect.arrayContaining([
            expect.objectContaining({
                actorId: firstView.actorId,
                camera: finalCamera,
            }),
            expect.objectContaining({
                actorId: secondView.actorId,
                camera: finalCamera,
            }),
            expect.objectContaining({
                actorId: remoteView.actorId,
                camera: independentCamera,
            }),
        ]))

        await canvasCollaboration.handle(account, {
            ...first,
            action: 'follow',
            actorId: remoteView.actorId,
        })
        await canvasCollaboration.handle(account, {
            ...first,
            action: 'presence',
            sequence: 5,
            camera: independentCamera,
            mainCameraAt: changedAt,
        })
        const restored = await canvasCollaboration.handle(account, {
            ...first,
            action: 'follow',
            actorId: null,
        })
        expect(restored).toHaveProperty('mainCamera.camera', finalCamera)

        await canvasCollaboration.handle(account, {
            ...first,
            action: 'leave',
        })
        await canvasCollaboration.handle(account, {
            ...second,
            action: 'leave',
        })
        const rejoined = await canvasCollaboration.handle(account, {
            ...first,
            sessionId: 'returning',
            action: 'join',
        })
        expect(rejoined).toHaveProperty('mainCamera.camera', finalCamera)
        const remoteHeartbeat = await canvasCollaboration.handle(otherAccount, {
            ...remote,
            action: 'presence',
            sequence: 2,
            knownCanvasRevision: 17,
        })
        expect(remoteHeartbeat).toHaveProperty('mainCamera.camera', independentCamera)
    })

    it('keeps the account follow across activity switches, delayed packets, and disconnects', async () => {
        const workspaceId = 'activity-workspace'
        const first = {
            workspaceId,
            sessionId: 'presenter-first',
        }
        const second = {
            workspaceId,
            sessionId: 'presenter-second',
        }
        const follower = {
            workspaceId,
            sessionId: 'follower',
        }
        const performer = 'presenter'
        const firstJoin = await canvasCollaboration.handle(performer, {
            ...first,
            action: 'join',
        })
        const secondJoin = await canvasCollaboration.handle(performer, {
            ...second,
            action: 'join',
        })
        const observing = await canvasCollaboration.handle('watching-user', {
            ...follower,
            action: 'join',
        })

        if (
            !('actors' in firstJoin)
            || !('actors' in secondJoin)
            || !('actors' in observing)
        )
            throw new Error('Test actors failed to join')

        const viewerId = firstJoin.actors.find(actor => actor.actorId === firstJoin.actorId)?.viewerId

        expect(viewerId).toBeTruthy()
        expect(secondJoin.actors.find(actor => actor.actorId === secondJoin.actorId)?.viewerId).toBe(viewerId)

        const activityAt = Date.now()
        await canvasCollaboration.handle(performer, {
            ...first,
            action: 'presence',
            sequence: 1,
            activityAt: activityAt - 300,
        })
        const followed = await canvasCollaboration.handle('watching-user', {
            ...follower,
            action: 'follow',
            actorId: null,
            viewerId,
        })
        const watcher = (response: typeof followed) => 'actors' in response ? response.actors.find(actor => actor.actorId === observing.actorId) : undefined
        expect(watcher(followed)).toMatchObject({
            followingViewerId: viewerId,
            followingActorId: firstJoin.actorId,
        })

        await canvasCollaboration.handle(performer, {
            ...second,
            action: 'presence',
            sequence: 7,
            knownCanvasRevision: 17,
            activityAt,
        })
        const refresh = async (sequence: number) => watcher(await canvasCollaboration.handle('watching-user', {
            ...follower,
            action: 'presence',
            sequence,
            knownCanvasRevision: 17,
        }))
        expect((await refresh(1))?.followingActorId).toBe(firstJoin.actorId)

        mocks.write.mockClear()
        await canvasCollaboration.handle(performer, {
            ...second,
            action: 'presence',
            sequence: 8,
            activityAt: activityAt - 100,
        })
        await canvasCollaboration.handle(performer, {
            ...first,
            action: 'presence',
            sequence: 2,
            activityAt: activityAt - 200,
        })
        expect((await refresh(2))?.followingActorId).toBe(secondJoin.actorId)
        expect(mocks.write).not.toHaveBeenCalled()

        const agent = {
            workspaceId,
            userId: 'agent-owner',
            sessionId: 'agent-run',
            name: 'Agent',
        }
        const joinedAgent = await canvasCollaboration.joinAgent(agent)
        const agentFollowed = await canvasCollaboration.followAsAgent(agent, firstJoin.actorId)
        expect(agentFollowed.actors.find(actor => actor.actorId === joinedAgent.actorId)).toMatchObject({
            followingViewerId: viewerId,
            followingActorId: secondJoin.actorId,
        })

        await canvasCollaboration.handle(performer, {
            ...second,
            action: 'leave',
        })
        expect((await refresh(3))?.followingActorId).toBe(firstJoin.actorId)
        await canvasCollaboration.handle(performer, {
            ...first,
            action: 'leave',
        })
        expect(await refresh(4)).toMatchObject({
            followingViewerId: viewerId,
            followingActorId: null,
        })

        const rejoined = await canvasCollaboration.handle(performer, {
            ...first,
            sessionId: 'presenter-returned',
            action: 'join',
        })

        if (!('actorId' in rejoined))
            throw new Error('Presenter failed to rejoin')

        expect((await refresh(5))?.followingActorId).toBe(rejoined.actorId)
    })

    it('keeps drafts off human snapshots and refuses to rebind an existing session', async () => {
        const workspaceId = 'private-draft-workspace'
        const sender = {
            workspaceId,
            sessionId: 'presenter-tab',
        }
        const follower = {
            workspaceId,
            sessionId: 'follower-tab',
        }
        const observer = {
            workspaceId,
            sessionId: 'observer-tab',
        }
        const composerReader = {
            inboxId: 'follower-private-composer-inbox',
            publicKey: createECDH('prime256v1').generateKeys().toString('base64url'),
        }
        const source = await canvasCollaboration.handle('presenter', {
            ...sender,
            action: 'join',
        })
        const joined = await canvasCollaboration.handle('same-account', {
            ...follower,
            action: 'join',
            composerReader,
        })
        await canvasCollaboration.handle('same-account', {
            ...observer,
            action: 'join',
        })

        expect(joined).not.toHaveProperty('composerReader')
        expect(joined).not.toHaveProperty('actors.1.composerReader')

        if (!('actorId' in source))
            throw new Error('Presenter failed to join')

        await canvasCollaboration.handle('presenter', {
            ...sender,
            action: 'presence',
            sequence: 1,
            composer: { content: {
                type: 'doc',
                text: 'draft text',
            } },
        })

        const followed = await canvasCollaboration.handle('same-account', {
            ...follower,
            action: 'follow',
            actorId: source.actorId,
        })
        const samePrincipalProbe = await canvasCollaboration.handle('same-account', {
            ...follower,
            action: 'presence',
            knownCanvasRevision: 17,
            sequence: 10,
        })
        const rebind = await canvasCollaboration.handle('same-account', {
            ...follower,
            action: 'join',
            composerReader: {
                inboxId: 'observer-chosen-composer-inbox',
                publicKey: createECDH('prime256v1').generateKeys().toString('base64url'),
            },
        })

        expect(JSON.stringify(followed)).not.toContain('draft text')
        expect(JSON.stringify(samePrincipalProbe)).not.toContain('draft text')
        expect(JSON.stringify(samePrincipalProbe)).not.toContain(composerReader.inboxId)
        expect(rebind).toEqual({ error: 'CANVAS_COMPOSER_SESSION_BOUND' })
        expect(await canvasCollaboration.handle('same-account', {
            ...follower,
            action: 'join',
            composerReader,
        })).toHaveProperty('actorId')
    })

    it('acknowledges motion compactly without reading or writing the room for every frame', async () => {
        const session = {
            workspaceId: 'presence-workspace',
            sessionId: 'human-tab',
        }
        const joined = await canvasCollaboration.handle('person', {
            ...session,
            action: 'join',
        })

        expect(joined).toHaveProperty('actors')
        expect(joined).toHaveProperty('canvasRevision', 17)

        vi.clearAllMocks()

        const first = await canvasCollaboration.handle('person', {
            ...session,
            action: 'presence',
            sequence: 22,
            camera: {
                x: 10,
                y: 20,
                zoom: 1,
            },
        })
        const stale = await canvasCollaboration.handle('person', {
            ...session,
            action: 'presence',
            sequence: 21,
            camera: {
                x: 500,
                y: 20,
                zoom: 1,
            },
        })

        expect(first).toEqual({
            workspaceId: session.workspaceId,
            actorId: expect.any(String),
            presenceSequence: 22,
        })
        expect(stale).toEqual(first)
        expect(mocks.read).not.toHaveBeenCalled()
        expect(mocks.write).not.toHaveBeenCalled()
        expect(mocks.workspace).not.toHaveBeenCalled()
        expect(mocks.resolveAccess).toHaveBeenCalledTimes(1)

        const heartbeat = await canvasCollaboration.handle('person', {
            ...session,
            action: 'presence',
            sequence: 23,
            knownCanvasRevision: 16,
        })

        expect(heartbeat).toHaveProperty('canvasRevision', 17)
        expect(heartbeat).toHaveProperty('canvasState')
        expect(heartbeat).toHaveProperty('actors', [expect.objectContaining({
            camera: {
                x: 10,
                y: 20,
                zoom: 1,
            },
            presenceSequence: 23,
        })])
        expect(mocks.read).toHaveBeenCalledTimes(1)
        expect(mocks.write).not.toHaveBeenCalled()
    })

    it('rejects an agent commit using a lease the human has taken', async () => {
        const workspaceId = 'ownership-workspace'
        const agent = {
            workspaceId,
            userId: 'agent-owner',
            sessionId: 'run',
            name: 'Canvas agent',
        }
        const human = {
            workspaceId,
            sessionId: 'human-tab',
        }

        await canvasCollaboration.joinAgent(agent)
        const lease = await canvasCollaboration.acquireAgentLease(agent, 'node:example', 'agent-acquire')
        await canvasCollaboration.handle('human', {
            ...human,
            action: 'join',
        })
        const humanLease = await canvasCollaboration.handle('human', {
            ...human,
            action: 'acquire',
            target: 'node:example',
            requestId: 'human-acquire',
        })

        expect(humanLease).toHaveProperty('lease.target', 'node:example')
        expect(humanLease).not.toHaveProperty('lease.leaseId', lease.leaseId)

        await expect(canvasCollaboration.commitAgent(agent, {
            requestId: 'agent-commit',
            baseCanvasRevision: 17,
            changes: {
                nodes: [{
                    type: 'document',
                    nodeId: 'example',
                    assetId: 'document-asset',
                    position: {
                        x: 5,
                        y: 10,
                    },
                    dimensions: {
                        width: 70,
                        height: 80,
                    },
                }],
            },
            leases: { [lease.target]: lease.leaseId },
        })).rejects.toThrow('CANVAS_LEASE_LOST')

        expect(mocks.updateCanvasState).not.toHaveBeenCalled()
    })

    it('cancels a queued canvas Tool and gives the next agent the geometry edit', async () => {
        const workspaceId = 'geometry-queue-workspace'
        const human = {
            workspaceId,
            sessionId: 'human-tab',
        }
        const agent = (userId: string): CanvasAgentSession => ({
            workspaceId,
            userId,
            sessionId: `run-${userId}`,
            name: userId,
        })
        const first = agent('first-agent')
        const next = agent('next-agent')
        const stopFirst = new AbortController()
        const proceedNext = new AbortController()
        let revision = 17
        let state: CanvasState = {
            viewport: {
                x: 0,
                y: 0,
                zoom: 1,
            },
            nodes: [{
                nodeId: 'shared-node',
                type: 'document',
                assetId: 'asset',
                position: {
                    x: 0,
                    y: 10,
                },
                dimensions: {
                    width: 100,
                    height: 200,
                },
            }],
            edges: [],
        }
        mocks.workspace.mockImplementation(async () => ({
            workspaceId,
            organizationId: 'organization',
            accessLevel: 'editor',
            canvasStateUpdatedAt: revision,
            canvasState: state,
        }))
        mocks.updateCanvasState.mockImplementation(async ({
            canvasState,
            expectedCanvasStateUpdatedAt,
            prepareCanvasWrite,
        }) => {
            expect(expectedCanvasStateUpdatedAt).toBe(revision)
            await mocks.write({ operations: prepareCanvasWrite(state, canvasState) })
            state = canvasState
            revision++

            return {
                success: true,
                canvasStateUpdatedAt: revision,
            }
        })

        const target = 'node:shared-node'
        const firstJoined = await canvasCollaboration.joinAgent(first)
        const nextJoined = await canvasCollaboration.joinAgent(next)
        await canvasCollaboration.handle('human', {
            ...human,
            action: 'join',
        })
        const held = await canvasCollaboration.handle('human', {
            ...human,
            action: 'acquire',
            target,
            requestId: 'start-drag',
        })

        if (
            !('lease' in held)
            || !held.lease
        )
            throw new Error('Test human lease was not acquired')

        const definition = createWorkspaceCanvasModule(async context => {
            const actor = context.userId === first.userId ? first : next
            const signal = actor === first ? stopFirst.signal : proceedNext.signal
            const session: Partial<CanvasAgentToolSession> = {
                signal,
                requestId: context.runId,
                inspect: async () => await canvasCollaboration.syncAgentCanvas(actor),
                updatePresence: async presence => await canvasCollaboration.updateAgentPresence(actor, presence),
                acquire: async target => await canvasCollaboration.acquireAgentLease(actor, target, context.runId, signal),
                release: async lease => await canvasCollaboration.releaseAgentLease(actor, lease),
                commit: async (baseCanvasRevision, changes, leases) => await canvasCollaboration.commitAgent(actor, {
                    requestId: context.runId,
                    baseCanvasRevision,
                    changes,
                    leases: Object.fromEntries(leases.map(lease => [lease.target, lease.leaseId])),
                }),
            }

            return session as CanvasAgentToolSession
        }, {
            storeResource: vi.fn(),
            seedBuiltInCapability: vi.fn(),
        })
        const geometry = definition.agentEntries?.find(entry => entry.name === 'edit_canvas_geometry')

        if (
            !geometry
            || !('execute' in geometry)
        )
            throw new Error('Test canvas geometry Tool was not registered')

        const move = (actor: CanvasAgentSession, x: number) => geometry.execute(
            { nodes: [{
                nodeId: 'shared-node',
                offset: {
                    x,
                    y: 0,
                },
            }] },
            {
                userId: actor.userId,
                workspaceId,
                origin: 'model',
                runId: actor.sessionId,
                rootCapabilityId: 'edit_canvas_geometry',
                variant: {
                    axis: 'request',
                    variantKey: 'request',
                },
            },
        )
        const firstMove = move(first, 100)
        let nextMove: Promise<unknown> | undefined

        try {
            await vi.waitFor(async () => void expect((await canvasCollaboration.syncAgentCanvas(first)).queue.map(item => item.actorId)).toEqual([firstJoined.actorId]))
            nextMove = move(next, 20)
            await vi.waitFor(async () => void expect((await canvasCollaboration.syncAgentCanvas(next)).queue.map(item => item.actorId)).toEqual([firstJoined.actorId, nextJoined.actorId]))
            expect(mocks.updateCanvasState).not.toHaveBeenCalled()

            const stopped = expect(firstMove).rejects.toThrow('Conversation stopped')
            stopFirst.abort(new Error('Conversation stopped'))
            await stopped
            await canvasCollaboration.handle('human', {
                ...human,
                action: 'release',
                target,
                leaseId: held.lease.leaseId,
            })

            await expect(nextMove).resolves.toMatchObject({
                status: 'completed',
                data: {
                    revision: 18,
                    nodes: [expect.objectContaining({ position: {
                        x: 20,
                        y: 10,
                    } })],
                },
            })
            expect(mocks.updateCanvasState).toHaveBeenCalledOnce()
        } finally {
            stopFirst.abort()
            proceedNext.abort()
            await Promise.allSettled(nextMove ? [firstMove, nextMove] : [firstMove])
        }
    })

    it('lets a human preempt the next step while an admitted agent publication settles', async () => {
        const agent = {
            workspaceId: 'asset-workspace',
            userId: 'agent-owner',
            sessionId: 'run',
            name: 'Canvas agent',
        }
        const entered = Promise.withResolvers<void>()
        const complete = Promise.withResolvers<void>()
        const order: string[] = []

        await canvasCollaboration.joinAgent(agent)
        const lease = await canvasCollaboration.acquireAgentLease(agent, 'asset:document', 'agent-acquire')
        const agentWrite = canvasCollaboration.withAgentDocumentPublish(agent, lease, async () => {
            entered.resolve()
            await complete.promise
            order.push('agent')
        })

        await entered.promise
        const humanWrite = canvasCollaboration.withHumanAssetWrite(agent.workspaceId, 'human', 'document', async () => void order.push('human'))

        try {
            await vi.waitFor(async () => void expect(await canvasCollaboration.isAgentLeaseCurrent(agent, lease)).toBe(false))
            expect(order).toEqual([])
        } finally {
            complete.resolve()
        }

        await Promise.all([agentWrite, humanWrite])

        expect(order).toEqual(['agent', 'human'])
    })

    it('merges a workspace access fence into the update of the same metadata item', () => {
        const operations: TransactOperation[] = [{
            type: 'update',
            tableName: 'workspace-meta',
            key: { workspaceId: 'canvas' },
            updates: { updatedAt: 17 },
            conditionExpression: '#check = :old',
            expressionAttributeNames: { '#check': 'revision' },
            expressionAttributeValues: { ':old': 16 },
        }]
        const fences: TransactOperation[] = [{
            type: 'check',
            tableName: 'workspace-meta',
            key: { workspaceId: 'canvas' },
            conditionExpression: '#check = :old',
            expressionAttributeNames: { '#check': 'organizationId' },
            expressionAttributeValues: { ':old': 'organization' },
        }]

        expect(appendCanvasTransactionFences(operations, fences)).toEqual([{
            ...operations[0],
            conditionExpression: '(#check = :old) AND (#canvasFence0_check = :canvasFence0_old)',
            expressionAttributeNames: {
                '#check': 'revision',
                '#canvasFence0_check': 'organizationId',
            },
            expressionAttributeValues: {
                ':old': 16,
                ':canvasFence0_old': 'organization',
            },
        }])
    })
})
