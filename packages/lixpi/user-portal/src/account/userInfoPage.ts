import {
    LoadingStatus,
    type User,
} from '@lixpi/constants'
import { createGentelellaPage } from '@lixpi/ui-kit-gentelella/components/page'
import { createGentelellaPageHeader } from '@lixpi/ui-kit-gentelella/components/page-header'
import {
    type LoadingLayer,
    type LoadingLease,
} from '@lixpi/canvas-components/loading/layer'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type UserStateStore,
} from '@lixpi/auth-client'

export type UserInfoPageConfig = {
    document?: Document
    store: UserStateStore
    loadingLayer: Pick<LoadingLayer, 'acquire'>
}

export type UserInfoPageInstance = {
    readonly el: HTMLDivElement
    destroy: () => void
}

const formatTimestamp = (timestamp: number): string => {
    if (!timestamp)
        return 'Not available'

    return new Intl.DateTimeFormat(
        undefined,
        {
            dateStyle: 'medium',
        },
    ).format(
        new Date(timestamp),
    )
}

class UserInfoPage implements UserInfoPageInstance {
    readonly el: HTMLDivElement

    private readonly contentEl: HTMLDivElement
    private readonly document: Document
    private readonly store: UserStateStore
    private readonly unsubscribe: () => void
    private readonly loading: LoadingLease

    constructor(config: UserInfoPageConfig) {
        this.document = config.document ?? globalThis.document
        this.store = config.store
        this.loading = config.loadingLayer.acquire({ label: 'Loading user information' })
        const html = createDocumentHtml(this.document)
        const header = createGentelellaPageHeader({
            document: this.document,
            title: 'Profile',
        })
        this.contentEl = html`<div className="user-portal-user-content"></div>` as HTMLDivElement
        const page = createGentelellaPage({
            document: this.document,
            content: [
                header.el,
                this.contentEl,
            ],
        })
        this.el = page.el
        this.unsubscribe = this.store.subscribe(state => this.render(state.meta.loadingStatus, state.data))
    }

    private render(
        loadingStatus: LoadingStatus,
        user: User,
    ): void {
        this.contentEl.replaceChildren()
        const pending = loadingStatus === LoadingStatus.idle || loadingStatus === LoadingStatus.loading
        this.loading.setVisible(pending)

        if (pending)
            return

        if (loadingStatus === LoadingStatus.error) {
            this.renderError()

            return
        }

        this.renderUser(user)
    }

    private renderError(): void {
        const html = createDocumentHtml(this.document)
        this.contentEl.append(
            html`
                <p
                    className="user-portal-state"
                    role="alert"
                >User information could not be loaded. Reload this page to try again.</p>
            ` as HTMLParagraphElement,
        )
    }

    private renderUser(user: User): void {
        const html = createDocumentHtml(this.document)
        const displayName = user.name
            && user.name !== user.email
            ? user.name
            : 'Your account'
        const initial = (user.givenName || user.name || user.email || 'L').slice(0, 1).toUpperCase()
        this.contentEl.append(
            html`
                <section
                    className="user-portal-profile"
                    aria-label="Your profile"
                >
                    <div className="user-portal-profile-heading">
                        <span
                            className="user-portal-avatar"
                            aria-hidden="true"
                        >${initial}</span>
                        <div><p className="user-portal-eyebrow">Your creative space</p><h2>${displayName}</h2><p>${user.email || 'Your Lixpi account'}</p></div>
                    </div>
                    <div className="user-portal-profile-section">
                    <h3>Personal details</h3>
                    <p className="user-portal-section-description">The details associated with your sign-in.</p>
                    <dl className="user-portal-user-grid">
                        <div className="user-portal-user-field">
                            <dt className="user-portal-user-term">Name</dt>
                            <dd className="user-portal-user-value">${user.name
                                && user.name !== user.email
                                ? user.name
                                : 'Not set'}</dd>
                        </div>
                        <div className="user-portal-user-field">
                            <dt className="user-portal-user-term">Email</dt>
                            <dd className="user-portal-user-value">${user.email || 'Not available'}</dd>
                        </div>
                        <div className="user-portal-user-field">
                            <dt className="user-portal-user-term">Member since</dt>
                            <dd className="user-portal-user-value">${formatTimestamp(user.createdAt)}</dd>
                        </div>
                    </dl>
                    </div>
                </section>
            ` as HTMLElement,
        )
    }

    destroy(): void {
        this.unsubscribe()
        this.loading.destroy()
        this.el.remove()
    }
}

export const createUserInfoPage = (config: UserInfoPageConfig): UserInfoPageInstance => new UserInfoPage(config)
