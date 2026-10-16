import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import { lixpiLogo } from '@lixpi/ui-kit/svg'

// Optional error UI. The application mounts it after protected views have been
// removed; it never renders provider errors, user profiles or callback values.
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
            description: 'Bring your ideas together in one creative workspace.',
            message: 'Your sign-in could not be completed. Sign in again to continue.',
            actions: [
                {
                    label: 'Sign in again',
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
            // Keep the same generic outcome, including on a denied callback.
        } finally {
            if (this.view === view) {
                this.busy = false
                view.setBusy(false)
            }
        }
    }
}
