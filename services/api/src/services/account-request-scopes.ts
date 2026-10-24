import {
    type AccountAdmission,
    type AdmittedAccount,
} from './account-admission.ts'

export type AccountInvalidation = {
    identityKey: string
    epoch: number
    state: 'active' | 'blocked' | 'reconciling' | 'superseded'
}

const denied = (): Error => new Error('ACCOUNT_ADMISSION_DENIED')

// The same signal must reach provider calls, worker requests and child work.
// assertActive also rejects late results from dependencies that ignore abort.
export class AccountRequestScope {
    readonly signal: AbortSignal
    private readonly controller = new AbortController()
    private readonly expiry: ReturnType<typeof setTimeout>

    constructor(
        readonly account: AdmittedAccount,
        private readonly current: () => boolean,
        parent?: AbortSignal,
    ) {
        this.signal = AbortSignal.any([this.controller.signal, ...(parent ? [parent] : [])])
        this.account = Object.freeze({ ...account })
        this.expiry = setTimeout(
            () => this.cancel(),
            Math.min(
                2_147_483_647,
                Math.max(0, account.tokenExpiresAt - Date.now()),
            ),
        )
        this.expiry.unref?.()
    }

    assertActive(): void {
        if (
            this.signal.aborted
            || !this.current()
            || this.account.tokenExpiresAt <= Date.now()
        )
            throw denied()
    }

    cancel(): void {
        clearTimeout(this.expiry)
        this.controller.abort(
            denied(),
        )
    }

    async waitFor<T>(operation: () => Promise<T>): Promise<T> {
        this.assertActive()
        let stop = (): void => {}
        const cancelled = new Promise<never>(
            (_resolve, reject) => void (stop = () => reject(
                denied(),
            )),
        )
        this.signal.addEventListener(
            'abort',
            stop,
            { once: true },
        )

        try {
            const result = await Promise.race([operation(), cancelled])
            this.assertActive()

            return result
        } finally {
            this.signal.removeEventListener('abort', stop)
        }
    }
}

// Starts closed. A durable control-feed consumer must establish readiness before
// requests can begin, and close it on disconnect or an invalid control stream.
export class AccountRequestScopes {
    private available = false
    private readonly active = new Map<string, Set<AccountRequestScope>>()
    private readonly watermarks = new Map<string, AccountInvalidation>()

    constructor(private readonly admission: Pick<AccountAdmission, 'admitVerifiedToken'>) {}

    setControlAvailable(available: boolean): void {
        this.available = available

        if (!available) for (const scopes of this.active.values())
            for (const scope of scopes)
                scope.cancel()
    }

    invalidate(event: AccountInvalidation): void {
        if (
            !event.identityKey
            || !Number.isSafeInteger(event.epoch)
            || event.epoch < 1
            || !['active', 'blocked', 'reconciling', 'superseded'].includes(event.state)
        ) {
            this.setControlAvailable(false)

            throw denied()
        }

        const previous = this.watermarks.get(event.identityKey)

        if (
            previous
            && previous.epoch > event.epoch
        )
            return

        // A state change at the same epoch violates the lifecycle protocol.
        // Keep that identity denied until a strictly newer active epoch arrives.
        const next = previous?.epoch === event.epoch
            && previous.state !== event.state
            ? {
                ...event,
                state: 'blocked' as const,
            }
            : { ...event }
        this.watermarks.set(event.identityKey, next)

        for (const scope of this.active.get(event.identityKey) ?? [])
            if (!this.isCurrent(scope.account))
                scope.cancel()
    }

    async run<T>(
        decoded: Record<string, unknown>,
        operation: (scope: AccountRequestScope) => Promise<T>,
        parent?: AbortSignal,
    ): Promise<T> {
        if (!this.available)
            throw denied()

        const account = await this.admission.admitVerifiedToken(decoded, parent)

        if (!this.isCurrent(account))
            throw denied()

        const scope = new AccountRequestScope(
            account,
            () => this.isCurrent(account),
            parent,
        )
        const scopes = this.active.get(account.identityKey) ?? new Set<AccountRequestScope>()
        scopes.add(scope)
        this.active.set(account.identityKey, scopes)

        try {
            // Install the cancellation index before this second durable read.
            // Revocation between the first read and registration cannot escape.
            const confirmed = await scope.waitFor(() => this.admission.admitVerifiedToken(decoded, scope.signal))

            if (
                confirmed.identityKey !== account.identityKey
                || confirmed.epoch !== account.epoch
                || confirmed.personalOrganizationId !== account.personalOrganizationId
            )
                throw denied()

            scope.assertActive()
            const result = await scope.waitFor(() => operation(scope))
            scope.assertActive()

            return result
        } finally {
            scope.cancel()
            scopes.delete(scope)

            if (!scopes.size)
                this.active.delete(account.identityKey)
        }
    }

    private isCurrent(account: AdmittedAccount): boolean {
        const latest = this.watermarks.get(account.identityKey)

        return this.available && (!latest || latest.epoch < account.epoch || (latest.epoch === account.epoch && latest.state === 'active'))
    }
}
