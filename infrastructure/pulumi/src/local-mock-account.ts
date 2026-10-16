import {
    CreateTableCommand,
    DescribeTableCommand,
    DynamoDBClient,
    waitUntilTableExists,
} from '@aws-sdk/client-dynamodb'
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    ScanCommand,
    TransactGetCommand,
    TransactWriteCommand,
    type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb'
import {
    getAccountIdentityKey,
    getDynamoDbTableStageName,
    type AccountAdmissionRecord,
} from '@lixpi/constants'

const subject = 'local|test-user-001'
const issuer = 'http://localhost:3000/'
const email = 'test@local.dev'
const fixedOrganizationId = 'local-test-organization-001'
const identityKey = getAccountIdentityKey(issuer, subject)
type Row = Record<string, unknown>
type Configuration = {
    endpoint: string
    organization: string
    stage: string
}

export const localMockConfiguration = (env: NodeJS.ProcessEnv): Configuration | null => {
    if (
        !['true', 'false'].includes(env.MOCK_AUTH0 ?? '')
        || !['true', 'false'].includes(env.VITE_MOCK_AUTH ?? '')
    )
        throw new Error('Set both MOCK_AUTH0 and VITE_MOCK_AUTH explicitly for local fixture setup')

    if (env.MOCK_AUTH0 !== env.VITE_MOCK_AUTH)
        throw new Error('Mock authentication flags disagree; no fixture writes were attempted')

    if (env.MOCK_AUTH0 === 'false')
        return null

    if (
        env.ENVIRONMENT !== 'local'
        || env.MOCK_AUTH0_DOMAIN !== 'localhost:3000'
    )
        throw new Error('The fixed fixture requires the local environment and localhost:3000 mock issuer')

    const endpoint = new URL(env.DYNAMODB_ENDPOINT ?? '')

    if (
        endpoint.protocol !== 'http:'
        || !['lixpi-dynamodb', 'localhost', '127.0.0.1'].includes(endpoint.hostname)
        || endpoint.port !== '8000'
        || endpoint.username
        || endpoint.password
        || endpoint.search
        || endpoint.hash
        || endpoint.pathname !== '/'
    )
        throw new Error('The mock fixture refuses a non-local DynamoDB endpoint')

    if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(env.ORG_NAME ?? '')
        || !/^[A-Za-z0-9_-]{1,64}$/.test(env.STAGE ?? '')
    )
        throw new Error('The mock fixture requires explicit organization and stage names')

    return {
        endpoint: endpoint.origin,
        organization: env.ORG_NAME!,
        stage: env.STAGE!,
    }
}

export class LocalMockAccount {
    private readonly client: DynamoDBClient
    private readonly db: DynamoDBDocumentClient
    private readonly configuration: Configuration

    constructor(configuration: Configuration) {
        this.configuration = configuration
        this.client = new DynamoDBClient({
            endpoint: configuration.endpoint,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        })
        this.db = DynamoDBDocumentClient.from(this.client)
    }

    private table(resource: string): string {
        return getDynamoDbTableStageName(
            resource,
            this.configuration.organization,
            this.configuration.stage,
        )
    }

    private async read(
        resource: string,
        key: Row,
    ): Promise<Row | undefined> {
        return (
            await this.db.send(
                new GetCommand({
                    TableName: this.table(resource),
                    Key: key,
                    ConsistentRead: true,
                }),
            )
        ).Item
    }

