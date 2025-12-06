'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as dockerBuild from '@pulumi/docker-build'

import { formatStageResourceName } from '@lixpi/constants'
import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../helpers/docker/build-helpers.ts'
import { LOG_RETENTION_DAYS } from '../constants/logging.ts'

const {
    ORG_NAME,
    STAGE
} = process.env

export type LlmApiServiceArgs = {
    // Infrastructure
    ecsCluster: {
        id: pulumi.Output<string>
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }
    vpc: aws.ec2.Vpc
    publicSubnets: aws.ec2.Subnet[]
    privateSubnets: aws.ec2.Subnet[]

    // Service specific
    serviceName?: string
    containerPort?: number
    cpu?: number
    memory?: number
    desiredCount?: number

    // App configuration
    environment: {
        SERVICE_NAME: string
        LOG_LEVEL: string

        AWS_REGION: string

        STAGE: string
        ORG_NAME: string
        ENVIRONMENT: string

        NATS_SERVERS: string
        NATS_NKEY_SEED: string

        AUTH0_DOMAIN: string
        AUTH0_API_IDENTIFIER: string

        OPENAI_API_KEY: string
        ANTHROPIC_API_KEY: string

        LLM_TIMEOUT_SECONDS: string
    }

    // Docker build context
    dockerBuildContext: string
    dockerfilePath: string

    // Dependencies (e.g., NATS cluster must be running first)
    dependencies?: pulumi.Resource[]
}

export const createLlmApiService = async (args: LlmApiServiceArgs) => {
    const {
        ecsCluster,
        vpc,
        publicSubnets,
        privateSubnets,
        serviceName = 'llm-api',
        containerPort = 8000,
        cpu = 256,        // 0.25 vCPU
        memory = 512,     // 512 MiB
        desiredCount = 1,
        environment,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [],
    } = args

    // Format names consistently
    const formattedServiceName = formatStageResourceName(serviceName, ORG_NAME, STAGE)

    // Build and push llm-api Docker image to ECR
    const { repository, image, imageRef } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: true,
        noCache: true,
        dependencies,
    }) as DockerImageBuildResult;

    // ECS Task Execution Role - used by ECS agent
    const executionRole = new aws.iam.Role(`${formattedServiceName}-execution-role`, {
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
    new aws.iam.RolePolicyAttachment(`${formattedServiceName}-execution-policy`, {
        role: executionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    })

    // Add ECR permissions to allow pulling images
    new aws.iam.RolePolicyAttachment(`${formattedServiceName}-ecr-policy`, {
        role: executionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
    });

    // ECS Task Role - used by the containers
    const taskRole = new aws.iam.Role(`${formattedServiceName}-task-role`, {
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

    // LLM API service doesn't need DynamoDB access - it's isolated in separate NATS account
    // It only needs NATS connectivity and AI provider API keys

    // Allow containers to access SSM parameters (for config management)
    const ssmPolicy = new aws.iam.Policy(`${formattedServiceName}-ssm-policy`, {
        policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: [
                    'ssm:GetParameters',
                    'ssm:GetParameter',
                ],
                Resource: `arn:aws:ssm:${aws.config.region}:${aws.config.accountId}:parameter/*`,
            }],
        }),
    })

    new aws.iam.RolePolicyAttachment(`${formattedServiceName}-ssm-attachment`, {
        role: taskRole.name,
        policyArn: ssmPolicy.arn,
    })

    // Create CloudWatch Log Group for Container
    const logGroup = new aws.cloudwatch.LogGroup(`${formattedServiceName}-logs`, {
        name: `/aws/ecs/${formattedServiceName}`,
        retentionInDays: LOG_RETENTION_DAYS,
    })

    // Create ECS Task Definition
    const taskDefinition = new aws.ecs.TaskDefinition(`${formattedServiceName}-task`, {
        family: formattedServiceName,
        cpu: `${cpu}`,
        memory: `${memory}`,
        networkMode: 'awsvpc',
        requiresCompatibilities: ['FARGATE'],
        executionRoleArn: executionRole.arn,
        taskRoleArn: taskRole.arn,
        containerDefinitions: pulumi.all([
            logGroup.name,
            imageRef,
        ]).apply(([logGroupName, imageReference]) => JSON.stringify([{
            name: formattedServiceName,
            image: imageReference,
            cpu: cpu,
            memory: memory,
            essential: true,
            portMappings: [{
                containerPort: containerPort,
                protocol: 'tcp',
            }],
            environment: Object.entries(environment).map(([name, value]) => ({
                name,
                value: value || '',
            })),
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
                command: ['CMD-SHELL', `curl -f http://localhost:${containerPort}/health || exit 1`],
                interval: 30,
                timeout: 10,
                retries: 3,
                startPeriod: 40,
            },
        }])),
    }, {
        dependsOn: [image],
    })

    // Security group for the ECS tasks
    const taskSecurityGroup = new aws.ec2.SecurityGroup(`${formattedServiceName}-task-sg`, {
        vpcId: vpc.id,
        description: `Security group for ${formattedServiceName} ECS tasks`,
        ingress: [],
        egress: [
            {
                // Allow all outbound traffic
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound traffic',
            },
        ],
    })

    // Create ECS Service (no load balancer - internal service only)
    const ecsService = new aws.ecs.Service(`${formattedServiceName}-service`, {
        cluster: ecsCluster.id,
        taskDefinition: taskDefinition.arn,
        desiredCount,
        launchType: 'FARGATE',
        schedulingStrategy: 'REPLICA',
        deploymentMinimumHealthyPercent: 50,
        deploymentMaximumPercent: 200,
        deploymentCircuitBreaker: {
            enable: true,
            rollback: true
        },
        networkConfiguration: {
            subnets: privateSubnets.map(subnet => subnet.id),
            securityGroups: [taskSecurityGroup.id],
            assignPublicIp: false,
        },
        forceNewDeployment: true,  // Ensure we deploy a fresh version on updates
        enableEcsManagedTags: true,
        propagateTags: 'SERVICE',
        waitForSteadyState: true,  // Wait until service reaches a steady state before considering deployment complete
        forceDelete: true,
    }, {
        customTimeouts: {
            create: '10m',
            update: '10m',
            delete: '10m',
        },
        // Force replacement when image changes
        replaceOnChanges: [
            "taskDefinition"
        ]
    })

    return {
        // Resources
        repository,
        image,
        taskDefinition,
        executionRole,
        taskRole,
        logGroup,
        ecsService,
        taskSecurityGroup,

        // Outputs
        outputs: {
            repositoryUrl: repository.repositoryUrl,
            imageRef: imageRef,
            serviceName: ecsService.name,
            serviceArn: ecsService.id,
            taskDefinitionArn: taskDefinition.arn,
            securityGroupId: taskSecurityGroup.id,
            containerPort,
        }
    }
}
