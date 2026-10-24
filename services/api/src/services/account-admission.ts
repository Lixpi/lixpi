import {
    ACCOUNT_ADMISSION_CLAIM,
    getAccountIdentityKey,
    getDynamoDbTableStageName,
} from '@lixpi/constants'
import {
    type TransactReadItem,
} from '@lixpi/dynamodb-service'

type Row = Record<string, unknown>

export type AdmissionReader = {
    transactRead: (request: {
        items: TransactReadItem[]
        abortSignal?: AbortSignal
    }) => Promise<Array<Row | undefined>>
}

export type AdmissionTables = {
    admission: string
    users: string
    organizations: string
    memberships: string
}

export type AdmittedAccount = Readonly<{
    identityKey: string
    issuer: string
    subject: string
    epoch: number
    personalOrganizationId: string
    tokenExpiresAt: number
}>

const deny = (): never => {
    throw new Error('ACCOUNT_ADMISSION_DENIED')
}

const row = (value: unknown): Row => {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
    )
        return deny()

    return value as Row
}

// A read-only boundary for already verified access tokens. Runtime activation
// must install this together with broker policy, cancellation and external signup.
export class AccountAdmission {
    private readonly tables: AdmissionTables

    static forEnvironment(
        reader: AdmissionReader,
        configuration: Record<string, string | undefined>,
    ): AccountAdmission {
        const mock = configuration.MOCK_AUTH0 === 'true'
        const organization = configuration.ORG_NAME
        const stage = configuration.STAGE

        if (
            !organization
            || !stage
            || (mock && (configuration.ENVIRONMENT !== 'local' || !configuration.MOCK_AUTH0_DOMAIN))
        )
            throw new Error('Incomplete account admission deployment configuration')

        return new AccountAdmission(
            reader,
            {
                admission: getDynamoDbTableStageName(
                    'ACCOUNT_ADMISSION',
                    organization,
                    stage,
                ),
                users: getDynamoDbTableStageName(
                    'USERS',
                    organization,
                    stage,
                ),
                organizations: getDynamoDbTableStageName(
                    'ORGANIZATIONS',
                    organization,
                    stage,
                ),
                memberships: getDynamoDbTableStageName(
                    'ORGANIZATIONS_ACCESS_LIST',
                    organization,
                    stage,
                ),
            },
            {
                mock,
                issuer: mock ? `http://${configuration.MOCK_AUTH0_DOMAIN}/` : `${configuration.AUTH0_DOMAIN?.replace(/\/+$/, '')}/`,
            },
        )
    }

    constructor(
        private readonly reader: AdmissionReader,
        tables: AdmissionTables,
        private readonly policy: Readonly<{
            issuer: string
            mock: boolean
        }>,
    ) {
        const names = Object.values(tables)
        const issuer = new URL(policy.issuer)

        if (
            names.length !== 4
            || new Set(names).size !== 4
            || names.some(name => !/^[a-zA-Z0-9_.-]{3,255}$/.test(name))
            || issuer.href !== policy.issuer
            || issuer.pathname !== '/'
            || issuer.search
            || issuer.hash
            || issuer.username
            || issuer.password
            || (policy.mock ? issuer.protocol !== 'http:' : issuer.protocol !== 'https:')
        )
            throw new Error('Invalid admission configuration')

        this.tables = { ...tables }
        this.policy = Object.freeze({ ...policy })
    }

