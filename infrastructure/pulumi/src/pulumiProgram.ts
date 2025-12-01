'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import { log, info, warn, err } from '@lixpi/debug-tools'
import { plInfo, plWarn, plError } from './pulumiLogger.ts'

import { createSsmParameters } from './resources/SSM-parameters.ts'
import { createDynamoDbTables } from './resources/db/DynamoDB-tables.ts'
import { createNetworkInfrastructure } from './resources/network.ts'
import { createEcsCluster } from './resources/ECS-cluster.ts'
import { createNatsClusterService } from './resources/NATS-cluster/NATS-cluster.ts'
import { createMainApiService } from './resources/main-api-service.ts'
import { createLlmApiService } from './resources/llm-api-service.ts'
import { createCertificate } from './resources//certificate.ts'
import { createDnsRecords, createHostedZone, createDelegationRecord, getOrCreateHostedZone } from './resources/dns-records.ts'
import { createWebUI } from './resources/web-ui.ts'
import { formatStageResourceName } from '@lixpi/constants'
import { createLambdaCertificateManager, createLambdaCertificateHelper } from './resources/certificate-manager/index.ts'

const {
    DOMAIN_NAME,
    HOSTED_ZONE_NAME,
    AWS_ROUTE53_HOSTED_ZONE_ID,              // Child or root hosted zone (if exists)
    AWS_ROUTE53_PARENT_HOSTED_ZONE_ID,       // Optional parent zone for delegation
    OPENAI_API_KEY,
    ANTHROPIC_API_KEY,
    STAGE,
    ENVIRONMENT,
    NODE_OPTIONS,

    HOSTED_ZONE_DNS_ROLE_ARN,

    AWS_REGION,
    ORG_NAME,
    CERTIFICATE_VALIDATION_EMAIL,

    DYNAMODB_ENDPOINT,

    NATS_SERVERS,
    NATS_AUTH_ACCOUNT,
    NATS_SYS_USER_PASSWORD,
    NATS_REGULAR_USER_PASSWORD,
    NATS_AUTH_NKEY_ISSUER_SEED,
    NATS_AUTH_NKEY_ISSUER_PUBLIC,
    NATS_AUTH_XKEY_ISSUER_SEED,
    NATS_AUTH_XKEY_ISSUER_PUBLIC,
    NATS_LLM_SERVICE_NKEY_SEED,
    NATS_LLM_SERVICE_NKEY_PUBLIC,
    NATS_SAME_ORIGIN,
    NATS_ALLOWED_ORIGINS,
    NATS_DEBUG_MODE,
    NATS_TRACE_MODE,
    ORIGIN_HOST_URL,
    API_HOST_URL,
    AUTH0_DOMAIN,
    AUTH0_API_IDENTIFIER,
    SAVE_LLM_RESPONSES_TO_DEBUG_DIR,

    VITE_API_URL,
    VITE_AUTH0_LOGIN_URL,
    VITE_AUTH0_DOMAIN,
    VITE_AUTH0_CLIENT_ID,
    VITE_AUTH0_AUDIENCE,
    VITE_AUTH0_REDIRECT_URI,
    VITE_STRIPE_PUBLIC_KEY,
    VITE_NATS_SERVER,

} = process.env

