import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    acquireCanvasTarget,
    emptyCanvasRoom,
    makeCanvasRoomEvent,
    pruneCanvasRoom,
    type CanvasRoomState,
} from './canvas-collaboration-state.ts'

const roomWithActors = (): CanvasRoomState => {
    const state = emptyCanvasRoom()

    for (const actorId of ['human', 'first', 'second', 'third'])
        state.participants[actorId] = {
            actor: {
                actorId,
                kind: actorId === 'human' ? 'human' : 'agent',
                name: actorId,
            },
            userId: actorId,
            expiresAt: 100,
            followSequence: -1,
        }

    return state
}

const acquire = (
    state: CanvasRoomState,
    actorId: string,
    target = 'node:shared',
): void => void acquireCanvasTarget(
    state,
    {
        actorId,
        target,
        requestId: `request-${actorId}`,
    },
)

describe('Canvas collaboration viewer identity', () => {
    it('groups tabs by verified account while preserving distinct transports and agent identities', () => {
        const state = roomWithActors()
        const person = state.participants.human!
        state.participants['second-tab'] = {
            ...person,
            actor: {
                ...person.actor,
                actorId: 'second-tab',
            },
        }
        state.participants['different-account'] = {
            ...person,
            userId: 'another-user',
            actor: {
                ...person.actor,
                actorId: 'different-account',
            },
        }
        state.participants.first!.userId = person.userId

        const room = makeCanvasRoomEvent('workspace-1', state, 1)
        const otherRoom = makeCanvasRoomEvent('workspace-2', state, 1)
        const actor = (id: string) => room.actors.find(item => item.actorId === id)

        expect(actor('human')?.viewerId).toBeTruthy()
        expect(actor('second-tab')).toMatchObject({
            actorId: 'second-tab',
            viewerId: actor('human')!.viewerId,
        })
        expect(actor('different-account')?.viewerId).not.toBe(actor('human')!.viewerId)
        expect(actor('first')).not.toHaveProperty('viewerId')
        expect(actor('human')).not.toHaveProperty('userId')
        expect(otherRoom.actors.find(item => item.actorId === 'human')?.viewerId).not.toBe(actor('human')!.viewerId)
    })
})

describe('Canvas collaboration ownership', () => {
    it('preempts an agent for a human and admits remaining agents in same-target FIFO order', () => {
        const state = roomWithActors()
        const target = 'node:shared'

        acquire(state, 'first')
        const preemptedLease = state.leases[target].leaseId
        acquire(state, 'second')
        acquire(state, 'third')
        acquire(state, 'second')
        acquire(state, 'human')
        acquire(state, 'first', 'node:independent')

        expect(state.leases[target].actorId).toBe('human')
        expect(state.leases[target].leaseId).not.toBe(preemptedLease)
        expect(state.leases['node:independent'].actorId).toBe('first')
        expect(state.queue.map(entry => entry.actorId)).toEqual(['second', 'third'])

        delete state.leases[target]
        pruneCanvasRoom(state, 1)
        expect(state.leases[target].actorId).toBe('second')

        delete state.leases[target]
        pruneCanvasRoom(state, 1)
        expect(state.leases[target].actorId).toBe('third')
    })

    it('holds waiting agents behind any active human Asset write', () => {
        const state = roomWithActors()
        const target = 'asset:shared'
        state.assetWrites[target] = {
            first: 10,
            second: 20,
        }

        acquire(state, 'first', target)
        acquire(state, 'second', target)
        pruneCanvasRoom(state, 10)

        expect(state.leases[target]).toBeUndefined()
        expect(state.queue.map(entry => entry.actorId)).toEqual(['first', 'second'])

        pruneCanvasRoom(state, 20)

        expect(state.leases[target].actorId).toBe('first')
        expect(state.queue.map(entry => entry.actorId)).toEqual(['second'])
    })

    it('expires a disconnected actor, their ownership and other actors following them', () => {
        const state = roomWithActors()
        acquire(state, 'first')
        acquire(state, 'second')
        state.participants.first.expiresAt = 5
        state.participants.human.actor.followingActorId = 'first'

        pruneCanvasRoom(state, 5)

        expect(state.participants.first).toBeUndefined()
        expect(state.leases['node:shared'].actorId).toBe('second')
        expect(state.participants.human.actor.followingActorId).toBeNull()
    })
})
