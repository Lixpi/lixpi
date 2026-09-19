import {
    AutoScalingClient,
    DescribeAutoScalingGroupsCommand,
    CreateOrUpdateTagsCommand,
    DeleteTagsCommand,
    TerminateInstanceInAutoScalingGroupCommand,
} from '@aws-sdk/client-auto-scaling'
import {
    EC2Client,
    DescribeInstancesCommand,
} from '@aws-sdk/client-ec2'
import {
    CloudWatchClient,
    GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch'
import {
    SSMClient,
    SendCommandCommand,
    GetCommandInvocationCommand,
} from '@aws-sdk/client-ssm'
import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import { connect } from '@nats-io/transport-node'
import {
    nkeyAuthenticator,
    type NatsConnection,
} from '@nats-io/nats-core'
import {
    NatsScalingController,
    type Broker,
    type BrokerSnapshot,
    type Retirement,
    type ScalingGroup,
    type ScalingPorts,
} from './controller.ts'

type Replica = {
    name: string
    current?: boolean
    offline?: boolean
}
type Cluster = {
    leader?: string
    replicas?: Replica[]
}
type Stream = {
    config?: {
        num_replicas?: number
        placement?: { tags?: string[] }
    }
    cluster?: Cluster
    consumer_detail?: {
        config?: {
            num_replicas?: number
            durable_name?: string
        }
        cluster?: Cluster
    }[]
}
type JetStreamReport = {
    disabled?: boolean
    streams?: number
    consumers?: number
    total?: number
    meta_cluster?: Cluster & {
        cluster_size?: number
        rescue?: boolean
    }
    account_details?: { stream_detail?: Stream[] }[]
}

const retirementTag = 'lixpi:nats-retirement'
const encoder = new TextEncoder()

class AwsScalingPorts implements ScalingPorts {
    private readonly scaling = new AutoScalingClient({})
    private readonly ec2 = new EC2Client({})
    private readonly metrics = new CloudWatchClient({})
    private readonly ssm = new SSMClient({})
    private readonly secrets = new SecretsManagerClient({})
    private system?: NatsConnection
    private operator?: NatsConnection
    private readonly subjects = JSON.parse(process.env.NATS_SCALING_SUBJECTS ?? '{}') as Record<string, string>

    constructor(
        private readonly groupName: string,
        private readonly secretArn: string,
        private readonly family: string,
    ) {
        if (!/^[a-zA-Z0-9_-]+$/.test(family))
            throw new Error('Invalid NATS task family')
    }

    group = async (): Promise<ScalingGroup> => {
        const response = await this.scaling.send(
            new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [this.groupName] }),
        )
        const group = response.AutoScalingGroups?.[0]

        if (
            !group?.MinSize
            || group.DesiredCapacity === undefined
        )
            throw new Error('Missing NATS scaling group')

        const ids = group.Instances?.map(instance => instance.InstanceId!).filter(Boolean) ?? []
        const instances = ids.length ? await this.ec2.send(
            new DescribeInstancesCommand({ InstanceIds: ids }),
        ) : undefined
        const addresses = new Map(
            instances?.Reservations?.flatMap(reservation => reservation.Instances ?? []).map(
                instance => [instance.InstanceId, instance.PrivateIpAddress],
            ),
        )
        const saved = group.Tags?.find(tag => tag.Key === retirementTag)?.Value

        return {
            minimum: group.MinSize,
            desired: group.DesiredCapacity,
            brokers: (group.Instances ?? []).map(instance => {
                const address = addresses.get(instance.InstanceId)

                if (!address)
                    throw new Error('Incomplete broker inventory')

                return {
                    id: instance.InstanceId!,
                    address,
                    zone: instance.AvailabilityZone!,
                    inService: instance.LifecycleState === 'InService' && instance.HealthStatus === 'Healthy',
                }
            }),
            retirement: saved ? JSON.parse(saved) : undefined,
        }
    }

    lowLoad = async (): Promise<boolean> => {
        // Leave two minutes for EC2's one-minute metrics to arrive. The monitor
        // check also guards against fresh CPU pressure before retiring a host.
        const end = new Date((Math.floor(Date.now() / 60000) - 2) * 60000)
        const response = await this.metrics.send(
            new GetMetricStatisticsCommand({
                Namespace: 'AWS/EC2',
                MetricName: 'CPUUtilization',
                Dimensions: [{
                    Name: 'AutoScalingGroupName',
                    Value: this.groupName,
                }],
                StartTime: new Date(end.getTime() - 15 * 60000),
                EndTime: end,
                Period: 60,
                Statistics: ['Average'],
            }),
        )
        const points = response.Datapoints ?? []
        const threshold = Number(process.env.SCALE_IN_CPU_PERCENT ?? '30')

        return points.length >= 15 && points.every(point => point.Average !== undefined && point.Average < threshold)
    }

    private getJson = async <T>(
        broker: Broker,
        path: string,
    ): Promise<T> => {
        const response = await fetch(`http://${broker.address}:8222/${path}`, { signal: AbortSignal.timeout(5000) })

        if (!response.ok)
            throw new Error(`Broker monitoring failed: ${response.status}`)

        return response.json() as Promise<T>
    }

    inspect = async (broker: Broker): Promise<BrokerSnapshot> => {
        const info = await this.getJson<{
            server_name: string
            tags?: string[]
            mem: number
            cpu: number
            cores: number
        }>(broker, 'varz')
        const report = await this.getJson<JetStreamReport>(broker, 'jsz?accounts=true&streams=true&consumers=true&config=true&limit=10000')
        const accounts = report.account_details ?? []

        if (
            !report.disabled
            && (report.total ?? 0) > accounts.length
        )
            throw new Error('Incomplete JetStream account inventory')

        const healthyCluster = (
            cluster: Cluster | undefined,
            replicas: number,
        ): boolean => {
            if (!cluster)
                return replicas === 1

            return (
                Boolean(cluster.leader)
                    && (cluster.replicas?.length ?? 0) >= replicas - 1
                    // Followers cannot report other followers' replication progress.
                    // The controller also reads the actual leader and requires its view.
                    && (cluster.leader !== info.server_name || (cluster.replicas ?? []).every(replica => replica.current && !replica.offline))
            )
        }
        const streams = accounts.flatMap(account => account.stream_detail ?? [])
        const health = report.disabled ? false : (await fetch(`http://${broker.address}:8222/healthz`, { signal: AbortSignal.timeout(5000) })).ok
        const memoryLimit = Number(process.env.BROKER_MEMORY_MIB ?? '1024') * 1024 * 1024

        return {
            name: info.server_name,
            tags: info.tags ?? [],
            healthy: health
                && info.mem < memoryLimit * 0.7
                && info.cpu / Math.max(info.cores, 1) < Number(process.env.SCALE_IN_CPU_PERCENT ?? '30'),
            disabled: report.disabled === true,
            streams: report.streams ?? 0,
            consumers: report.consumers ?? 0,
            replicasHealthy: !report.meta_cluster?.rescue
                && healthyCluster(report.meta_cluster, report.meta_cluster?.cluster_size ?? 0)
                && streams.every(stream => {
                    const replicas = stream.config?.num_replicas ?? 1

                    return healthyCluster(stream.cluster, replicas)
                        && (stream.consumer_detail ?? []).every(
                            consumer => healthyCluster(
                                consumer.cluster,
                                consumer.config?.num_replicas || (consumer.config?.durable_name ? replicas : 1),
                            ),
                        )
                }),
            // Negative overrides disable unique_tag selection in NATS. Do not
            // automatically retire brokers from a cluster using that policy.
            unsafePlacement: streams.some(stream => stream.config?.placement?.tags?.some(tag => tag.startsWith('!az:') || tag.startsWith('!server:'))),
            metaMembers: [report.meta_cluster?.leader, ...(report.meta_cluster?.replicas ?? []).map(replica => replica.name)].filter(
                (name): name is string => Boolean(name),
            ),
            leaders: [report.meta_cluster?.leader, ...streams.flatMap(
                stream => [stream.cluster?.leader, ...(stream.consumer_detail ?? []).map(consumer => consumer.cluster?.leader)],
            )].filter((name): name is string => Boolean(name)),
        }
    }

    fence = async (
        broker: Broker,
        enabled: boolean,
    ): Promise<void> => {
        const response = await this.ssm.send(
            new SendCommandCommand({
                InstanceIds: [broker.id],
                DocumentName: 'AWS-RunShellScript',
                TimeoutSeconds: 60,
                Parameters: { commands: [
                    'set -eu',
                    `CONTAINER=$(docker ps -q --filter 'label=com.amazonaws.ecs.task-definition-family=${this.family}' --filter 'label=com.amazonaws.ecs.container-name=${this.family}')`,
                    '[ -n "$CONTAINER" ] && [ "$(printf "%s\\n" "$CONTAINER" | wc -l)" -eq 1 ]',
                    `docker exec "$CONTAINER" /usr/local/bin/lixpi-nats fence ${enabled ? 'enable' : 'disable'}`,
                ] },
            }),
        )

        for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            let result

            try {
                result = await this.ssm.send(
                    new GetCommandInvocationCommand({
                        CommandId: response.Command?.CommandId,
                        InstanceId: broker.id,
                    }),
                )
            } catch (error) {
                if ((error as Error).name === 'InvocationDoesNotExist')
                    continue

                throw error
            }

            if (result.Status === 'Success')
                return

            if (!['Pending', 'InProgress', 'Delayed'].includes(result.Status ?? ''))
                throw new Error('Broker placement fence command failed')
        }

        throw new Error('Broker placement fence command timed out')
    }

    private connections = async (): Promise<void> => {
        if (
            this.system
            && this.operator
        )
            return

        const secret = await this.secrets.send(
            new GetSecretValueCommand({ SecretId: this.secretArn }),
        )
        const credentials = JSON.parse(secret.SecretString ?? '{}')
        const group = await this.group()
        const servers = group.brokers.filter(broker => broker.id !== group.retirement?.id).map(broker => `nats://${broker.address}:4222`)
        this.system = await connect({
            servers,
            user: 'sys',
            pass: credentials.systemPassword,
            timeout: 5000,
        })
        this.operator = await connect({
            servers,
            authenticator: nkeyAuthenticator(
                new TextEncoder().encode(credentials.operatorSeed),
            ),
            timeout: 5000,
        })
    }

    private request = async (
        subject: string,
        payload: Record<string, unknown>,
        system = true,
    ): Promise<Record<string, any>> => {
        await this.connections()
        const response = await (system ? this.system! : this.operator!).request(
            subject,
            encoder.encode(
                JSON.stringify(payload),
            ),
            { timeout: 10000 },
        )

        return response.json()
    }

    placementExcluded = async (
        broker: Broker,
        name: string,
    ): Promise<boolean> => {
        const stream = `NATS_SCALE_PROBE_${broker.id.replaceAll('-', '_')}`
        const response = await this.request(
            this.subjects.STREAM_CREATE.replace('*', stream),
            {
                name: stream,
                subjects: [this.subjects.SCALING_PROBE.replace('*', broker.id)],
                num_replicas: 1,
                storage: 'file',
                max_bytes: 1024,
                max_msgs: 1,
                max_age: 60000000000,
                placement: { tags: [`server:${name}`] },
            },
            false,
        )

        if (!response.error) {
            const deleted = await this.request(
                this.subjects.STREAM_DELETE.replace('*', stream),
                {},
                false,
            )

            if (!deleted.success)
                throw new Error('Could not remove scaling placement probe')

            return false
        }

        // 10005 is cluster placement insufficient resources, including no peer
        // matching the explicitly requested server tag. Other errors are not proof.
        if (response.error.err_code !== 10005)
            throw new Error(`Placement probe failed: ${response.error.err_code}`)

        return true
    }

    evacuate = async (name: string): Promise<void> => {
        const response = await this.request(this.subjects.SERVER_EVACUATE, { peer: name })

        if (!response.success)
            throw new Error('NATS rejected broker evacuation')
    }

    removePeer = async (name: string): Promise<void> => {
        const response = await this.request(this.subjects.SERVER_REMOVE, { peer: name })

        if (!response.success)
            throw new Error('NATS rejected broker membership removal')
    }

    stepDownMetadataLeader = async (): Promise<void> => {
        const response = await this.request(this.subjects.META_LEADER_STEPDOWN, {})

        if (!response.success)
            throw new Error('NATS rejected metadata leader transfer')
    }

    saveRetirement = async (retirement?: Retirement): Promise<void> => {
        const tag = {
            ResourceId: this.groupName,
            ResourceType: 'auto-scaling-group',
            Key: retirementTag,
            PropagateAtLaunch: false,
        }

        if (retirement)
            await this.scaling.send(
                new CreateOrUpdateTagsCommand({ Tags: [{
                    ...tag,
                    Value: JSON.stringify(retirement),
                }] }),
            )
        else
            await this.scaling.send(
                new DeleteTagsCommand({ Tags: [tag] }),
            )
    }

    terminate = async (broker: Broker): Promise<void> =>
        void (await this.scaling.send(
            new TerminateInstanceInAutoScalingGroupCommand({
                InstanceId: broker.id,
                ShouldDecrementDesiredCapacity: true,
            }),
        ))

    close = async (): Promise<void> => {
        await this.system?.close()
        await this.operator?.close()
    }
}

export const handler = async (): Promise<void> => {
    const ports = new AwsScalingPorts(
        process.env.AUTO_SCALING_GROUP!,
        process.env.CREDENTIALS_SECRET_ARN!,
        process.env.TASK_FAMILY!,
    )

    try {
        await new NatsScalingController(ports).reconcile()
    } finally {
        await ports.close()
    }
}
