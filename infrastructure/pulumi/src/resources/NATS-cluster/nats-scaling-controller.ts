import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import {
    formatStageResourceName,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../../helpers/docker/build-helpers.ts'
import { LOG_RETENTION_DAYS } from '../../constants/logging.ts'

type ScalingControllerArgs = {
    name: string
    autoScalingGroup: aws.autoscaling.Group
    vpc: aws.ec2.Vpc
    privateSubnets: aws.ec2.Subnet[]
    systemPassword: string
    operatorSeed: string
    brokerMemoryMiB: number
    scaleInCpuPercent?: number
}

export const createNatsScalingController = (args: ScalingControllerArgs) => {
    if (
        !args.systemPassword
        || !args.operatorSeed
    )
        throw new Error('NATS scaling requires system and operator credentials')

    const scaleInCpuPercent = args.scaleInCpuPercent ?? 30

    if (
        !Number.isFinite(scaleInCpuPercent)
        || scaleInCpuPercent <= 0
        || scaleInCpuPercent >= 100
    )
        throw new Error('NATS scale-in CPU threshold must be between 0 and 100 percent')

    const name = `${args.name}-scaling-controller`
    const credentials = new aws.secretsmanager.Secret(`${name}-credentials`)
    const version = new aws.secretsmanager.SecretVersion(
        `${name}-credentials-value`,
        {
            secretId: credentials.id,
            secretString: pulumi.secret(
                JSON.stringify({
                    systemPassword: args.systemPassword,
                    operatorSeed: args.operatorSeed,
                }),
            ),
        },
    )
    const role = new aws.iam.Role(
        `${name}-role`,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Service: 'lambda.amazonaws.com' },
                    Action: 'sts:AssumeRole',
                }],
            }),
        },
    )
    const policy = new aws.iam.RolePolicy(
        `${name}-policy`,
        {
            role: role.id,
            policy: pulumi.all([args.autoScalingGroup.arn, credentials.arn]).apply(
                ([groupArn, secretArn]) => JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Action: ['autoscaling:DescribeAutoScalingGroups', 'ec2:DescribeInstances', 'cloudwatch:GetMetricStatistics', 'ssm:GetCommandInvocation'],
                            Resource: '*',
                        },
                        {
                            Effect: 'Allow',
                            Action: ['autoscaling:CreateOrUpdateTags', 'autoscaling:DeleteTags', 'autoscaling:TerminateInstanceInAutoScalingGroup'],
                            Resource: groupArn,
                        },
                        {
                            Effect: 'Allow',
                            Action: 'secretsmanager:GetSecretValue',
                            Resource: secretArn,
                        },
                        {
                            Effect: 'Allow',
                            Action: 'ssm:SendCommand',
                            Resource: `arn:aws:ssm:${aws.config.region}::document/AWS-RunShellScript`,
                        },
                        {
                            Effect: 'Allow',
                            Action: 'ssm:SendCommand',
                            Resource: `arn:aws:ec2:${aws.config.region}:*:instance/*`,
                            Condition: { StringEquals: { 'ssm:resourceTag/Name': formatStageResourceName(
                                'ECS-Instance',
                                process.env.ORG_NAME,
                                process.env.STAGE,
                            ) } },
                        },
                    ],
                }),
            ),
        },
    )
    new aws.iam.RolePolicyAttachment(
        `${name}-execution`,
        {
            role: role.name,
            policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
        },
    )
    const securityGroup = new aws.ec2.SecurityGroup(
        `${name}-sg`,
        {
            vpcId: args.vpc.id,
            egress: [{
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
            }],
        },
    )
    const image = buildDockerImage({
        imageName: name,
        dockerBuildContext: '/usr/src/service/infrastructure/pulumi/src/resources/NATS-cluster/nats-scaling-controller',
        dockerfilePath: '/usr/src/service/infrastructure/pulumi/src/resources/NATS-cluster/nats-scaling-controller/Dockerfile',
        platforms: ['linux/amd64'],
        push: true,
    }) as DockerImageBuildResult
    const logs = new aws.cloudwatch.LogGroup(
        `${name}-logs`,
        {
            name: `/aws/lambda/${name}`,
            retentionInDays: LOG_RETENTION_DAYS,
        },
    )
    const controller = new aws.lambda.Function(
        `${name}-function`,
        {
            name,
            role: role.arn,
            packageType: 'Image',
            imageUri: image.imageRef,
            timeout: 120,
            memorySize: 512,
            reservedConcurrentExecutions: 1,
            vpcConfig: {
                subnetIds: args.privateSubnets.map(subnet => subnet.id),
                securityGroupIds: [securityGroup.id],
            },
            environment: { variables: {
                AUTO_SCALING_GROUP: args.autoScalingGroup.name,
                CREDENTIALS_SECRET_ARN: credentials.arn,
                TASK_FAMILY: args.name,
                BROKER_MEMORY_MIB: String(args.brokerMemoryMiB),
                SCALE_IN_CPU_PERCENT: String(scaleInCpuPercent),
                NATS_SCALING_SUBJECTS: JSON.stringify({
                    ...NATS_SUBJECTS.PROTOCOL_SUBJECTS.JETSTREAM,
                    SCALING_PROBE: NATS_SUBJECTS.PROTOCOL_SUBJECTS.SCALING_PROBE,
                }),
            } },
        },
        { dependsOn: [version, policy, logs] },
    )
    const schedule = new aws.cloudwatch.EventRule(`${name}-schedule`, { scheduleExpression: 'rate(1 minute)' })
    new aws.lambda.Permission(
        `${name}-schedule-invoke`,
        {
            action: 'lambda:InvokeFunction',
            function: controller.name,
            principal: 'events.amazonaws.com',
            sourceArn: schedule.arn,
        },
    )
    new aws.cloudwatch.EventTarget(
        `${name}-target`,
        {
            rule: schedule.name,
            arn: controller.arn,
        },
    )
    const alerts = new aws.sns.Topic(`${name}-alerts`)

    if (process.env.NATS_OPERATIONAL_ALERT_EMAIL)
        new aws.sns.TopicSubscription(
            `${name}-email`,
            {
                topic: alerts.arn,
                protocol: 'email',
                endpoint: process.env.NATS_OPERATIONAL_ALERT_EMAIL,
            },
        )

    new aws.cloudwatch.MetricAlarm(
        `${name}-failure`,
        {
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensions: { FunctionName: controller.name },
            statistic: 'Sum',
            period: 60,
            evaluationPeriods: 1,
            threshold: 1,
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            treatMissingData: 'notBreaching',
            alarmActions: [alerts.arn],
        },
    )

    return {
        controller,
        alerts,
    }
}
