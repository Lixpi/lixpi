// AI Model Registry — internal-only Fargate service.
//
// Owns the model catalog: it merges the authored `-lixpi.json` files that ship in
// the image with what models.dev and the provider listing endpoints report, writes
// the result to the AI_MODELS_LIST DynamoDB table, and announces each run on
// `aiModels.syncCompleted`. It supersedes the ai-models-synchronization workload
// that used to run on the NEX node.
//
// It is a NATS client rather than a server, so it needs no public IP, no Route53,
// and no cert sidecar. desiredCount stays 1 because the sync must be a singleton:
// two tasks on the same interval would write the same table concurrently.

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../../helpers/docker/build-helpers.ts'
import { LOG_RETENTION_DAYS } from '../../constants/logging.ts'

export type AiModelRegistryServiceArgs = {
    ecsCluster: {
        id: pulumi.Output<string>
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }
    vpc: aws.ec2.Vpc
    privateSubnets: aws.ec2.Subnet[]

    serviceName?: string
    cpu?: number
    memory?: number
    desiredCount?: number
    containerPort?: number

    // DynamoDB tables the task role may write (AI_MODELS_LIST).
    tables: Record<string, { arn: pulumi.Output<string> }>

    // Container env. Values may be Outputs, so they are resolved inside the task
    // definition.
    environment: Record<string, pulumi.Input<string>>

    dockerBuildContext: string
    dockerfilePath: string

    dependencies?: pulumi.Resource[]
}

