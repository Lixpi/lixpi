import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult,
} from '../../helpers/docker/build-helpers.ts'

import { LOG_RETENTION_DAYS } from '../../constants/logging.ts'

// Local helper function (avoiding import issues in Pulumi context)
const formatStageResourceName = (
    resourceName: string,
    orgName: string,
    stageName: string,
): string => `${resourceName}-${orgName}-${stageName}`

const {
    ORG_NAME,
    STAGE,
} = process.env

export type LambdaCertificateManagerArgs = {
    // Certificate configuration
    domains: string[]
    email: string

    // DNS configuration
    hostedZoneId?: pulumi.Input<string>

    // Storage configuration
    storageType: 'secrets-manager' | 's3' | 'efs'
    storageConfig: {
        secretsManagerPrefix?: string
        s3Bucket?: pulumi.Input<string>
        s3Prefix?: string
        efsFileSystemId?: pulumi.Input<string>
        efsAccessPoint?: aws.efs.AccessPoint
    }

    // AWS infrastructure
    vpc?: aws.ec2.Vpc
    privateSubnets?: aws.ec2.Subnet[]

    // Lambda configuration
    functionName?: string
    timeout?: number
    memorySize?: number
    alarmActions?: pulumi.Input<string>[]

    // Docker build context (same as ECS version)
    dockerBuildContext: string
    dockerfilePath: string

    // Environment overrides
    environment?: Record<string, string>
}

export type LambdaCertificateManagerResult = {
    // ECR Repository for container image
    repository: aws.ecr.Repository

    // Docker image (from helper)
    image: DockerImageBuildResult['image']

    // Lambda function
    lambdaFunction: aws.lambda.Function
    lambdaRole: aws.iam.Role

    // CloudWatch Log Group
    logGroup: aws.cloudwatch.LogGroup

    // Certificate generation invocation (for dependency management)
    initialCertificateGeneration: aws.lambda.Invocation

    // Certificate secrets (if using secrets-manager storage)
    certificateSecrets: aws.secretsmanager.Secret[]
    certificateStateBucket: aws.s3.Bucket
    alertTopic: aws.sns.Topic

    // Outputs
    outputs: {
        functionName: pulumi.Output<string>
        functionArn: pulumi.Output<string>
        alertTopicArn: pulumi.Output<string>
        certificateSecrets: {
            name: pulumi.Output<string>
            arn: pulumi.Output<string>
        }[]
    }
}

