import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import {
    type ProviderUsageClient,
    type MeasuredUsage,
} from '@lixpi/usage-reporter'
import { AccountRequestContext } from './account-request-context.ts'

export type ProviderUsageIdentity = {
    organizationId: string
    userId: string
    workspaceId?: string
}

// Infrastructure scope shared by chat, detached capabilities and auxiliary calls.
// Identity comes from the authorized caller, never from model-generated input.
export class ProviderCallAccounting {
    private static readonly identities = new AsyncLocalStorage<ProviderUsageIdentity>()
    private static client?: ProviderUsageClient
    private usage?: MeasuredUsage
    private providerRequestId: string

    private constructor(
        private readonly workflowId: string,
        private readonly model: string,
        private readonly identity: ProviderUsageIdentity | undefined,
        private readonly authorizationId: string | undefined,
    ) {
        this.providerRequestId = `auxiliary:${workflowId}`
    }

    static configure(client?: ProviderUsageClient): void {
        this.client = client
    }

    static async inScope<T>(
        identity: ProviderUsageIdentity,
        operation: () => Promise<T>,
    ): Promise<T> {
        return await this.identities.run(identity, operation)
    }

    static async run<T>(
        model: string,
        estimatedUnits: number,
        operation: (accounting: ProviderCallAccounting) => Promise<T>,
        identity = this.identities.getStore(),
    ): Promise<T> {
        const client = this.client
        const workflowId = randomUUID()
        let authorizationId: string | undefined
        let accounting: ProviderCallAccounting | undefined
        let terminal = false
        let started = false
        const settle = AccountRequestContext.prepareCleanup(async () => await accounting?.settle(terminal))

        if (client?.enabled) {
            if (
                !identity?.organizationId
                || !identity.userId
            )
                throw new Error('ProviderUsage: auxiliary call has no usage identity')

            const authorization = await client.authorizeRequest({
                orgId: identity.organizationId,
                userId: identity.userId,
                workspaceId: identity.workspaceId,
                workflowId,
                model,
                modality: 'tokens',
                estimatedUnits,
            })

            if (
                !authorization.authorized
                || !authorization.authorizationId
            )
                throw new Error('ProviderUsage: auxiliary call was not authorized')

            authorizationId = authorization.authorizationId
        }

        accounting = new ProviderCallAccounting(
            workflowId,
            model,
            identity,
            authorizationId,
        )

        try {
            AccountRequestContext.assertActive()
            started = true
            const result = await operation(accounting)
            terminal = true

            return result
        } catch (error) {
            const status = (error as { status?: number })?.status

            if (
                !started
                || (status && [400, 401, 403, 404, 413, 422, 429].includes(status))
            ) {
                accounting.observe({
                    promptTokens: 0,
                    completionTokens: 0,
                })
                terminal = true
            }

            throw error
        } finally {
            await settle()
        }
    }

    observe(
        usage: MeasuredUsage,
        providerRequestId?: string,
    ): void {
        this.usage = {
            ...this.usage,
            ...usage,
        }

        if (providerRequestId)
            this.providerRequestId = providerRequestId
    }

    private async settle(terminal: boolean): Promise<void> {
        const client = ProviderCallAccounting.client

        if (
            !client?.enabled
            || !this.identity
            || !this.authorizationId
            || !this.usage
        )
            return

        await client.recordUsage({
            providerRequestId: this.providerRequestId,
            authorizationId: this.authorizationId,
            orgId: this.identity.organizationId,
            userId: this.identity.userId,
            workspaceId: this.identity.workspaceId,
            workflowId: this.workflowId,
            workflowSeq: 1,
            model: this.model,
            modality: 'tokens',
            measuringUnit: 'tokens',
            usage: this.usage,
            occurredAt: new Date().toISOString(),
        })

        if (!terminal)
            return

        await client.completeRequest({
            authorizationId: this.authorizationId,
            orgId: this.identity.organizationId,
            userId: this.identity.userId,
            workflowId: this.workflowId,
            providerRequestIds: [this.providerRequestId],
        })
    }
}
