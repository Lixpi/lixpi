'use strict'

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    buildDockerImage,
    type DockerImageBuildResult
} from '../../helpers/docker/build-helpers.ts'

import { LOG_RETENTION_DAYS } from '../../constants/logging.ts'

// Local helper function (avoiding import issues in Pulumi context)
const formatStageResourceName = (resourceName: string, orgName: string, stageName: string): string =>
    `${resourceName}-${orgName}-${stageName}`

const { ORG_NAME, STAGE } = process.env

export interface LambdaCertificateManagerArgs {
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

    // Docker build context (same as ECS version)
    dockerBuildContext: string
    dockerfilePath: string

    // Environment overrides
    environment?: Record<string, string>
}

export interface LambdaCertificateManagerResult {
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

    // Outputs
    outputs: {
        functionName: pulumi.Output<string>
        functionArn: pulumi.Output<string>
        certificateSecrets: {
            name: pulumi.Output<string>
            arn: pulumi.Output<string>
        }[]
    }
}

export const createLambdaCertificateManager = async (
    args: LambdaCertificateManagerArgs
): Promise<LambdaCertificateManagerResult> => {
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
    } = args

    // Format names consistently
    const formattedFunctionName = formatStageResourceName(functionName, ORG_NAME || 'lixpi', STAGE || 'dev')

    // Build and push certificate manager Lambda Docker image to ECR
    const { repository, image, imageRef, imageTag } = buildDockerImage({
        imageName: formattedFunctionName,
        dockerBuildContext,
        dockerfilePath,
        platforms: ['linux/amd64'],
        push: true,
    }) as DockerImageBuildResult;

    // Lambda execution role
    const lambdaRole = new aws.iam.Role(`${formattedFunctionName}-role`, {
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
    new aws.iam.RolePolicyAttachment(`${formattedFunctionName}-basic-execution`, {
        role: lambdaRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    })

    // Attach VPC execution policy if running in VPC
    if (vpc && privateSubnets) {
        new aws.iam.RolePolicyAttachment(`${formattedFunctionName}-vpc-execution`, {
            role: lambdaRole.name,
            policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
        })
    }

    // Certificate management IAM policies
    const certificatePolicy = new aws.iam.Policy(`${formattedFunctionName}-policy`, {
        policy: JSON.stringify({
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
                        'route53:GetResourceRecordSets',
                        'route53:ListResourceRecordSets',
                    ],
                    Resource: 'arn:aws:route53:::hostedzone/*',
                },
                // Storage-specific permissions
                ...(storageType === 'secrets-manager' ? [
                    {
                        Effect: 'Allow',
                        Action: [
                            'secretsmanager:CreateSecret',
                            'secretsmanager:UpdateSecret',
                            'secretsmanager:PutSecretValue',
                            'secretsmanager:GetSecretValue',
                        ],
                        Resource: `arn:aws:secretsmanager:*:*:secret:${storageConfig.secretsManagerPrefix}-*`,
                    }
                ] : []),
                ...(storageType === 's3' ? [
                    {
                        Effect: 'Allow',
                        Action: [
                            's3:PutObject',
                            's3:GetObject',
                            's3:DeleteObject',
                        ],
                        Resource: pulumi.interpolate`${storageConfig.s3Bucket}/${storageConfig.s3Prefix || 'certificates'}/*`,
                    }
                ] : []),
                ...(storageType === 'efs' ? [
                    {
                        Effect: 'Allow',
                        Action: [
                            'elasticfilesystem:CreateAccessPoint',
                            'elasticfilesystem:DescribeAccessPoints',
                            'elasticfilesystem:DescribeFileSystems',
                        ],
                        Resource: '*',
                    }
                ] : []),
            ],
        }),
    })

    new aws.iam.RolePolicyAttachment(`${formattedFunctionName}-cert-policy`, {
        role: lambdaRole.name,
        policyArn: certificatePolicy.arn,
    })

    // Prepare Lambda environment variables with proper Pulumi Output handling
    const lambdaEnvironment = hostedZoneId ?
        pulumi.all([hostedZoneId]).apply(([zoneId]) => ({
            // Core certificate manager environment
            CADDY_LOCAL_MODE: 'false', // Force production mode in Lambda
            DOMAINS: domains.join(','),
            CADDY_EMAIL: email,
            STORAGE_TYPE: storageType,
            // AWS_REGION is automatically provided by Lambda runtime - don't set it explicitly

            // Storage-specific environment
            ...(storageType === 'secrets-manager' ? {
                SECRETS_PREFIX: storageConfig.secretsManagerPrefix || 'caddy-cert',
            } : {}),
            ...(storageType === 's3' ? {
                S3_BUCKET: storageConfig.s3Bucket?.toString() || '',
                S3_PREFIX: storageConfig.s3Prefix || 'certificates',
            } : {}),

            // Route53 configuration for DNS challenges
            AWS_HOSTED_ZONE_ID: zoneId || '', // Specific hosted zone ID for DNS challenges

            // Override any user-provided environment
            ...environment,
        })) : {
            // Core certificate manager environment
            CADDY_LOCAL_MODE: 'false', // Force production mode in Lambda
            DOMAINS: domains.join(','),
            CADDY_EMAIL: email,
            STORAGE_TYPE: storageType,
            // AWS_REGION is automatically provided by Lambda runtime - don't set it explicitly

            // Storage-specific environment
            ...(storageType === 'secrets-manager' ? {
                SECRETS_PREFIX: storageConfig.secretsManagerPrefix || 'caddy-cert',
            } : {}),
            ...(storageType === 's3' ? {
                S3_BUCKET: storageConfig.s3Bucket?.toString() || '',
                S3_PREFIX: storageConfig.s3Prefix || 'certificates',
            } : {}),

            // Route53 configuration for DNS challenges
            AWS_HOSTED_ZONE_ID: '', // Auto-detect hosted zone ID

            // Override any user-provided environment
            ...environment,
        }

    // VPC configuration for Lambda (if provided)
    let vpcConfig: any = {}
    if (vpc && privateSubnets) {
        // Create a security group for Lambda if running in VPC
        const lambdaSg = new aws.ec2.SecurityGroup(`${formattedFunctionName}-sg`, {
            vpcId: vpc.id,
            description: 'Security group for certificate manager Lambda',
            egress: [{
                fromPort: 0,
                toPort: 0,
                protocol: '-1',
                cidrBlocks: ['0.0.0.0/0'],
            }],
        })

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
            return new aws.secretsmanager.Secret(`${secretName}-secret`, {
                name: secretName,
                description: `TLS certificate for ${domain}`,
                forceOverwriteReplicaSecret: true,
                recoveryWindowInDays: 0, // FORCE DELETE with 0 recovery window
            })
        })
    }

    // Create CloudWatch Log Group for Lambda (prevents auto-creation with infinite retention)
    const logGroup = new aws.cloudwatch.LogGroup(`${formattedFunctionName}-logs`, {
        name: `/aws/lambda/${formattedFunctionName}`,
        retentionInDays: LOG_RETENTION_DAYS,
    })

    // Create Lambda function using container image
    // Use a unique resource name AND function name with imageTag to avoid naming conflicts
    const lambdaFunction = new aws.lambda.Function(`${formattedFunctionName}-${imageTag}`, {
        name: `${formattedFunctionName}-${imageTag}`,
        packageType: 'Image',
        imageUri: imageRef,
        role: lambdaRole.arn,
        timeout,
        memorySize,
        environment: {
            variables: lambdaEnvironment,
        },
        vpcConfig: Object.keys(vpcConfig).length > 0 ? vpcConfig : undefined,
        // Lambda container images don't use layers
        architectures: ['x86_64'],
        description: pulumi.interpolate`Caddy certificate manager Lambda function for domains: ${domains.join(', ')} - Image: ${imageTag}`,
        // Publish a new version to force update
        publish: true,
    }, {
        dependsOn: [...(storageType === 'secrets-manager' ? certificateSecrets : []), image, logGroup],
        // Force complete resource replacement when any input changes
        replaceOnChanges: ['*'],
        // Delete the old function before creating the new one
        deleteBeforeReplace: true,
    })

    // Create the initial certificate generation invocation
    // This provides the synchronous behavior that NATS needs
    const initialCertificateGeneration = new aws.lambda.Invocation(`${formattedFunctionName}-initial-cert-${imageTag}`, {
        functionName: lambdaFunction.name, // Use the function name directly instead of alias
        input: JSON.stringify({
            action: 'generate_certificates',
            domains: domains,
            force: true, // Force generation on initial deployment
        }),
        triggers: {
            // Retrigger if domains or configuration change
            domains: domains.join(','),
            storageType,
            imageTag,
            // Add timestamp to force re-invocation when Lambda function is replaced
            deploymentTimestamp: Date.now().toString(),
        },
    }, {
        dependsOn: [lambdaFunction], // Depend on function directly since we're not using alias
        // Force this invocation to be replaced when Lambda function changes
        replaceOnChanges: ['*'],
        // Delete before replace to ensure clean invocation
        deleteBeforeReplace: true,
    })

    return {
        repository,
        image,
        lambdaFunction,
        lambdaRole,
        logGroup,
        initialCertificateGeneration,
        certificateSecrets,
        outputs: {
            functionName: lambdaFunction.name,
            functionArn: lambdaFunction.arn,
            certificateSecrets: certificateSecrets.map(secret => ({
                name: secret.name,
                arn: secret.arn,
            })),
        },
    }
}

