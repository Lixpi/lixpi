'use strict'

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult
} from '../../helpers/docker/build-helpers.ts'

// Local helper function (avoiding import issues)
const formatStageResourceName = (resourceName: string, orgName: string, stageName: string): string =>
    `${resourceName}-${orgName}-${stageName}`

const { ORG_NAME, STAGE } = process.env

export interface ServiceDiscoverySidecarArgs {
    // Route53 configuration for public IP registration
    route53HostedZoneId: pulumi.Input<string>
    natsRecordName: string  // e.g., "nats.shelby-dev.lixpi.dev"

    // ECS cluster to monitor
    ecsCluster: {
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }

    // VPC configuration for Lambda
    vpc: aws.ec2.Vpc
    privateSubnets: aws.ec2.Subnet[]

    // Lambda configuration
    functionName?: string
    timeout?: number
    memorySize?: number

    // Docker build context for Lambda
    dockerBuildContext: string
    dockerfilePath: string
}

export const createServiceDiscoverySidecar = async (args: ServiceDiscoverySidecarArgs) => {
    const {
        route53HostedZoneId,
        natsRecordName,
        ecsCluster,
        vpc,
        privateSubnets,
        functionName = 'nats-cluster-sidecar',
        timeout = 60,
        memorySize = 512,
        dockerBuildContext,
        dockerfilePath,
    } = args

    // Build and push Lambda Docker image to ECR
    const { repository, image, imageRef } = buildDockerImage({
        imageName: functionName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
    }) as DockerImageBuildResult;

    // Lambda execution role
    const lambdaRole = new aws.iam.Role(`${functionName}-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: {
                    Service: 'lambda.amazonaws.com',
                },
            }],
        }),
    })

    // Attach basic Lambda execution policy
    new aws.iam.RolePolicyAttachment(`${functionName}-basic-execution`, {
        role: lambdaRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    })

    // Attach VPC execution policy for Lambda in VPC
    new aws.iam.RolePolicyAttachment(`${functionName}-vpc-execution`, {
        role: lambdaRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
    })

    // Custom policy for Route53, ECS operations
    const lambdaPolicy = new aws.iam.Policy(`${functionName}-policy`, {
        policy: pulumi.all([route53HostedZoneId]).apply(([hostedZoneId]: [string]) =>
            JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: [
                            'route53:ChangeResourceRecordSets',
                            'route53:ListResourceRecordSets',
                            'route53:GetChange'
                        ],
                        Resource: [
                            `arn:aws:route53:::hostedzone/${hostedZoneId}`,
                            'arn:aws:route53:::change/*'
                        ]
                    },
                    {
                        Effect: 'Allow',
                        Action: [
                            'ecs:DescribeTasks',
                            'ecs:DescribeContainerInstances',
                            'ecs:ListTasks',
                        ],
                        Resource: '*',
                    },
                    {
                        Effect: 'Allow',
                        Action: [
                            'ec2:DescribeNetworkInterfaces',
                        ],
                        Resource: '*',
                    },
                    {
                        Effect: 'Allow',
                        Action: [
                            'route53:CreateHealthCheck',
                            'route53:DeleteHealthCheck',
                            'route53:UpdateHealthCheck',
                            'route53:GetHealthCheck',
                            'route53:ListHealthChecks',
                        ],
                        Resource: '*',
                    },
                ],
            })
        )
    })

    new aws.iam.RolePolicyAttachment(`${functionName}-policy-attachment`, {
        role: lambdaRole.name,
        policyArn: lambdaPolicy.arn,
    })

    // Security group for Lambda
    const lambdaSecurityGroup = new aws.ec2.SecurityGroup(`${functionName}-sg`, {
        vpcId: vpc.id,
        description: 'Security group for NATS service discovery Lambda',
        egress: [
            {
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound traffic',
            },
        ],
        tags: { Name: `${functionName}-SG` },
    }, {
        // Ensure security group is created after VPC but deleted before VPC
        deleteBeforeReplace: true,
    })

    // CloudWatch Log Group for Lambda
    const logGroup = new aws.cloudwatch.LogGroup(`${functionName}-logs`, {
        name: `/aws/lambda/${functionName}`,
        retentionInDays: 7,
    })

    // Lambda function using Container Image
    // Create Lambda function
    const lambdaFunction = new aws.lambda.Function(`${functionName}-func`, {
        name: functionName,
        packageType: 'Image',
        imageUri: imageRef,
        role: lambdaRole.arn,
        timeout,
        memorySize,
        environment: {
            variables: {
                ROUTE53_HOSTED_ZONE_ID: pulumi.output(route53HostedZoneId).apply((id: string) => id),
                NATS_RECORD_NAME: natsRecordName,
                ECS_CLUSTER_ARN: ecsCluster.arn,
            },
        },
        vpcConfig: {
            subnetIds: privateSubnets.map(subnet => subnet.id),
            securityGroupIds: [lambdaSecurityGroup.id],
        },
    }, {
        dependsOn: [image, logGroup, lambdaRole],
        // Ensure Lambda is deleted before VPC components by marking VPC dependencies
        deleteBeforeReplace: true,
        // Add custom timeouts for faster cleanup and explicit dependency on VPC resources
        customTimeouts: {
            create: '5m',
            update: '5m',
            delete: '15m', // Longer delete timeout for ENI cleanup
        },
        // Ensure deletion order by depending on VPC resources
        ignoreChanges: ['vpcConfig'],
        // Force replacement when Route53 configuration changes
        replaceOnChanges: ['environment.variables.ROUTE53_HOSTED_ZONE_ID', 'environment.variables.NATS_RECORD_NAME'],
    })

    // CloudWatch Event Rule for ECS Task State Changes
    const ecsTaskStateRule = new aws.cloudwatch.EventRule(`${functionName}-rule`, {
        description: 'Capture ECS task state changes for NATS service discovery',
        eventPattern: ecsCluster.arn.apply((clusterArn: string) => JSON.stringify({
            source: ['aws.ecs'],
            'detail-type': ['ECS Task State Change'],
            detail: {
                clusterArn: [clusterArn],
            },
        })),
    })

    // Permission for CloudWatch Events to invoke Lambda
    const lambdaPermission = new aws.lambda.Permission(`${functionName}-perm`, {
        action: 'lambda:InvokeFunction',
        function: lambdaFunction.name,
        principal: 'events.amazonaws.com',
        sourceArn: ecsTaskStateRule.arn,
    })

    // CloudWatch Event Target - Lambda function
    const ecsTaskStateTarget = new aws.cloudwatch.EventTarget(`${functionName}-target`, {
        rule: ecsTaskStateRule.name,
        arn: lambdaFunction.arn,
    }, {
        dependsOn: [lambdaPermission],
    })

    return {
        repository,
        image,
        lambdaFunction,
        lambdaRole,
        lambdaPolicy,
        lambdaSecurityGroup,
        logGroup,
        ecsTaskStateRule,
        ecsTaskStateTarget,

        outputs: {
            functionName: lambdaFunction.name,
            functionArn: lambdaFunction.arn,
            imageUri: imageRef,
        },
    }
}