export const createInfrastructure = async () => {

    // Decide whether to deploy full AWS infra or use local-only resources
    const DEPLOY_TO_AWS = process.env.ENVIRONMENT !== 'local'
    const USE_LOCAL_DYNAMODB = !DEPLOY_TO_AWS

    const dynamoDBtables = await createDynamoDbTables({
        ...(USE_LOCAL_DYNAMODB && {
            provider: new aws.Provider('local-dynamodb', {
                region: ('us-east-1' as aws.Region),
                accessKey: 'test',
                secretKey: 'test',
                skipCredentialsValidation: true,
                skipRequestingAccountId: true,
                endpoints: [{ dynamodb: DYNAMODB_ENDPOINT! }],
            })
        }),
    })

    // Local mode: only create DynamoDB tables (in DynamoDB Local) and exit early
    if (!DEPLOY_TO_AWS) {
        return { dynamoDBtables }
    }

    // Everything below is for real AWS deployments only
    const ssmParameters = createSsmParameters()

    // Create network infrastructure including VPC, subnets, and security groups
    const networkInfrastructure = await createNetworkInfrastructure()

    // Configure provider to assume the role with Route53 permissions
    const dnsProvider = new aws.Provider("dns-provider", {
        ...(HOSTED_ZONE_DNS_ROLE_ARN && {
            assumeRole: {
                roleArn: HOSTED_ZONE_DNS_ROLE_ARN,
                sessionName: "PulumiDeployment"
            }
        })
    });

    // Hosted zone resolution strategy (idempotent & reuse-only):
    // 1. If explicit AWS_ROUTE53_HOSTED_ZONE_ID provided -> trust & reuse it (validate exists)
    // 2. Else try to find existing zone by name -> reuse
    // 3. Else create new one (and only then optionally delegate from parent)
    let hostedZoneId: pulumi.Output<string>;
    let createdHostedZone: aws.route53.Zone | undefined;
    let delegationRecord: aws.route53.Record | undefined;

    if (AWS_ROUTE53_HOSTED_ZONE_ID) {
        const existing = await aws.route53.getZone({ name: DOMAIN_NAME! }).catch(e => {
            throw new Error(`Explicit AWS_ROUTE53_HOSTED_ZONE_ID provided but lookup by name failed for ${DOMAIN_NAME}: ${e}`)
        });
        hostedZoneId = pulumi.output(existing.zoneId);
    } else {
        const zoneResult = await getOrCreateHostedZone({
            orgName: ORG_NAME!,
            stage: STAGE!,
            domainName: DOMAIN_NAME!,
            serviceName: 'domain',
        });
        hostedZoneId = zoneResult.outputs.hostedZoneId;
        if (!zoneResult.reused) {
            createdHostedZone = zoneResult.hostedZone;
            if (AWS_ROUTE53_PARENT_HOSTED_ZONE_ID) {
                delegationRecord = createDelegationRecord({
                    parentHostedZoneId: AWS_ROUTE53_PARENT_HOSTED_ZONE_ID,
                    subdomainName: DOMAIN_NAME!,
                    nameServers: zoneResult.outputs.nameServers,
                    serviceName: 'domain',
                    dnsProvider,
                });
            }
        }
    }

    // Create certificate using the appropriate hosted zone ID
    const certificateResources = await createCertificate({
        domainName: DOMAIN_NAME!,
        hostedZoneId: hostedZoneId,
        orgName: ORG_NAME!,
        stage: STAGE!,
        serviceName: 'shared-certificate',
        dnsProvider
    })

    // Create CloudMap service discovery namespace (for DNS-based service discovery)
    const cloudMapNamespaceName = `cloudmap.${DOMAIN_NAME}.internal`; // cloudmap.shelby-dev.lixpi.dev.internal
    const cloudMapNamespace = new aws.servicediscovery.PrivateDnsNamespace(`${DOMAIN_NAME}-namespace`, {
        name: cloudMapNamespaceName,
        vpc: networkInfrastructure.vpc.id,
        description: `Private service discovery namespace for ${cloudMapNamespaceName}`,
    });

    // Create ECS Cluster for Fargate tasks
    const ecsCluster = await createEcsCluster({
        vpc: networkInfrastructure.vpc,
        publicSubnets: networkInfrastructure.publicSubnets,
        privateSubnets: networkInfrastructure.privateSubnets,
        clusterName: 'Shared-ECS-Cluster',
        tags: {
            Environment: ENVIRONMENT!,
            Project: 'Lixpi AI',
        },
    })

    // Create NATS domain for certificate management - USE MANAGEABLE DOMAIN
    // The client connects to nats.cloudmap.shelby-dev.lixpi.dev, but we generate cert for controllable domain
    const natsDomain = `nats.${DOMAIN_NAME}`  // nats.shelby-dev.lixpi.dev (manageable via Route53)

    // Create placeholder DNS record for NATS domain BEFORE certificate generation
    // This allows DNS-01 challenge to succeed since the domain will exist in DNS
    // Note: Using a valid public IP (8.8.8.8) as placeholder instead of localhost
    // Idempotent placeholder record (safe overwrite if already present)
    const natsPlaceholderRecord = new aws.route53.Record(`nats-placeholder-record`, {
        name: natsDomain,
        zoneId: hostedZoneId,
        type: "A",
        allowOverwrite: true,
        records: ["8.8.8.8"],
        ttl: 60,
    });

    // Create Lambda-based Caddy certificate manager for NATS TLS certificates
    // Note: DNS record created above ensures domain exists for certificate validation
    const caddyCertManager = await createLambdaCertificateManager({
        domains: [natsDomain],
        email: CERTIFICATE_VALIDATION_EMAIL || `admin@${DOMAIN_NAME}`,
        // Explicitly pass hosted zone ID (removes auto-detect round trip & ambiguity)
        hostedZoneId: hostedZoneId,
        storageType: 'secrets-manager',
        storageConfig: {
            secretsManagerPrefix: formatStageResourceName('nats-certs', ORG_NAME!, STAGE!),
        },
        functionName: 'nats-cert-manager',
        timeout: 900, // 15 minutes for certificate generation
        memorySize: 1024,
        dockerBuildContext: '/usr/src/service/infrastructure/pulumi/src/resources/certificate-manager',
        dockerfilePath: '/usr/src/service/infrastructure/pulumi/src/resources/certificate-manager/Dockerfile',
        environment: {
            // Any additional environment variables for Lambda
        },
    })

    // Create certificate helper for NATS to access certificates
    const natsCertHelper = createLambdaCertificateHelper(
        natsDomain,
        'secrets-manager',
        {
            secretsManagerPrefix: formatStageResourceName('nats-certs', ORG_NAME!, STAGE!),
        }
    )

    // Create NATS cluster service - CRITICAL: Must wait for certificates to be generated first
    const natsClusterService = await createNatsClusterService({
        cloudMapNamespace,
        cloudMapNamespaceName,
        parentHostedZoneId: hostedZoneId, // Hosted zone we manage / created or existing
        natsRecordName: natsDomain, // e.g., "nats.shelby-dev.lixpi.dev"
        ecsCluster: {  // Add back ECS cluster - Fargate tasks run on the existing cluster
            id: ecsCluster.outputs.clusterId,
            arn: ecsCluster.outputs.clusterArn,
            name: ecsCluster.outputs.clusterName,
        },
        vpc: networkInfrastructure.vpc,
        publicSubnets: networkInfrastructure.publicSubnets,
        privateSubnets: networkInfrastructure.privateSubnets,
        serviceName: formatStageResourceName('nats-cluster', ORG_NAME!, STAGE!).toLowerCase(),
        clientPort: 4222,           // 4222: client connections
        httpManagementPort: 8222,   // 8222: HTTP management/info
        clusterRoutingPort: 6222,   // 6222: cluster routing
        cpu: 256,
        memory: 512,                // Changed from 256 to 512 - valid Fargate combination
        minCount: 3,
        maxCount: 3,
        desiredCount: 3,
        environment: {
            NATS_CLUSTER_NAME: "Lixpi-NATS",
            NATS_SERVER_NAME_BASE: "Lixpi-NATS",
            NATS_SYS_USER_PASSWORD: NATS_SYS_USER_PASSWORD!,
            NATS_REGULAR_USER_PASSWORD: NATS_REGULAR_USER_PASSWORD!,
            NATS_AUTH_NKEY_ISSUER_PUBLIC: NATS_AUTH_NKEY_ISSUER_PUBLIC!,
            NATS_AUTH_XKEY_ISSUER_PUBLIC: NATS_AUTH_XKEY_ISSUER_PUBLIC!,
            NATS_LLM_SERVICE_NKEY_PUBLIC: NATS_LLM_SERVICE_NKEY_PUBLIC!,
            NATS_SAME_ORIGIN: NATS_SAME_ORIGIN!,
            NATS_ALLOWED_ORIGINS: NATS_ALLOWED_ORIGINS || "[]",
            NATS_DEBUG_MODE: NATS_DEBUG_MODE!,
            NATS_TRACE_MODE: NATS_TRACE_MODE!,
        },
        // Add certificate configuration
        certificateHelper: natsCertHelper,
        dockerBuildContext: '/usr/src/service/services/nats',
        dockerfilePath: '/usr/src/service/services/nats/Dockerfile',
        // CRITICAL: NATS cluster CANNOT start until certificates are generated
        dependencies: [caddyCertManager.initialCertificateGeneration],
    })

    // Deploy main API service on ECS infrastructure
    const mainApiService = await createMainApiService({
        ecsCluster: {
            id: ecsCluster.outputs.clusterId,
            arn: ecsCluster.outputs.clusterArn,
            name: ecsCluster.outputs.clusterName,
        },
        vpc: networkInfrastructure.vpc,
        publicSubnets: networkInfrastructure.publicSubnets,
        privateSubnets: networkInfrastructure.privateSubnets,
        serviceName: 'api',
        containerPort: 3000,
        cpu: 256,
        memory: 512,
        desiredCount: 1,
        resourceBindings: {
            tables: {
                usersTable: dynamoDBtables.usersTable,
                organizationsTable: dynamoDBtables.organizationsTable,
                organizationsAccessListTable: dynamoDBtables.organizationsAccessListTable,
                documentsTable: dynamoDBtables.documentsTable,
                documentsMetaTable: dynamoDBtables.documentsMetaTable,
                documentsAccessListTable: dynamoDBtables.documentsAccessListTable,
                aiModelsListTable: dynamoDBtables.aiModelsListTable,
            },
            functions: (() => {
                const f: any = {};
                if (dynamoDBtables?.stripeBillingHandlerLambda) {
                    f.stripeBillingHandlerLambda = dynamoDBtables.stripeBillingHandlerLambda;
                }
                return f;
            })(),
            topics: (() => {
                const t: any = {};
                if (dynamoDBtables?.subscriptionBalanceUpdatesSNSTopic) {
                    t.subscriptionBalanceUpdatesTopic = dynamoDBtables.subscriptionBalanceUpdatesSNSTopic;
                }
                return t;
            })(),
        },
        environment: {
            NODE_OPTIONS: NODE_OPTIONS!,
            AWS_REGION: AWS_REGION!,
            STAGE: STAGE!,
            ORG_NAME: ORG_NAME!,
            ENVIRONMENT: ENVIRONMENT!,

            NATS_SERVERS: NATS_SERVERS!,
            NATS_AUTH_ACCOUNT: NATS_AUTH_ACCOUNT!,
            NATS_AUTH_NKEY_ISSUER_SEED: NATS_AUTH_NKEY_ISSUER_SEED!,
            NATS_AUTH_NKEY_ISSUER_PUBLIC: NATS_AUTH_NKEY_ISSUER_PUBLIC!,
            NATS_AUTH_XKEY_ISSUER_SEED: NATS_AUTH_XKEY_ISSUER_SEED!,
            NATS_AUTH_XKEY_ISSUER_PUBLIC: NATS_AUTH_XKEY_ISSUER_PUBLIC!,
            NATS_SYS_USER_PASSWORD: NATS_SYS_USER_PASSWORD!,
            NATS_REGULAR_USER_PASSWORD: NATS_REGULAR_USER_PASSWORD!,
            NATS_LLM_SERVICE_NKEY_PUBLIC: NATS_LLM_SERVICE_NKEY_PUBLIC!,
            ORIGIN_HOST_URL: ORIGIN_HOST_URL!,
            API_HOST_URL: API_HOST_URL!,
            AUTH0_DOMAIN: AUTH0_DOMAIN!,
            AUTH0_API_IDENTIFIER: AUTH0_API_IDENTIFIER!,
            SAVE_LLM_RESPONSES_TO_DEBUG_DIR: SAVE_LLM_RESPONSES_TO_DEBUG_DIR!,
            OPENAI_API_KEY: OPENAI_API_KEY!,
            ANTHROPIC_API_KEY: ANTHROPIC_API_KEY!,
        },
        dockerBuildContext: '/usr/src/service',
        dockerfilePath: '/usr/src/service/services/api/Dockerfile',
    })

    // Deploy LLM API service on ECS infrastructure
    // This service is isolated in a separate NATS account and communicates exclusively via NATS
    const llmApiService = await createLlmApiService({
        ecsCluster: {
            id: ecsCluster.outputs.clusterId,
            arn: ecsCluster.outputs.clusterArn,
            name: ecsCluster.outputs.clusterName,
        },
        vpc: networkInfrastructure.vpc,
        publicSubnets: networkInfrastructure.publicSubnets,
        privateSubnets: networkInfrastructure.privateSubnets,
        serviceName: 'llm-api',
        containerPort: 8000,
        cpu: 256,
        memory: 512,
        desiredCount: 1,
        environment: {
            SERVICE_NAME: 'llm-api',
            LOG_LEVEL: 'INFO',

            AWS_REGION: AWS_REGION!,

            STAGE: STAGE!,
            ORG_NAME: ORG_NAME!,
            ENVIRONMENT: ENVIRONMENT!,

            NATS_SERVERS: NATS_SERVERS!,
            NATS_NKEY_SEED: NATS_LLM_SERVICE_NKEY_SEED!,

            AUTH0_DOMAIN: AUTH0_DOMAIN!,
            AUTH0_API_IDENTIFIER: AUTH0_API_IDENTIFIER!,

            OPENAI_API_KEY: OPENAI_API_KEY!,
            ANTHROPIC_API_KEY: ANTHROPIC_API_KEY!,

            LLM_TIMEOUT_SECONDS: '1200',
        },
        dockerBuildContext: '/usr/src/service',
        dockerfilePath: '/usr/src/service/services/llm-api/Dockerfile',
        dependencies: [natsClusterService.ecsService], // Must wait for NATS cluster to be ready
    })

    // Deploy the web UI with CloudFront distribution
    const webUI = await createWebUI({
        orgName: ORG_NAME!,
        stage: STAGE!,
        domainName: DOMAIN_NAME!,
        hostedZoneId: hostedZoneId as unknown as string, // createWebUI currently expects string; cast Output
        hostedZoneName: HOSTED_ZONE_NAME || DOMAIN_NAME!,
        certificateArn: certificateResources.outputs.validatedCertificateArn,
        environment: {
            VITE_API_URL: VITE_API_URL!,
            VITE_AUTH0_LOGIN_URL: VITE_AUTH0_LOGIN_URL!,
            VITE_AUTH0_DOMAIN: VITE_AUTH0_DOMAIN!,
            VITE_AUTH0_CLIENT_ID: VITE_AUTH0_CLIENT_ID!,
            VITE_AUTH0_AUDIENCE: VITE_AUTH0_AUDIENCE!,
            VITE_AUTH0_REDIRECT_URI: VITE_AUTH0_REDIRECT_URI!,
            VITE_NATS_SERVER: VITE_NATS_SERVER!,
        },
        dockerBuildContext: '/usr/src/service',
        dockerfilePath: '/usr/src/service/services/web-ui/Dockerfile',
    });

    // Create DNS records after the services are created
    const dnsRecords = pulumi.all([
        hostedZoneId,
        webUI.outputs.domainName,
        webUI.outputs.distributionDomainName,
        webUI.outputs.distributionHostedZoneId,
        webUI.outputs.wwwDomainName,
    ]).apply(async ([
        currentHostedZoneId,
        webDomainName,
        webDistDns,
        webDistZoneId,
        webWwwDomainName,
    ]) => {
        return await createDnsRecords({
            orgName: ORG_NAME!,
            stage: STAGE!,
            hostedZoneId: currentHostedZoneId, // Use the appropriate hosted zone
            records: [
                // Note: NATS DNS is now handled automatically by CloudMap public namespace
                // No manual DNS records needed for NATS - CloudMap manages nats.shelby-dev.lixpi.dev

                // Add the record for the apex domain
                {
                    name: webDomainName,
                    type: "A",
                    alias: {
                        name: webDistDns,
                        zoneId: webDistZoneId,
                        evaluateTargetHealth: false,
                    }
                },
                // Add the record for www subdomain
                {
                    name: webWwwDomainName,
                    type: "A",
                    alias: {
                        name: webDistDns,
                        zoneId: webDistZoneId,
                        evaluateTargetHealth: false,
                    }
                }
            ],
            serviceName: 'Lixpi-AI'
        });
    });

    return {
        ssmParameters,
        dynamoDBtables,
        networkInfrastructure,
        ecsCluster,
        caddyCertManager,
        natsClusterService,
        mainApiService,
        llmApiService,
        webUI,
        certificateResources,
        dnsRecords,
        cloudMapNamespace,
        ...(createdHostedZone && { createdHostedZone }),
        ...(delegationRecord && { delegationRecord }),
    }
}
