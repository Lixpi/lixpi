import { html } from '@lixpi/ui-primitives/dom'
import {
    createShiftingGradientBackground,
    type ShiftingGradientBackground,
} from '@lixpi/ui-primitives/gradients'

export type AuthPanelAction = {
    label: string
    onClick: () => void
    secondary?: boolean
}

export type AuthPanelConfig = {
    actions: AuthPanelAction[]
    brand: string
    content?: HTMLElement
    description: string
    logo?: string
    message?: string
    title: string
}

// Shared presentation for authentication and account setup. The host owns
// authentication, navigation and any decision about application access.
export class AuthPanel {
    readonly dom: HTMLElement
    private readonly buttons: HTMLButtonElement[]
    private readonly background: ShiftingGradientBackground

    constructor(config: AuthPanelConfig) {
        this.buttons = config.actions.map(
            action => html`
                <button
                    className=${action.secondary ? 'auth-panel-button auth-panel-button-secondary' : 'auth-panel-button'}
                    type="button"
                    onclick=${action.onClick}
                >${action.label}</button>
            ` as HTMLButtonElement,
        )
        this.dom = html`
            <section
                className="auth-panel"
                aria-label=${config.title}
                tabindex="-1"
            >
                <div className="auth-panel-main">
                    <div className="auth-panel-mobile-brand">${config.brand}</div>
                    <div className="auth-panel-content">
                        <p className="auth-panel-eyebrow">YOUR CREATIVE WORKSPACE</p>
                        <h1 className="auth-panel-title">${config.title}</h1>
                        <p className="auth-panel-description">${config.description}</p>
                        ${
                            config.message ? html`
                                <p
                                    className="auth-panel-notice"
                                    role="status"
                                >${config.message}</p>
                            ` : null
                        }
                        ${config.content ?? null}
                        <div className="auth-panel-actions">${this.buttons}</div>
                    </div>
                    <p className="auth-panel-footer">Your ideas. Room to grow.</p>
                </div>
                <aside
                    className="auth-panel-brand"
                    aria-label=${config.brand}
                >
                    <div className="auth-panel-brand-content">
                        <div className="auth-panel-brand-mark">
                            ${
                                config.logo ? html`
                                    <span
                                        className="auth-panel-logo"
                                        aria-hidden="true"
                                        innerHTML=${config.logo}
                                    ></span>
                                ` : null
                            }
                            <span className="auth-panel-wordmark">${config.brand}</span>
                        </div>
                        <p className="auth-panel-brand-caption">A little space for your next big idea.</p>
                    </div>
                </aside>
            </section>
        ` as HTMLElement
        this.background = createShiftingGradientBackground(
            this.dom.querySelector<HTMLElement>('.auth-panel-brand')!,
            {
                // Match company-website/src/components/HeroSection.svelte at the renderer's initial phase.
                colors: ['#7a9e6b', '#769a68', '#789c6a', '#7ca06c'],
            },
        )
    }

    setBusy(busy: boolean): void {
        for (const button of this.buttons)
            button.disabled = busy

        if (busy)
            this.dom.setAttribute('aria-busy', 'true')
        else
            this.dom.removeAttribute('aria-busy')
    }

    destroy(): void {
        this.background.destroy()
        this.dom.remove()
    }
}
