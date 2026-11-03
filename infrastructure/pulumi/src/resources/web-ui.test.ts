import {
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import * as pulumi from '@pulumi/pulumi'
import { createWebUI } from './web-ui.ts'

const resources: pulumi.runtime.MockResourceArgs[] = []
const resolveOutput = <T>(value: pulumi.Input<T>): Promise<T> => new Promise(resolve => void pulumi.output(value).apply(result => void resolve(result)))

beforeAll(() => {
    pulumi.runtime.setMocks({
        newResource: args => {
            resources.push(args)

            return {
                id: `${args.name}-id`,
                state: {
                    ...args.inputs,
                    arn: `arn:aws:test:us-east-1:123456789012:${args.name}`,
                    bucket: args.inputs.bucket ?? args.name,
                    bucketRegionalDomainName: `${args.name}.s3.us-east-1.amazonaws.com`,
                    cloudfrontAccessIdentityPath: `origin-access-identity/cloudfront/${args.name}`,
                    domainName: 'd123456789.cloudfront.net',
                    fqdn: `${args.name}.example.com`,
                    iamArn: `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${args.name}`,
                    hostedZoneId: 'Z-CLOUDFRONT',
                },
            }
        },
        call: args => args.inputs,
    }, 'lixpi.ai', 'production', false)
})

describe('main web UI resource defaults', () => {
    it('keeps the application hosting names and infrastructure-managed artifacts', async () => {
        const webUI = await createWebUI({
            orgName: 'Lixpi',
            stage: 'production',
            domainName: 'lixpi.com',
            hostedZoneId: 'Z-ROOT',
            hostedZoneName: 'lixpi.com',
            certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
            environment: {
                VITE_API_URL: 'https://api.lixpi.com',
                VITE_AUTH0_LOGIN_URL: 'https://auth.lixpi.com',
                VITE_AUTH0_DOMAIN: 'auth.lixpi.com',
                VITE_AUTH0_CLIENT_ID: 'test-client',
                VITE_AUTH0_AUDIENCE: 'https://api.lixpi.com',
                VITE_AUTH0_REDIRECT_URI: 'https://lixpi.com/callback',
                VITE_USER_PORTAL_URL: 'https://user-portal.lixpi.com',
                VITE_NATS_SERVER: 'wss://nats.lixpi.com',
            },
            dockerBuildContext: '/synthetic/context',
            dockerfilePath: '/synthetic/context/Dockerfile',
        })
        await Promise.all([
            resolveOutput(webUI.outputs.websiteUrl),
            resolveOutput(webUI.outputs.distributionId),
        ])
        await vi.waitFor(() => expect(resources.some(resource => resource.name === 'web-ui-Lixpi-production-invalidation-exec')).toBe(true))

        const byName = (name: string) => resources.find(resource => resource.name === name)
        expect(byName('web-ui-Lixpi-production-bucket')?.inputs).toMatchObject({
            bucket: 'lixpi-web-ui-lixpi.com-cloudfront-distribution',
            acl: 'private',
            website: {
                indexDocument: 'index.html',
                errorDocument: 'index.html',
            },
        })
        expect(byName('web-ui-Lixpi-production-oai')?.inputs.comment).toBe('OAI for lixpi.com website')
        expect(byName('web-ui-Lixpi-production-distribution')?.inputs.aliases).toEqual(['lixpi.com', 'www.lixpi.com'])
        expect(byName('web-ui-Lixpi-production-build-exec')?.type).toBe('command:local:Command')
        expect(byName('web-ui-Lixpi-production-upload-exec')?.type).toBe('command:local:Command')
        expect(byName('web-ui-Lixpi-production-invalidation-exec')?.type).toBe('command:local:Command')
        expect(await resolveOutput(webUI.siteBucket.urn)).toBe('urn:pulumi:production::lixpi.ai::aws:s3/bucket:Bucket::web-ui-Lixpi-production-bucket')
        expect(webUI.outputs.wwwDomainName).toBe('www.lixpi.com')
    })
})
