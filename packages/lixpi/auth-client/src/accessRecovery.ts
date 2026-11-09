import {
    type AuthClientInstance,
} from './authClient.ts'

// NATS rejects a connection the same way whether the session is invalid or the
// service that checks it is briefly unavailable, such as while the API restarts
// after a code change. Rejections keep being retried for this long, as long as
// a token can still be obtained, before the session counts as rejected.
export const ACCESS_RETRY_WINDOW_MS = 60_000

// A restarting API is back within a few seconds, and the cached token is still
// good, so retries start with it. Rejections that last longer than this suggest
// the token itself went stale, for example after LocalAuth0 restarted with new
// signing keys, so one uncached token is fetched then.
export const UNCACHED_TOKEN_AFTER_MS = 5_000

// A persistent rejection closes the application and clears its session before
// applying the configured domain's sign-in flow.
export class AccessRecovery {
    private rejectedSince: number | undefined
    private fetchedUncachedToken = false
    private rejected = false

    constructor(
        private readonly auth: Pick<AuthClientInstance, 'getTokenSilently' | 'rejectAccess'>,
        private readonly cleanup: () => Promise<void>,
        private readonly onError: (error: unknown) => void,
    ) {}

    connected = (): void => {
        if (this.rejected)
            return

        this.rejectedSince = undefined
        this.fetchedUncachedToken = false
    }

    authError = async (): Promise<void | false> => {
        if (!this.rejected) {
            const now = Date.now()
            this.rejectedSince ??= now
            const rejectedForMs = now - this.rejectedSince
            const uncached = !this.fetchedUncachedToken && rejectedForMs >= UNCACHED_TOKEN_AFTER_MS

            if (uncached)
                this.fetchedUncachedToken = true

            if (
                rejectedForMs < ACCESS_RETRY_WINDOW_MS
                && (await this.auth.getTokenSilently(uncached))
            )
                return
        }

        this.deny()

        return false
    }

    deny = (): void => {
        if (this.rejected)
            return

        this.rejected = true
        void this.finish()
    }

    private async finish(): Promise<void> {
        try {
            await this.auth.rejectAccess(this.cleanup)
        } catch (error) {
            this.onError(error)
        }
    }
}
