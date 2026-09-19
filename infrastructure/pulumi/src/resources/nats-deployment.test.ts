import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pulumi from '@pulumi/pulumi'

vi.mock('../helpers/docker/build-helpers.ts', () => ({
    buildDockerImage: () => ({
        imageRef: 'test:local',
        image: undefined,
        repository: undefined,
    }),
}))
vi.mock('../constants/logging.ts', () => ({ LOG_RETENTION_DAYS: 7 }))

const resources: pulumi.runtime.MockResourceArgs[] = []
const invocations: string[] = []
const resolveOutput = <T>(value: pulumi.Input<T>): Promise<T> => new Promise(resolve => void pulumi.output(value).apply(result => void resolve(result)))

beforeAll(async () => {
    process.env.ORG_NAME = 'test'
    process.env.STAGE = 'test'
    process.env.AWS_REGION = 'us-east-1'
    process.env.NATS_OPERATOR_NKEY_SEED = 'synthetic-unused-test-seed'
    pulumi.runtime.setMocks({
        newResource: args => {
            resources.push(args)

            return {
                id: `${args.name}-id`,
                state: {
                    ...args.inputs,
                    arn: `arn:test:${args.name}`,
                    name: args.inputs.name ?? args.name,
                },
            }
        },
        call: args => {
            invocations.push(args.token)

            if (args.token.includes('getAvailabilityZones'))
                return { names: ['us-east-1a', 'us-east-1b', 'us-east-1c'] }

            if (args.token.includes('getInstanceType'))
                return {
                    memorySize: 2048,
                    supportedArchitectures: ['x86_64'],
                }

            if (args.token.includes('getParameter'))
                return { value: 'ami-test-al2023' }

            return args.inputs
        },
    }, 'test', 'test', false)
    const { createNetworkInfrastructure } = await import('./network.ts')
    const { createEcsEc2Cluster } = await import('./ECS-EC2-cluster.ts')
    const { createNatsClusterService } = await import('./NATS-cluster/NATS-cluster.ts')
    const network = await createNetworkInfrastructure()
    const cluster = await createEcsEc2Cluster({
        ...network,
        minCapacity: 3,
        maxCapacity: 9,
        desiredCapacity: 3,
    })
    const broker = await createNatsClusterService({
        ...network,
        ecsCluster: cluster.cluster,
        capacityProviderName: cluster.capacityProvider.name,
        autoScalingGroup: cluster.autoScalingGroup,
        ec2SecurityGroup: cluster.ecsSecurityGroup,
        cloudMapNamespace: { id: pulumi.output('namespace') } as any,
        cloudMapNamespaceName: 'internal.test',
        parentHostedZoneId: 'zone',
        natsRecordName: 'nats.test',
        calloutSecretArn: 'callout',
        authSecretArns: {
            NATS_AUTH_NKEY_ISSUER_SEED: 'issuer',
            NATS_AUTH_XKEY_ISSUER_SEED: 'curve',
            NATS_SERVICE_AUTH_REGISTRATIONS: 'registrations',
        },
        authEnvironment: {
            AUTH0_DOMAIN: 'https://issuer.test',
            AUTH0_API_IDENTIFIER: 'test',
        },
        backupSecretArn: 'backup',
        certificateHelper: {
            getCertificateReference: () => pulumi.output('nats-certificate'),
            getCertificateEnvironment: () => [
                {
                    name: 'CERT_SECRET_NAME',
                    value: 'nats-certificate',
                },
                {
                    name: 'CERT_DOMAIN',
                    value: 'nats.test',
                },
            ],
            getCertificateDownloadScript: () => '',
        },
        environment: {
            NATS_CLUSTER_NAME: 'test',
            NATS_SYS_USER_PASSWORD: 'test',
        } as any,
        dockerBuildContext: 'unused',
        dockerfilePath: 'unused',
    })
    const { createDynamoDbTables } = await import('./db/DynamoDB-tables.ts')
    const tables = await createDynamoDbTables()
    await Promise.all([
        resolveOutput(cluster.launchTemplate.userData), resolveOutput(cluster.autoScalingGroup.urn),
        resolveOutput(broker.ecsService.urn), resolveOutput(broker.taskDefinition.containerDefinitions),
        resolveOutput(broker.backupTaskDefinition.containerDefinitions),
        resolveOutput(broker.serviceDiscoverySidecar.lambdaFunction.environment),
        resolveOutput(tables.usersTable.urn),
    ])
})

