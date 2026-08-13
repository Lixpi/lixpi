'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import { formatStageResourceName } from '@lixpi/constants'
import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../helpers/docker/build-helpers.ts'
import { LOG_RETENTION_DAYS } from '../constants/logging.ts'

const { ORG_NAME, STAGE } = process.env

export type ModelPricingServiceArgs = {
    ecsCluster: {
        id: pulumi.Output<string>
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }
    vpc: aws.ec2.Vpc
    privateSubnets: aws.ec2.Subnet[]
    tables: Record<string, aws.dynamodb.Table>
    environment: Record<string, pulumi.Input<string>>
    pricingServiceNkeySeed: pulumi.Input<string>
    dockerBuildContext: string
    dockerfilePath: string
    dependencies?: pulumi.Resource[]
}

export const createModelPricingService = (args: ModelPricingServiceArgs) => {
    const {
        ecsCluster,
        vpc,
        privateSubnets,
        tables,
        environment,
        pricingServiceNkeySeed,
        dockerBuildContext,
        dockerfilePath,
        dependencies = [],
    } = args
    const serviceName = 'model-pricing'

    const { repository, image, imageRef } = buildDockerImage({
        imageName: serviceName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
        buildOnPreview: true,
        noCache: true,
    }) as DockerImageBuildResult

    const executionRole = new aws.iam.Role(`${serviceName}-exec-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
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

    const taskRole = new aws.iam.Role(`${serviceName}-task-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
                Principal: { Service: 'ecs-tasks.amazonaws.com' },
            }],
        }),
    })

    const dynamoPolicy = new aws.iam.Policy(`${serviceName}-dynamo-policy`, {
        policy: pulumi.all(Object.values(tables).map(table => table.arn)).apply(tableArns => JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: [
                    'dynamodb:GetItem',
                    'dynamodb:Query',
                    'dynamodb:PutItem',
                    'dynamodb:UpdateItem',
                    'dynamodb:TransactWriteItems',
                    'dynamodb:DescribeTable',
                ],
                Resource: tableArns,
            }],
        })),
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-dynamo-attachment`, {
        role: taskRole.name,
        policyArn: dynamoPolicy.arn,
    })

    const logsPolicy = new aws.iam.Policy(`${serviceName}-logs-policy`, {
        policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: 'arn:aws:logs:*:*:*',
            }],
        }),
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-logs-attachment`, {
        role: taskRole.name,
        policyArn: logsPolicy.arn,
    })

    const securityGroup = new aws.ec2.SecurityGroup(`${serviceName}-sg`, {
        vpcId: vpc.id,
        description: 'Egress-only security group for the model pricing service',
        egress: [{
            protocol: '-1',
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ['0.0.0.0/0'],
            description: 'Allow outbound NATS and DynamoDB traffic',
        }],
    })

    const logGroup = new aws.cloudwatch.LogGroup(`${serviceName}-logs`, {
        name: `/aws/ecs/${serviceName}`,
        retentionInDays: LOG_RETENTION_DAYS,
    })

    const pricingServiceSecret = new aws.secretsmanager.Secret(`${serviceName}-nkey`, {
        name: `${formatStageResourceName(serviceName, ORG_NAME!, STAGE!)}/nats-service-nkey`,
        description: 'NKey seed for the model pricing ECS task',
    })

    const pricingServiceSecretVersion = new aws.secretsmanager.SecretVersion(`${serviceName}-nkey-value`, {
        secretId: pricingServiceSecret.id,
        secretString: pulumi.secret(pricingServiceNkeySeed),
    })

    const secretAccessPolicy = new aws.iam.Policy(`${serviceName}-secret-access-policy`, {
        policy: pricingServiceSecret.arn.apply(secretArn => JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Action: ['secretsmanager:GetSecretValue'],
                Resource: secretArn,
            }],
        })),
    })

    new aws.iam.RolePolicyAttachment(`${serviceName}-secret-access-attachment`, {
        role: executionRole.name,
        policyArn: secretAccessPolicy.arn,
    })

    const taskDefinition = new aws.ecs.TaskDefinition(`${serviceName}-task`, {
        family: serviceName,
        cpu: '256',
        memory: '512',
        networkMode: 'awsvpc',
        requiresCompatibilities: ['FARGATE'],
        executionRoleArn: executionRole.arn,
        taskRoleArn: taskRole.arn,
        containerDefinitions: pulumi.all([logGroup.name, imageRef, pulumi.output(environment)]).apply(([
            logGroupName,
            imageReference,
            configuredEnvironment,
        ]) => JSON.stringify([{
            name: serviceName,
            image: imageReference,
            essential: true,
            environment: Object.entries(configuredEnvironment as Record<string, string>)
                .map(([name, value]) => ({ name, value })),
            secrets: [{
                name: 'NATS_PRICING_SERVICE_NKEY_SEED',
                valueFrom: pricingServiceSecretVersion.arn,
            }],
            logConfiguration: {
                logDriver: 'awslogs',
                options: {
                    'awslogs-group': logGroupName,
                    'awslogs-region': aws.config.region,
                    'awslogs-stream-prefix': 'ecs',
                },
            },
            healthCheck: {
                command: ['CMD-SHELL', 'node -e "process.kill(1, 0)"'],
                interval: 30,
                timeout: 5,
                retries: 3,
                startPeriod: 30,
            },
        }])),
    })

    const ecsService = new aws.ecs.Service(`${serviceName}-service`, {
        cluster: ecsCluster.id,
        taskDefinition: taskDefinition.arn,
        desiredCount: 1,
        launchType: 'FARGATE',
        deploymentCircuitBreaker: { enable: true, rollback: true },
        networkConfiguration: {
            subnets: privateSubnets.map(subnet => subnet.id),
            securityGroups: [securityGroup.id],
            assignPublicIp: false,
        },
        enableExecuteCommand: true,
        waitForSteadyState: false,
    }, {
        dependsOn: [pricingServiceSecretVersion, ...dependencies],
    })

    return { repository, image, executionRole, taskRole, taskDefinition, ecsService, pricingServiceSecret }
}
