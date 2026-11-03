import * as aws from '@pulumi/aws'
import { createCertificate } from '../resources/certificate.ts'
import { createStaticWebClient } from '../resources/web-ui.ts'
import { createDnsRecords } from '../resources/dns-records.ts'

const requiredEnvironment = (name: string): string => {
    const value = process.env[name]

    if (!value)
        throw new Error(`${name} is required for a static website deployment`)

    return value
}

export const createStaticWebsiteInfrastructure = async () => {
    const orgName = requiredEnvironment('ORG_NAME')
    const stage = requiredEnvironment('STAGE')
    const domainName = requiredEnvironment('DOMAIN_NAME')
    const hostedZoneId = requiredEnvironment('AWS_ROUTE53_HOSTED_ZONE_ID')
    const accountId = requiredEnvironment('AWS_EXPECTED_ACCOUNT_ID')
    const websiteRoot = '/usr/src/website'
    const resourceBase = `website-${orgName}-${stage}`.toLowerCase()
    const certificateBase = `website-cert-${orgName}-${stage}`.toLowerCase()

    // Keep the existing website resource identities when moving between repositories.
    const certificateProvider = new aws.Provider(
        'us-east-1-provider',
        {
            region: 'us-east-1',
            allowedAccountIds: [accountId],
        },
    )
    const certificate = await createCertificate({
        orgName,
        stage,
        domainName,
        hostedZoneId,
        serviceName: 'website',
        identity: {
            resourceName: certificateBase,
            validationResourceName: `${certificateBase}-validation`,
            validationRecordPrefix: `${certificateBase}-validation`,
            tagName: `${orgName}-website-cert-${stage}`,
            provider: certificateProvider,
        },
    })
    const website = await createStaticWebClient({
        orgName,
        stage,
        domainName,
        hostedZoneId,
        hostedZoneName: domainName,
        certificateArn: certificate.outputs.validatedCertificateArn,
        serviceName: 'website',
        aliases: [domainName, `www.${domainName}`],
        bucketNameSegment: 'website',
        hosting: {
            resourceNamePrefix: resourceBase,
            bucketName: `${orgName}-website-${domainName}-distribution`.toLowerCase(),
            originAccessIdentityComment: `OAI for ${domainName}`,
        },
        artifactCommands: {
            buildCommand: `node /usr/src/service/infrastructure/pulumi/src/static-website/prepare-build.ts && cd "${websiteRoot}" && pnpm install --frozen-lockfile && pnpm run build`,
            buildDirectory: `${websiteRoot}/dist`,
            resourceNames: {
                build: `${resourceBase}-build`,
                upload: `${resourceBase}-upload`,
                invalidation: `${resourceBase}-invalidation`,
            },
        },
    })

    await createDnsRecords({
        orgName,
        stage,
        hostedZoneId,
        serviceName: 'website',
        resourcePrefix: `website-dns-${orgName}-${stage}`,
        records: [domainName, `www.${domainName}`].flatMap(
            name => [
                {
                    name,
                    type: 'A' as const,
                    alias: {
                        name: website.outputs.distributionDomainName,
                        zoneId: website.outputs.distributionHostedZoneId,
                        evaluateTargetHealth: false,
                    },
                },
                {
                    name,
                    type: 'AAAA' as const,
                    alias: {
                        name: website.outputs.distributionDomainName,
                        zoneId: website.outputs.distributionHostedZoneId,
                        evaluateTargetHealth: false,
                    },
                },
            ],
        ),
    })

    return {
        websiteUrl: website.outputs.websiteUrl,
        distributionId: website.outputs.distributionId,
        certificateArn: certificate.outputs.certificateArn,
    }
}
