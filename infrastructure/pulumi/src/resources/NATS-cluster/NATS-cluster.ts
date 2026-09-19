import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../../helpers/docker/build-helpers.ts'
import { createServiceDiscoverySidecar } from './nats-service-discovery-sidecar.ts'
import { createNatsScalingController } from './nats-scaling-controller.ts'
import {
    type CertificateHelper,
} from '../certificate-manager/certificate-helper.ts'
import { createNatsExecutionRole } from './credentials.ts'
import { LOG_RETENTION_DAYS } from '../../constants/logging.ts'

const {
    ORG_NAME,
    STAGE,
    NATS_AUTH_NKEY_ISSUER_PUBLIC,
    NATS_AUTH_XKEY_ISSUER_PUBLIC,
    DOMAIN_NAME,
} = process.env

export type NatsClusterServiceArgs = {
    // Infrastructure
    cloudMapNamespace: aws.servicediscovery.PrivateDnsNamespace
    cloudMapNamespaceName: string

    // Route53 configuration for public client access
    parentHostedZoneId: pulumi.Input<string> // The main domain hosted zone ID for Route53 records
    natsRecordName: string // e.g., "nats.shelby-dev.lixpi.dev"

    ecsCluster: { // Add back ECS cluster - Fargate tasks can run on any cluster
        id: pulumi.Output<string>
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }
    capacityProviderName: pulumi.Input<string>
    autoScalingGroup: aws.autoscaling.Group
    scaleInCpuPercent?: number
    ec2SecurityGroup: aws.ec2.SecurityGroup
    vpc: aws.ec2.Vpc
    publicSubnets: aws.ec2.Subnet[]
    privateSubnets: aws.ec2.Subnet[]

    serviceName?: string
    clientPort?: number
    httpManagementPort?: number
    clusterRoutingPort?: number
    cpu?: number
    memory?: number

    // App configuration
    environment: {
        NATS_CLUSTER_NAME: string
        NATS_SERVER_NAME_BASE: string
        NATS_AUTH_NKEY_ISSUER_PUBLIC: string
        NATS_AUTH_XKEY_ISSUER_PUBLIC: string
        NATS_SAME_ORIGIN: string
        NATS_ALLOWED_ORIGINS: string
        NATS_DEBUG_MODE: string
        NATS_TRACE_MODE: string
        NATS_SYS_USER_PASSWORD: string
    }

    calloutSecretArn: pulumi.Input<string>
    authSecretArns: Record<string, pulumi.Input<string>>
    authEnvironment: Record<string, string>
    backupSecretArn: pulumi.Input<string>

    // Certificate management (optional - if provided, uses real TLS certs instead of self-signed)
    certificateHelper?: CertificateHelper

    // Docker build context
    dockerBuildContext: string
    dockerfilePath: string

    // Dependencies (CRITICAL: NATS must wait for certificates)
    dependencies?: pulumi.Resource[]
}

