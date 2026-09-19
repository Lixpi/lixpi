import {
    Route53Client,
    ChangeResourceRecordSetsCommand,
    ListResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53'
import {
    ECSClient,
    DescribeContainerInstancesCommand,
    DescribeTasksCommand,
    ListTasksCommand,
} from '@aws-sdk/client-ecs'
import {
    EC2Client,
    DescribeInstancesCommand,
} from '@aws-sdk/client-ec2'
import {
    ServiceDiscoveryClient,
    ListInstancesCommand,
    RegisterInstanceCommand,
    DeregisterInstanceCommand,
} from '@aws-sdk/client-servicediscovery'
import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'

type DiscoveryConfig = {
    clusterArn: string
    taskFamily: string
    hostedZoneId: string
    recordName: string
    discoveryServiceId: string
    admissionToken: string
}

export class NatsDiscovery {
    constructor(
        private readonly config: DiscoveryConfig,
        private readonly ecs = new ECSClient({}),
        private readonly ec2 = new EC2Client({}),
        private readonly route53 = new Route53Client({}),
        private readonly discovery = new ServiceDiscoveryClient({}),
        private readonly probe = fetch,
    ) {}

    private admitsConnections = async (address: string): Promise<boolean> => {
        try {
            const response = await this.probe(
                `http://${address}:3020/ready`,
                {
                    headers: { Authorization: `Bearer ${this.config.admissionToken}` },
                    signal: AbortSignal.timeout(2000),
                    redirect: 'error',
                },
            )
            await response.body?.cancel()

            return response.ok
        } catch {
            return false
        }
    }

    reconcile = async (): Promise<void> => {
        const privateAddresses = new Map<string, string>()
        const publicAddresses = new Set<string>()
        let nextToken: string | undefined

        do {
            const page = await this.ecs.send(
                new ListTasksCommand({
                    cluster: this.config.clusterArn,
                    family: this.config.taskFamily,
                    desiredStatus: 'RUNNING',
                    nextToken,
                    maxResults: 100,
                }),
            )
            nextToken = page.nextToken

            if (!page.taskArns?.length)
                continue

            const tasks = await this.ecs.send(
                new DescribeTasksCommand({
                    cluster: this.config.clusterArn,
                    tasks: page.taskArns,
                }),
            )

            if (tasks.failures?.length)
                throw new Error('Incomplete ECS task inventory; refusing DNS mutation')

            for (const task of tasks.tasks ?? []) {
                if (
                    task.lastStatus !== 'RUNNING'
                    || !task.containerInstanceArn
                )
                    continue

                if (!task.taskDefinitionArn?.includes(`task-definition/${this.config.taskFamily}:`))
                    continue

                const hosts = await this.ecs.send(
                    new DescribeContainerInstancesCommand({
                        cluster: this.config.clusterArn,
                        containerInstances: [task.containerInstanceArn],
                    }),
                )
                const instanceId = hosts.containerInstances?.[0]?.ec2InstanceId

                if (
                    hosts.failures?.length
                    || !instanceId
                )
                    throw new Error('Missing EC2 host in discovery inventory')

                const instances = await this.ec2.send(
                    new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
                )
                const instance = instances.Reservations?.[0]?.Instances?.[0]

                if (!instance?.PrivateIpAddress)
                    throw new Error('Missing private broker address')

                // Routes must discover starting peers before JetStream can form quorum.
                privateAddresses.set(instanceId, instance.PrivateIpAddress)

                if (
                    task.healthStatus === 'HEALTHY'
                    && instance.PublicIpAddress
                    && (await this.admitsConnections(instance.PrivateIpAddress))
                )
                    publicAddresses.add(instance.PublicIpAddress)
            }
        } while (nextToken)

        const registered = new Map<string, string | undefined>()
        let discoveryToken: string | undefined

        do {
            const page = await this.discovery.send(
                new ListInstancesCommand({
                    ServiceId: this.config.discoveryServiceId,
                    NextToken: discoveryToken,
                }),
            )
            discoveryToken = page.NextToken

            for (const instance of page.Instances ?? [])
                if (instance.Id)
                    registered.set(instance.Id, instance.Attributes?.AWS_INSTANCE_IPV4)
        } while (discoveryToken)

        for (const [id, address] of privateAddresses)
            if (registered.get(id) !== address)
                await this.discovery.send(
                    new RegisterInstanceCommand({
                        ServiceId: this.config.discoveryServiceId,
                        InstanceId: id,
                        Attributes: {
                            AWS_INSTANCE_IPV4: address,
                            AWS_INSTANCE_PORT: '4222',
                        },
                    }),
                )

        for (const id of registered.keys())
            if (!privateAddresses.has(id))
                await this.discovery.send(
                    new DeregisterInstanceCommand({
                        ServiceId: this.config.discoveryServiceId,
                        InstanceId: id,
                    }),
                )

        const records = await this.route53.send(
            new ListResourceRecordSetsCommand({
                HostedZoneId: this.config.hostedZoneId,
                StartRecordName: this.config.recordName,
                StartRecordType: 'A',
                MaxItems: 1,
            }),
        )
        const existing = records.ResourceRecordSets?.find(record => record.Type === 'A' && record.Name?.replace(/\.$/, '') === this.config.recordName)
        const addresses = [...publicAddresses].sort()

        if (JSON.stringify(existing?.ResourceRecords?.map(record => record.Value).sort() ?? []) === JSON.stringify(addresses))
            return

        if (
            !addresses.length
            && !existing
        )
            return

        await this.route53.send(
            new ChangeResourceRecordSetsCommand({
                HostedZoneId: this.config.hostedZoneId,
                ChangeBatch: {
                    Changes: [{
                        Action: addresses.length ? 'UPSERT' : 'DELETE',
                        ResourceRecordSet: addresses.length ? {
                            Name: this.config.recordName,
                            Type: 'A',
                            TTL: 30,
                            ResourceRecords: addresses.map(Value => ({ Value })),
                        } : existing!,
                    }],
                },
            }),
        )
    }
}

export const handler = async (): Promise<void> => {
    const required = (name: string): string => {
        const value = process.env[name]

        if (!value)
            throw new Error(`Missing ${name}`)

        return value
    }
    const secret = await new SecretsManagerClient({}).send(
        new GetSecretValueCommand({ SecretId: required('NATS_ADMISSION_SECRET_ARN') }),
    )

    if (!secret.SecretString)
        throw new Error('Missing admission probe credential')

    await new NatsDiscovery({
        clusterArn: required('ECS_CLUSTER_ARN'),
        taskFamily: required('NATS_TASK_FAMILY'),
        hostedZoneId: required('ROUTE53_HOSTED_ZONE_ID'),
        recordName: required('NATS_RECORD_NAME'),
        discoveryServiceId: required('NATS_DISCOVERY_SERVICE_ID'),
        admissionToken: secret.SecretString,
    }).reconcile()
}
