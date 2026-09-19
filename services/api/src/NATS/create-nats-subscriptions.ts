import {
    activeContractGroups,
    type ContractGroup,
} from '@lixpi/nats-subject-registry'
import {
    type EndpointContract,
} from '@lixpi/nats-subject-registry/types'
import {
    type NatsSubjectSubscription,
} from '@lixpi/nats-service'

export const createNatsSubscriptions = <Group extends ContractGroup>(
    group: Group,
    handlers: Record<typeof activeContractGroups[Group][number]['id'], NatsSubjectSubscription['handler']>,
): NatsSubjectSubscription[] => {
    const contracts: readonly EndpointContract[] = activeContractGroups[group]
    const expected = new Set(
        contracts.map(contract => contract.id),
    )

    if (
        Object.keys(handlers).length !== expected.size
        || Object.keys(handlers).some(id => !expected.has(id))
    )
        throw new Error(`Unexpected endpoint bindings in ${group}`)

    return contracts.map(contract => {
        const handler = handlers[contract.id as keyof typeof handlers]

        if (typeof handler !== 'function')
            throw new Error(`Missing endpoint handler: ${contract.id}`)

        return {
            subject: contract.subject,
            type: contract.type,
            payloadType: contract.payloadType,
            ...('queue' in contract ? { queue: contract.queue } : {}),
            ...(contract.permissions === 'none' ? {} : {
                permissions: {
                    ...(contract.permissions.pub ? { pub: { allow: [...contract.permissions.pub.allow] } } : {}),
                    ...(contract.permissions.sub ? { sub: { allow: [...contract.permissions.sub.allow] } } : {}),
                },
            }),
            handler,
        }
    })
}

export const composeApiSubscriptions = (groups: Record<ContractGroup, NatsSubjectSubscription[]>): NatsSubjectSubscription[] => {
    const names = Object.keys(activeContractGroups) as ContractGroup[]

    if (Object.keys(groups).length !== names.length)
        throw new Error('Missing or extra active contract groups')

    return names.flatMap(group => {
        const contracts: readonly EndpointContract[] = activeContractGroups[group]
        const subscriptions = groups[group]

        if (
            !subscriptions
            || subscriptions.length !== contracts.length
        )
            throw new Error(`Incomplete active contract group: ${group}`)

        for (const [index, contract] of contracts.entries()) {
            const subscription = subscriptions[index]

            if (
                subscription.subject !== contract.subject
                || subscription.type !== contract.type
                || subscription.payloadType !== contract.payloadType
                || subscription.queue !== contract.queue
                || typeof subscription.handler !== 'function'
            )
                throw new Error(`Mismatched active endpoint: ${contract.id}`)
        }

        return subscriptions
    })
}