    private async ensureAdmissionTable(): Promise<void> {
        try {
            const result = await this.client.send(
                new DescribeTableCommand({ TableName: this.table('ACCOUNT_ADMISSION') }),
            )

            if (
                result.Table?.KeySchema?.length !== 1
                || result.Table.KeySchema[0]?.AttributeName !== 'identityKey'
                || result.Table.KeySchema[0]?.KeyType !== 'HASH'
                || !result.Table.AttributeDefinitions?.some(attribute => attribute.AttributeName === 'identityKey' && attribute.AttributeType === 'S')
            )
                throw new Error('The local admission table has an incompatible key schema; it was not changed')

            return
        } catch (error) {
            if (
                !(error instanceof Error)
                || error.name !== 'ResourceNotFoundException'
            )
                throw error
        }

        try {
            await this.client.send(
                new CreateTableCommand({
                    TableName: this.table('ACCOUNT_ADMISSION'),
                    AttributeDefinitions: [{
                        AttributeName: 'identityKey',
                        AttributeType: 'S',
                    }],
                    KeySchema: [{
                        AttributeName: 'identityKey',
                        KeyType: 'HASH',
                    }],
                    BillingMode: 'PAY_PER_REQUEST',
                }),
            )
        } catch (error) {
            if (
                !(error instanceof Error)
                || error.name !== 'ResourceInUseException'
            )
                throw error
        }

        await waitUntilTableExists(
            {
                client: this.client,
                maxWaitTime: 20,
                minDelay: 1,
                maxDelay: 2,
            },
            { TableName: this.table('ACCOUNT_ADMISSION') },
        )

        // A competing initializer may have created the table first.
        await this.ensureAdmissionTable()
    }

    private async memberships(): Promise<Row[]> {
        const rows: Row[] = []
        let cursor: Row | undefined

        do {
            const result = await this.db.send(
                new QueryCommand({
                    TableName: this.table('ORGANIZATIONS_ACCESS_LIST'),
                    KeyConditionExpression: 'userId = :user',
                    ExpressionAttributeValues: { ':user': subject },
                    ConsistentRead: true,
                    ExclusiveStartKey: cursor,
                }),
            )
            rows.push(...(result.Items ?? []))
            cursor = result.LastEvaluatedKey
        } while (cursor)

        return rows
    }

    private async organizationGrants(): Promise<Row[]> {
        const rows: Row[] = []
        let cursor: Row | undefined

        do {
            const result = await this.db.send(
                new ScanCommand({
                    TableName: this.table('ORGANIZATIONS'),
                    FilterExpression: 'attribute_exists(#access.#user)',
                    ExpressionAttributeNames: {
                        '#access': 'accessList',
                        '#user': subject,
                    },
                    ConsistentRead: true,
                    ExclusiveStartKey: cursor,
                }),
            )
            rows.push(...(result.Items ?? []))
            cursor = result.LastEvaluatedKey
        } while (cursor)

        return rows
    }

    private associations(user: Row | undefined): string[] {
        if (
            !user
            || user.organizations === undefined
        )
            return []

        if (
            !Array.isArray(user.organizations)
            || !user.organizations.every(value => typeof value === 'string' && value.length > 0)
        )
            throw this.repairRequired()

        return user.organizations
    }

    private isOwner(organization: Row | undefined): boolean {
        const access = organization?.accessList

        return !!access && typeof access === 'object' && !Array.isArray(access)
            && (access as Row)[subject] === 'owner'
    }

    private repairRequired(): Error {
        return new Error('The fixed mock account is partial or ambiguous. No existing records were overwritten. Inspect its organization grants, then run fixture:local repair <existing-organization-id> (or repair new if it has no grants).')
    }

    private receipt(
        organizationId: string,
        now: number,
    ): AccountAdmissionRecord {
        return {
            identityKey,
            schemaVersion: 1,
            issuer,
            subject,
            userId: subject,
            personalOrganizationId: organizationId,
            state: 'active',
            epoch: 1,
            emailVerification: {
                issuer,
                subject,
                connectionId: 'localauth0',
                email,
                source: 'local_fixture',
                verifiedAt: now,
                providerEmail: email,
            },
            completedAt: now,
            updatedAt: now,
        }
    }

    private canRepairReceipt(record: Row): boolean {
        const proof = record.emailVerification as Row | undefined
        const allowed = new Set(
            Object.keys(
                this.receipt(fixedOrganizationId, 1),
            ),
        )

        return (
            Object.keys(record).every(key => allowed.has(key))
                && record.identityKey === identityKey && record.issuer === issuer && record.subject === subject
                && record.userId === subject && record.schemaVersion === 1 && record.state === 'active' && record.epoch === 1
                && typeof record.personalOrganizationId === 'string' && typeof record.updatedAt === 'number'
                && proof?.issuer === issuer && proof.subject === subject && proof.email === email
                && proof.source === 'local_fixture' && proof.connectionId === 'localauth0'
        )
    }

