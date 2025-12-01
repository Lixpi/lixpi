'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult
} from '../../helpers/docker/build-helpers.ts'
import { createServiceDiscoverySidecar } from './nats-service-discovery-sidecar.ts'
import {
    type CertificateHelper
} from '../certificate-manager/certificate-helper.ts'

const {
    ORG_NAME,
    STAGE,
    NATS_AUTH_NKEY_ISSUER_PUBLIC,
    NATS_AUTH_XKEY_ISSUER_PUBLIC,
    DOMAIN_NAME,
} = process.env

// Configuration interface for the NATS cluster service
export interface NatsClusterServiceArgs {
    // Infrastructure
    cloudMapNamespace: aws.servicediscovery.PrivateDnsNamespace
    cloudMapNamespaceName: string

    // Route53 configuration for public client access
    parentHostedZoneId: pulumi.Input<string>  // The main domain hosted zone ID for Route53 records
    natsRecordName: string  // e.g., "nats.shelby-dev.lixpi.dev"

    ecsCluster: {  // Add back ECS cluster - Fargate tasks can run on any cluster
        id: pulumi.Output<string>
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }
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
        NATS_LLM_SERVICE_NKEY_PUBLIC: string
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
        vpc,
        publicSubnets,
        privateSubnets,
        serviceName = 'nats',
        clientPort = 4222,           // Client connections
        httpManagementPort = 8222,   // HTTP management/info
        clusterRoutingPort = 6222,   // Cluster routing
        cpu = 256,
        memory = 512,
        minCount = 1,
        maxCount = 3,
        desiredCount = 3,
        environment,
        certificateHelper,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [],  // Extract dependencies with empty default
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
    }) as DockerImageBuildResult;

    // Create PRIVATE CloudMap service for internal cluster communication
    const privateDiscoveryService = new aws.servicediscovery.Service(`${serviceName}-private-discovery`, {
        name: "nats",
        namespaceId: cloudMapNamespace.id,
        dnsConfig: {
            namespaceId: cloudMapNamespace.id,
            dnsRecords: [{
                ttl: 10,
                type: "A",
            }],
            routingPolicy: "MULTIVALUE",
        },
        healthCheckCustomConfig: {
            failureThreshold: 1,
        },
    });

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
    });

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
    });

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

    // Security group for NATS tasks (CloudMap approach - no load balancer)
    const natsSecurityGroup = new aws.ec2.SecurityGroup(`${serviceName}-sg`, {
        vpcId: vpc.id,
        description: 'Security group for NATS cluster',
        ingress: [
            {
                // Allow NATS client connections from anywhere
                protocol: 'tcp',
                fromPort: clientPort,
                toPort: clientPort,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow NATS client connections from internet',
            },
            {
                // Allow NATS WebSocket connections from anywhere
                protocol: 'tcp',
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow NATS WebSocket connections from internet',
            },
            {
                // Allow HTTP management/info from VPC
                protocol: 'tcp',
                fromPort: httpManagementPort,
                toPort: httpManagementPort,
                cidrBlocks: [vpc.cidrBlock],
                description: 'Allow HTTP management/info from VPC',
            },
            {
                // Allow NATS cluster routing within VPC
                protocol: 'tcp',
                fromPort: clusterRoutingPort,
                toPort: clusterRoutingPort,
                cidrBlocks: [vpc.cidrBlock],
                description: 'Allow cluster routing within VPC',
            },
        ],
        egress: [
            {
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound traffic',
            },
        ],
        tags: { Name: `${serviceName}-SG` },
    })

    // Create CloudWatch Log Group for Container
    const logGroup = new aws.cloudwatch.LogGroup(`${serviceName}-logs`, {
        name: `/aws/ecs/${serviceName}`,
        retentionInDays: 7,
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
        networkMode: 'awsvpc',
        requiresCompatibilities: ['FARGATE'],  // Changed from ['EC2'] to ['FARGATE']
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
                    { containerPort: clientPort, protocol: 'tcp' },                    // Removed hostPort for Fargate
                    { containerPort: httpManagementPort, protocol: 'tcp' },           // Removed hostPort for Fargate
                    { containerPort: 443, protocol: 'tcp' },                         // Removed hostPort for Fargate
                    { containerPort: clusterRoutingPort, protocol: 'tcp' },           // Removed hostPort for Fargate
                ],
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
                        value: 'false' // For AWS deployment: TLS enabled (no_tls: false)
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
                    "--routes", `nats://sys:${environment.NATS_SYS_USER_PASSWORD}@nats.${cloudMapNamespaceName}:6222`
                ],
                logConfiguration: {
                    logDriver: 'awslogs',
                    options: {
                        'awslogs-group': logGroupName,
                        'awslogs-region': aws.config.region,
                        'awslogs-stream-prefix': 'ecs',
                        'awslogs-create-group': 'true'
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
    })

    // Create SINGLE ECS Service registered with public CloudMap
    // The private CloudMap service will be used for manual instance registration via ECS task metadata
    const ecsService = new aws.ecs.Service(`${serviceName}-service`, {
        cluster: ecsCluster.id,
        taskDefinition: taskDefinition.arn,
        desiredCount: desiredCount,
        launchType: 'FARGATE',
        schedulingStrategy: 'REPLICA',
        deploymentMinimumHealthyPercent: 50,
        deploymentMaximumPercent: 200,
        deploymentCircuitBreaker: {
            enable: true,
            rollback: true
        },
        networkConfiguration: {
            subnets: publicSubnets.map(subnet => subnet.id), // Use public subnets to get both private and public IPs
            securityGroups: [natsSecurityGroup.id],
            assignPublicIp: true, // Assign public IPs for external access
        },
        serviceRegistries: {
            registryArn: privateDiscoveryService.arn,  // Auto-register private IP with private CloudMap
            containerName: serviceName,
        },
        forceNewDeployment: true,
        enableExecuteCommand: true, // Enable for debugging
        waitForSteadyState: false,  // Don't wait - let it deploy async
    }, {
        customTimeouts: {
            create: '10m',
            update: '10m',
            delete: '10m',
        },
        replaceOnChanges: [
            "taskDefinition"
        ],
        dependsOn: [
            serviceDiscoverySidecar.lambdaFunction, // Ensure Lambda is ready to handle events
            ...dependencies,  // CRITICAL: Wait for certificate generation before starting NATS
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
            scalableDimension: "ecs:service:DesiredCount",
            serviceNamespace: "ecs",
        });

        // CPU-based scaling policy
        const cpuScalingPolicy = new aws.appautoscaling.Policy(`${serviceName}-cpu-scaling`, {
            policyType: "TargetTrackingScaling",
            resourceId: scalableTarget.resourceId,
            scalableDimension: scalableTarget.scalableDimension,
            serviceNamespace: scalableTarget.serviceNamespace,
            targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: "ECSServiceAverageCPUUtilization",
                },
                targetValue: 70.0, // Target 70% CPU utilization
                scaleInCooldown: 300, // 5 minutes
                scaleOutCooldown: 60, // 1 minute
            },
        });

        // Memory-based scaling policy
        const memoryScalingPolicy = new aws.appautoscaling.Policy(`${serviceName}-memory-scaling`, {
            policyType: "TargetTrackingScaling",
            resourceId: scalableTarget.resourceId,
            scalableDimension: scalableTarget.scalableDimension,
            serviceNamespace: scalableTarget.serviceNamespace,
            targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: "ECSServiceAverageMemoryUtilization",
                },
                targetValue: 80.0, // Target 80% memory utilization
                scaleInCooldown: 300, // 5 minutes
                scaleOutCooldown: 60, // 1 minute
            },
        });
    }

    return {
        // Resources
        repository,
        image,
        privateDiscoveryService,
        serviceDiscoverySidecar,
        taskDefinition,
        executionRole,
        taskRole,
        logGroup,
        ecsService,
        natsSecurityGroup,

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
