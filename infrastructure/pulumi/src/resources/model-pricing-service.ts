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
const MODEL_PRICING_METRIC_NAMESPACE = 'Lixpi/ModelPricing'

export type ModelPricingServiceArgs = {
    ecsCluster: {
        id: pulumi.Output<string>
        arn: pulumi.Output<string>
        name: pulumi.Output<string>
    }
    vpc: aws.ec2.Vpc
    privateSubnets: aws.ec2.Subnet[]
    tables: Record<string, aws.dynamodb.Table>
    aiModelsListTable: aws.dynamodb.Table
    environment: Record<string, pulumi.Input<string>>
    pricingServiceNkeySeed: pulumi.Input<string>
    openAiAdminApiKey?: pulumi.Input<string>
    dockerBuildContext: string
    dockerfilePath: string
    alarmActions?: pulumi.Input<string>[]
    dependencies?: pulumi.Resource[]
}

export const createModelPricingService = (args: ModelPricingServiceArgs) => {
    const {
        ecsCluster,
        vpc,
        privateSubnets,
        tables,
        aiModelsListTable,
        environment,
        pricingServiceNkeySeed,
        openAiAdminApiKey,
        dockerBuildContext,
        dockerfilePath,
        alarmActions = [],
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
        policy: pulumi.all([pulumi.all(Object.values(tables).map(table => table.arn)), aiModelsListTable.arn]).apply(([pricingTableArns, catalogTableArn]) => JSON.stringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Action: [
                        'dynamodb:GetItem',
                        'dynamodb:Query',
                        'dynamodb:Scan',
                        'dynamodb:PutItem',
                        'dynamodb:UpdateItem',
                        'dynamodb:BatchWriteItem',
                        'dynamodb:TransactWriteItems',
                        'dynamodb:DescribeTable',
                    ],
                    Resource: pricingTableArns,
                },
                {
                    Effect: 'Allow',
                    Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:DescribeTable'],
                    Resource: catalogTableArn,
                },
            ],
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
        role: executionRole.name,
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

    const metricDimensions = {
        Service: serviceName,
        Stage: STAGE!,
    }
    const createMetricAlarm = (
        resourceName: string,
        args: Omit<aws.cloudwatch.MetricAlarmArgs, 'actionsEnabled' | 'alarmActions' | 'dimensions' | 'namespace' | 'okActions'>,
    ): aws.cloudwatch.MetricAlarm => new aws.cloudwatch.MetricAlarm(`${serviceName}-${resourceName}`, {
        ...args,
        actionsEnabled: alarmActions.length > 0,
        alarmActions,
        okActions: alarmActions,
        dimensions: metricDimensions,
        namespace: MODEL_PRICING_METRIC_NAMESPACE,
    })

    const alarms = {
        activeSnapshotMissing: createMetricAlarm('active-snapshot-missing-alarm', {
            alarmDescription: 'Model pricing has no active verified snapshot or stopped publishing health telemetry. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'LessThanThreshold',
            datapointsToAlarm: 2,
            evaluationPeriods: 2,
            metricName: 'ActiveSnapshotPresent',
            period: 300,
            statistic: 'Minimum',
            threshold: 1,
            treatMissingData: 'breaching',
        }),
        activeSnapshotStale: createMetricAlarm('active-snapshot-stale-alarm', {
            alarmDescription: 'No model-pricing import has successfully reverified provider evidence for 36 hours. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 3,
            evaluationPeriods: 3,
            metricName: 'LastSuccessfulImportAgeSeconds',
            period: 300,
            statistic: 'Maximum',
            threshold: 36 * 60 * 60,
            treatMissingData: 'notBreaching',
        }),
        consumerRefreshStale: createMetricAlarm('consumer-refresh-stale-alarm', {
            alarmDescription: 'No pricing-table consumer fetched the active snapshot within the alarm window. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 3,
            evaluationPeriods: 3,
            metricName: 'ConsumerRefreshPending',
            period: 300,
            statistic: 'Maximum',
            threshold: 1,
            treatMissingData: 'notBreaching',
        }),
        missingRoute: createMetricAlarm('missing-route-alarm', {
            alarmDescription: 'At least one catalog pricing route has no active verified price record. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 1,
            evaluationPeriods: 1,
            metricName: 'MissingRouteCount',
            period: 300,
            statistic: 'Maximum',
            threshold: 1,
            treatMissingData: 'notBreaching',
        }),
        heldRoute: createMetricAlarm('held-route-alarm', {
            alarmDescription: 'At least one catalog pricing candidate is held while the last verified record remains active. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 1,
            evaluationPeriods: 1,
            metricName: 'HeldRouteCount',
            period: 300,
            statistic: 'Maximum',
            threshold: 1,
            treatMissingData: 'notBreaching',
        }),
        parserFailure: createMetricAlarm('parser-failure-alarm', {
            alarmDescription: 'An official provider source could not be parsed or verified for at least one catalog route. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 1,
            evaluationPeriods: 1,
            metricName: 'ParserFailureHoldCount',
            period: 300,
            statistic: 'Maximum',
            threshold: 1,
            treatMissingData: 'notBreaching',
        }),
        maintenanceFailure: createMetricAlarm('maintenance-failure-alarm', {
            alarmDescription: 'A model-pricing import, reconciliation, pruning, or health task failed. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 1,
            evaluationPeriods: 1,
            metricName: 'MaintenanceFailureCount',
            period: 300,
            statistic: 'Sum',
            threshold: 1,
            treatMissingData: 'notBreaching',
        }),
        reconciliationIncident: createMetricAlarm('reconciliation-incident-alarm', {
            alarmDescription: 'Provider actuals reconciliation has an open material incident. Follow documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md.',
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            datapointsToAlarm: 1,
            evaluationPeriods: 1,
            metricName: 'ReconciliationMaterialIncidentCount',
            period: 300,
            statistic: 'Maximum',
            threshold: 1,
            treatMissingData: 'notBreaching',
        }),
    }

    const pricingServiceSecret = new aws.secretsmanager.Secret(`${serviceName}-nkey`, {
        name: `${formatStageResourceName(serviceName, ORG_NAME!, STAGE!)}/nats-service-nkey`,
        description: 'NKey seed for the model pricing ECS task',
    })

    const pricingServiceSecretVersion = new aws.secretsmanager.SecretVersion(`${serviceName}-nkey-value`, {
        secretId: pricingServiceSecret.id,
        secretString: pulumi.secret(pricingServiceNkeySeed),
    })

    const openAiAdminSecret = openAiAdminApiKey ? new aws.secretsmanager.Secret(`${serviceName}-openai-admin`, {
        name: `${formatStageResourceName(serviceName, ORG_NAME!, STAGE!)}/openai-admin-api-key`,
        description: 'OpenAI organization admin key for provider-cost reconciliation',
    }) : undefined
    const openAiAdminSecretVersion = openAiAdminSecret && openAiAdminApiKey
        ? new aws.secretsmanager.SecretVersion(`${serviceName}-openai-admin-value`, {
            secretId: openAiAdminSecret.id,
            secretString: pulumi.secret(openAiAdminApiKey),
        })
        : undefined

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

    if (openAiAdminSecret) {
        const openAiSecretAccessPolicy = new aws.iam.Policy(`${serviceName}-openai-secret-access-policy`, {
            policy: openAiAdminSecret.arn.apply(secretArn => JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['secretsmanager:GetSecretValue'],
                    Resource: secretArn,
                }],
            })),
        })
        new aws.iam.RolePolicyAttachment(`${serviceName}-openai-secret-access-attachment`, {
            role: executionRole.name,
            policyArn: openAiSecretAccessPolicy.arn,
        })
    }

    const taskDefinition = new aws.ecs.TaskDefinition(`${serviceName}-task`, {
        family: serviceName,
        cpu: '256',
        memory: '512',
        networkMode: 'awsvpc',
        requiresCompatibilities: ['FARGATE'],
        executionRoleArn: executionRole.arn,
        taskRoleArn: taskRole.arn,
        containerDefinitions: pulumi.all([
            logGroup.name,
            imageRef,
            pulumi.output(environment),
            pricingServiceSecretVersion.arn,
            openAiAdminSecretVersion?.arn ?? pulumi.output(''),
        ]).apply(([
            logGroupName,
            imageReference,
            configuredEnvironment,
            secretVersionArn,
            openAiAdminSecretVersionArn,
        ]) => JSON.stringify([{
            name: serviceName,
            image: imageReference,
            essential: true,
            environment: Object.entries(configuredEnvironment as Record<string, string>)
                .map(([name, value]) => ({ name, value })),
            secrets: [
                {
                    name: 'NATS_PRICING_SERVICE_NKEY_SEED',
                    valueFrom: secretVersionArn,
                },
                ...(openAiAdminSecretVersionArn ? [{
                    name: 'OPENAI_ADMIN_API_KEY',
                    valueFrom: openAiAdminSecretVersionArn,
                }] : []),
            ],
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
        dependsOn: [pricingServiceSecretVersion, ...(openAiAdminSecretVersion ? [openAiAdminSecretVersion] : []), ...dependencies],
    })

    return {
        repository,
        image,
        executionRole,
        taskRole,
        taskDefinition,
        ecsService,
        pricingServiceSecret,
        openAiAdminSecret,
        alarms,
    }
}
