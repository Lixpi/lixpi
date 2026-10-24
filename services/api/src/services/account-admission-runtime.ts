import { createHash } from 'node:crypto'
import {
    ACCOUNT_ADMISSION_CLAIM,
    ACCOUNT_ADMISSION_CHECK_SUBJECT,
    ACCOUNT_ADMISSION_REPLY_PREFIX,
} from '@lixpi/constants'
import {
    type default as NATS_Service,
} from '@lixpi/nats-service'
import {
    AccountAdmission,
    type AdmissionReader,
} from './account-admission.ts'
import { AccountRequestScopes } from './account-request-scopes.ts'
import { AccountControlFeed } from './account-control-feed.ts'
import { AccountBrokerPolicy } from './account-broker-policy.ts'

type Subscription = { unsubscribe: () => void }
type PolicyMessage = {
    reply: string
    data: Uint8Array
    json: () => unknown
    respond: (data: string) => boolean
}

export class AccountAdmissionRuntime {
    private static serving?: AccountAdmissionRuntime

    static current(): AccountAdmissionRuntime {
        if (
            !this.serving
            || !this.serving.feed.isReady()
        )
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        return this.serving
    }
    readonly admission: AccountAdmission
    readonly scopes: AccountRequestScopes
    readonly feed: AccountControlFeed
    private readonly brokerPolicy: AccountBrokerPolicy
    private subscription?: Subscription
    private inflight = 0
    private readonly applicationRevision: string
    private readonly issuer: string

    constructor(
        private readonly service: NATS_Service,
        reader: AdmissionReader,
        configuration: Record<string, string | undefined>,
    ) {
        const mock = configuration.MOCK_AUTH0 === 'true'
        const issuer = mock ? `http://${configuration.MOCK_AUTH0_DOMAIN}/` : `${configuration.AUTH0_DOMAIN?.replace(/\/+$/, '')}/`
        const organization = configuration.ORG_NAME
        const stage = configuration.STAGE
        const audience = configuration.AUTH0_API_IDENTIFIER
        const stream = configuration.ACCOUNT_ADMISSION_STREAM

        if (
            !organization
            || !stage
            || !audience
            || !stream
            || (mock && configuration.ENVIRONMENT !== 'local')
        )
            throw new Error('Incomplete account admission deployment configuration')

        const envelope = JSON.parse(configuration.NATS_APPLICATION_REGISTRATION ?? '')
        const payload = Buffer.from(envelope.payload, 'base64')
        const manifest = JSON.parse(
            payload.toString('utf8'),
        )
        const browser = manifest.browsers?.find((profile: { issuer: string }) => profile.issuer === issuer)
        this.applicationRevision = createHash('sha256').update(payload).digest('hex')
        this.issuer = issuer

        if (
            browser?.admission?.subject !== ACCOUNT_ADMISSION_CHECK_SUBJECT
            || browser.admission.claim !== ACCOUNT_ADMISSION_CLAIM
            || browser.admission.stream !== stream
            || browser.audience !== audience
        )
            throw new Error('Signed browser registration does not require account admission')

        this.admission = AccountAdmission.forEnvironment(reader, configuration)
        this.scopes = new AccountRequestScopes(this.admission)
        this.feed = new AccountControlFeed(
            service,
            this.scopes,
            stream,
        )
        this.brokerPolicy = new AccountBrokerPolicy(
            this.admission,
            {
                issuer,
                audience,
                applicationRevision: createHash('sha256').update(payload).digest('hex'),
            },
            () => this.feed.isReady(),
        )
    }

    async start(): Promise<void> {
        const connection = this.service.getConnection()

        if (!connection)
            throw new Error('Account admission requires a service connection')

        try {
            await this.feed.start()
            this.subscription = connection.subscribe(
                ACCOUNT_ADMISSION_CHECK_SUBJECT,
                {
                    queue: 'account-admission-api-v1',
                    callback: (error, message) => {
                        if (error) {
                            this.feed.stop()

                            return
                        }

                        void this.reply(message)
                    },
                },
            )
            await connection.flush()
            AccountAdmissionRuntime.serving = this
        } catch {
            this.stop()

            throw new Error('Account admission startup failed')
        }
    }

    stop(): void {
        if (AccountAdmissionRuntime.serving === this)
            AccountAdmissionRuntime.serving = undefined

        this.subscription?.unsubscribe()
        this.feed.stop()
    }

    // Public health exposes policy identity, never credentials or user state.
    status(): {
        ready: boolean
        applicationRevision: string
        issuer: string
        process: string
    } {
        return {
            ready: AccountAdmissionRuntime.serving === this && this.feed.isReady(),
            applicationRevision: this.applicationRevision,
            issuer: this.issuer,
            process: this.feed.consumerName,
        }
    }

    private async reply(message: PolicyMessage): Promise<void> {
        if (
            this.inflight >= 128
            || message.data.byteLength > 8192
            || !message.reply.startsWith(`${ACCOUNT_ADMISSION_REPLY_PREFIX}.AUTH.`)
            || /[\s*>]/.test(message.reply)
        )
            return

        this.inflight++

        try {
            const response = await this.brokerPolicy.check(
                message.json(),
                AbortSignal.timeout(1000),
            )
            message.respond(
                JSON.stringify(response),
            )
        } catch {
            // Malformed private requests receive no reply or account details.
        } finally {
            this.inflight--
        }
    }
}
