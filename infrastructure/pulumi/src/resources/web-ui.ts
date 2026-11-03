import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { Command } from '@pulumi/command/local/index.js'

import { formatStageResourceName } from '@lixpi/constants'

import {
    buildDockerImage,
    type DockerImageLocalResult,
} from '../helpers/docker/build-helpers.ts'

export type WebClientEnvironment = {
    VITE_API_URL: string
    VITE_AUTH0_LOGIN_URL: string
    VITE_AUTH0_DOMAIN: string
    VITE_AUTH0_CLIENT_ID: string
    VITE_AUTH0_AUDIENCE: string
    VITE_AUTH0_REDIRECT_URI: string
    VITE_USER_PORTAL_URL: string
    VITE_NATS_SERVER: string
}

type StaticWebClientHostingArgs = {
    // Organization and environment
    orgName: string
    stage: string

    // Domain configuration
    domainName: string
    hostedZoneId: string
    hostedZoneName: string
    certificateArn: pulumi.Input<string>

    // An external publisher can own artifacts while this component owns hosting.
    artifactManagement?: 'infrastructure' | 'external'

    serviceName: string
    aliases: string[]
    bucketNameSegment: string
    hosting?: {
        resourceNamePrefix?: string
        bucketName?: string
        originAccessIdentityComment?: string
    }
}

export type StaticWebClientArtifactCommands = {
    buildCommand: pulumi.Input<string>
    buildDirectory: string
    resourceNames?: {
        build?: string
        upload?: string
        invalidation?: string
    }
}

type DockerWebClientArgs = StaticWebClientHostingArgs & {
    environment: WebClientEnvironment
    dockerBuildContext: string
    dockerfilePath: string
    buildDirectory: string
    builderContainerName: string
    artifactCommands?: undefined
}

export type StaticWebClientArgs = DockerWebClientArgs | (StaticWebClientHostingArgs & {
    artifactCommands: StaticWebClientArtifactCommands
})

export type WebUIArgs = Omit<
    DockerWebClientArgs,
    'aliases' | 'buildDirectory' | 'builderContainerName' | 'bucketNameSegment' | 'serviceName'
>

