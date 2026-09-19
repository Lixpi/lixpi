export type Broker = {
    id: string
    address: string
    zone: string
    inService: boolean
}

export type Retirement = {
    id: string
    name: string
    phase: 'fencing' | 'evacuating' | 'removed'
}

export type BrokerSnapshot = {
    name: string
    tags: string[]
    healthy: boolean
    disabled: boolean
    streams: number
    consumers: number
    replicasHealthy: boolean
    unsafePlacement: boolean
    metaMembers: string[]
    leaders: string[]
}

export type ScalingGroup = {
    minimum: number
    desired: number
    brokers: Broker[]
    retirement?: Retirement
}

export type ScalingPorts = {
    group: () => Promise<ScalingGroup>
    lowLoad: () => Promise<boolean>
    inspect: (broker: Broker) => Promise<BrokerSnapshot>
    fence: (
        broker: Broker,
        enabled: boolean,
    ) => Promise<void>
    placementExcluded: (
        broker: Broker,
        name: string,
    ) => Promise<boolean>
    evacuate: (name: string) => Promise<void>
    removePeer: (name: string) => Promise<void>
    stepDownMetadataLeader: () => Promise<void>
    saveRetirement: (retirement?: Retirement) => Promise<void>
    terminate: (broker: Broker) => Promise<void>
}

// ASG scale-out and this serialized controller are separate: no AWS timeout may
// turn incomplete replica migration into permission to terminate a broker.
export class NatsScalingController {
    constructor(private readonly ports: ScalingPorts) {}

    reconcile = async (): Promise<void> => {
        const group = await this.ports.group()
        const retirement = group.retirement
        const brokers = group.brokers

        if (
            retirement
            && !brokers.some(broker => broker.id === retirement.id)
        ) {
            await this.ports.saveRetirement()

            return
        }

        if (brokers.some(broker => !broker.inService))
            return

        if (
            brokers.length <= group.minimum
            || group.desired <= group.minimum
        )
            return

        const lowLoad = await this.ports.lowLoad()

        if (
            !retirement
            && !lowLoad
        )
            return

        const snapshots = new Map<string, BrokerSnapshot>()

        for (const broker of brokers)
            snapshots.set(broker.id, await this.ports.inspect(broker))

        const knownNames = new Set(
            [...snapshots.values()].map(snapshot => snapshot.name),
        )

        if ([...snapshots.values()].some(snapshot => snapshot.leaders.some(leader => !knownNames.has(leader))))
            return

        const survivors = brokers.filter(broker => broker.id !== retirement?.id)

        for (const broker of survivors) {
            const snapshot = snapshots.get(broker.id)!

            if (
                !snapshot.healthy
                || !snapshot.replicasHealthy
                || snapshot.unsafePlacement
                || !snapshot.tags.some(tag => tag.startsWith('az:'))
            )
                return
        }

        if (!retirement) {
            const zones = new Map<string, number>()

            for (const broker of brokers)
                zones.set(broker.zone, (zones.get(broker.zone) ?? 0) + 1)

            const candidate = [...brokers].filter(broker => (zones.get(broker.zone) ?? 0) > 1)
                .sort((left, right) => (zones.get(right.zone)! - zones.get(left.zone)!))[0]

            if (!candidate)
                return

            await this.ports.saveRetirement({
                id: candidate.id,
                name: snapshots.get(candidate.id)!.name,
                phase: 'fencing',
            })

            return
        }

        const candidate = brokers.find(broker => broker.id === retirement.id)!
        const snapshot = snapshots.get(candidate.id)!

        if (
            snapshot.name !== retirement.name
            || !['fencing', 'evacuating', 'removed'].includes(retirement.phase)
        )
            throw new Error('Saved retirement does not match the running broker identity')

        // A previous remove request may have succeeded even if its response or
        // the following state write was lost. Confirm membership before retrying.
        const removed = snapshot.disabled
            && survivors.every(broker => !snapshots.get(broker.id)!.metaMembers.includes(retirement.name))

        if (removed) {
            const freshGroup = await this.ports.group()

            if (
                freshGroup.desired <= freshGroup.minimum
                || freshGroup.brokers.length <= freshGroup.minimum
            )
                return

            await this.ports.terminate(candidate)
            await this.ports.saveRetirement()

            return
        }

        if (retirement.phase === 'removed')
            return

        if (!lowLoad) {
            await this.ports.fence(candidate, false)
            await this.ports.saveRetirement()

            return
        }

        if (retirement.phase === 'fencing') {
            await this.ports.fence(candidate, true)
            const fenced = await this.ports.inspect(candidate)

            if (fenced.tags.some(tag => tag.startsWith('server:') || tag.startsWith('az:')))
                return

            // This goes through the meta leader. A local reload alone is not
            // proof that the leader has received the changed placement tags.
            if (!(await this.ports.placementExcluded(candidate, retirement.name)))
                return

            await this.ports.saveRetirement({
                ...retirement,
                phase: 'evacuating',
            })
            await this.ports.evacuate(retirement.name)

            return
        }

        if (snapshot.tags.some(tag => tag.startsWith('server:') || tag.startsWith('az:')))
            throw new Error('Retiring broker lost its persistent placement fence')

        if (
            snapshot.streams
            || snapshot.consumers
        ) {
            await this.ports.evacuate(retirement.name)

            return
        }

        if (
            !snapshot.healthy
            || !snapshot.replicasHealthy
            || snapshot.unsafePlacement
        )
            return

        if (!(await this.ports.placementExcluded(candidate, retirement.name)))
            return

        if (snapshot.metaMembers[0] === retirement.name) {
            await this.ports.stepDownMetadataLeader()

            return
        }

        // The peer stays protected until a later invocation observes JS disabled
        // and verifies the remaining members after the committed removal.
        await this.ports.removePeer(retirement.name)
        await this.ports.saveRetirement({
            ...retirement,
            phase: 'removed',
        })
    }
}
