import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import { lixpiLogo } from '@lixpi/ui-kit/svg'

// Sign-in entry when protected views are unavailable. A missing session or
// stopped automatic redirect does not establish that a sign-in attempt failed.
export class AuthenticationFailure {
    private view?: AuthPanel
    private busy = false

    constructor(
        private readonly retry: () => Promise<void>,
        private readonly signup?: () => Promise<void>,
    ) {}

    show(target: HTMLElement): void {
        this.destroy()
        this.view = new AuthPanel({
            brand: 'Lixpi',
            logo: lixpiLogo,
            title: 'Welcome to Lixpi',
            description: 'Sign in to continue to your workspace.',
            actions: [
                {
                    label: 'Sign in',
                    onClick: () => void this.signIn(this.retry),
                },
                ...(this.signup ? [{
                    label: 'Create an account',
                    secondary: true,
                    onClick: () => void this.signIn(this.signup!),
                }] : []),
            ],
        })
        target.replaceChildren(this.view.dom)
        this.view.dom.focus()
    }

    destroy(): void {
        this.view?.destroy()
        this.view = undefined
        this.busy = false
    }

    private async signIn(action: () => Promise<void>): Promise<void> {
        if (
            this.busy
            || !this.view
        )
            return

        this.busy = true
        const view = this.view
        view.setBusy(true)

        try {
            await action()
        } catch {
            // Leave sign-in available without exposing provider diagnostics.
        } finally {
            if (this.view === view) {
                this.busy = false
                view.setBusy(false)
            }
        }
    }
}
