import {
    type AuthClientInstance,
} from './authClient.ts'

// One uncached token retry is allowed per connection. A persistent rejection
// closes the application and clears its session before applying the configured
// domain's sign-in flow.
export class AccessRecovery {
    private refreshed = false
    private rejected = false

    constructor(
        private readonly auth: Pick<AuthClientInstance, 'getTokenSilently' | 'rejectAccess'>,
        private readonly cleanup: () => Promise<void>,
        private readonly onError: (error: unknown) => void,
    ) {}

    connected = (): void => {
        if (!this.rejected)
            this.refreshed = false
    }

    authError = async (): Promise<void | false> => {
        if (
            !this.rejected
            && !this.refreshed
        ) {
            this.refreshed = true

            if (await this.auth.getTokenSilently(true))
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
