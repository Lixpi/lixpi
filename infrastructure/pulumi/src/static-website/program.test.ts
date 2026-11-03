import {
    beforeAll,
    vi,
    describe,
    expect,
    it,
} from 'vitest'
import * as pulumi from '@pulumi/pulumi'
import { createStaticWebsiteInfrastructure } from './program.ts'

const resources: pulumi.runtime.MockResourceArgs[] = []
const resolveOutput = <T>(value: pulumi.Input<T>): Promise<T> => new Promise(resolve => void pulumi.output(value).apply(result => void resolve(result)))

beforeAll(async () => {
    process.env.ORG_NAME = 'Lixpi'
    process.env.STAGE = 'production'
    process.env.DOMAIN_NAME = 'lixpi.com'
    process.env.AWS_ROUTE53_HOSTED_ZONE_ID = 'Z-EXAMPLE'
    process.env.AWS_EXPECTED_ACCOUNT_ID = '529088280712'
    pulumi.runtime.setMocks({
        newResource: args => {
            resources.push(args)

            return {
                id: `${args.name}-id`,
                state: {
                    ...args.inputs,
                    arn: `arn:aws:test:us-east-1:529088280712:${args.name}`,
                    bucket: args.inputs.bucket ?? args.name,
                    bucketRegionalDomainName: `${args.name}.s3.us-east-1.amazonaws.com`,
                    cloudfrontAccessIdentityPath: `origin-access-identity/cloudfront/${args.name}`,
                    domainName: 'd123456789.cloudfront.net',
                    domainValidationOptions: [{
                        resourceRecordName: '_apex-validation.lixpi.com',
                        resourceRecordType: 'CNAME',
                        resourceRecordValue: 'apex-validation.example.net',
                    }, {
                        resourceRecordName: '_apex-validation.lixpi.com',
                        resourceRecordType: 'CNAME',
                        resourceRecordValue: 'apex-validation.example.net',
                    }, {
                        resourceRecordName: '_www-validation.lixpi.com',
                        resourceRecordType: 'CNAME',
                        resourceRecordValue: 'www-validation.example.net',
                    }],
                    fqdn: `${args.name}.lixpi.com`,
                    iamArn: `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${args.name}`,
                    name: args.inputs.name ?? args.name,
                    hostedZoneId: 'Z-CLOUDFRONT',
                    certificateArn: `arn:aws:acm:us-east-1:529088280712:certificate/${args.name}`,
                },
            }
        },
        call: args => args.inputs,
    }, 'lixpi-website', 'production', false)
})

describe('static website resource identities', () => {
    it('keeps existing certificate, hosting, artifact and DNS resource names', async () => {
        const result = await createStaticWebsiteInfrastructure()
        await Promise.all([
            resolveOutput(result.websiteUrl),
            resolveOutput(result.distributionId),
            resolveOutput(result.certificateArn),
        ])
        await vi.waitFor(() => expect(resources.some(resource => resource.name === 'website-lixpi-production-invalidation')).toBe(true))
        await vi.waitFor(() => expect(resources.filter(resource => resource.name.startsWith('website-dns-Lixpi-production-record-')).length).toBe(4))

        const byName = (name: string) => resources.find(resource => resource.name === name)
        expect(byName('us-east-1-provider')?.type).toBe('pulumi:providers:aws')
        expect(byName('us-east-1-provider')?.inputs).toMatchObject({
            region: 'us-east-1',
            allowedAccountIds: '["529088280712"]',
        })
        expect(byName('website-cert-lixpi-production')?.type).toBe('aws:acm/certificate:Certificate')
        expect(byName('website-cert-lixpi-production')?.inputs).toMatchObject({
            domainName: 'lixpi.com',
            subjectAlternativeNames: ['lixpi.com', 'www.lixpi.com', '*.lixpi.com'],
            tags: { Name: 'Lixpi-website-cert-production' },
        })
        expect(byName('website-cert-lixpi-production-validation-0')?.type).toBe('aws:route53/record:Record')
        expect(byName('website-cert-lixpi-production-validation-1')?.type).toBe('aws:route53/record:Record')
        expect(byName('website-cert-lixpi-production-validation-2')).toBeUndefined()
        expect(byName('website-cert-lixpi-production-validation')?.type).toBe('aws:acm/certificateValidation:CertificateValidation')

        expect(byName('website-lixpi-production-bucket')?.inputs).toMatchObject({
            bucket: 'lixpi-website-lixpi.com-distribution',
            acl: 'private',
            website: {
                indexDocument: 'index.html',
                errorDocument: 'index.html',
            },
        })
        expect(byName('website-lixpi-production-oai')?.inputs).toMatchObject({
            comment: 'OAI for lixpi.com',
        })
        expect(byName('website-lixpi-production-distribution')?.inputs).toMatchObject({
            aliases: ['lixpi.com', 'www.lixpi.com'],
            enabled: true,
            isIpv6Enabled: true,
        })
        expect(byName('website-lixpi-production-build')?.type).toBe('command:local:Command')
        expect(byName('website-lixpi-production-upload')?.type).toBe('command:local:Command')
        expect(byName('website-lixpi-production-invalidation')?.type).toBe('command:local:Command')

        const dnsRecords = resources.filter(resource => resource.name.startsWith('website-dns-Lixpi-production-record-'))
        expect(dnsRecords.map(resource => resource.name)).toEqual([
            'website-dns-Lixpi-production-record-0',
            'website-dns-Lixpi-production-record-1',
            'website-dns-Lixpi-production-record-2',
            'website-dns-Lixpi-production-record-3',
        ])
        expect(dnsRecords.map(resource => [resource.inputs.name, resource.inputs.type])).toEqual([
            ['lixpi.com', 'A'],
            ['lixpi.com', 'AAAA'],
            ['www.lixpi.com', 'A'],
            ['www.lixpi.com', 'AAAA'],
        ])
    })
})