export const createLambdaCertificateManager = async (args: LambdaCertificateManagerArgs): Promise<LambdaCertificateManagerResult> => {
    const {
        domains,
        email,
        hostedZoneId,
        storageType,
        storageConfig,
        vpc,
        privateSubnets,
        functionName = 'cert-manager',
        timeout = 900, // 15 minutes - certificate generation can take time
        memorySize = 1024,
        dockerBuildContext,
        dockerfilePath,
        environment = {},
        alarmActions = [],
    } = args

    // Format names consistently
    const formattedFunctionName = formatStageResourceName(
        functionName,
        ORG_NAME || 'lixpi',
        STAGE || 'dev',
    )

    const certificateStateBucket = new aws.s3.Bucket(
        `${formattedFunctionName}-state`,
        {
            forceDestroy: false,
        },
        { protect: true },
    )
    new aws.s3.BucketVersioning(
        `${formattedFunctionName}-state-versioning`,
        {
            bucket: certificateStateBucket.id,
            versioningConfiguration: { status: 'Enabled' },
        },
    )
    new aws.s3.BucketServerSideEncryptionConfiguration(
        `${formattedFunctionName}-state-encryption`,
        {
            bucket: certificateStateBucket.id,
            rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
        },
    )
    new aws.s3.BucketPublicAccessBlock(
        `${formattedFunctionName}-state-private`,
        {
            bucket: certificateStateBucket.id,
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        },
    )
    const alertTopic = new aws.sns.Topic(`${formattedFunctionName}-alerts`, {})

    if (process.env.NATS_OPERATIONAL_ALERT_EMAIL)
        new aws.sns.TopicSubscription(
            `${formattedFunctionName}-alert-email`,
            {
                topic: alertTopic.arn,
                protocol: 'email',
                endpoint: process.env.NATS_OPERATIONAL_ALERT_EMAIL,
            },
        )

    const certificateAlarmActions = [alertTopic.arn, ...alarmActions]

    // Build and push certificate manager Lambda Docker image to ECR
    const {
        repository,
        image,
        imageRef,
        imageTag,
    } = buildDockerImage({
        imageName: formattedFunctionName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
    }) as DockerImageBuildResult

    // Lambda execution role
    const lambdaRole = new aws.iam.Role(
        `${formattedFunctionName}-role`,
        {
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
        },
    )

    const statePolicy = new aws.iam.RolePolicy(
        `${formattedFunctionName}-state-policy`,
        {
            role: lambdaRole.id,
            policy: pulumi.jsonStringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: ['s3:ListBucket'],
                        Resource: certificateStateBucket.arn,
                    },
                    {
                        Effect: 'Allow',
                        Action: ['s3:GetObject', 's3:PutObject'],
                        Resource: pulumi.interpolate`${certificateStateBucket.arn}/caddy-state.tar.gz`,
                    },
                    {
                        Effect: 'Allow',
                        Action: ['cloudwatch:PutMetricData'],
                        Resource: '*',
                        Condition: { StringEquals: { 'cloudwatch:namespace': 'Lixpi/Certificates' } },
                    },
                ],
            }),
        },
    )

    // Attach basic Lambda execution policy
    new aws.iam.RolePolicyAttachment(
        `${formattedFunctionName}-basic-execution`,
        {
            role: lambdaRole.name,
            policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        },
    )

    // Attach VPC execution policy if running in VPC
    if (
        vpc
        && privateSubnets
    ) {
        new aws.iam.RolePolicyAttachment(
            `${formattedFunctionName}-vpc-execution`,
            {
                role: lambdaRole.name,
                policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
            },
        )
    }

    // Certificate management IAM policies
    const certificatePolicy = new aws.iam.Policy(
        `${formattedFunctionName}-policy`,
        {
            policy: pulumi.jsonStringify({
                Version: '2012-10-17',
                Statement: [
                    // Route53 permissions for DNS-01 challenge
                    {
                        Effect: 'Allow',
                        Action: [
                            'route53:GetChange',
                            'route53:ListHostedZones',
                            'route53:ListHostedZonesByName',
                        ],
                        Resource: '*',
                    },
                    {
                        Effect: 'Allow',
                        Action: [
                            'route53:ChangeResourceRecordSets',
                            'route53:GetHostedZone',
                            'route53:ListResourceRecordSets',
                        ],
                        Resource: hostedZoneId ? pulumi.interpolate`arn:aws:route53:::hostedzone/${hostedZoneId}` : 'arn:aws:route53:::hostedzone/*',
                    },
                    // Storage-specific permissions
                    ...(storageType === 'secrets-manager'
                        ? [
                            {
                                Effect: 'Allow',
                                Action: [
                                    'secretsmanager:CreateSecret',
                                    'secretsmanager:UpdateSecret',
                                    'secretsmanager:PutSecretValue',
                                    'secretsmanager:GetSecretValue',
                                    'secretsmanager:ListSecretVersionIds',
                                ],
                                Resource: `arn:aws:secretsmanager:*:*:secret:${storageConfig.secretsManagerPrefix}-*`,
                            },
                        ]
                        : []),
                    ...(storageType === 's3'
                        ? [
                            {
                                Effect: 'Allow',
                                Action: [
                                    's3:PutObject',
                                    's3:GetObject',
                                    's3:DeleteObject',
                                ],
                                Resource: pulumi.interpolate`${storageConfig.s3Bucket}/${storageConfig.s3Prefix || 'certificates'}/*`,
                            },
                        ]
                        : []),
                    ...(storageType === 'efs'
                        ? [
                            {
                                Effect: 'Allow',
                                Action: [
                                    'elasticfilesystem:CreateAccessPoint',
                                    'elasticfilesystem:DescribeAccessPoints',
                                    'elasticfilesystem:DescribeFileSystems',
                                ],
                                Resource: '*',
                            },
                        ]
                        : []),
                ],
            }),
        },
    )

    const certificatePolicyAttachment = new aws.iam.RolePolicyAttachment(
        `${formattedFunctionName}-cert-policy`,
        {
            role: lambdaRole.name,
            policyArn: certificatePolicy.arn,
        },
    )

    const lambdaEnvironment = pulumi.all({
        zoneId: hostedZoneId ?? '',
        stateBucket: certificateStateBucket.id,
        certificateBucket: storageConfig.s3Bucket ?? '',
    }).apply(
        ({
            zoneId,
            stateBucket,
            certificateBucket,
        }) => ({
            CADDY_STATE_BUCKET: stateBucket,
            CERT_MANAGER_NAME: formattedFunctionName,
            CADDY_LOCAL_MODE: 'false',
            DOMAINS: domains.join(','),
            CADDY_EMAIL: email,
            STORAGE_TYPE: storageType,
            SECRETS_PREFIX: storageConfig.secretsManagerPrefix || 'caddy-cert',
            S3_BUCKET: certificateBucket,
            S3_PREFIX: storageConfig.s3Prefix || 'certificates',
            AWS_HOSTED_ZONE_ID: zoneId,
            ...environment,
        }),
    )

    // VPC configuration for Lambda (if provided)
    let vpcConfig: any = {}

    if (
        vpc
        && privateSubnets
    ) {
        // Create a security group for Lambda if running in VPC
        const lambdaSg = new aws.ec2.SecurityGroup(
            `${formattedFunctionName}-sg`,
            {
                vpcId: vpc.id,
                description: 'Security group for certificate manager Lambda',
                egress: [{
                    fromPort: 0,
                    toPort: 0,
                    protocol: '-1',
                    cidrBlocks: ['0.0.0.0/0'],
                }],
            },
        )

        vpcConfig = {
            subnetIds: privateSubnets.map(subnet => subnet.id),
            securityGroupIds: [lambdaSg.id],
        }
    }

    // Create secrets in AWS Secrets Manager for certificate storage (if using secrets-manager)
    let certificateSecrets: aws.secretsmanager.Secret[] = []

    if (storageType === 'secrets-manager') {
        certificateSecrets = domains.map(domain => {
            const secretName = `${storageConfig.secretsManagerPrefix}-${domain.replace(/\*/g, 'wildcard').replace(/\./g, '-')}`

            return new aws.secretsmanager.Secret(
                `${secretName}-secret`,
                {
                    name: secretName,
                    description: `TLS certificate for ${domain}`,
                    forceOverwriteReplicaSecret: true,
                    recoveryWindowInDays: 30,
                },
            )
        })
    }

    // Create CloudWatch Log Group for Lambda (prevents auto-creation with infinite retention)
    const logGroup = new aws.cloudwatch.LogGroup(
        `${formattedFunctionName}-logs`,
        {
            name: `/aws/lambda/${formattedFunctionName}`,
            retentionInDays: LOG_RETENTION_DAYS,
        },
    )

    // Keep one function identity so concurrency serialization also covers image updates.
    const lambdaFunction = new aws.lambda.Function(
        formattedFunctionName,
        {
            name: formattedFunctionName,
            packageType: 'Image',
            imageUri: imageRef,
            role: lambdaRole.arn,
            timeout,
            memorySize,
            reservedConcurrentExecutions: 1,
            environment: {
                variables: lambdaEnvironment,
            },
            vpcConfig: Object.keys(vpcConfig).length > 0 ? vpcConfig : undefined,
            // Lambda container images don't use layers
            architectures: ['x86_64'],
            description: pulumi.interpolate`Caddy certificate manager Lambda function for domains: ${domains.join(', ')} - Image: ${imageTag}`,
            // Publish a new version to force update
            publish: true,
        },
        {
            dependsOn: [...(storageType === 'secrets-manager' ? certificateSecrets : []), image, logGroup, statePolicy, certificatePolicyAttachment],
        },
    )

    // Create the initial certificate generation invocation
    // This provides the synchronous behavior that NATS needs
    const initialCertificateGeneration = new aws.lambda.Invocation(
        `${formattedFunctionName}-initial-cert-${imageTag}`,
        {
            functionName: lambdaFunction.name, // Use the function name directly instead of alias
            input: JSON.stringify({
                action: 'generate_certificates',
                domains: domains,
            }),
            triggers: {
                // Retrigger if domains or configuration change
                domains: domains.join(','),
                storageType,
                imageTag,
            },
        },
        {
            dependsOn: [lambdaFunction], // Depend on function directly since we're not using alias
            // Force this invocation to be replaced when Lambda function changes
            replaceOnChanges: ['*'],
            // Delete before replace to ensure clean invocation
            deleteBeforeReplace: true,
        },
    )

    const renewalSchedule = new aws.cloudwatch.EventRule(
        `${formattedFunctionName}-renewal`,
        {
            scheduleExpression: 'rate(6 hours)',
            description: 'Check persisted certificates and renew when they enter the Caddy renewal window',
        },
    )
    new aws.lambda.Permission(
        `${formattedFunctionName}-scheduled-renewal`,
        {
            action: 'lambda:InvokeFunction',
            function: lambdaFunction.name,
            principal: 'events.amazonaws.com',
            sourceArn: renewalSchedule.arn,
        },
    )
    new aws.cloudwatch.EventTarget(
        `${formattedFunctionName}-renewal-target`,
        {
            rule: renewalSchedule.name,
            arn: lambdaFunction.arn,
            input: JSON.stringify({ action: 'maintain_certificates' }),
            retryPolicy: {
                maximumEventAgeInSeconds: 3600,
                maximumRetryAttempts: 3,
            },
        },
    )
    new aws.cloudwatch.MetricAlarm(
        `${formattedFunctionName}-renewal-errors`,
        {
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensions: { FunctionName: lambdaFunction.name },
            statistic: 'Sum',
            period: 300,
            evaluationPeriods: 1,
            threshold: 1,
            comparisonOperator: 'GreaterThanOrEqualToThreshold',
            treatMissingData: 'notBreaching',
            alarmActions: certificateAlarmActions,
        },
    )
    new aws.cloudwatch.MetricAlarm(
        `${formattedFunctionName}-renewal-stale`,
        {
            namespace: 'Lixpi/Certificates',
            metricName: 'CertificateMaintenanceSuccess',
            dimensions: { Manager: formattedFunctionName },
            statistic: 'Sum',
            period: 21600,
            evaluationPeriods: 2,
            threshold: 1,
            comparisonOperator: 'LessThanThreshold',
            treatMissingData: 'breaching',
            alarmActions: certificateAlarmActions,
        },
    )
    new aws.cloudwatch.MetricAlarm(
        `${formattedFunctionName}-certificate-expiry`,
        {
            namespace: 'Lixpi/Certificates',
            metricName: 'CertificateSecondsRemaining',
            dimensions: { Manager: formattedFunctionName },
            statistic: 'Minimum',
            period: 21600,
            evaluationPeriods: 1,
            threshold: 604800,
            comparisonOperator: 'LessThanThreshold',
            treatMissingData: 'breaching',
            alarmActions: certificateAlarmActions,
        },
    )

    return {
        repository,
        image,
        lambdaFunction,
        lambdaRole,
        logGroup,
        initialCertificateGeneration,
        certificateSecrets,
        certificateStateBucket,
        alertTopic,
        outputs: {
            functionName: lambdaFunction.name,
            functionArn: lambdaFunction.arn,
            alertTopicArn: alertTopic.arn,
            certificateSecrets: certificateSecrets.map(
                secret => ({
                    name: secret.name,
                    arn: secret.arn,
                }),
            ),
        },
    }
}