    private user(
        now: number,
        organizationId: string,
    ): Row {
        return {
            userId: subject,
            email,
            name: 'Test User',
            givenName: 'Test',
            familyName: 'User',
            avatar: '',
            recentTags: [],
            organizations: [organizationId],
            createdAt: now,
            updatedAt: now,
        }
    }

    private absentPut(
        resource: string,
        item: Row,
        key: string,
    ): NonNullable<TransactWriteCommandInput['TransactItems']>[number] {
        return { Put: {
            TableName: this.table(resource),
            Item: item,
            ConditionExpression: 'attribute_not_exists(#key)',
            ExpressionAttributeNames: { '#key': key },
        } }
    }

    async validate(): Promise<void> {
        const receipt = await this.read('ACCOUNT_ADMISSION', { identityKey })

        if (
            !receipt
            || typeof receipt.personalOrganizationId !== 'string'
        )
            throw this.repairRequired()

        const organizationId = receipt.personalOrganizationId
        const snapshot = await this.db.send(
            new TransactGetCommand({ TransactItems: [
                { Get: {
                    TableName: this.table('ACCOUNT_ADMISSION'),
                    Key: { identityKey },
                } },
                { Get: {
                    TableName: this.table('USERS'),
                    Key: { userId: subject },
                } },
                { Get: {
                    TableName: this.table('ORGANIZATIONS'),
                    Key: { organizationId },
                } },
                { Get: {
                    TableName: this.table('ORGANIZATIONS_ACCESS_LIST'),
                    Key: {
                        userId: subject,
                        organizationId,
                    },
                } },
            ] }),
        )
        const [admission, user, organization, membership] = snapshot.Responses?.map(item => item.Item) ?? []
        const verification = admission?.emailVerification as Row | undefined

        if (
            !admission
            || admission.identityKey !== identityKey
            || admission.issuer !== issuer
            || admission.subject !== subject
            || admission.userId !== subject
            || admission.schemaVersion !== 1
            || admission.state !== 'active'
            || admission.epoch !== 1
            || admission.personalOrganizationId !== organizationId
            || !user
            || user.email !== email
            || !this.associations(user).includes(organizationId)
            || !this.isOwner(organization)
            || membership?.accessLevel !== 'owner'
            || verification?.source !== 'local_fixture'
            || verification.issuer !== issuer
            || verification.subject !== subject
            || verification.email !== email
            || verification.connectionId !== 'localauth0'
        )
            throw this.repairRequired()
    }

