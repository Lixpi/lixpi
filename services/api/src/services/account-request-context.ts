import { AsyncLocalStorage } from 'node:async_hooks'
import {
    ACCOUNT_ADMISSION_CLAIM,
    getAccountIdentityKey,
    type AccountWorkContext,
} from '@lixpi/constants'
import {
    type Request,
    type Response,
    type NextFunction,
} from 'express'
import { AccountAdmissionRuntime } from './account-admission-runtime.ts'
import {
    type AccountRequestScope,
} from './account-request-scopes.ts'

type VerifiedRequest = {
    decoded: Record<string, unknown>
    scope: AccountRequestScope
}

// Only authentication middleware may associate verified claims with a payload.
// A JSON property cannot forge the WeakMap entry or the async execution context.
export class AccountRequestContext {
    private static readonly verified = new WeakMap<object, Record<string, unknown>>()
    private static readonly execution = new AsyncLocalStorage<VerifiedRequest>()

    static remember(
        payload: object,
        decoded: Record<string, unknown>,
    ): void {
        if (process.env.ACCOUNT_ADMISSION_ENABLED === 'true')
            this.verified.set(
                payload,
                structuredClone(decoded),
            )
    }

    static current(): AccountRequestScope | undefined {
        return this.execution.getStore()?.scope
    }

    static assertActive(): void {
        this.current()?.assertActive()
    }

    static workContext(): AccountWorkContext | undefined {
        if (process.env.ACCOUNT_ADMISSION_ENABLED !== 'true')
            return undefined

        const scope = this.current()

        if (!scope)
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        scope.assertActive()

        return { ...scope.account }
    }

    // This entry point accepts only API-created queue metadata on private
    // service subjects. Browser handlers must use verified JWT middleware.
    static async resumeWork<T>(
        account: AccountWorkContext,
        operation: () => Promise<T>,
    ): Promise<T> {
        if (process.env.ACCOUNT_ADMISSION_ENABLED !== 'true')
            return await operation()

        if (
            !account
            || account.identityKey !== getAccountIdentityKey(account.issuer, account.subject)
            || !Number.isSafeInteger(account.tokenExpiresAt)
        )
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        return await this.runVerified(
            {
                iss: account.issuer,
                sub: account.subject,
                exp: account.tokenExpiresAt / 1000,
                [ACCOUNT_ADMISSION_CLAIM]: {
                    v: 1,
                    epoch: account.epoch,
                },
            },
            async scope => {
                if (
                    scope.account.personalOrganizationId !== account.personalOrganizationId
                    || scope.account.identityKey !== account.identityKey
                    || scope.account.issuer !== account.issuer
                    || scope.account.subject !== account.subject
                    || scope.account.epoch !== account.epoch
                    || scope.account.tokenExpiresAt !== account.tokenExpiresAt
                )
                    throw new Error('ACCOUNT_ADMISSION_DENIED')

                return await operation()
            },
        )
    }

    static async runPayload(
        payload: unknown,
        operation: (assertActive: () => void) => Promise<void>,
    ): Promise<void> {
        if (process.env.ACCOUNT_ADMISSION_ENABLED !== 'true')
            return await operation(() => {})

        if (
            !payload
            || typeof payload !== 'object'
        )
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        const decoded = this.verified.get(payload)
        this.verified.delete(payload)

        if (!decoded)
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        await this.runVerified(decoded, async scope => await operation(() => scope.assertActive()))
    }

    private static async runVerified<T>(
        decoded: Record<string, unknown>,
        operation: (scope: AccountRequestScope) => Promise<T>,
    ): Promise<T> {
        return await AccountAdmissionRuntime.current().scopes.run(
            decoded,
            async scope =>
                await this.execution.run(
                    {
                        decoded,
                        scope,
                    },
                    async () => await operation(scope),
                ),
        )
    }

    // Detached jobs receive their own indexed scope before the request finishes.
    // They recheck the same verified identity and cannot extend its token expiry.
    static async detach<T>(operation: () => Promise<T>): Promise<T> {
        const request = this.execution.getStore()

        if (process.env.ACCOUNT_ADMISSION_ENABLED !== 'true')
            return await operation()

        if (!request)
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        request.scope.assertActive()

        return await this.runVerified(request.decoded, async () => await operation())
    }

    static startDetached(
        operation: () => Promise<void>,
        onError: (error: unknown) => void | Promise<void>,
    ): void {
        void (async () => {
            try {
                await this.detach(operation)
            } catch (error) {
                await onError(error)
            }
        })()
    }

    // Call sites bind only terminal cleanup of resources already authorized by
    // this request. The returned closure accepts no replacement identity/input.
    static prepareCleanup<T>(operation: () => Promise<T>): () => Promise<T> {
        this.assertActive()

        return async () => await this.execution.exit(operation)
    }

    static async runHttp(
        decoded: Record<string, unknown>,
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        if (process.env.ACCOUNT_ADMISSION_ENABLED !== 'true') {
            next()

            return
        }

        try {
            await this.runVerified(decoded, async scope => {
                const finished = Promise.withResolvers<void>()
                const complete = (): void => void finished.resolve()
                const abort = (): void => void scope.cancel()
                const deny = (): void => void res.destroy()
                const originalWrite = res.write.bind(res)
                const originalEnd = res.end.bind(res)

                // A dependency that ignores abort still cannot write a late HTTP response.
                res.write = ((...args: Parameters<Response['write']>) => {
                    scope.assertActive()

                    return originalWrite(...args)
                }) as Response['write']
                res.end = ((...args: Parameters<Response['end']>) => {
                    scope.assertActive()

                    return originalEnd(...args)
                }) as Response['end']
                res.once('finish', complete)
                res.once('close', complete)
                req.once('aborted', abort)
                scope.signal.addEventListener(
                    'abort',
                    deny,
                    { once: true },
                )

                try {
                    scope.assertActive()
                    next()
                    await scope.waitFor(() => finished.promise)
                } finally {
                    req.off('aborted', abort)
                    res.off('finish', complete)
                    res.off('close', complete)
                    scope.signal.removeEventListener('abort', deny)
                }
            })
        } catch {
            res.destroy()
        }
    }
}
