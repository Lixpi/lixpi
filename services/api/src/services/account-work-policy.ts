import {
    ACCOUNT_WORK_ADMISSION_SUBJECT,
    type AccountWorkContext,
} from '@lixpi/constants'
import type NatsService from '@lixpi/nats-service'
import {
    type MessageHandler,
} from '@lixpi/nats-service'
import { AccountRequestContext } from './account-request-context.ts'

// Only NKey-authenticated workers may publish here. The API creates the work
// context after JWT verification; workers never receive a browser bearer token.
export class AccountWorkPolicy {
    private subscription?: { unsubscribe: () => void }
    private inflight = 0

    constructor(private readonly service: NatsService) {}

    start(): void {
        const connection = this.service.getConnection()

        if (!connection)
            throw new Error('Account work policy requires a service connection')

        this.subscription = connection.subscribe(
            ACCOUNT_WORK_ADMISSION_SUBJECT,
            {
                queue: 'account-work-policy-v1',
                callback: (error, message) => {
                    if (!error)
                        void this.reply(message)
                },
            },
        )
    }

    stop(): void {
        this.subscription?.unsubscribe()
    }

    private async reply(message: Parameters<MessageHandler>[1]): Promise<void> {
        if (
            !message.reply
            || message.data.byteLength > 4096
            || this.inflight >= 128
        ) {
            message.respond(
                JSON.stringify({ error: 'ACCOUNT_ADMISSION_DENIED' }),
            )

            return
        }

        this.inflight++

        try {
            const request = message.json<{
                version: number
                nonce: string
                accountContext: AccountWorkContext
            }>()

            if (
                request.version !== 1
                || !/^[a-f0-9-]{36}$/i.test(request.nonce)
            )
                throw new Error('ACCOUNT_ADMISSION_DENIED')

            await AccountRequestContext.resumeWork(request.accountContext, async () => {
                AccountRequestContext.assertActive()
                message.respond(
                    JSON.stringify({
                        version: 1,
                        nonce: request.nonce,
                        accountContext: AccountRequestContext.workContext(),
                        expiresAt: Math.min(request.accountContext.tokenExpiresAt, Date.now() + 30_000),
                    }),
                )
            })
        } catch {
            message.respond(
                JSON.stringify({ error: 'ACCOUNT_ADMISSION_DENIED' }),
            )
        } finally {
            this.inflight--
        }
    }
}
