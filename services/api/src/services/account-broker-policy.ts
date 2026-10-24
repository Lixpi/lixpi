import {
    ACCOUNT_ADMISSION_CLAIM,
    type AccountPolicyDecision,
    type AccountPolicyRequest,
} from '@lixpi/constants'
import {
    type AccountAdmission,
} from './account-admission.ts'

// Only the broker's private policy connection can submit this request. The
// browser access token was verified by the broker before its claims reach here.
export class AccountBrokerPolicy {
    constructor(
        private readonly admission: Pick<AccountAdmission, 'admitVerifiedToken'>,
        private readonly configuration: {
            issuer: string
            audience: string
            applicationRevision: string
        },
        private readonly ready: () => boolean,
    ) {}

    async check(
        input: unknown,
        signal?: AbortSignal,
    ): Promise<AccountPolicyDecision> {
        if (
            !input
            || typeof input !== 'object'
            || Array.isArray(input)
        )
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        const request = input as AccountPolicyRequest

        if (
            request.version !== 1
            || typeof request.nonce !== 'string'
            || !/^[a-f0-9]{64}$/.test(request.nonce)
            || typeof request.revision !== 'string'
            || !/^[a-f0-9]{64}$/.test(request.revision)
            || typeof request.applicationRevision !== 'string'
            || !/^[a-f0-9]{64}$/.test(request.applicationRevision)
            || typeof request.userNKey !== 'string'
            || !/^U[A-Z2-7]{55}$/.test(request.userNKey)
            || typeof request.subject !== 'string'
            || !request.subject
            || request.subject.length > 512
        )
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        const response: AccountPolicyDecision = {
            version: 1,
            nonce: request.nonce,
            revision: request.revision,
            applicationRevision: request.applicationRevision,
            userNKey: request.userNKey,
            subject: request.subject,
            allowed: false,
            epoch: 0,
            expiresAt: 0,
        }

        if (
            !this.ready()
            || request.issuer !== this.configuration.issuer
            || request.audience !== this.configuration.audience
            || request.applicationRevision !== this.configuration.applicationRevision
            || !Number.isSafeInteger(request.tokenExpiresAt)
            || !Number.isSafeInteger(request.tokenExpiresAt * 1000)
            || !Number.isSafeInteger(request.grantExpiresAt)
            || request.grantExpiresAt <= Math.floor(Date.now() / 1000)
            || request.grantExpiresAt > request.tokenExpiresAt
            || request.grantExpiresAt > Math.floor(Date.now() / 1000) + 60
        )
            return response

        try {
            const account = await this.admission.admitVerifiedToken(
                {
                    iss: request.issuer,
                    sub: request.subject,
                    exp: request.tokenExpiresAt,
                    [ACCOUNT_ADMISSION_CLAIM]: request.claim,
                },
                signal,
            )

            if (
                !this.ready()
                || signal?.aborted
                || account.epoch !== request.claim?.epoch
                || account.subject !== request.subject
                || account.issuer !== request.issuer
                || request.grantExpiresAt <= Math.floor(Date.now() / 1000)
            )
                return response

            return {
                ...response,
                allowed: true,
                epoch: account.epoch,
                expiresAt: request.grantExpiresAt,
            }
        } catch {
            return response
        }
    }
}