/**
 * Creates a certificate helper for Lambda-managed certificates
 */
export const createLambdaCertificateHelper = (
    domain: string,
    storageType: 'secrets-manager' | 's3' | 'efs',
    storageConfig: {
        secretsManagerPrefix?: string
        s3Bucket?: pulumi.Input<string>
        s3Prefix?: string
        efsFileSystemId?: pulumi.Input<string>
    }
): import('./certificate-helper.ts').CertificateHelper => {
    switch (storageType) {
        case 'secrets-manager':
            const secretName = `${storageConfig.secretsManagerPrefix}-${domain.replace(/\*/g, 'wildcard').replace(/\./g, '-')}`

            return {
                getCertificateReference: () => pulumi.output(secretName),
                getCertificateEnvironment: () => [
                    { name: 'CERT_STORAGE_TYPE', value: 'secrets-manager' },
                    { name: 'CERT_SECRET_NAME', value: secretName },
                    { name: 'CERT_DOMAIN', value: domain },
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
                    { name: 'CERT_STORAGE_TYPE', value: 's3' },
                    { name: 'CERT_S3_BUCKET', value: storageConfig.s3Bucket?.toString() || '' },
                    { name: 'CERT_S3_PREFIX', value: storageConfig.s3Prefix || 'certificates' },
                    { name: 'CERT_DOMAIN', value: domain },
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
                    { name: 'CERT_STORAGE_TYPE', value: 'efs' },
                    { name: 'CERT_EFS_FILESYSTEM_ID', value: storageConfig.efsFileSystemId?.toString() || '' },
                    { name: 'CERT_DOMAIN', value: domain },
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