// Creates a certificate helper for Lambda-managed certificates
export const createLambdaCertificateHelper = (
    domain: string,
    storageType: 'secrets-manager' | 's3' | 'efs',
    storageConfig: {
        secretsManagerPrefix?: string
        s3Bucket?: pulumi.Input<string>
        s3Prefix?: string
        efsFileSystemId?: pulumi.Input<string>
    },
): import('./certificate-helper.ts').CertificateHelper => {
    switch (storageType) {
        case 'secrets-manager':
            const secretName = `${storageConfig.secretsManagerPrefix}-${domain.replace(/\*/g, 'wildcard').replace(/\./g, '-')}`

            return {
                getCertificateReference: () => pulumi.output(secretName),
                getCertificateEnvironment: () => [
                    {
                        name: 'CERT_STORAGE_TYPE',
                        value: 'secrets-manager',
                    },
                    {
                        name: 'CERT_SECRET_NAME',
                        value: secretName,
                    },
                    {
                        name: 'CERT_DOMAIN',
                        value: domain,
                    },
                ],
                getCertificateDownloadScript: () => `
                    # Download certificate from Secrets Manager
                    aws secretsmanager get-secret-value --secret-id "${secretName}" --query SecretString --output text > /tmp/cert_data.json
                    cat /tmp/cert_data.json | jq -r '.certificate' > /certificates/tls.crt
                    cat /tmp/cert_data.json | jq -r '.private_key' > /certificates/tls.key
                    rm /tmp/cert_data.json
                `,
            }
        case 's3':
            return {
                getCertificateReference: () => pulumi.interpolate`${storageConfig.s3Bucket}/${storageConfig.s3Prefix || 'certificates'}/${domain}`,
                getCertificateEnvironment: () => [
                    {
                        name: 'CERT_STORAGE_TYPE',
                        value: 's3',
                    },
                    {
                        name: 'CERT_S3_BUCKET',
                        value: storageConfig.s3Bucket?.toString() || '',
                    },
                    {
                        name: 'CERT_S3_PREFIX',
                        value: storageConfig.s3Prefix || 'certificates',
                    },
                    {
                        name: 'CERT_DOMAIN',
                        value: domain,
                    },
                ],
                getCertificateDownloadScript: () => `
                    # Download certificate from S3
                    aws s3 cp "s3://${storageConfig.s3Bucket}/${storageConfig.s3Prefix || 'certificates'}/${domain}/tls.crt" /certificates/tls.crt
                    aws s3 cp "s3://${storageConfig.s3Bucket}/${storageConfig.s3Prefix || 'certificates'}/${domain}/tls.key" /certificates/tls.key
                `,
            }
        case 'efs':
            return {
                getCertificateReference: () => pulumi.interpolate`${storageConfig.efsFileSystemId}:/${domain}`,
                getCertificateEnvironment: () => [
                    {
                        name: 'CERT_STORAGE_TYPE',
                        value: 'efs',
                    },
                    {
                        name: 'CERT_EFS_FILESYSTEM_ID',
                        value: storageConfig.efsFileSystemId?.toString() || '',
                    },
                    {
                        name: 'CERT_DOMAIN',
                        value: domain,
                    },
                ],
                getCertificateDownloadScript: () => `
                    # Certificate files are already available on EFS mount
                    cp "/certificates/${domain}/tls.crt" /certificates/tls.crt
                    cp "/certificates/${domain}/tls.key" /certificates/tls.key
                `,
            }
        default:
            throw new Error(`Unsupported storage type: ${storageType}`)
    }
}
