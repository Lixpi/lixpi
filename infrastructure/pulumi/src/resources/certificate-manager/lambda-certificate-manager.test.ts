import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pulumi from '@pulumi/pulumi'

vi.mock('../../helpers/docker/build-helpers.ts', () => ({
    buildDockerImage: () => ({
        imageRef: 'test:local',
        imageTag: 'test',
        image: undefined,
        repository: undefined,
    }),
}))
vi.mock('../../constants/logging.ts', () => ({ LOG_RETENTION_DAYS: 7 }))

const resources: pulumi.runtime.MockResourceArgs[] = []
const resolveOutput = <T>(value: pulumi.Input<T>): Promise<T> => new Promise(resolve => void pulumi.output(value).apply(result => void resolve(result)))

beforeAll(async () => {
    process.env.ORG_NAME = 'test'
    process.env.STAGE = 'test'
    process.env.NATS_OPERATIONAL_ALERT_EMAIL = 'alerts@example.test'
    pulumi.runtime.setMocks({
        newResource: args => {
            resources.push(args)

            return {
                id: `${args.name}-id`,
                state: {
                    ...args.inputs,
                    arn: `arn:test:${args.name}`,
                    name: args.inputs.name ?? args.name,
                },
            }
        },
        call: args => args.inputs,
    }, 'certificate-test', 'test', false)
    const { createLambdaCertificateManager } = await import('./lambda-certificate-manager.ts')
    const manager = await createLambdaCertificateManager({
        domains: ['nats.example.com'],
        email: 'ops@example.com',
        hostedZoneId: 'test-zone',
        storageType: 'secrets-manager',
        storageConfig: { secretsManagerPrefix: 'certificates' },
        dockerBuildContext: 'unused',
        dockerfilePath: 'unused',
    })
    await Promise.all([
        resolveOutput(manager.lambdaFunction.environment),
        resolveOutput(manager.initialCertificateGeneration.input),
        resolveOutput(manager.certificateStateBucket.urn),
        resolveOutput(manager.outputs.alertTopicArn),
    ])
})

describe('certificate maintenance infrastructure', () => {
    it('serializes scheduled maintenance and preserves the full Caddy state', () => {
        const lambda = resources.find(resource => resource.type === 'aws:lambda/function:Function')!.inputs
        expect(lambda.reservedConcurrentExecutions).toBe(1)
        expect(lambda.environment.variables.CADDY_STATE_BUCKET).toBeTruthy()
        const schedule = resources.find(resource => resource.type === 'aws:cloudwatch/eventRule:EventRule')!.inputs
        expect(schedule.scheduleExpression).toBe('rate(6 hours)')
        const versioning = resources.find(resource => resource.type === 'aws:s3/bucketVersioning:BucketVersioning')!.inputs
        expect(versioning.versioningConfiguration.status).toBe('Enabled')
        const publicAccess = resources.find(resource => resource.type === 'aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock')!.inputs
        expect(publicAccess).toMatchObject({
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
        })
    })

    it('alerts on failed execution, missing scheduled success and impending expiry', () => {
        const alarms = resources.filter(resource => resource.type === 'aws:cloudwatch/metricAlarm:MetricAlarm').map(resource => resource.inputs)
        expect(alarms.map(alarm => alarm.metricName).sort()).toEqual(['CertificateMaintenanceSuccess', 'CertificateSecondsRemaining', 'Errors'])
        expect(alarms.find(alarm => alarm.metricName === 'CertificateMaintenanceSuccess')!.treatMissingData).toBe('breaching')
        expect(alarms.every(alarm => alarm.alarmActions.length > 0)).toBe(true)
        const subscription = resources.find(resource => resource.type === 'aws:sns/topicSubscription:TopicSubscription')!.inputs
        expect(subscription).toMatchObject({
            protocol: 'email',
            endpoint: 'alerts@example.test',
        })
    })

    it('does not force a fresh ACME issuance on every deployment', () => {
        const invocation = resources.find(resource => resource.type === 'aws:lambda/invocation:Invocation')!.inputs
        expect(JSON.parse(invocation.input).force).toBeUndefined()
        expect(invocation.triggers.deploymentTimestamp).toBeUndefined()
        const secret = resources.find(resource => resource.type === 'aws:secretsmanager/secret:Secret')!.inputs
        expect(secret.recoveryWindowInDays).toBe(30)
    })
})
