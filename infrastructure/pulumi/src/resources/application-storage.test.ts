import {
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import * as pulumi from '@pulumi/pulumi'

vi.mock('../helpers/docker/build-helpers.ts', () => ({
    buildDockerImage: () => ({
        imageRef: 'test:local',
        image: new pulumi.ComponentResource('test:build:Image', 'application-image'),
        repository: undefined,
    }),
}))
vi.mock('../constants/logging.ts', () => ({
    LOG_RETENTION_DAYS: 7,
    CONTAINER_INSIGHTS_ENABLED: false,
}))

const resources: pulumi.runtime.MockResourceArgs[] = []
const resolveOutput = <T>(value: pulumi.Input<T>): Promise<T> => new Promise(resolve => void pulumi.output(value).apply(result => void resolve(result)))
let tableArns: string[]

beforeAll(async () => {
    process.env.ORG_NAME = 'test'
    process.env.STAGE = 'storage'
    process.env.ENVIRONMENT = 'production'
    process.env.AWS_REGION = 'us-east-1'
    pulumi.runtime.setMocks({
        newResource: args => {
            resources.push(args)

            return {
                id: `${args.name}-id`,
                state: {
                    ...args.inputs,
                    arn: `arn:aws:test:us-east-1:123456789012:${args.name}`,
                    name: args.inputs.name ?? args.name,
                },
            }
        },
        call: args => args.inputs,
    }, 'test', 'storage', false)
    const aws = await import('@pulumi/aws')
    const { createDynamoDbTables } = await import('./db/DynamoDB-tables.ts')
    const { createEcsCluster } = await import('./ECS-cluster.ts')
    const { createMainApiService } = await import('./main-api-service.ts')
    const vpc = new aws.ec2.Vpc('application-vpc', { cidrBlock: '10.0.0.0/16' })
    const privateSubnets = ['a', 'b'].map((zone, index) => new aws.ec2.Subnet(`private-${zone}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${index}.0/24`,
    }))
    const cluster = await createEcsCluster({
        vpc,
        publicSubnets: [],
        privateSubnets,
        clusterName: 'Application',
    })
    const {
        outputs,
        ...tables
    } = await createDynamoDbTables()
    expect(outputs).not.toHaveProperty('applicationEventJournalTableName')
    const api = await createMainApiService({
        ecsCluster: {
            id: cluster.outputs.clusterId,
            arn: cluster.outputs.clusterArn,
            name: cluster.outputs.clusterName,
        },
        vpc,
        publicSubnets: [],
        privateSubnets,
        resourceBindings: { tables },
        environment: {
            NATS_SERVERS: 'nats://broker:4222',
            NATS_API_NKEY_SEED: 'synthetic-api-seed',
        } as any,
        dockerBuildContext: 'unused',
        dockerfilePath: 'unused',
    })
    tableArns = await Promise.all(Object.values(tables).map(table => resolveOutput(table.arn)))
    await Promise.all([resolveOutput(api.ecsService.urn), resolveOutput(api.taskDefinition.containerDefinitions)])
    await vi.waitFor(() => expect(resources.some(resource => resource.name.endsWith('-dynamo-policy'))).toBe(true))
})

describe('API deployment with native NATS storage', () => {
    it('creates domain tables without an application journal or content bucket', () => {
        expect(resources.some(resource => resource.type.startsWith('aws:s3/'))).toBe(false)
        const tables = resources.filter(resource => resource.type === 'aws:dynamodb/table:Table')
        expect(tables.length).toBeGreaterThan(0)
        expect(tables.some(resource => resource.inputs.name.includes('Application-Event-Journal'))).toBe(false)

        for (const table of tables)
            expect(table.inputs.pointInTimeRecovery).toEqual({
                enabled: true,
                recoveryPeriodInDays: 35,
            })
    })

    it('configures the API with NATS credentials and no archive or migration environment', () => {
        const task = resources.find(resource => resource.type === 'aws:ecs/taskDefinition:TaskDefinition')!
        const container = JSON.parse(task.inputs.containerDefinitions)[0]
        const environment = Object.fromEntries(container.environment.map((entry: {
            name: string
            value: string
        }) => [entry.name, entry.value]))
        expect(environment).toEqual({
            NATS_SERVERS: 'nats://broker:4222',
            NATS_API_NKEY_SEED: 'synthetic-api-seed',
        })
        expect(task.inputs).toMatchObject({
            requiresCompatibilities: ['FARGATE'],
            networkMode: 'awsvpc',
        })
        const service = resources.find(resource => resource.type === 'aws:ecs/service:Service')!.inputs
        expect(service).toMatchObject({
            launchType: 'FARGATE',
            networkConfiguration: { assignPublicIp: false },
        })
        expect(service.networkConfiguration.subnets).toEqual(['private-a-id', 'private-b-id'])
    })

    it('grants domain-table access without S3 content or ECS migration permissions', () => {
        const policies = resources.filter(resource => resource.type === 'aws:iam/rolePolicy:RolePolicy').map(resource => JSON.parse(resource.inputs.policy))
        const statements = policies.flatMap(policy => policy.Statement)
        const tableStatements = statements.filter(statement => statement.Action.some?.((action: string) => action.startsWith('dynamodb:')))
        expect(tableStatements).toHaveLength(1)
        expect(tableStatements[0].Resource.toSorted()).toEqual(tableArns.flatMap(arn => [arn, `${arn}/index/*`]).toSorted())
        expect(tableStatements[0].Action).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem']))
        const actions: string[] = statements.flatMap(statement => statement.Action)
        expect(actions.filter(action => action.startsWith('s3:') || action.startsWith('ecs:'))).toEqual([])
    })
})
