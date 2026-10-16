import { beforeAll, describe, expect, it } from 'vitest'
import * as pulumi from '@pulumi/pulumi'
import { createDnsRecords, createHostedZone, createDelegationRecord } from './dns-records.ts'
import * as aws from '@pulumi/aws'

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
                    zoneId: 'ZCHILD',
                    nameServers: ['ns1.example.net', 'ns2.example.net'],
                },
            }
        },
        call: args => args.inputs,
    }, 'dns-test', 'local', false)
})

describe('development DNS resources', () => {
    it('accepts the Auth0 CNAME output and refuses to overwrite another owner', async () => {
        const result = await createDnsRecords({
            orgName: 'test',
            stage: 'local',
            hostedZoneId: pulumi.output('ZCHILD'),
            serviceName: 'auth0',
            records: [{
                name: 'auth.developer-local.example.com',
                type: 'CNAME',
                records: pulumi.output(['tenant.edge.tenants.auth0.com']),
                allowOverwrite: false,
            }],
        })
        await resolveOutput(Object.values(result.records)[0].id)
        const record = resources.find(resource => resource.inputs.type === 'CNAME')!

        expect(record.inputs).toMatchObject({
            zoneId: 'ZCHILD',
            type: 'CNAME',
            records: ['tenant.edge.tenants.auth0.com'],
            allowOverwrite: false,
            ttl: 300,
        })
    })

    it('delegates the development zone with the nameservers returned by Route53', async () => {
        const zone = await createHostedZone({
            orgName: 'test',
            stage: 'local',
            domainName: 'developer-local.example.com',
            serviceName: 'auth-dev',
            protect: true,
        })
        const delegation = createDelegationRecord({
            parentHostedZoneId: 'ZPARENT',
            subdomainName: 'developer-local.example.com',
            nameServers: zone.outputs.nameServers,
            serviceName: 'auth-dev',
            dnsProvider: new aws.Provider('parent-zone', {}),
        })
        await resolveOutput(delegation.id)

        expect(resources.find(resource => resource.inputs.type === 'NS')?.inputs).toMatchObject({
            zoneId: 'ZPARENT',
            name: 'developer-local.example.com',
            records: ['ns1.example.net', 'ns2.example.net'],
        })
    })
})
