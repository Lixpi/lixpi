'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    formatStageResourceName,
} from '@lixpi/constants'

import {
    buildDockerImage,
    type DockerImageBuildResult
} from '../helpers/docker/build-helpers.ts'

const {
    ORG_NAME,
    STAGE
} = process.env

export type MainApiServiceArgs = {
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

    // Resource bindings
    resourceBindings: {
        tables?: {
            [key: string]: aws.dynamodb.Table
        }
        functions?: {
            [key: string]: aws.lambda.Function
        }
        topics?: {
            [key: string]: aws.sns.Topic
        }
        queues?: {
            [key: string]: aws.sqs.Queue
        }
    }

    // App configuration
    environment: {
        NODE_OPTIONS: string

        AWS_REGION: string

        STAGE: string
        ORG_NAME: string
        ENVIRONMENT: string

        NATS_SERVERS: string
        NATS_AUTH_ACCOUNT: string
        NATS_SYS_USER_PASSWORD: string
        NATS_REGULAR_USER_PASSWORD: string
        NATS_AUTH_NKEY_ISSUER_SEED: string
        NATS_AUTH_NKEY_ISSUER_PUBLIC: string
        NATS_AUTH_XKEY_ISSUER_SEED: string
        NATS_AUTH_XKEY_ISSUER_PUBLIC: string
        NATS_LLM_SERVICE_NKEY_PUBLIC: string

        ORIGIN_HOST_URL: string
        API_HOST_URL: string

        AUTH0_DOMAIN: string
        AUTH0_API_IDENTIFIER: string
        SAVE_LLM_RESPONSES_TO_DEBUG_DIR: string

        OPENAI_API_KEY: string
        ANTHROPIC_API_KEY: string
    }

    // Docker build context
    dockerBuildContext: string
    dockerfilePath: string
}

export const createMainApiService = async (args: MainApiServiceArgs) => {
    const {
        ecsCluster,
        vpc,
        publicSubnets,
        privateSubnets,
        serviceName = 'api',
        containerPort = 3000,
        cpu = 512,        // 0.5 vCPU
        memory = 512,    // 512 MiB
        desiredCount = 1,
        resourceBindings,
        environment,
        dockerBuildContext,
        dockerfilePath,
    } = args

    // Format names consistently
    const formattedServiceName = formatStageResourceName(serviceName, ORG_NAME, STAGE)

        // Build and push main-api Docker image to ECR
    const { repository, image, imageRef } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: true,
        noCache: true,
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

    // Allow containers to access bound DynamoDB tables
    resourceBindings.tables && Object.values(resourceBindings.tables).forEach((table, i) => {
        const tablePolicy = new aws.iam.Policy(`${formattedServiceName}-dynamo-policy-${i}`, {
            policy: table.arn.apply(arn => JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: [
                        'dynamodb:BatchGetItem',
                        'dynamodb:GetItem',
                        'dynamodb:Query',
                        'dynamodb:Scan',
                        'dynamodb:BatchWriteItem',
                        'dynamodb:PutItem',
                        'dynamodb:UpdateItem',
                        'dynamodb:DeleteItem',
                    ],
                    Resource: [arn, `${arn}/index/*`],
                }],
            })),
        })

        new aws.iam.RolePolicyAttachment(`${formattedServiceName}-dynamo-attachment-${i}`, {
            role: taskRole.name,
            policyArn: tablePolicy.arn,
        })
    })

    // // Allow containers to access bound SQS queues
    // resourceBindings.queues && Object.values(resourceBindings.queues).forEach((queue, i) => {
    //     const sqsPolicy = new aws.iam.Policy(`${formattedServiceName}-sqs-policy-${i}`, {
    //         policy: queue.arn.apply(arn => JSON.stringify({
    //             Version: '2012-10-17',
    //             Statement: [{
    //                 Effect: 'Allow',
    //                 Action: [
    //                     'sqs:ReceiveMessage',
    //                     'sqs:DeleteMessage',
    //                     'sqs:GetQueueAttributes',
    //                     'sqs:ChangeMessageVisibility',
    //                 ],
    //                 Resource: arn,
    //             }],
    //         })),
    //     })

    //     new aws.iam.RolePolicyAttachment(`${formattedServiceName}-sqs-attachment-${i}`, {
    //         role: taskRole.name,
    //         policyArn: sqsPolicy.arn,
    //     })
    // })

    // // Allow containers to access SNS topics
    // resourceBindings.topics && Object.values(resourceBindings.topics).forEach((topic, i) => {
    //     const snsPolicy = new aws.iam.Policy(`${formattedServiceName}-sns-policy-${i}`, {
    //         policy: topic.arn.apply(arn => JSON.stringify({
    //             Version: '2012-10-17',
    //             Statement: [{
    //                 Effect: 'Allow',
    //                 Action: ['sns:Publish'],
    //                 Resource: arn,
    //             }],
    //         })),
    //     })

    //     new aws.iam.RolePolicyAttachment(`${formattedServiceName}-sns-attachment-${i}`, {
    //         role: taskRole.name,
    //         policyArn: snsPolicy.arn,
    //     })
    // })

    // // Allow containers to invoke Lambda functions
    // resourceBindings.functions && Object.values(resourceBindings.functions).forEach((func, i) => {
    //     const lambdaPolicy = new aws.iam.Policy(`${formattedServiceName}-lambda-policy-${i}`, {
    //         policy: func.arn.apply(arn => JSON.stringify({
    //             Version: '2012-10-17',
    //             Statement: [{
    //                 Effect: 'Allow',
    //                 Action: ['lambda:InvokeFunction'],
    //                 Resource: arn,
    //             }],
    //         })),
    //     })

    //     new aws.iam.RolePolicyAttachment(`${formattedServiceName}-lambda-attachment-${i}`, {
    //         role: taskRole.name,
    //         policyArn: lambdaPolicy.arn,
    //     })
    // })

    // Allow containers to access SSM parameters
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
        retentionInDays: 7,
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
                command: ['CMD-SHELL', `curl -f http://localhost:${containerPort}/health-check || exit 1`],
                interval: 10,
                timeout: 5,
                retries: 2,
                startPeriod: 5,
            },
        }])),
    }, {
        dependsOn: [image],  // Ensure image is fully built and pushed before creating task definition
    })

    // Security group for the ECS tasks
    const taskSecurityGroup = new aws.ec2.SecurityGroup(`${formattedServiceName}-task-sg`, {
        vpcId: vpc.id,
        description: 'Security group for the API ECS tasks',
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

    // Create ECS Service
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
            subnets: privateSubnets.map(subnet => subnet.id),  // Changed from publicSubnets to privateSubnets
            securityGroups: [taskSecurityGroup.id],
            assignPublicIp: false,  // Changed from true to false since we're in private subnets
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
            serviceName: ecsService.name,
            serviceArn: ecsService.id,
            containerPort,
        },
    }
}
