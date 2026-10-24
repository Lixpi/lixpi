import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import { lixpiLogo } from '@lixpi/ui-kit/svg'

// One hosted authentication entry for both existing and new accounts. Account
// discovery and registration belong to Auth0 after proof of identity.
export class AuthenticationFailure {
    private view?: AuthPanel
    private busy = false

    constructor(private readonly retry: () => Promise<void>) {}

    show(
        target: HTMLElement,
        failed = false,
    ): void {
        this.destroy()
        this.view = new AuthPanel({
            brand: 'Lixpi',
            logo: lixpiLogo,
            title: 'Welcome to Lixpi',
            description: 'Sign in to continue to your workspace.',
            message: failed ? 'Sign-in could not be completed. Please try again.' : undefined,
            actions: [{
                label: 'Sign in',
                onClick: () => void this.signIn(target),
            }],
        })
        target.replaceChildren(this.view.dom)
        this.view.dom.focus()
    }

    destroy(): void {
        this.view?.destroy()
        this.view = undefined
        this.busy = false
    }

    private async signIn(target: HTMLElement): Promise<void> {
        if (
            this.busy
            || !this.view
        )
            return

        this.busy = true
        const view = this.view
        view.setBusy(true)

        try {
            await this.retry()
        } catch {
            if (this.view === view)
                this.show(target, true)
        } finally {
            if (this.view === view) {
                this.busy = false
                view.setBusy(false)
            }
        }
    }
}
