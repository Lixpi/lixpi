import {
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'
import * as pulumi from '@pulumi/pulumi'
import { createStaticWebClient } from '../resources/web-ui.ts'

const resolveOutput = <T>(value: pulumi.Input<T>): Promise<T> => new Promise(resolve => void pulumi.output(value).apply(result => void resolve(result)))

beforeAll(() => {
    pulumi.runtime.setMocks({
        newResource: args => ({
            id: `${args.name}-id`,
            state: {
                ...args.inputs,
                bucket: args.inputs.bucket ?? args.name,
                bucketRegionalDomainName: `${args.name}.s3.us-east-1.amazonaws.com`,
                cloudfrontAccessIdentityPath: `origin-access-identity/cloudfront/${args.name}`,
                domainName: 'd123456789.cloudfront.net',
                hostedZoneId: 'Z-CLOUDFRONT',
            },
        }),
        call: args => args.inputs,
    }, 'lixpi-website', 'production', false)
})

describe('static website Pulumi URNs', () => {
    it('keeps the existing bucket and CloudFront distribution URNs', async () => {
        const website = await createStaticWebClient({
            orgName: 'Lixpi',
            stage: 'production',
            domainName: 'lixpi.com',
            hostedZoneId: 'Z-EXAMPLE',
            hostedZoneName: 'lixpi.com',
            certificateArn: 'arn:aws:acm:us-east-1:529088280712:certificate/example',
            serviceName: 'website',
            aliases: ['lixpi.com', 'www.lixpi.com'],
            bucketNameSegment: 'website',
            hosting: {
                resourceNamePrefix: 'website-lixpi-production',
                bucketName: 'lixpi-website-lixpi.com-distribution',
                originAccessIdentityComment: 'OAI for lixpi.com',
            },
            artifactCommands: {
                buildCommand: 'true',
                buildDirectory: '/tmp/website-dist',
                resourceNames: {
                    build: 'website-lixpi-production-build',
                    upload: 'website-lixpi-production-upload',
                    invalidation: 'website-lixpi-production-invalidation',
                },
            },
        })

        expect(await resolveOutput(website.siteBucket.urn)).toBe('urn:pulumi:production::lixpi-website::aws:s3/bucket:Bucket::website-lixpi-production-bucket')
        expect(await resolveOutput(website.distribution.urn)).toBe('urn:pulumi:production::lixpi-website::aws:cloudfront/distribution:Distribution::website-lixpi-production-distribution')
    })
})
