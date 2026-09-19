import { describe, expect, it, vi } from 'vitest'
import { NatsDiscovery } from './index.ts'

const config = {
    clusterArn: 'cluster',
    taskFamily: 'broker',
    hostedZoneId: 'zone',
    recordName: 'nats.example.test',
    discoveryServiceId: 'discovery',
    admissionToken: 'synthetic-probe-token',
}

const setup = (healthStatus = 'HEALTHY') => {
    const ecs = { send: vi.fn(async (command: any) => {
        switch (command.constructor.name) {
            case 'ListTasksCommand':
                return command.input.nextToken ? { taskArns: [] } : {
                    taskArns: ['task'],
                    nextToken: 'page-2',
                }
            case 'DescribeTasksCommand':
                return { tasks: [{
                    taskDefinitionArn: 'arn:task-definition/broker:1',
                    lastStatus: 'RUNNING',
                    healthStatus,
                    containerInstanceArn: 'host',
                }] }
            case 'DescribeContainerInstancesCommand':
                return { containerInstances: [{ ec2InstanceId: 'i-1' }] }
        }

        throw new Error('Unexpected ECS command')
    }) }
    const ec2 = { send: vi.fn().mockResolvedValue({ Reservations: [{ Instances: [{
        PrivateIpAddress: '10.0.0.10',
        PublicIpAddress: '192.0.2.10',
    }] }] }) }
    const route53 = { send: vi.fn().mockResolvedValue({ ResourceRecordSets: [] }) }
    const discovery = { send: vi.fn().mockResolvedValue({ Instances: [{
        Id: 'stale',
        Attributes: { AWS_INSTANCE_IPV4: '10.0.0.9' },
    }] }) }
    const probe = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    return {
        ecs,
        ec2,
        route53,
        discovery,
        probe,
        reconciler: new NatsDiscovery(config, ecs as any, ec2 as any, route53 as any, discovery as any, probe),
    }
}

describe('EC2 NATS discovery', () => {
    it('keeps an admission failure privately discoverable but removes its public address', async () => {
        const state = setup()
        state.probe.mockResolvedValue(new Response(null, { status: 503 }))
        await state.reconciler.reconcile()
        expect(state.discovery.send.mock.calls.some(([command]) => command.constructor.name === 'RegisterInstanceCommand')).toBe(true)
        expect(state.route53.send).toHaveBeenCalledTimes(1)
        expect(state.probe).toHaveBeenCalledWith('http://10.0.0.10:3020/ready', expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-probe-token' } }))
    })
    it('paginates tasks, registers private host addresses and removes stale peers', async () => {
        const state = setup()
        await state.reconciler.reconcile()
        expect(state.ecs.send.mock.calls.filter(([command]) => command.constructor.name === 'ListTasksCommand')).toHaveLength(2)
        expect(state.discovery.send.mock.calls.map(([command]) => command.input)).toContainEqual({
            ServiceId: 'discovery',
            InstanceId: 'i-1',
            Attributes: {
                AWS_INSTANCE_IPV4: '10.0.0.10',
                AWS_INSTANCE_PORT: '4222',
            },
        })
        expect(state.discovery.send.mock.calls.map(([command]) => command.input)).toContainEqual({
            ServiceId: 'discovery',
            InstanceId: 'stale',
        })
        expect(state.route53.send.mock.calls[1][0].input.ChangeBatch.Changes[0].ResourceRecordSet.ResourceRecords).toEqual([{ Value: '192.0.2.10' }])
    })

    it('makes starting peers discoverable privately without advertising them to browsers', async () => {
        const state = setup('UNKNOWN')
        await state.reconciler.reconcile()
        expect(state.discovery.send.mock.calls.some(([command]) => command.constructor.name === 'RegisterInstanceCommand')).toBe(true)
        expect(state.route53.send).toHaveBeenCalledTimes(1)
    })

    it('leaves DNS intact when host inventory fails', async () => {
        const state = setup()
        state.ec2.send.mockRejectedValue(new Error('AWS unavailable'))
        await expect(state.reconciler.reconcile()).rejects.toThrow('AWS unavailable')
        expect(state.discovery.send).not.toHaveBeenCalled()
        expect(state.route53.send).not.toHaveBeenCalled()
    })

    it('deletes a stale public address when no broker is healthy', async () => {
        const state = setup('UNHEALTHY')
        const record = {
            Name: 'nats.example.test.',
            Type: 'A',
            TTL: 60,
            ResourceRecords: [{ Value: '192.0.2.9' }],
        }
        state.route53.send.mockResolvedValue({ ResourceRecordSets: [record] })
        await state.reconciler.reconcile()
        expect(state.route53.send.mock.calls[1][0].input.ChangeBatch.Changes).toEqual([{
            Action: 'DELETE',
            ResourceRecordSet: record,
        }])
    })
})