export const createStaticWebClient = async (args: StaticWebClientArgs) => {
    const {
        orgName,
        stage,
        domainName,
        hostedZoneId,
        hostedZoneName,
        certificateArn,
        serviceName,
        aliases,
        bucketNameSegment,
        hosting,
        artifactCommands,
        artifactManagement = 'infrastructure',
    } = args

    // Resource naming
    const formattedServiceName = hosting?.resourceNamePrefix ?? formatStageResourceName(
        serviceName,
        orgName,
        stage,
    )

    // Create an S3 bucket for the website
    const siteBucket = new aws.s3.Bucket(
        `${formattedServiceName}-bucket`,
        {
            bucket: hosting?.bucketName ?? `${orgName}-${bucketNameSegment}-${domainName}-cloudfront-distribution`.toLowerCase(),
            acl: 'private', // CloudFront will handle access, so keep this private
            website: {
                indexDocument: 'index.html',
                errorDocument: 'index.html',
            },
            forceDestroy: true,
        },
    )

    // Create a CloudFront origin access identity for S3
    const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity(
        `${formattedServiceName}-oai`,
        {
            comment: hosting?.originAccessIdentityComment ?? `OAI for ${domainName} website`,
        },
    )

    // Grant CloudFront permission to access the bucket
    const bucketPolicy = new aws.s3.BucketPolicy(
        `${formattedServiceName}-bucket-policy`,
        {
            bucket: siteBucket.id,
            policy: pulumi.all([siteBucket.arn, originAccessIdentity.iamArn]).apply(
                ([bucketArn, oaiArn]) =>
                    JSON.stringify({
                        Version: '2012-10-17',
                        Statement: [{
                            Effect: 'Allow',
                            Principal: {
                                AWS: oaiArn,
                            },
                            Action: 's3:GetObject',
                            Resource: `${bucketArn}/*`,
                        }],
                    }),
            ),
        },
    )

    let uploadExec: Command | undefined

    if (artifactManagement === 'infrastructure') {
        let buildExec: Command
        let s3SyncCommand: pulumi.Input<string>
        let buildDependencies: pulumi.Resource[] = []

        if (args.artifactCommands) {
            const {
                buildCommand,
                buildDirectory,
                resourceNames,
            } = args.artifactCommands

            buildExec = new Command(
                resourceNames?.build ?? `${formattedServiceName}-build-exec`,
                {
                    create: buildCommand,
                    update: buildCommand,
                    environment: {
                        TIMESTAMP: new Date().toISOString(),
                    },
                },
                {
                    replaceOnChanges: ['*'],
                },
            )

            s3SyncCommand = pulumi.interpolate`aws s3 sync "${buildDirectory}" s3://${siteBucket.bucket} --delete`
        } else {
            const {
                environment,
                dockerBuildContext,
                dockerfilePath,
                buildDirectory,
                builderContainerName,
            } = args

            // Build web UI Docker image locally (no ECR push needed)
            const {
                image: webUIBuildImage,
                imageTag: webUIImageTag,
            } = buildDockerImage({
                imageName: `${formattedServiceName}-build`,
                dockerBuildContext,
                dockerfilePath,
                platforms: ['linux/amd64'],
                buildArgs: Object.entries(environment).reduce(
                    (acc, [key, value]) => ({
                        ...acc,
                        [key]: value,
                    }),
                    {
                        VITE_NATS_SERVER: environment.VITE_NATS_SERVER,
                    },
                ),
                push: false,
                noCache: true,
                buildOnPreview: true,
                exports: [
                    {
                        docker: {
                            names: [`${formattedServiceName}-build:latest`.toLowerCase()],
                        },
                    },
                ],
            }) as DockerImageLocalResult

            // Prepare environment variables for docker run only
            const envVars = pulumi.all(
                Object.entries(environment).map(([key, value]) => pulumi.output(value).apply(v => `-e ${key}=${v}`)),
            ).apply(flags => flags.join(' '))

            // Run a container to build the site, and extract the build artifacts
            const buildCommand = pulumi.interpolate`
            docker stop ${builderContainerName} >/dev/null 2>&1 || true && \
            docker rm ${builderContainerName} >/dev/null 2>&1 || true && \
            docker run -d --name ${builderContainerName} ${envVars} ${webUIImageTag} tail -f /dev/null && \
            docker exec ${builderContainerName} pnpm run build && \
            mkdir -p ${buildDirectory} && \
            docker cp ${builderContainerName}:/usr/src/service/dist/. ${buildDirectory}/ && \
            docker stop ${builderContainerName} && \
            docker rm ${builderContainerName}
        `

            // Run the build command
            buildExec = new Command(
                `${formattedServiceName}-build-exec`,
                {
                    create: buildCommand,
                    update: buildCommand,
                    environment: {
                        // Add a timestamp to force the command to run on every update
                        TIMESTAMP: new Date().toISOString(),
                    },
                },
                {
                    replaceOnChanges: ['*'],
                    dependsOn: [webUIBuildImage],
                },
            )

            buildDependencies = [webUIBuildImage]
            s3SyncCommand = pulumi.interpolate`
            aws s3 sync ${buildDirectory} s3://${siteBucket.bucket} --delete
        `
        }

        // Upload the built assets to S3 using aws cli sync
        uploadExec = new Command(
            artifactCommands?.resourceNames?.upload ?? `${formattedServiceName}-upload-exec`,
            {
                create: s3SyncCommand,
                update: s3SyncCommand,
                environment: {
                    // Add a timestamp to force the command to run on every update
                    TIMESTAMP: new Date().toISOString(),
                },
            },
            {
                dependsOn: [buildExec, siteBucket, ...buildDependencies],
                replaceOnChanges: ['*'],
            },
        )
    }

    // Create CloudFront distribution
    const distribution = new aws.cloudfront.Distribution(
        `${formattedServiceName}-distribution`,
        {
            enabled: true,
            isIpv6Enabled: true,
            httpVersion: 'http3',
            priceClass: 'PriceClass_All', // Use global edge locations for worldwide distribution

            // Origins configuration
            origins: [{
                domainName: siteBucket.bucketRegionalDomainName,
                originId: siteBucket.id.apply(id => `S3-${id}`),
                s3OriginConfig: {
                    originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
                },
            }],

            // Default behavior
            defaultCacheBehavior: {
                allowedMethods: ['GET', 'HEAD', 'OPTIONS'], // ALLOW_GET_HEAD_OPTIONS
                cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
                targetOriginId: siteBucket.id.apply(id => `S3-${id}`),
                forwardedValues: {
                    queryString: false,
                    cookies: {
                        forward: 'none',
                    },
                    headers: ['Origin'],
                },
                viewerProtocolPolicy: 'redirect-to-https', // HTTPS_ONLY
                minTtl: 0,
                defaultTtl: 3600,
                maxTtl: 86400,
                compress: true,
            },

            // Restrictions
            restrictions: {
                geoRestriction: {
                    restrictionType: 'none',
                    locations: [],
                },
            },

            // SSL certificate
            viewerCertificate: {
                acmCertificateArn: certificateArn,
                sslSupportMethod: 'sni-only',
                minimumProtocolVersion: 'TLSv1.2_2021',
            },

            // Custom error responses - redirect to index.html for SPA
            customErrorResponses: [
                {
                    errorCode: 403,
                    responseCode: 200,
                    responsePagePath: '/index.html',
                },
                {
                    errorCode: 404,
                    responseCode: 200,
                    responsePagePath: '/index.html',
                },
            ],

            aliases,

            // Wait for invalidation to complete
            waitForDeployment: true,
        },
        {
            dependsOn: [originAccessIdentity, ...(uploadExec ? [uploadExec] : [])],
        },
    )

    if (uploadExec) {
        // Create CloudFront invalidation to ensure latest content is served
        const invalidationCommand = artifactCommands
            ? pulumi.interpolate`aws cloudfront create-invalidation --distribution-id ${distribution.id} --paths "/*"`
            : pulumi.interpolate`
            aws cloudfront create-invalidation --distribution-id ${distribution.id} --paths "/*"
            `
        new Command(
            artifactCommands?.resourceNames?.invalidation ?? `${formattedServiceName}-invalidation-exec`,
            {
                create: invalidationCommand,
                update: invalidationCommand,
                environment: {
                    // Add a timestamp to force the command to run on every update
                    TIMESTAMP: new Date().toISOString(),
                },
            },
            {
                dependsOn: [uploadExec, distribution],
                replaceOnChanges: ['*'],
            },
        )
    }

    return {
        siteBucket,
        distribution,
        outputs: {
            bucketName: siteBucket.bucket,
            websiteUrl: pulumi.interpolate`https://${domainName}`,
            domainName,
            distributionId: distribution.id,
            distributionDomainName: distribution.domainName,
            distributionHostedZoneId: distribution.hostedZoneId, // Add hosted zone ID for alias record
        },
    }
}

export const createWebUI = async (args: WebUIArgs) => {
    const wwwDomainName = `www.${args.domainName}`
    const webUI = await createStaticWebClient({
        ...args,
        serviceName: 'web-ui',
        aliases: [args.domainName, wwwDomainName],
        buildDirectory: './dist/web-ui',
        builderContainerName: 'web-ui-builder',
        bucketNameSegment: 'web-ui',
    })

    return {
        ...webUI,
        outputs: {
            ...webUI.outputs,
            wwwDomainName,
        },
    }
}