    async admitVerifiedToken(
        decoded: Row,
        signal?: AbortSignal,
    ): Promise<AdmittedAccount> {
        try {
            const abortSignal = AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])])
            abortSignal.throwIfAborted()
            const claim = row(decoded[ACCOUNT_ADMISSION_CLAIM])

            if (
                decoded.iss !== this.policy.issuer
                || typeof decoded.sub !== 'string'
                || claim.v !== 1
                || !Number.isSafeInteger(claim.epoch)
                || Number(claim.epoch) < 1
                || typeof decoded.exp !== 'number'
                || !Number.isSafeInteger(decoded.exp)
                || decoded.exp * 1000 <= Date.now()
                || !Number.isSafeInteger(decoded.exp * 1000)
                || (this.policy.mock && decoded.sub !== 'local|test-user-001')
            )
                return deny()

            const issuer = this.policy.issuer
            const subject = decoded.sub
            const identityKey = getAccountIdentityKey(issuer, subject)
            const admissionRead = {
                tableName: this.tables.admission,
                key: { identityKey },
            }
            const pointer = await this.reader.transactRead({
                items: [admissionRead],
                abortSignal,
            })
            abortSignal.throwIfAborted()
            const initial = row(pointer[0])

            if (
                initial.identityKey !== identityKey
                || initial.issuer !== issuer
                || initial.subject !== subject
                || typeof initial.personalOrganizationId !== 'string'
                || !initial.personalOrganizationId
            )
                return deny()

            const personalOrganizationId = initial.personalOrganizationId
            const records = await this.reader.transactRead({
                items: [
                    admissionRead,
                    {
                        tableName: this.tables.users,
                        key: { userId: subject },
                    },
                    {
                        tableName: this.tables.organizations,
                        key: { organizationId: personalOrganizationId },
                    },
                    {
                        tableName: this.tables.memberships,
                        key: {
                            userId: subject,
                            organizationId: personalOrganizationId,
                        },
                    },
                ],
                abortSignal,
            })

            if (records.length !== 4)
                return deny()

            const [admission, user, organization, membership] = records.map(row)

            if (
                admission.identityKey !== identityKey
                || admission.issuer !== issuer
                || admission.subject !== subject
                || admission.blockRequested === true
                || (admission.emailPending !== undefined && (!Array.isArray(admission.emailPending) || admission.emailPending.length !== 0))
                || admission.userId !== subject
                || admission.schemaVersion !== 1
                || admission.state !== 'active'
                || admission.epoch !== claim.epoch
                || admission.personalOrganizationId !== personalOrganizationId
                || (admission.operationId !== undefined && admission.operationId !== '')
                || (admission.canonicalSubject !== undefined && admission.canonicalSubject !== '')
                || !Number.isSafeInteger(admission.completedAt)
                || Number(admission.completedAt) <= 0
                || !Number.isSafeInteger(admission.updatedAt)
                || Number(admission.updatedAt) < Number(admission.completedAt)
            )
                return deny()

            const proof = row(admission.emailVerification)

            if (
                proof.issuer !== issuer
                || proof.subject !== subject
                || typeof proof.connectionId !== 'string'
                || !proof.connectionId
                || typeof proof.email !== 'string'
                || proof.email.length > 320
                || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(proof.email)
                || !Number.isSafeInteger(proof.verifiedAt)
                || Number(proof.verifiedAt) <= 0
                || Number(proof.verifiedAt) > Date.now() + 60_000
                || user.userId !== subject
                || user.email !== proof.email
                || !Array.isArray(user.organizations)
                || !user.organizations.includes(personalOrganizationId)
                || organization.organizationId !== personalOrganizationId
                || row(organization.accessList)[subject] !== 'owner'
                || membership.userId !== subject
                || membership.organizationId !== personalOrganizationId
                || membership.accessLevel !== 'owner'
            )
                return deny()

            if (this.policy.mock) {
                if (
                    proof.source !== 'local_fixture'
                    || proof.connectionId !== 'localauth0'
                    || claim.epoch !== 1
                )
                    return deny()
            } else if (!['database_otp', 'passwordless_otp', 'enterprise_otp', 'provider', 'form_otp'].includes(
                String(proof.source),
            ))
                return deny()

            if (
                proof.source !== 'form_otp'
                && proof.providerEmail !== proof.email
            )
                return deny()

            if (
                proof.source === 'form_otp'
                && ((proof.providerEmail !== null && (typeof proof.providerEmail !== 'string' || proof.providerEmail.length > 512)) ||
                    typeof proof.providerSubject !== 'string' ||
                    !proof.providerSubject ||
                    proof.providerSubject.length > 512 ||
                    typeof proof.challengeId !== 'string' ||
                    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proof.challengeId))
            )
                return deny()

            abortSignal.throwIfAborted()

            if (decoded.exp * 1000 <= Date.now())
                return deny()

            return Object.freeze({
                identityKey,
                issuer,
                subject,
                epoch: Number(claim.epoch),
                personalOrganizationId,
                tokenExpiresAt: decoded.exp * 1000,
            })
        } catch {
            return deny()
        }
    }
}
