import { describe, expect, it, vi } from 'vitest'
import { NatsScalingController, type BrokerSnapshot, type Retirement, type ScalingGroup, type ScalingPorts } from './controller.ts'

const setup = (retirement?: Retirement) => {
    const group: ScalingGroup = {
        minimum: 3,
        desired: 4,
        brokers: [
            {
                id: 'one',
                address: '10.0.0.1',
                zone: 'a',
                inService: true,
            },
            {
                id: 'two',
                address: '10.0.0.2',
                zone: 'b',
                inService: true,
            },
            {
                id: 'three',
                address: '10.0.0.3',
                zone: 'c',
                inService: true,
            },
            {
                id: 'four',
                address: '10.0.0.4',
                zone: 'a',
                inService: true,
            },
        ],
        retirement,
    }
    const snapshot: BrokerSnapshot = {
        name: 'nats-four',
        tags: ['server:nats-four', 'az:a'],
        healthy: true,
        disabled: false,
        streams: 0,
        consumers: 0,
        replicasHealthy: true,
        unsafePlacement: false,
        metaMembers: ['nats-one', 'nats-two', 'nats-three', 'nats-four'],
        leaders: ['nats-one'],
    }
    const ports: ScalingPorts = {
        group: vi.fn(async () => group),
        lowLoad: vi.fn(async () => true),
        inspect: vi.fn(async broker => ({
            ...snapshot,
            name: `nats-${broker.id}`,
            tags: broker.id === retirement?.id ? [] : snapshot.tags,
        })),
        fence: vi.fn(async () => {}),
        placementExcluded: vi.fn(async () => true),
        evacuate: vi.fn(async () => {}),
        removePeer: vi.fn(async () => {}),
        stepDownMetadataLeader: vi.fn(async () => {}),
        saveRetirement: vi.fn(async () => {}),
        terminate: vi.fn(async () => {}),
    }

    return {
        group,
        snapshot,
        ports,
        controller: new NatsScalingController(ports),
    }
}

describe('stateful NATS scale-in', () => {
    it('does not shrink below the configured minimum or with an incomplete host inventory', async () => {
        const state = setup()
        state.group.minimum = 4
        await state.controller.reconcile()
        expect(state.ports.inspect).not.toHaveBeenCalled()
        state.group.minimum = 3
        state.group.brokers[0].inService = false
        await state.controller.reconcile()
        expect(state.ports.saveRetirement).not.toHaveBeenCalled()
    })

    it('selects only a zone with a spare broker and persists intent before touching it', async () => {
        const state = setup()
        await state.controller.reconcile()
        expect(state.ports.saveRetirement).toHaveBeenCalledWith({
            id: 'one',
            name: 'nats-one',
            phase: 'fencing',
        })
        expect(state.ports.fence).not.toHaveBeenCalled()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('never drains the last broker in any zone', async () => {
        const state = setup()
        state.group.brokers[3].zone = 'd'
        await state.controller.reconcile()
        expect(state.ports.saveRetirement).not.toHaveBeenCalled()
        expect(state.ports.fence).not.toHaveBeenCalled()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('rejects stale retirement identity instead of removing a different peer', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-one',
            phase: 'evacuating',
        })
        await expect(state.controller.reconcile()).rejects.toThrow('identity')
        expect(state.ports.removePeer).not.toHaveBeenCalled()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('waits for the meta leader to observe the fence before starting migration', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'fencing',
        })
        vi.mocked(state.ports.placementExcluded).mockResolvedValueOnce(false)
        await state.controller.reconcile()
        expect(state.ports.fence).toHaveBeenCalledWith(state.group.brokers[3], true)
        expect(state.ports.evacuate).not.toHaveBeenCalled()
        await state.controller.reconcile()
        expect(state.ports.evacuate).toHaveBeenCalledWith('nats-four')
        expect(state.ports.removePeer).not.toHaveBeenCalled()
    })

    it('keeps a broker and its disk while stream or consumer migration remains incomplete', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'evacuating',
        })
        state.snapshot.streams = 1
        await state.controller.reconcile()
        expect(state.ports.evacuate).toHaveBeenCalled()
        expect(state.ports.removePeer).not.toHaveBeenCalled()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('requires replica health and rejects placement policies that bypass the fence', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'evacuating',
        })
        state.snapshot.replicasHealthy = false
        await state.controller.reconcile()
        state.snapshot.replicasHealthy = true
        state.snapshot.unsafePlacement = true
        await state.controller.reconcile()
        expect(state.ports.removePeer).not.toHaveBeenCalled()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('removes metadata membership only after evacuation, then waits for confirmation', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'evacuating',
        })
        await state.controller.reconcile()
        expect(state.ports.removePeer).toHaveBeenCalledWith('nats-four')
        expect(state.ports.saveRetirement).toHaveBeenCalledWith({
            id: 'four',
            name: 'nats-four',
            phase: 'removed',
        })
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('transfers metadata leadership before removing the current leader', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'evacuating',
        })
        state.snapshot.metaMembers = ['nats-four', 'nats-one', 'nats-two', 'nats-three']
        await state.controller.reconcile()
        expect(state.ports.stepDownMetadataLeader).toHaveBeenCalledOnce()
        expect(state.ports.removePeer).not.toHaveBeenCalled()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })

    it('recovers a lost remove response and terminates exactly one verified empty broker', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'evacuating',
        })
        vi.mocked(state.ports.inspect).mockImplementation(async broker => ({
            ...state.snapshot,
            name: `nats-${broker.id}`,
            disabled: broker.id === 'four',
            metaMembers: ['nats-one', 'nats-two', 'nats-three'],
        }))
        vi.mocked(state.ports.lowLoad).mockResolvedValue(false)
        await state.controller.reconcile()
        expect(state.ports.terminate).toHaveBeenCalledExactlyOnceWith(state.group.brokers[3])
        expect(state.ports.fence).not.toHaveBeenCalled()
        expect(state.ports.saveRetirement).toHaveBeenCalledWith()
    })

    it('cancels a retirement safely if demand returns before membership removal', async () => {
        const state = setup({
            id: 'four',
            name: 'nats-four',
            phase: 'evacuating',
        })
        vi.mocked(state.ports.lowLoad).mockResolvedValue(false)
        await state.controller.reconcile()
        expect(state.ports.fence).toHaveBeenCalledWith(state.group.brokers[3], false)
        expect(state.ports.saveRetirement).toHaveBeenCalledWith()
        expect(state.ports.terminate).not.toHaveBeenCalled()
    })
})
