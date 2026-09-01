import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../../helpers/docker/build-helpers.ts'
import { createServiceDiscoverySidecar } from './nats-service-discovery-sidecar.ts'
import {
    type CertificateHelper,
} from '../certificate-manager/certificate-helper.ts'
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
    minCount?: number
    maxCount?: number
    desiredCount?: number

    // App configuration
    environment: {
        NATS_CLUSTER_NAME: string
        NATS_SERVER_NAME_BASE: string
        NATS_AUTH_NKEY_ISSUER_PUBLIC: string
        NATS_AUTH_XKEY_ISSUER_PUBLIC: string
        NATS_NEX_NODE_NKEY_PUBLIC: string
        NATS_SAME_ORIGIN: string
        NATS_ALLOWED_ORIGINS: string
        NATS_DEBUG_MODE: string
        NATS_TRACE_MODE: string
        NATS_SYS_USER_PASSWORD: string
        NATS_REGULAR_USER_PASSWORD: string
    }

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
        cpu = 256,
        memory = 512,
        minCount = 1,
        maxCount = 3,
        desiredCount = 3,
        environment,
        certificateHelper,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [], // Extract dependencies with empty default
    } = args

    // Pure CloudMap approach - no load balancers ever!

    // Build and push NATS Docker image to ECR
    const { repository, image, imageRef, repositoryUrl } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: true,
        noCache: true,
    }) as DockerImageBuildResult

    // Create PRIVATE CloudMap service for internal cluster communication
    const privateDiscoveryService = new aws.servicediscovery.Service(`${serviceName}-private-discovery`, {
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
    })

    // Create Lambda service discovery sidecar to manage Route53 public DNS records
    // This MUST be created before the ECS service to handle task state changes
    const serviceDiscoverySidecar = await createServiceDiscoverySidecar({
        route53HostedZoneId: parentHostedZoneId,
        natsRecordName: natsRecordName,
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
    const executionRole = new aws.iam.Role(`${serviceName}-exec-role`, {
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
    })

    // Attach policies for task execution
    new aws.iam.RolePolicyAttachment(`${serviceName}-exec-policy`, {
        role: executionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    })

    // Add ECR permissions to allow pulling images
    new aws.iam.RolePolicyAttachment(`${serviceName}-ecr-policy`, {
        role: executionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
    })

    // ECS Task Role - used by the containers
    const taskRole = new aws.iam.Role(`${serviceName}-task-role`, {
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
    })

    const backupBucket = new aws.s3.BucketV2(`${serviceName}-backups`, {
        forceDestroy: false,
        tags: { Workload: 'NATS', Purpose: 'JetStream backups' },
    })
    new aws.s3.BucketVersioningV2(`${serviceName}-backup-versioning`, {
        bucket: backupBucket.id,
        versioningConfiguration: { status: 'Enabled' },
    })
    new aws.s3.BucketServerSideEncryptionConfigurationV2(`${serviceName}-backup-encryption`, {
        bucket: backupBucket.id,
        rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
    })
    new aws.s3.BucketPublicAccessBlock(`${serviceName}-backup-public-access`, {
        bucket: backupBucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
    })
    new aws.s3.BucketLifecycleConfigurationV2(`${serviceName}-backup-lifecycle`, {
        bucket: backupBucket.id,
        rules: [{
            id: 'expire-old-jetstream-snapshots',
            status: 'Enabled',
            expiration: { days: 35 },
            noncurrentVersionExpiration: { noncurrentDays: 7 },
        }],
    })
    const backupPolicy = new aws.iam.Policy(`${serviceName}-backup-policy`, {
        policy: backupBucket.arn.apply((bucketArn) =>
            JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['s3:GetObject', 's3:ListBucket', 's3:PutObject'],
                    Resource: [bucketArn, `${bucketArn}/*`],
                }],
            })
        ),
    })
    new aws.iam.RolePolicyAttachment(`${serviceName}-backup-policy-attachment`, {
        role: taskRole.name,
        policyArn: backupPolicy.arn,
    })

    // Allow CloudWatch Logs
    const logsPolicy = new aws.iam.Policy(`${serviceName}-logs-policy`, {
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
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-logs-attachment`, {
        role: taskRole.name,
        policyArn: logsPolicy.arn,
    })

    // Add certificate access permissions if certificate helper is provided
    if (certificateHelper) {
        const certAccessPolicy = new aws.iam.Policy(`${serviceName}-cert-access-policy`, {
            policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: [
                        'secretsmanager:GetSecretValue',
                        'secretsmanager:DescribeSecret',
                    ],
                    Resource: `arn:aws:secretsmanager:${aws.config.region}:*:secret:*`,
                }],
            }),
        })

        new aws.iam.RolePolicyAttachment(`${serviceName}-cert-access-attachment`, {
            role: taskRole.name,
            policyArn: certAccessPolicy.arn,
        })
    }

    const ingressRules = [
        { name: 'client', fromPort: clientPort, toPort: clientPort, cidrBlocks: ['0.0.0.0/0'] },
        { name: 'websocket', fromPort: 443, toPort: 443, cidrBlocks: ['0.0.0.0/0'] },
        { name: 'management', fromPort: httpManagementPort, toPort: httpManagementPort, cidrBlocks: [vpc.cidrBlock] },
        { name: 'routing', fromPort: clusterRoutingPort, toPort: clusterRoutingPort, cidrBlocks: [vpc.cidrBlock] },
    ].map((rule) =>
        new aws.ec2.SecurityGroupRule(`${serviceName}-${rule.name}-ingress`, {
            type: 'ingress',
            securityGroupId: ec2SecurityGroup.id,
            protocol: 'tcp',
            fromPort: rule.fromPort,
            toPort: rule.toPort,
            cidrBlocks: rule.cidrBlocks,
        })
    )

    // Create CloudWatch Log Group for Container
    const logGroup = new aws.cloudwatch.LogGroup(`${serviceName}-logs`, {
        name: `/aws/ecs/${serviceName}`,
        retentionInDays: LOG_RETENTION_DAYS,
    })

    // log('cloudMapNamespace:', {
    //     'cloudMapNamespace.hostedZone': cloudMapNamespace.hostedZone,
    //     'cloudMapNamespace.arn': cloudMapNamespace.arn,
    //     'cloudMapNamespace.name': cloudMapNamespace.name,
    //     'cloudMapNamespace.id': cloudMapNamespace.id,
    //     'cloudMapNamespace.tags': cloudMapNamespace.tags,
    //     'cloudMapNamespace.vpc': cloudMapNamespace.vpc,

    // })

    // Create ECS Task Definition (with command line arguments for server name)
    const taskDefinition = new aws.ecs.TaskDefinition(`${serviceName}-task`, {
        family: serviceName,
        cpu: `${cpu}`,
        memory: `${memory}`,
        networkMode: 'host',
        requiresCompatibilities: ['EC2'],
        executionRoleArn: executionRole.arn,
        taskRoleArn: taskRole.arn,
        containerDefinitions: pulumi.all([
            logGroup.name,
            imageRef,
        ]).apply(([logGroupName, imageReference]) =>
            JSON.stringify([{
                name: serviceName,
                image: imageReference,
                cpu: cpu,
                memory: memory,
                essential: true,
                portMappings: [
                    { containerPort: clientPort, hostPort: clientPort, protocol: 'tcp' },
                    { containerPort: httpManagementPort, hostPort: httpManagementPort, protocol: 'tcp' },
                    { containerPort: 443, hostPort: 443, protocol: 'tcp' },
                    { containerPort: clusterRoutingPort, hostPort: clusterRoutingPort, protocol: 'tcp' },
                ],
                mountPoints: [{
                    sourceVolume: 'jetstream-data',
                    containerPath: '/data/jetstream',
                    readOnly: false,
                }],
                environment: [
                    {
                        name: 'NATS_CLUSTER_NAME',
                        value: environment.NATS_CLUSTER_NAME,
                    },
                    {
                        name: 'NATS_SERVER_NAME_BASE',
                        value: environment.NATS_SERVER_NAME_BASE, // Just the base, entrypoint script will add unique ID
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
                        name: 'NATS_NEX_NODE_NKEY_PUBLIC',
                        value: environment.NATS_NEX_NODE_NKEY_PUBLIC,
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
                        name: 'NATS_REGULAR_USER_PASSWORD',
                        value: environment.NATS_REGULAR_USER_PASSWORD,
                    },
                    {
                        name: 'NATS_WEBSOCKET_NO_TLS',
                        value: 'false', // For AWS deployment: TLS enabled (no_tls: false)
                    },
                    {
                        name: 'DOMAIN_NAME',
                        value: process.env.DOMAIN_NAME,
                    },
                    {
                        name: 'USE_REAL_CERTIFICATES',
                        value: certificateHelper ? 'true' : 'false',
                    },
                    // Add certificate helper environment variables if provided
                    ...(certificateHelper ? certificateHelper.getCertificateEnvironment() : []),
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
                    command: ['CMD-SHELL', `curl -f http://localhost:${httpManagementPort}/healthz || exit 1`],
                    interval: 30,
                    timeout: 5,
                    retries: 3,
                    startPeriod: 60,
                },
            }])
        ),
        volumes: [{
            name: 'jetstream-data',
            hostPath: '/data/jetstream',
        }],
    })

    const backupTaskDefinition = new aws.ecs.TaskDefinition(`${serviceName}-backup-task`, {
        family: `${serviceName}-backup`,
        networkMode: 'bridge',
        requiresCompatibilities: ['EC2'],
        executionRoleArn: executionRole.arn,
        taskRoleArn: taskRole.arn,
        containerDefinitions: pulumi.all([imageRef, backupBucket.bucket, logGroup.name]).apply(([
            imageReference,
            bucketName,
            logGroupName,
        ]) =>
            JSON.stringify([{
                name: 'nats-backup',
                image: imageReference,
                essential: true,
                cpu: 128,
                memory: 256,
                entryPoint: ['/opt/nats/backup-streams.sh'],
                environment: [
                    { name: 'NATS_BACKUP_BUCKET', value: bucketName },
                    { name: 'NATS_BACKUP_PREFIX', value: 'jetstream' },
                    { name: 'NATS_URL', value: `tls://nats.${cloudMapNamespaceName}:${clientPort}` },
                    { name: 'NATS_SYS_USER', value: 'regular_user' },
                    { name: 'NATS_SYS_PASSWORD', value: environment.NATS_REGULAR_USER_PASSWORD },
                ],
                logConfiguration: {
                    logDriver: 'awslogs',
                    options: {
                        'awslogs-group': logGroupName,
                        'awslogs-region': aws.config.region,
                        'awslogs-stream-prefix': 'backup',
                    },
                },
            }])
        ),
    })

    const backupScheduleRole = new aws.iam.Role(`${serviceName}-backup-schedule-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
                Principal: { Service: 'events.amazonaws.com' },
            }],
        }),
    })
    const backupSchedulePolicy = new aws.iam.Policy(`${serviceName}-backup-schedule-policy`, {
        policy: pulumi.all([backupTaskDefinition.arn, executionRole.arn, taskRole.arn]).apply(([
            taskDefinitionArn,
            executionRoleArn,
            taskRoleArn,
        ]) =>
            JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    { Effect: 'Allow', Action: 'ecs:RunTask', Resource: taskDefinitionArn },
                    { Effect: 'Allow', Action: 'iam:PassRole', Resource: [executionRoleArn, taskRoleArn] },
                ],
            })
        ),
    })
    new aws.iam.RolePolicyAttachment(`${serviceName}-backup-schedule-attachment`, {
        role: backupScheduleRole.name,
        policyArn: backupSchedulePolicy.arn,
    })
    const backupSchedule = new aws.cloudwatch.EventRule(`${serviceName}-backup-schedule`, {
        scheduleExpression: 'cron(17 */6 * * ? *)',
        description: 'Back up every JetStream stream to versioned S3 storage every six hours',
    })
    new aws.cloudwatch.EventTarget(`${serviceName}-backup-target`, {
        rule: backupSchedule.name,
        arn: ecsCluster.arn,
        roleArn: backupScheduleRole.arn,
        ecsTarget: {
            launchType: 'EC2',
            taskCount: 1,
            taskDefinitionArn: backupTaskDefinition.arn,
        },
    })

    // Create SINGLE ECS Service registered with public CloudMap
    // The private CloudMap service will be used for manual instance registration via ECS task metadata
    const ecsService = new aws.ecs.Service(`${serviceName}-service`, {
        cluster: ecsCluster.id,
        taskDefinition: taskDefinition.arn,
        capacityProviderStrategies: [{ capacityProvider: capacityProviderName, weight: 1 }],
        schedulingStrategy: 'DAEMON',
        deploymentMinimumHealthyPercent: 100,
        deploymentMaximumPercent: 100,
        deploymentCircuitBreaker: {
            enable: true,
            rollback: true,
        },
        serviceRegistries: {
            registryArn: privateDiscoveryService.arn, // Auto-register private IP with private CloudMap
            containerName: serviceName,
            containerPort: clientPort,
        },
        forceNewDeployment: true,
        enableExecuteCommand: true, // Enable for debugging
        waitForSteadyState: false, // Don't wait - let it deploy async
    }, {
        customTimeouts: {
            create: '10m',
            update: '10m',
            delete: '10m',
        },
        replaceOnChanges: [
            'taskDefinition',
        ],
        dependsOn: [
            serviceDiscoverySidecar.lambdaFunction, // Ensure Lambda is ready to handle events
            ...ingressRules,
            ...dependencies, // CRITICAL: Wait for certificate generation before starting NATS
        ],
    })

    // Note: Public access is now through CloudMap public namespace with subdomain delegation
    // Private cluster communication uses CloudMap private namespace

    // Create Auto Scaling configuration for the ECS service
    if (minCount !== maxCount) {
        // Create an Application Auto Scaling target
        const scalableTarget = new aws.appautoscaling.Target(`${serviceName}-scaling-target`, {
            minCapacity: minCount,
            maxCapacity: maxCount,
            resourceId: pulumi.interpolate`service/${ecsCluster.name}/${ecsService.name}`, // Fixed: use actual cluster name
            scalableDimension: 'ecs:service:DesiredCount',
            serviceNamespace: 'ecs',
        })

        // CPU-based scaling policy
        const cpuScalingPolicy = new aws.appautoscaling.Policy(`${serviceName}-cpu-scaling`, {
            policyType: 'TargetTrackingScaling',
            resourceId: scalableTarget.resourceId,
            scalableDimension: scalableTarget.scalableDimension,
            serviceNamespace: scalableTarget.serviceNamespace,
            targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: 'ECSServiceAverageCPUUtilization',
                },
                targetValue: 70.0, // Target 70% CPU utilization
                scaleInCooldown: 300, // 5 minutes
                scaleOutCooldown: 60, // 1 minute
            },
        })

        // Memory-based scaling policy
        const memoryScalingPolicy = new aws.appautoscaling.Policy(`${serviceName}-memory-scaling`, {
            policyType: 'TargetTrackingScaling',
            resourceId: scalableTarget.resourceId,
            scalableDimension: scalableTarget.scalableDimension,
            serviceNamespace: scalableTarget.serviceNamespace,
            targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: 'ECSServiceAverageMemoryUtilization',
                },
                targetValue: 80.0, // Target 80% memory utilization
                scaleInCooldown: 300, // 5 minutes
                scaleOutCooldown: 60, // 1 minute
            },
        })
    }

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
        natsSecurityGroup: ec2SecurityGroup,

        // Outputs
        outputs: {
            serviceName: ecsService.name,
            serviceArn: ecsService.id,
            // Internal cluster communication via private CloudMap
            natsUrl: pulumi.interpolate`nats://nats.${cloudMapNamespaceName}:${clientPort}`,
            natsWebSocketUrl: pulumi.interpolate`ws://nats.${cloudMapNamespaceName}:443`,
            // Public client access via Route53 (will have public IPs registered automatically by Lambda)
            publicNatsUrl: pulumi.interpolate`nats://${natsRecordName}:${clientPort}`,
            publicNatsWebSocketUrl: pulumi.interpolate`wss://${natsRecordName}:443`,
            clientPort,
            clusterRoutingPort,
            httpManagementPort,
            serviceEndpoint: pulumi.interpolate`nats.${cloudMapNamespaceName}:${clientPort}`,
            publicServiceEndpoint: pulumi.interpolate`${natsRecordName}:${clientPort}`,
            // Service discovery sidecar outputs
            serviceDiscoveryLambdaArn: serviceDiscoverySidecar.outputs.functionArn,
            serviceDiscoveryLambdaFunction: serviceDiscoverySidecar.lambdaFunction, // For explicit dependencies
        },
    }
}