export const createAiModelRegistryService = async (args: AiModelRegistryServiceArgs) => {
    const {
        ecsCluster,
        vpc,
        privateSubnets,
        serviceName = 'ai-model-registry',
        // The smallest Fargate combination there is. The work is an hourly HTTP
        // fetch, a JSON merge over a few hundred small files, and a DynamoDB write;
        // nothing here is CPU or memory bound.
        cpu = 256,
        memory = 512,
        desiredCount = 1,
        containerPort = 3010,
        tables,
        environment,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [],
    } = args

    const {
        repository,
        image,
        imageRef,
    } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: true,
        noCache: true,
    }) as DockerImageBuildResult

    // ECS Task Execution Role — used by the ECS agent to pull the image and ship logs.
    const executionRole = new aws.iam.Role(
        `${serviceName}-exec-role`,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Action: 'sts:AssumeRole',
                    Effect: 'Allow',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                }],
            }),
        },
    )

    new aws.iam.RolePolicyAttachment(
        `${serviceName}-exec-policy`,
        {
            role: executionRole.name,
            policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
        },
    )

    new aws.iam.RolePolicyAttachment(
        `${serviceName}-ecr-policy`,
        {
            role: executionRole.name,
            policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
        },
    )

    // ECS Task Role — used by the registry container itself.
    const taskRole = new aws.iam.Role(
        `${serviceName}-task-role`,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Action: 'sts:AssumeRole',
                    Effect: 'Allow',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                }],
            }),
        },
    )

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

    Object.values(tables).forEach((table, i) => {
        const tablePolicy = new aws.iam.Policy(
            `${serviceName}-dynamo-policy-${i}`,
            {
                policy: table.arn.apply(
                    arn =>
                        JSON.stringify({
                            Version: '2012-10-17',
                            Statement: [{
                                Effect: 'Allow',
                                Action: [
                                    'dynamodb:GetItem',
                                    'dynamodb:Query',
                                    'dynamodb:Scan',
                                    'dynamodb:BatchWriteItem',
                                    'dynamodb:PutItem',
                                    'dynamodb:UpdateItem',
                                    'dynamodb:DeleteItem',
                                    'dynamodb:DescribeTable',
                                ],
                                Resource: [arn, `${arn}/index/*`],
                            }],
                        }),
                ),
            },
        )

        new aws.iam.RolePolicyAttachment(
            `${serviceName}-dynamo-attachment-${i}`,
            {
                role: taskRole.name,
                policyArn: tablePolicy.arn,
            },
        )
    })

    // Read-only Bedrock catalog access. With ANTHROPIC_USE_AWS_BEDROCK_INFERENCE=true
    // the registry lists Anthropic models from Bedrock instead of the Anthropic API,
    // because that setup may carry no Anthropic key at all. No invoke permissions:
    // the registry never runs inference.
    const bedrockCatalogPolicy = new aws.iam.Policy(
        `${serviceName}-bedrock-catalog-policy`,
        {
            policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: [
                        'bedrock:ListFoundationModels',
                        'bedrock:GetFoundationModel',
                    ],
                    Resource: '*',
                }],
            }),
        },
    )

    new aws.iam.RolePolicyAttachment(
        `${serviceName}-bedrock-catalog-attachment`,
        {
            role: taskRole.name,
            policyArn: bedrockCatalogPolicy.arn,
        },
    )

    // Egress-only: the registry connects out to NATS, DynamoDB, models.dev, and the
    // provider APIs. Its HTTP surface is a maintenance tool reached through ECS
    // Exec, not something other services call, so there is no ingress rule.
    const securityGroup = new aws.ec2.SecurityGroup(
        `${serviceName}-sg`,
        {
            vpcId: vpc.id,
            description: 'Security group for the AI Model Registry (egress only)',
            egress: [{
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound traffic',
            }],
            tags: { Name: `${serviceName}-SG` },
        },
    )

    const logGroup = new aws.cloudwatch.LogGroup(
        `${serviceName}-logs`,
        {
            name: `/aws/ecs/${serviceName}`,
            retentionInDays: LOG_RETENTION_DAYS,
        },
    )

    const taskDefinition = new aws.ecs.TaskDefinition(
        `${serviceName}-task`,
        {
            family: serviceName,
            cpu: `${cpu}`,
            memory: `${memory}`,
            networkMode: 'awsvpc',
            requiresCompatibilities: ['FARGATE'],
            executionRoleArn: executionRole.arn,
            taskRoleArn: taskRole.arn,
            containerDefinitions: pulumi.all([
                logGroup.name,
                imageRef,
                pulumi.output(environment),
            ]).apply(
                ([logGroupName, imageReference, env]) =>
                    JSON.stringify([{
                        name: serviceName,
                        image: imageReference,
                        cpu,
                        memory,
                        essential: true,
                        portMappings: [{
                            containerPort,
                            hostPort: containerPort,
                            protocol: 'tcp',
                        }],
                        environment: Object.entries(env as Record<string, string>).map(
                            ([name, value]) => ({
                                name,
                                value,
                            }),
                        ),
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
                            command: ['CMD-SHELL', `curl -fsS http://127.0.0.1:${containerPort}/api/models >/dev/null || exit 1`],
                            interval: 30,
                            timeout: 10,
                            retries: 3,
                            // The client build runs at container start, so the first
                            // health check must not fire before it finishes.
                            startPeriod: 120,
                        },
                    }]),
            ),
        },
    )

    const ecsService = new aws.ecs.Service(
        `${serviceName}-service`,
        {
            cluster: ecsCluster.id,
            taskDefinition: taskDefinition.arn,
            // Singleton: two tasks on the same interval would write AI_MODELS_LIST
            // concurrently.
            desiredCount,
            launchType: 'FARGATE',
            schedulingStrategy: 'REPLICA',
            deploymentMinimumHealthyPercent: 0,
            deploymentMaximumPercent: 100,
            deploymentCircuitBreaker: {
                enable: true,
                rollback: true,
            },
            networkConfiguration: {
                subnets: privateSubnets.map(subnet => subnet.id),
                securityGroups: [securityGroup.id],
                assignPublicIp: false,
            },
            forceNewDeployment: true,
            enableExecuteCommand: true,
            waitForSteadyState: false,
        },
        {
            customTimeouts: {
                create: '10m',
                update: '10m',
                delete: '10m',
            },
            replaceOnChanges: ['taskDefinition'],
            dependsOn: [...dependencies],
        },
    )

    return {
        repository,
        image,
        taskDefinition,
        executionRole,
        taskRole,
        logGroup,
        securityGroup,
        ecsService,
        outputs: {
            serviceName: ecsService.name,
            serviceArn: ecsService.id,
        },
    }
}
