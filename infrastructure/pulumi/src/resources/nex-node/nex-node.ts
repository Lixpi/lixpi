// NATS NEX execution-engine node — internal-only Fargate service.
//
// Mirrors NATS-cluster.ts (ECR build, exec/task roles, log group, task def, ECS
// service) but much simpler: the node is a NATS *client*, not a server, so it
// needs no public IP, no Route53, no CloudMap registration, and no cert sidecar.
// It runs a single instance (desiredCount: 1 — the hourly workload must be a
// singleton; see the proposal's Risk "duplicate hourly runs") on the private
// subnets, with a task role granting DynamoDB access to AI_MODELS_LIST so the
// relocated ai-models-sync workload can write the catalog.

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../../helpers/docker/build-helpers.ts'
import { LOG_RETENTION_DAYS } from '../../constants/logging.ts'

export type NexNodeServiceArgs = {
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

    // DynamoDB tables the node's task role may write (AI_MODELS_LIST). Mirrors the
    // per-table policy loop in main-api-service.ts.
    tables: Record<string, { arn: pulumi.Output<string> }>

    // Container env. Values may be Outputs (e.g. NATS_SERVERS from the cluster's
    // internal CloudMap URL), so they are resolved inside the task definition.
    environment: Record<string, pulumi.Input<string>>

    dockerBuildContext: string
    dockerfilePath: string

    dependencies?: pulumi.Resource[]
}

export const createNexNodeService = async (args: NexNodeServiceArgs) => {
    const {
        ecsCluster,
        vpc,
        privateSubnets,
        serviceName = 'nex',
        cpu = 512,
        memory = 1024,
        desiredCount = 1,
        tables,
        environment,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [],
    } = args

    // Build and push the nex node image to ECR.
    const { repository, image, imageRef, repositoryUrl } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: true,
        noCache: true,
    }) as DockerImageBuildResult

    // ECS Task Execution Role — used by the ECS agent to pull the image + ship logs.
    const executionRole = new aws.iam.Role(`${serviceName}-exec-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: { Service: 'ecs-tasks.amazonaws.com' },
            }],
        }),
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-exec-policy`, {
        role: executionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-ecr-policy`, {
        role: executionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
    })

    // ECS Task Role — used by the node container (and the workload it spawns).
    const taskRole = new aws.iam.Role(`${serviceName}-task-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: { Service: 'ecs-tasks.amazonaws.com' },
            }],
        }),
    })

    // CloudWatch Logs.
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

    // DynamoDB access per bound table (mirrors main-api-service.ts).
    Object.values(tables).forEach((table, i) => {
        const tablePolicy = new aws.iam.Policy(`${serviceName}-dynamo-policy-${i}`, {
            policy: table.arn.apply(arn =>
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
                })
            ),
        })

        new aws.iam.RolePolicyAttachment(`${serviceName}-dynamo-attachment-${i}`, {
            role: taskRole.name,
            policyArn: tablePolicy.arn,
        })
    })

    // Read-only Bedrock catalog access. With ANTHROPIC_USE_AWS_BEDROCK_INFERENCE=true the
    // models-sync workload lists Anthropic models from Bedrock instead of the Anthropic API,
    // because that setup may carry no Anthropic api key at all. No invoke permissions here —
    // the workload never runs inference.
    const bedrockCatalogPolicy = new aws.iam.Policy(`${serviceName}-bedrock-catalog-policy`, {
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
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-bedrock-catalog-attachment`, {
        role: taskRole.name,
        policyArn: bedrockCatalogPolicy.arn,
    })

    // Egress-only security group: the node is a client (connects out to NATS,
    // DynamoDB, and provider APIs). Nothing connects to it, so no ingress.
    const securityGroup = new aws.ec2.SecurityGroup(`${serviceName}-sg`, {
        vpcId: vpc.id,
        description: 'Security group for the NATS NEX node (egress only)',
        egress: [{
            protocol: '-1',
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ['0.0.0.0/0'],
            description: 'Allow all outbound traffic',
        }],
        tags: { Name: `${serviceName}-SG` },
    })

    const logGroup = new aws.cloudwatch.LogGroup(`${serviceName}-logs`, {
        name: `/aws/ecs/${serviceName}`,
        retentionInDays: LOG_RETENTION_DAYS,
    })

    const taskDefinition = new aws.ecs.TaskDefinition(`${serviceName}-task`, {
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
        ]).apply(([logGroupName, imageReference, env]) =>
            JSON.stringify([{
                name: serviceName,
                image: imageReference,
                cpu,
                memory,
                essential: true,
                environment: Object.entries(env as Record<string, string>).map(([name, value]) => ({ name, value })),
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
                    // The entrypoint exec's `nex` as the node process; pidof confirms it's up.
                    command: ['CMD-SHELL', 'pidof nex >/dev/null 2>&1 || exit 1'],
                    interval: 30,
                    timeout: 5,
                    retries: 3,
                    startPeriod: 60,
                },
            }])
        ),
    })

    const ecsService = new aws.ecs.Service(`${serviceName}-service`, {
        cluster: ecsCluster.id,
        taskDefinition: taskDefinition.arn,
        desiredCount, // singleton — see proposal Risk "duplicate hourly runs"
        launchType: 'FARGATE',
        schedulingStrategy: 'REPLICA',
        deploymentMinimumHealthyPercent: 0, // single task: allow it to stop before the new one starts
        deploymentMaximumPercent: 100,
        deploymentCircuitBreaker: { enable: true, rollback: true },
        networkConfiguration: {
            subnets: privateSubnets.map(subnet => subnet.id), // internal only
            securityGroups: [securityGroup.id],
            assignPublicIp: false,
        },
        forceNewDeployment: true,
        enableExecuteCommand: true, // for `aws ecs execute-command` debugging
        waitForSteadyState: false,
    }, {
        customTimeouts: { create: '10m', update: '10m', delete: '10m' },
        replaceOnChanges: ['taskDefinition'],
        dependsOn: [...dependencies],
    })

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
