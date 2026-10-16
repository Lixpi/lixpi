import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import { getAccountIdentityKey } from '@lixpi/constants'
import {
    type AccountRequestScope,
} from './account-request-scopes.ts'

type Writer<Result> = {
    transactWrite: (request: {
        operations: TransactOperation[]
        abortSignal: AbortSignal
        origin: string
        logConditionalCheckFailures: boolean
    }) => Promise<Result>
}

// User-authorized mutations include the admission fence in the same transaction.
// Aborting the transport alone cannot close the database commit race.
export class AccountCommitter<Result = unknown> {
    constructor(
        private readonly writer: Writer<Result>,
        private readonly admissionTable: string,
    ) {
        if (!/^[a-zA-Z0-9_.-]{3,255}$/.test(admissionTable))
            throw new Error('Invalid admission commit configuration')
    }

    async commit(
        scope: AccountRequestScope,
        operations: TransactOperation[],
        origin: string,
        targetSubjects: readonly string[] = [],
    ): Promise<Result> {
        scope.assertActive()

        if (
            !operations.length
            || operations.length > 99
            || operations.some(operation => operation.tableName === this.admissionTable)
        )
            throw new Error('Invalid account-scoped transaction')

        const account = scope.account
        const targets = [...new Set(targetSubjects)].filter(subject => subject !== account.subject)

        if (
            targets.some(subject => typeof subject !== 'string' || !subject || subject.length > 512)
            || operations.length + targets.length > 99
        )
            throw new Error('Invalid account target transaction')

        const fence: TransactOperation = {
            type: 'check',
            tableName: this.admissionTable,
            key: { identityKey: account.identityKey },
            conditionExpression: '#schema = :schema AND #state = :active AND #epoch = :epoch AND #issuer = :issuer AND #subject = :subject AND #user = :subject AND #organization = :organization AND (attribute_not_exists(#operation) OR #operation = :empty) AND (attribute_not_exists(#canonical) OR #canonical = :empty) AND (attribute_not_exists(#blocked) OR #blocked = :false)',
            expressionAttributeNames: {
                '#schema': 'schemaVersion',
                '#state': 'state',
                '#epoch': 'epoch',
                '#issuer': 'issuer',
                '#subject': 'subject',
                '#user': 'userId',
                '#organization': 'personalOrganizationId',
                '#operation': 'operationId',
                '#canonical': 'canonicalSubject',
                '#blocked': 'blockRequested',
            },
            expressionAttributeValues: {
                ':schema': 1,
                ':active': 'active',
                ':epoch': account.epoch,
                ':issuer': account.issuer,
                ':subject': account.subject,
                ':organization': account.personalOrganizationId,
                ':empty': '',
                ':false': false,
            },
        }

        return await scope.waitFor(
            () => this.writer.transactWrite({
                operations: [fence, ...targets.map(
                    subject => ({
                        type: 'check' as const,
                        tableName: this.admissionTable,
                        key: { identityKey: getAccountIdentityKey(account.issuer, subject) },
                        conditionExpression: '#schema = :schema AND #state = :active AND #issuer = :issuer AND #subject = :subject AND #user = :subject AND #completed > :zero AND (attribute_not_exists(#operation) OR #operation = :empty) AND (attribute_not_exists(#canonical) OR #canonical = :empty) AND (attribute_not_exists(#blocked) OR #blocked = :false)',
                        expressionAttributeNames: {
                            '#schema': 'schemaVersion',
                            '#state': 'state',
                            '#issuer': 'issuer',
                            '#subject': 'subject',
                            '#user': 'userId',
                            '#completed': 'completedAt',
                            '#operation': 'operationId',
                            '#canonical': 'canonicalSubject',
                            '#blocked': 'blockRequested',
                        },
                        expressionAttributeValues: {
                            ':schema': 1,
                            ':active': 'active',
                            ':issuer': account.issuer,
                            ':subject': subject,
                            ':zero': 0,
                            ':empty': '',
                            ':false': false,
                        },
                    }),
                ), ...operations],
                abortSignal: scope.signal,
                origin,
                logConditionalCheckFailures: false,
            }),
        )
    }
}