    async load(repairOrganizationId?: string): Promise<void> {
        await this.ensureAdmissionTable()
        const admission = await this.read('ACCOUNT_ADMISSION', { identityKey })

        if (admission) {
            try {
                await this.validate()

                return
            } catch (error) {
                if (
                    !repairOrganizationId
                    || !this.canRepairReceipt(admission)
                )
                    throw error
            }
        }

        const user = await this.read('USERS', { userId: subject })
        const associations = this.associations(user)
        const memberships = await this.memberships()
        const grants = await this.organizationGrants()

        if (
            user
            && user.email !== email
        )
            throw this.repairRequired()

        const empty = !user
            && memberships.length === 0
            && grants.length === 0
        const owners = grants.filter(row => this.isOwner(row))
        const coherent = user
            && owners.length === 1
            && associations.includes(
                String(owners[0]!.organizationId),
            )
            && memberships.some(row => row.organizationId === owners[0]!.organizationId && row.accessLevel === 'owner')

        if (
            !empty
            && !coherent
            && !repairOrganizationId
        )
            throw this.repairRequired()

        const createOrganization = empty || repairOrganizationId === 'new'

        if (
            createOrganization
            && (associations.length || memberships.length || grants.length)
        )
            throw this.repairRequired()

        const organizationId = createOrganization ? fixedOrganizationId : (repairOrganizationId ?? String(owners[0]!.organizationId))

        if (!/^[A-Za-z0-9_-]{1,128}$/.test(organizationId))
            throw this.repairRequired()

        const organization = createOrganization ? undefined : await this.read('ORGANIZATIONS', { organizationId })

        if (
            !createOrganization
            && !this.isOwner(organization)
        )
            throw this.repairRequired()

        const membership = memberships.find(row => row.organizationId === organizationId)

        if (
            membership
            && membership.accessLevel !== 'owner'
        )
            throw this.repairRequired()

        const now = Date.now()
        const writes: NonNullable<TransactWriteCommandInput['TransactItems']> = []

        if (admission)
            writes.push({ Put: {
                TableName: this.table('ACCOUNT_ADMISSION'),
                Item: this.receipt(organizationId, now),
                ConditionExpression: '#state = :state AND epoch = :epoch AND schemaVersion = :schema AND issuer = :issuer AND subject = :subject AND userId = :subject AND personalOrganizationId = :previousOrganization AND updatedAt = :previousUpdated AND emailVerification = :proof AND attribute_not_exists(operationId) AND attribute_not_exists(canonicalSubject)',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: {
                    ':state': 'active',
                    ':epoch': 1,
                    ':schema': 1,
                    ':issuer': issuer,
                    ':subject': subject,
                    ':previousOrganization': admission.personalOrganizationId,
                    ':previousUpdated': admission.updatedAt,
                    ':proof': admission.emailVerification,
                },
            } })
        else
            writes.push(
                this.absentPut(
                    'ACCOUNT_ADMISSION',
                    this.receipt(organizationId, now),
                    'identityKey',
                ),
            )

        if (!user)
            writes.push(
                this.absentPut(
                    'USERS',
                    this.user(now, organizationId),
                    'userId',
                ),
            )
        else {
            const names: Record<string, string> = {
                '#organizations': 'organizations',
                '#updated': 'updatedAt',
                '#email': 'email',
            }
            const values: Row = { ':email': email }
            const conditions = ['#email = :email']

            for (const [field, alias] of [
                ['organizations', '#organizations'],
                ['updatedAt', '#updated'],
            ] as const) {
                if (user[field] === undefined)
                    conditions.push(`attribute_not_exists(${alias})`)
                else {
                    values[`:${field}`] = user[field]
                    conditions.push(`${alias} = :${field}`)
                }
            }

            // A coherent account only gets a receipt; its profile and timestamps stay intact.
            if (associations.includes(organizationId))
                writes.push({ ConditionCheck: {
                    TableName: this.table('USERS'),
                    Key: { userId: subject },
                    ConditionExpression: conditions.join(' AND '),
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                } })
            else
                writes.push({ Update: {
                    TableName: this.table('USERS'),
                    Key: { userId: subject },
                    UpdateExpression: 'SET #organizations = :nextOrganizations, #updated = :now',
                    ConditionExpression: conditions.join(' AND '),
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: {
                        ...values,
                        ':nextOrganizations': [...new Set([
                            ...associations,
                            organizationId,
                        ])],
                        ':now': now,
                    },
                } })
        }

        if (createOrganization)
            writes.push(
                this.absentPut(
                    'ORGANIZATIONS',
                    {
                        organizationId,
                        name: "Test User's Organization",
                        tags: {},
                        accessList: { [subject]: 'owner' },
                        createdAt: now,
                        updatedAt: now,
                    },
                    'organizationId',
                ),
            )
        else
            writes.push({ ConditionCheck: {
                TableName: this.table('ORGANIZATIONS'),
                Key: { organizationId },
                ConditionExpression: '#access.#user = :owner',
                ExpressionAttributeNames: {
                    '#access': 'accessList',
                    '#user': subject,
                },
                ExpressionAttributeValues: { ':owner': 'owner' },
            } })

        if (!membership)
            writes.push(
                this.absentPut(
                    'ORGANIZATIONS_ACCESS_LIST',
                    {
                        userId: subject,
                        organizationId,
                        accessLevel: 'owner',
                        createdAt: now,
                        updatedAt: now,
                    },
                    'userId',
                ),
            )
        else
            writes.push({ ConditionCheck: {
                TableName: this.table('ORGANIZATIONS_ACCESS_LIST'),
                Key: {
                    userId: subject,
                    organizationId,
                },
                ConditionExpression: 'accessLevel = :owner',
                ExpressionAttributeValues: { ':owner': 'owner' },
            } })

        try {
            await this.db.send(
                new TransactWriteCommand({ TransactItems: writes }),
            )
        } catch {
            // A concurrent initializer or an ambiguous response may have committed.
            await this.validate()

            return
        }

        await this.validate()
    }

    destroy(): void {
        this.client.destroy()
    }
}