describe('NATS infrastructure safety', () => {
    it('keeps the broker on EC2 and uses a 2 GiB minimum default', () => {
        const template = resources.find(resource => resource.type === 'aws:ec2/launchTemplate:LaunchTemplate')!.inputs
        expect(template.instanceType).toBe('t3.small')
        expect(template.imageId).toBe('ami-test-al2023')
        expect(template.metadataOptions.httpTokens).toBe('required')
        const dataVolume = template.blockDeviceMappings.find((volume: any) => volume.deviceName === '/dev/xvdh').ebs
        expect(dataVolume).toMatchObject({
            deleteOnTermination: false,
            encrypted: true,
            volumeType: 'gp3',
            volumeSize: 150,
        })
        const startupScript = Buffer.from(template.userData, 'base64').toString()
        expect(startupScript.includes('ConditionPathIsMountPoint=/data/jetstream'), 'ECS startup must require the JetStream mount').toBe(true)
    })

    it('adds a third zone without moving the existing subnets and avoids automatic refresh', () => {
        const subnets = resources.filter(resource => resource.type === 'aws:ec2/subnet:Subnet').map(resource => resource.inputs)
        expect(subnets.map(subnet => subnet.cidrBlock).sort()).toEqual(['10.0.0.0/24', '10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24', '10.0.4.0/24', '10.0.5.0/24'])
        expect(new Set(subnets.map(subnet => subnet.availabilityZone)).size).toBe(3)
        const group = resources.find(resource => resource.type === 'aws:autoscaling/group:Group')!.inputs
        expect(group).toMatchObject({
            minSize: 3,
            maxSize: 9,
            desiredCapacity: 3,
        })
        expect(group.availabilityZoneDistribution.capacityDistributionStrategy).toBe('balanced-only')
        expect(group.instanceRefresh).toBeUndefined()
        expect(group.suspendedProcesses).toEqual(['AZRebalance', 'ReplaceUnhealthy'])
        const scaling = resources.find(resource => resource.type === 'aws:autoscaling/policy:Policy')!.inputs
        expect(scaling.targetTrackingConfiguration).toMatchObject({
            disableScaleIn: true,
            targetValue: 60,
            predefinedMetricSpecification: { predefinedMetricType: 'ASGAverageCPUUtilization' },
        })
        expect(resources.some(resource => resource.type === 'aws:appautoscaling/target:Target')).toBe(false)
    })

    it('enables continuous 35-day recovery for AWS application tables', () => {
        const tables = resources.filter(resource => resource.type === 'aws:dynamodb/table:Table')
        expect(tables.length).toBeGreaterThan(0)

        for (const table of tables)
            expect(table.inputs.pointInTimeRecovery).toEqual({
                enabled: true,
                recoveryPeriodInDays: 35,
            })
    })

    it('keeps snapshots off broker root disks and native traffic off the public internet', () => {
        const tasks = resources.filter(resource => resource.type === 'aws:ecs/taskDefinition:TaskDefinition')
        expect(tasks.find(resource => resource.inputs.family === 'nats')!.inputs.requiresCompatibilities).toEqual(['EC2'])
        const broker = JSON.parse(tasks.find(resource => resource.inputs.family === 'nats')!.inputs.containerDefinitions)[0]
        const adapter = JSON.parse(tasks.find(resource => resource.inputs.family === 'nats')!.inputs.containerDefinitions)[1]
        expect(broker.environment.some((entry: any) => /AWS|S3|SECRET|METRIC_CLUSTER|CERT_STORAGE_TYPE/.test(entry.name))).toBe(false)
        expect(broker.environment).toEqual(expect.arrayContaining([
            {
                name: 'NATS_NODE_CONFIG_FILE',
                value: '/run/nats-input/node.json',
            },
            {
                name: 'NATS_CERT_FILE',
                value: '/run/nats-input/current/certificate.pem',
            },
        ]))
        expect(broker.dependsOn).toEqual([{
            containerName: 'deployment-adapter',
            condition: 'HEALTHY',
        }])
        expect(adapter.name).toBe('deployment-adapter')
        expect(adapter.environment).toContainEqual({
            name: 'CERT_SECRET_NAME',
            value: 'nats-certificate',
        })
        expect(broker.mountPoints.find((mount: any) => mount.sourceVolume === 'broker-input').readOnly).toBe(true)
        expect(broker.memory).toBe(1024)
        expect(broker.stopTimeout).toBe(120)
        expect(broker.healthCheck.command).toEqual(['CMD', '/usr/local/bin/lixpi-nats', 'health', 'broker'])
        expect(broker.secrets.map((secret: any) => secret.name).sort()).toEqual(['NATS_AUTH_NKEY_ISSUER_SEED', 'NATS_AUTH_XKEY_ISSUER_SEED', 'NATS_CALLOUT_PASSWORD', 'NATS_SERVICE_AUTH_REGISTRATIONS'])
        const backup = JSON.parse(tasks.find(resource => resource.inputs.family === 'nats-backup')!.inputs.containerDefinitions)[0]
        expect(backup.command).toEqual(['backup'])
        expect(backup.secrets).toEqual([{
            name: 'NATS_BACKUP_NKEY_SEED',
            valueFrom: 'backup',
        }])
        expect(tasks.some(resource => resource.inputs.family.includes('nats-auth'))).toBe(false)
        expect(broker.environment).toContainEqual({
            name: 'NATS_WEBSOCKET_ADVERTISE',
            value: 'nats.test:443',
        })
        expect(tasks.find(resource => resource.inputs.family === 'nats-backup')!.inputs).toMatchObject({
            requiresCompatibilities: ['FARGATE'],
            networkMode: 'awsvpc',
            ephemeralStorage: { sizeInGib: 200 },
        })
        const clientRule = resources.find(resource => resource.type === 'aws:ec2/securityGroupRule:SecurityGroupRule' && resource.inputs.fromPort === 4222)!
        expect(clientRule.inputs.cidrBlocks).toEqual(['10.0.0.0/16'])
        const service = resources.find(resource => resource.type === 'aws:ecs/service:Service')!.inputs
        expect(service.serviceRegistries).toBeUndefined()
        expect(service.deploymentMinimumHealthyPercent).toBe(66)
        expect(invocations.some(token => token.includes('getAmi'))).toBe(false)
    })

    it('alerts for failed backup starts, nonzero exits and missing successful snapshots', () => {
        const alarms = resources.filter(resource => resource.type === 'aws:cloudwatch/metricAlarm:MetricAlarm')
        const freshness = alarms.find(resource => resource.inputs.metricName === 'BackupComplete')!.inputs
        expect(freshness).toMatchObject({
            period: 3600,
            evaluationPeriods: 8,
            datapointsToAlarm: 8,
            treatMissingData: 'breaching',
        })
        expect(freshness.alarmActions).toHaveLength(1)
        expect(alarms.find(resource => resource.name === 'nats-backup-launch-failed')!.inputs.metricName).toBe('FailedInvocations')
        const rule = resources.find(resource => resource.name === 'nats-backup-task-failed')!
        const pattern = JSON.parse(rule.inputs.eventPattern)
        expect(pattern.detail.group).toEqual(['family:nats-backup'])
        expect(pattern.detail.lastStatus).toEqual(['STOPPED'])
        expect(pattern.detail.$or).toEqual([{ stopCode: ['TaskFailedToStart'] }, { containers: { exitCode: [{ 'anything-but': 0 }] } }])
        const policy = JSON.parse(resources.find(resource => resource.name === 'nats-backup-alert-events')!.inputs.policy)
        expect(policy.Statement.map((statement: any) => statement.Principal.Service)).toEqual(['events.amazonaws.com', 'cloudwatch.amazonaws.com'])
        const task = resources.find(resource => resource.type === 'aws:ecs/taskDefinition:TaskDefinition' && resource.inputs.family === 'nats-backup')!
        expect(JSON.parse(task.inputs.containerDefinitions)[0].environment).toContainEqual({
            name: 'NATS_METRIC_CLUSTER',
            value: 'nats',
        })
    })
})