export const createNatsClusterService = async (args: NatsClusterServiceArgs) => {
    const {
        cloudMapNamespace,
        cloudMapNamespaceName,
        parentHostedZoneId,
        natsRecordName,
        ecsCluster,
        capacityProviderName,
        ec2SecurityGroup,
        vpc,
        publicSubnets,
        privateSubnets,
        serviceName = 'nats',
        clientPort = 4222, // Client connections
        httpManagementPort = 8222, // HTTP management/info
        clusterRoutingPort = 6222, // Cluster routing
        cpu = 1024,
        memory = 1024,
        environment,
        certificateHelper,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [], // Extract dependencies with empty default
    } = args

    const certificateEnvironment = certificateHelper?.getCertificateEnvironment() ?? []
    const certificateSecret = certificateEnvironment.find(entry => entry.name === 'CERT_SECRET_NAME')?.value
    const certificateDomain = certificateEnvironment.find(entry => entry.name === 'CERT_DOMAIN')?.value

    if (
        !certificateSecret
        || !certificateDomain
    )
        throw new Error('The AWS NATS deployment requires its certificate secret and domain')

    // Pure CloudMap approach - no load balancers ever!

    // Build and push NATS Docker image to ECR
    const {
        repository,
        image,
        imageRef,
        repositoryUrl,
    } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: false,
        noCache: true,
    }) as DockerImageBuildResult

    const deploymentAdapter = buildDockerImage({
        imageName: `${serviceName}-deployment-adapter`,
        dockerBuildContext: '/usr/src/service/infrastructure/pulumi/src/resources/NATS-cluster/deployment-adapter',
        dockerfilePath: '/usr/src/service/infrastructure/pulumi/src/resources/NATS-cluster/deployment-adapter/Dockerfile',
        buildArgs: { NATS_IMAGE: imageRef },
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: false,
    }) as DockerImageBuildResult

    // Create PRIVATE CloudMap service for internal cluster communication
    const privateDiscoveryService = new aws.servicediscovery.Service(
        `${serviceName}-private-discovery`,
        {
            name: 'nats',
            namespaceId: cloudMapNamespace.id,
            dnsConfig: {
                namespaceId: cloudMapNamespace.id,
                dnsRecords: [{
                    ttl: 10,
                    type: 'A',
                }],
                routingPolicy: 'MULTIVALUE',
            },
            healthCheckCustomConfig: {
                failureThreshold: 1,
            },
        },
    )

    // Create Lambda service discovery sidecar to manage Route53 public DNS records
    // This MUST be created before the ECS service to handle task state changes
    const serviceDiscoverySidecar = await createServiceDiscoverySidecar({
        route53HostedZoneId: parentHostedZoneId,
        natsRecordName: natsRecordName,
        taskFamily: serviceName,
        discoveryService: privateDiscoveryService,
        admissionSecretArn: args.calloutSecretArn,
        ecsCluster: ecsCluster,
        vpc: vpc,
        privateSubnets: privateSubnets,
        functionName: `${serviceName}-sidecar`,
        timeout: 60,
        memorySize: 512,
        dockerBuildContext: '/usr/src/service/infrastructure/pulumi/src/resources/NATS-cluster/nats-service-discovery-sidecar',
        dockerfilePath: '/usr/src/service/infrastructure/pulumi/src/resources/NATS-cluster/nats-service-discovery-sidecar/Dockerfile',
    })

    // ECS Task Execution Role - used by ECS agent
    const executionRole = createNatsExecutionRole(`${serviceName}-exec-role`, [args.calloutSecretArn, ...Object.values(args.authSecretArns)])
    const backupExecutionRole = createNatsExecutionRole(`${serviceName}-backup-exec-role`, [args.backupSecretArn])

    // Add ECR permissions to allow pulling images
    new aws.iam.RolePolicyAttachment(
        `${serviceName}-ecr-policy`,
        {
            role: executionRole.name,
            policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
        },
    )

    // ECS Task Role - used by the containers
    const taskRole = new aws.iam.Role(
        `${serviceName}-task-role`,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Action: 'sts:AssumeRole',
                    Effect: 'Allow',
                    Principal: {
                        Service: 'ecs-tasks.amazonaws.com',
                    },
                }],
            }),
        },
    )

    const backupTaskRole = new aws.iam.Role(
        `${serviceName}-backup-task-role`,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: 'sts:AssumeRole',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                }],
            }),
        },
    )
    const backupSecurityGroup = new aws.ec2.SecurityGroup(
        `${serviceName}-backup-sg`,
        {
            vpcId: vpc.id,
            ingress: [],
            egress: [{
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
            }],
        },
    )
    const backupBucket = new aws.s3.BucketV2(
        `${serviceName}-backups`,
        {
            forceDestroy: false,
            tags: {
                Workload: 'NATS',
                Purpose: 'JetStream backups',
            },
        },
    )
    new aws.s3.BucketVersioningV2(
        `${serviceName}-backup-versioning`,
        {
            bucket: backupBucket.id,
            versioningConfiguration: { status: 'Enabled' },
        },
    )
    new aws.s3.BucketServerSideEncryptionConfigurationV2(
        `${serviceName}-backup-encryption`,
        {
            bucket: backupBucket.id,
            rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
        },
    )
    new aws.s3.BucketPublicAccessBlock(
        `${serviceName}-backup-public-access`,
        {
            bucket: backupBucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        },
    )
    new aws.s3.BucketLifecycleConfigurationV2(
        `${serviceName}-backup-lifecycle`,
        {
            bucket: backupBucket.id,
            rules: [{
                id: 'expire-old-jetstream-snapshots',
                status: 'Enabled',
                expiration: { days: 35 },
                noncurrentVersionExpiration: { noncurrentDays: 7 },
            }],
        },
    )
    const backupPolicy = new aws.iam.Policy(
        `${serviceName}-backup-policy`,
        {
            policy: backupBucket.arn.apply(
                bucketArn =>
                    JSON.stringify({
                        Version: '2012-10-17',
                        Statement: [{
                            Effect: 'Allow',
                            Action: ['s3:GetObject', 's3:ListBucket', 's3:PutObject'],
                            Resource: [bucketArn, `${bucketArn}/*`],
                        }, {
                            Effect: 'Allow',
                            Action: ['cloudwatch:PutMetricData'],
                            Resource: '*',
                            Condition: { StringEquals: { 'cloudwatch:namespace': 'Lixpi/NATS' } },
                        }],
                    }),
            ),
        },
    )
    new aws.iam.RolePolicyAttachment(
        `${serviceName}-backup-policy-attachment`,
        {
            role: backupTaskRole.name,
            policyArn: backupPolicy.arn,
        },
    )

    // Allow CloudWatch Logs
    const logsPolicy = new aws.iam.Policy(
        `${serviceName}-logs-policy`,
        {
            policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: [
                        'logs:CreateLogGroup',
                        'logs:CreateLogStream',
                        'logs:PutLogEvents',
                        'logs:DescribeLogStreams',
                    ],
                    Resource: 'arn:aws:logs:*:*:*',
                }],
            }),
        },
    )

    new aws.iam.RolePolicyAttachment(
        `${serviceName}-logs-attachment`,
        {
            role: taskRole.name,
            policyArn: logsPolicy.arn,
        },
    )

    const certificateAlerts = new aws.sns.Topic(`${serviceName}-certificate-alerts`, {})

    if (process.env.NATS_OPERATIONAL_ALERT_EMAIL)
        new aws.sns.TopicSubscription(
            `${serviceName}-certificate-alert-email`,
            {
                topic: certificateAlerts.arn,
                protocol: 'email',
                endpoint: process.env.NATS_OPERATIONAL_ALERT_EMAIL,
            },
        )

    // Add certificate access permissions if certificate helper is provided
    if (certificateHelper) {
        const certAccessPolicy = new aws.iam.Policy(
            `${serviceName}-cert-access-policy`,
            {
                policy: certificateHelper.getCertificateReference().apply(
                    secretName => JSON.stringify({
                        Version: '2012-10-17',
                        Statement: [{
                            Effect: 'Allow',
                            Action: [
                                'secretsmanager:GetSecretValue',
                                'secretsmanager:DescribeSecret',
                            ],
                            Resource: `arn:aws:secretsmanager:${aws.config.region}:*:secret:${secretName}-??????`,
                        }, {
                            Effect: 'Allow',
                            Action: ['cloudwatch:PutMetricData'],
                            Resource: '*',
                            Condition: { StringEquals: { 'cloudwatch:namespace': 'Lixpi/NATS' } },
                        }],
                    }),
                ),
            },
        )

        new aws.iam.RolePolicyAttachment(
            `${serviceName}-cert-access-attachment`,
            {
                role: taskRole.name,
                policyArn: certAccessPolicy.arn,
            },
        )

        for (const metricName of ['CertificateRefreshHealthy', 'CertificateValidBeyondSevenDays']) {
            new aws.cloudwatch.MetricAlarm(
                `${serviceName}-${metricName}`,
                {
                    namespace: 'Lixpi/NATS',
                    metricName,
                    dimensions: { Cluster: serviceName },
                    statistic: 'Minimum',
                    period: 600,
                    evaluationPeriods: 2,
                    threshold: 1,
                    comparisonOperator: 'LessThanThreshold',
                    treatMissingData: 'breaching',
                    alarmActions: [certificateAlerts.arn],
                },
            )
        }
    }

    const ingressRules = [
        {
            name: 'admission-health',
            fromPort: 3020,
            toPort: 3020,
            cidrBlocks: [vpc.cidrBlock],
        },
        {
            name: 'client',
            fromPort: clientPort,
            toPort: clientPort,
            cidrBlocks: [vpc.cidrBlock],
        },
        {
            name: 'websocket',
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ['0.0.0.0/0'],
        },
        {
            name: 'management',
            fromPort: httpManagementPort,
            toPort: httpManagementPort,
            cidrBlocks: [vpc.cidrBlock],
        },
        {
            name: 'routing',
            fromPort: clusterRoutingPort,
            toPort: clusterRoutingPort,
            cidrBlocks: [vpc.cidrBlock],
        },
    ].map(
        rule =>
            new aws.ec2.SecurityGroupRule(
                `${serviceName}-${rule.name}-ingress`,
                {
                    type: 'ingress',
                    securityGroupId: ec2SecurityGroup.id,
                    protocol: 'tcp',
                    fromPort: rule.fromPort,
                    toPort: rule.toPort,
                    cidrBlocks: rule.cidrBlocks,
                },
            ),
    )

    // Create CloudWatch Log Group for Container
    const logGroup = new aws.cloudwatch.LogGroup(
        `${serviceName}-logs`,
        {
            name: `/aws/ecs/${serviceName}`,
            retentionInDays: LOG_RETENTION_DAYS,
        },
    )

    // log('cloudMapNamespace:', {
    //     'cloudMapNamespace.hostedZone': cloudMapNamespace.hostedZone,
    //     'cloudMapNamespace.arn': cloudMapNamespace.arn,
    //     'cloudMapNamespace.name': cloudMapNamespace.name,
    //     'cloudMapNamespace.id': cloudMapNamespace.id,
    //     'cloudMapNamespace.tags': cloudMapNamespace.tags,
    //     'cloudMapNamespace.vpc': cloudMapNamespace.vpc,

    // })

    // Create ECS Task Definition (with command line arguments for server name)
    const taskDefinition = new aws.ecs.TaskDefinition(
        `${serviceName}-task`,
        {
            family: serviceName,
            cpu: `${cpu + 64}`,
            memory: `${memory + 128}`,
            networkMode: 'host',
            requiresCompatibilities: ['EC2'],
            executionRoleArn: executionRole.arn,
            taskRoleArn: taskRole.arn,
            containerDefinitions: pulumi.all([
                logGroup.name,
                imageRef,
                deploymentAdapter.imageRef,
                args.calloutSecretArn,
                pulumi.output(args.authSecretArns),
            ]).apply(
                ([logGroupName, imageReference, adapterImage, calloutSecretArn, authSecrets]) =>
                    JSON.stringify([{
                        name: serviceName,
                        image: imageReference,
                        cpu: cpu,
                        memory: memory,
                        essential: true,
                        stopTimeout: 120,
                        dependsOn: [{
                            containerName: 'deployment-adapter',
                            condition: 'HEALTHY',
                        }],
                        portMappings: [
                            {
                                containerPort: clientPort,
                                hostPort: clientPort,
                                protocol: 'tcp',
                            },
                            {
                                containerPort: httpManagementPort,
                                hostPort: httpManagementPort,
                                protocol: 'tcp',
                            },
                            {
                                containerPort: 443,
                                hostPort: 443,
                                protocol: 'tcp',
                            },
                            {
                                containerPort: clusterRoutingPort,
                                hostPort: clusterRoutingPort,
                                protocol: 'tcp',
                            },
                        ],
                        mountPoints: [{
                            sourceVolume: 'jetstream-data',
                            containerPath: '/data/jetstream',
                            readOnly: false,
                        }, {
                            sourceVolume: 'broker-input',
                            containerPath: '/run/nats-input',
                            readOnly: true,
                        }],
                        secrets: [{
                            name: 'NATS_CALLOUT_PASSWORD',
                            valueFrom: calloutSecretArn,
                        }, ...Object.entries(authSecrets).map(
                            ([name, valueFrom]) => ({
                                name,
                                valueFrom,
                            }),
                        )],
                        environment: [
                            ...Object.entries(args.authEnvironment).map(
                                ([name, value]) => ({
                                    name,
                                    value,
                                }),
                            ),
                            {
                                name: 'NATS_PERSIST_SERVER_NAME',
                                value: 'true',
                            },
                            {
                                name: 'NATS_MAX_MEMORY_STORE',
                                value: '256M',
                            },
                            {
                                name: 'NATS_JETSTREAM_UNIQUE_TAG',
                                value: process.env.NATS_JETSTREAM_UNIQUE_TAG ?? 'az:',
                            },
                            {
                                name: 'GOMEMLIMIT',
                                value: '768MiB',
                            },
                            {
                                name: 'NATS_CLUSTER_NAME',
                                value: environment.NATS_CLUSTER_NAME,
                            },
                            {
                                name: 'NATS_SERVER_NAME_BASE',
                                value: environment.NATS_SERVER_NAME_BASE,
                            },
                            {
                                name: 'NATS_AUTH_NKEY_ISSUER_PUBLIC',
                                value: environment.NATS_AUTH_NKEY_ISSUER_PUBLIC,
                            },
                            {
                                name: 'NATS_AUTH_XKEY_ISSUER_PUBLIC',
                                value: environment.NATS_AUTH_XKEY_ISSUER_PUBLIC,
                            },
                            {
                                name: 'NATS_SAME_ORIGIN',
                                value: environment.NATS_SAME_ORIGIN,
                            },
                            {
                                name: 'NATS_ALLOWED_ORIGINS',
                                value: environment.NATS_ALLOWED_ORIGINS,
                            },
                            {
                                name: 'NATS_DEBUG_MODE',
                                value: environment.NATS_DEBUG_MODE,
                            },
                            {
                                name: 'NATS_TRACE_MODE',
                                value: environment.NATS_TRACE_MODE,
                            },
                            {
                                name: 'NATS_SYS_USER_PASSWORD',
                                value: environment.NATS_SYS_USER_PASSWORD,
                            },
                            {
                                name: 'NATS_WEBSOCKET_ADVERTISE',
                                value: `${natsRecordName}:443`,
                            },
                            {
                                name: 'NATS_NODE_CONFIG_FILE',
                                value: '/run/nats-input/node.json',
                            },
                            {
                                name: 'NATS_CERT_FILE',
                                value: '/run/nats-input/current/certificate.pem',
                            },
                            {
                                name: 'NATS_KEY_FILE',
                                value: '/run/nats-input/current/private-key.pem',
                            },
                            {
                                name: 'CERT_DOMAIN',
                                value: certificateDomain,
                            },
                        ],
                        // Use CloudMap as seed server - nodes will attempt to connect to the CloudMap DNS
                        // NATS is smart enough to handle self-connections and will discover other nodes through gossip
                        command: [
                            '--routes',
                            `nats://sys:${environment.NATS_SYS_USER_PASSWORD}@nats.${cloudMapNamespaceName}:6222`,
                        ],
                        logConfiguration: {
                            logDriver: 'awslogs',
                            options: {
                                'awslogs-group': logGroupName,
                                'awslogs-region': aws.config.region,
                                'awslogs-stream-prefix': 'ecs',
                                'awslogs-create-group': 'true',
                            },
                        },
                        healthCheck: {
                            command: ['CMD', '/usr/local/bin/lixpi-nats', 'health', 'broker'],
                            interval: 30,
                            timeout: 5,
                            retries: 3,
                            startPeriod: 60,
                        },
                    }, {
                        name: 'deployment-adapter',
                        image: adapterImage,
                        essential: true,
                        cpu: 64,
                        memory: 128,
                        command: ['serve'],
                        mountPoints: [{
                            sourceVolume: 'broker-input',
                            containerPath: '/run/nats-input',
                            readOnly: false,
                        }],
                        secrets: [{
                            name: 'NATS_CALLOUT_PASSWORD',
                            valueFrom: calloutSecretArn,
                        }],
                        environment: [
                            {
                                name: 'NATS_INPUT_DIRECTORY',
                                value: '/run/nats-input',
                            },
                            {
                                name: 'CERT_SECRET_NAME',
                                value: certificateSecret,
                            },
                            {
                                name: 'NATS_METRIC_CLUSTER',
                                value: serviceName,
                            },
                            {
                                name: 'AWS_REGION',
                                value: aws.config.region || '',
                            },
                        ],
                        healthCheck: {
                            command: ['CMD', 'node', '-e', "const fs=require('node:fs'); for(const p of ['node.json','current/certificate.pem','current/private-key.pem']) fs.accessSync('/run/nats-input/'+p)"],
                            interval: 10,
                            timeout: 5,
                            retries: 3,
                            startPeriod: 60,
                        },
                        logConfiguration: {
                            logDriver: 'awslogs',
                            options: {
                                'awslogs-group': logGroupName,
                                'awslogs-region': aws.config.region,
                                'awslogs-stream-prefix': 'deployment-adapter',
                            },
                        },
                    }]),
            ),
            volumes: [{
                name: 'jetstream-data',
                hostPath: '/data/jetstream',
            }, { name: 'broker-input' }],
        },
    )

    const backupTaskDefinition = new aws.ecs.TaskDefinition(
        `${serviceName}-backup-task`,
        {
            family: `${serviceName}-backup`,
            networkMode: 'awsvpc',
            requiresCompatibilities: ['FARGATE'],
            cpu: '256',
            memory: '512',
            ephemeralStorage: { sizeInGib: 200 },
            executionRoleArn: backupExecutionRole.arn,
            taskRoleArn: backupTaskRole.arn,
            containerDefinitions: pulumi.all([deploymentAdapter.imageRef, backupBucket.bucket, logGroup.name, args.backupSecretArn]).apply(
                ([
                    imageReference,
                    bucketName,
                    logGroupName,
                    backupSecretArn,
                ]) =>
                    JSON.stringify([{
                        name: 'nats-backup',
                        image: imageReference,
                        essential: true,
                        cpu: 256,
                        memory: 512,
                        command: ['backup'],
                        secrets: [{
                            name: 'NATS_BACKUP_NKEY_SEED',
                            valueFrom: backupSecretArn,
                        }],
                        environment: [
                            {
                                name: 'NATS_BACKUP_BUCKET',
                                value: bucketName,
                            },
                            {
                                name: 'NATS_BACKUP_PREFIX',
                                value: 'jetstream',
                            },
                            {
                                name: 'NATS_METRIC_CLUSTER',
                                value: serviceName,
                            },
                            {
                                name: 'AWS_REGION',
                                value: aws.config.region || '',
                            },
                            {
                                name: 'NATS_URL',
                                value: `nats://nats.${cloudMapNamespaceName}:${clientPort}`,
                            },
                            {
                                name: 'NATS_SNAPSHOT_DIR',
                                value: '/snapshots',
                            },
                        ],
                        logConfiguration: {
                            logDriver: 'awslogs',
                            options: {
                                'awslogs-group': logGroupName,
                                'awslogs-region': aws.config.region,
                                'awslogs-stream-prefix': 'backup',
                            },
                        },
                    }]),
            ),
        },
    )

    const backupScheduleRole = new aws.iam.Role(
        `${serviceName}-backup-schedule-role`,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: 'sts:AssumeRole',
                    Principal: { Service: 'events.amazonaws.com' },
                }],
            }),
        },
    )
    const backupSchedulePolicy = new aws.iam.Policy(
        `${serviceName}-backup-schedule-policy`,
        {
            policy: pulumi.all([backupTaskDefinition.arn, backupExecutionRole.arn, backupTaskRole.arn]).apply(
                ([
                    taskDefinitionArn,
                    executionRoleArn,
                    taskRoleArn,
                ]) =>
                    JSON.stringify({
                        Version: '2012-10-17',
                        Statement: [
                            {
                                Effect: 'Allow',
                                Action: 'ecs:RunTask',
                                Resource: taskDefinitionArn,
                            },
                            {
                                Effect: 'Allow',
                                Action: 'iam:PassRole',
                                Resource: [executionRoleArn, taskRoleArn],
                            },
                        ],
                    }),
            ),
        },
    )
    new aws.iam.RolePolicyAttachment(
        `${serviceName}-backup-schedule-attachment`,
        {
            role: backupScheduleRole.name,
            policyArn: backupSchedulePolicy.arn,
        },
    )
    const backupSchedule = new aws.cloudwatch.EventRule(
        `${serviceName}-backup-schedule`,
        {
            scheduleExpression: 'cron(17 */6 * * ? *)',
            description: 'Back up AUTH JetStream streams to versioned S3 storage every six hours',
        },
    )
    new aws.cloudwatch.EventTarget(
        `${serviceName}-backup-target`,
        {
            rule: backupSchedule.name,
            arn: ecsCluster.arn,
            roleArn: backupScheduleRole.arn,
            ecsTarget: {
                launchType: 'FARGATE',
                networkConfiguration: {
                    subnets: privateSubnets.map(subnet => subnet.id),
                    securityGroups: [backupSecurityGroup.id],
                    assignPublicIp: false,
                },
                taskCount: 1,
                taskDefinitionArn: backupTaskDefinition.arn,
            },
        },
    )

    const backupAlerts = new aws.sns.Topic(`${serviceName}-backup-alerts`, {})

    if (process.env.NATS_OPERATIONAL_ALERT_EMAIL)
        new aws.sns.TopicSubscription(
            `${serviceName}-backup-alert-email`,
            {
                topic: backupAlerts.arn,
                protocol: 'email',
                endpoint: process.env.NATS_OPERATIONAL_ALERT_EMAIL,
            },
        )

    const backupLaunchAlarm = new aws.cloudwatch.MetricAlarm(
        `${serviceName}-backup-launch-failed`,
        {
            namespace: 'AWS/Events',
            metricName: 'FailedInvocations',
            dimensions: { RuleName: backupSchedule.name },
            statistic: 'Sum',
            period: 300,
            evaluationPeriods: 1,
            threshold: 1,
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            treatMissingData: 'notBreaching',
            alarmActions: [backupAlerts.arn],
        },
    )
    const backupStaleAlarm = new aws.cloudwatch.MetricAlarm(
        `${serviceName}-backup-stale`,
        {
            namespace: 'Lixpi/NATS',
            metricName: 'BackupComplete',
            dimensions: { Cluster: serviceName },
            statistic: 'Sum',
            period: 3600,
            evaluationPeriods: 8,
            datapointsToAlarm: 8,
            threshold: 1,
            comparisonOperator: 'LessThanThreshold',
            treatMissingData: 'breaching',
            alarmActions: [backupAlerts.arn],
            alarmDescription: 'No completed AUTH snapshot in eight hourly periods; the schedule runs every six hours',
        },
    )
    const backupTaskFailed = new aws.cloudwatch.EventRule(
        `${serviceName}-backup-task-failed`,
        {
            eventPattern: pulumi.jsonStringify({
                source: ['aws.ecs'],
                'detail-type': ['ECS Task State Change'],
                detail: {
                    clusterArn: [ecsCluster.arn],
                    group: [`family:${serviceName}-backup`],
                    lastStatus: ['STOPPED'],
                    $or: [
                        { stopCode: ['TaskFailedToStart'] },
                        { containers: { exitCode: [{ 'anything-but': 0 }] } },
                    ],
                },
            }),
        },
    )
    new aws.sns.TopicPolicy(
        `${serviceName}-backup-alert-events`,
        {
            arn: backupAlerts.arn,
            policy: pulumi.jsonStringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Service: 'events.amazonaws.com' },
                    Action: 'sns:Publish',
                    Resource: backupAlerts.arn,
                    // EventBridge's SNS integration does not support policy conditions.
                }, {
                    Effect: 'Allow',
                    Principal: { Service: 'cloudwatch.amazonaws.com' },
                    Action: 'sns:Publish',
                    Resource: backupAlerts.arn,
                    Condition: { ArnEquals: { 'aws:SourceArn': [backupLaunchAlarm.arn, backupStaleAlarm.arn] } },
                }],
            }),
        },
    )
    new aws.cloudwatch.EventTarget(
        `${serviceName}-backup-failure-alert`,
        {
            rule: backupTaskFailed.name,
            arn: backupAlerts.arn,
        },
    )

    // Create SINGLE ECS Service registered with public CloudMap
    // The private CloudMap service will be used for manual instance registration via ECS task metadata
    const ecsService = new aws.ecs.Service(
        `${serviceName}-service`,
        {
            cluster: ecsCluster.id,
            taskDefinition: taskDefinition.arn,
            capacityProviderStrategies: [{
                capacityProvider: capacityProviderName,
                weight: 1,
            }],
            schedulingStrategy: 'DAEMON',
            deploymentMinimumHealthyPercent: 66,
            deploymentMaximumPercent: 100,
            deploymentCircuitBreaker: {
                enable: true,
                rollback: true,
            },
            // Host networking cannot use ECS-managed A records. The reconciler owns them.
            forceNewDeployment: true,
            enableExecuteCommand: true, // Enable for debugging
            waitForSteadyState: false, // Don't wait - let it deploy async
        },
        {
            customTimeouts: {
                create: '10m',
                update: '10m',
                delete: '10m',
            },
            dependsOn: [
                serviceDiscoverySidecar.lambdaFunction, // Ensure Lambda is ready to handle events
                ...ingressRules,
                ...dependencies, // CRITICAL: Wait for certificate generation before starting NATS
            ],
        },
    )

    // Note: Public access is now through CloudMap public namespace with subdomain delegation
    // Private cluster communication uses CloudMap private namespace

    // A DAEMON service follows EC2 hosts and has no scalable DesiredCount.
    const scaling = createNatsScalingController({
        name: serviceName,
        autoScalingGroup: args.autoScalingGroup,
        vpc,
        privateSubnets,
        systemPassword: environment.NATS_SYS_USER_PASSWORD,
        operatorSeed: process.env.NATS_OPERATOR_NKEY_SEED!,
        brokerMemoryMiB: memory,
        scaleInCpuPercent: args.scaleInCpuPercent,
    })

    return {
        // Resources
        repository,
        image,
        privateDiscoveryService,
        serviceDiscoverySidecar,
        taskDefinition,
        backupTaskDefinition,
        backupBucket,
        executionRole,
        taskRole,
        logGroup,
        ecsService,
        scaling,
        natsSecurityGroup: ec2SecurityGroup,

        // Outputs
        outputs: {
            serviceName: ecsService.name,
            serviceArn: ecsService.id,
            scalingAlertsTopicArn: scaling.alerts.arn,
            // Internal cluster communication via private CloudMap
            natsUrl: pulumi.interpolate`nats://nats.${cloudMapNamespaceName}:${clientPort}`,
            natsWebSocketUrl: pulumi.interpolate`wss://${natsRecordName}:443`,
            // Public client access via Route53 (will have public IPs registered automatically by Lambda)
            publicNatsWebSocketUrl: pulumi.interpolate`wss://${natsRecordName}:443`,
            clientPort,
            clusterRoutingPort,
            httpManagementPort,
            serviceEndpoint: pulumi.interpolate`nats.${cloudMapNamespaceName}:${clientPort}`,
            publicServiceEndpoint: pulumi.interpolate`${natsRecordName}:${clientPort}`,
            // Service discovery sidecar outputs
            serviceDiscoveryLambdaArn: serviceDiscoverySidecar.outputs.functionArn,
            certificateAlertsTopicArn: certificateAlerts.arn,
            backupAlertsTopicArn: backupAlerts.arn,
            serviceDiscoveryLambdaFunction: serviceDiscoverySidecar.lambdaFunction, // For explicit dependencies
        },
    }
}
