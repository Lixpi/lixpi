import {
    createUserService,
    type UserStateStore,
    type WebClientUserService,
} from '@lixpi/auth-client'
import {
    createConversationSettings,
    LoadingStatus,
    type AccountAgentPreferences,
    type AccountPreferences,
} from '@lixpi/constants'
import {
    themePresets,
    lixpiLightTheme,
} from '@lixpi/themes'
import { createGentelellaPage } from '@lixpi/ui-kit-gentelella/components/page'
import { createGentelellaPageHeader } from '@lixpi/ui-kit-gentelella/components/page-header'
import {
    createGentelellaButton,
    type GentelellaButtonInstance,
} from '@lixpi/ui-kit-gentelella/components/button'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type UserPortalModuleContext,
} from '../types.ts'

type AccountPreferencesPageConfig = Pick<UserPortalModuleContext, 'userStore' | 'getToken' | 'nats'> & {
    document?: Document
}

const themeLabels: Record<string, string> = {
    'lixpi-light': 'Lixpi Light',
    'one-dark-pro-mariana': 'One Dark Pro Mariana',
}
const defaultAgent = createConversationSettings()
const defaultAppearance = lixpiLightTheme.name

class AccountPreferencesPage {
    readonly el: HTMLDivElement

    private readonly user: WebClientUserService
    private readonly store: UserStateStore
    private readonly appearance: HTMLSelectElement
    private readonly contextMode: HTMLSelectElement
    private readonly midRunPolicy: HTMLSelectElement
    private readonly appearanceSave: GentelellaButtonInstance
    private readonly agentSave: GentelellaButtonInstance
    private readonly appearanceStatus: HTMLParagraphElement
    private readonly agentStatus: HTMLParagraphElement
    private readonly loadError: HTMLParagraphElement
    private readonly unsubscribe: () => void
    private readonly appearanceForm: HTMLFormElement
    private readonly agentForm: HTMLFormElement
    private saved: AccountPreferences = {}
    private appearanceDirty = false
    private agentDirty = false
    private saving = false
    private destroyed = false

    constructor(config: AccountPreferencesPageConfig) {
        const document = config.document ?? globalThis.document
        const html = createDocumentHtml(document)
        this.store = config.userStore
        this.user = createUserService({
            getToken: config.getToken,
            requestClient: config.nats,
            store: this.store,
        })
        const header = createGentelellaPageHeader({
            document,
            title: 'Preferences',
        })
        const themeOptions = themePresets.map(
            theme => html`
                <option value=${theme.name}>${themeLabels[theme.name] ?? theme.name} (${theme.colorScheme})</option>
            `,
        )
        this.appearance = html`
            <select
                className="form-control"
                aria-describedby="user-portal-appearance-description"
            >
                ${themeOptions}
                <option value="system">Follow device</option>
            </select>
        ` as HTMLSelectElement
        this.contextMode = html`
            <select
                className="form-control"
                aria-describedby="user-portal-context-mode-description"
            >
                <option value="explicit">Explicit</option>
                <option value="discovery">Discovery</option>
                <option value="mixed">Mixed</option>
            </select>
        ` as HTMLSelectElement
        this.midRunPolicy = html`
            <select
                className="form-control"
                aria-describedby="user-portal-mid-run-policy-description"
            >
                <option value="steer">Steer the current run</option>
                <option value="stop-first">Stop and start a new run</option>
                <option value="queue">Queue for later</option>
            </select>
        ` as HTMLSelectElement
        this.appearanceSave = createGentelellaButton({
            document,
            label: 'Save appearance',
            type: 'submit',
            variant: 'primary',
        })
        this.agentSave = createGentelellaButton({
            document,
            label: 'Save agent behavior',
            type: 'submit',
            variant: 'primary',
        })
        this.appearanceStatus = html`
            <p
                className="user-portal-preference-status"
                role="status"
            ></p>
        ` as HTMLParagraphElement
        this.agentStatus = html`
            <p
                className="user-portal-preference-status"
                role="status"
            ></p>
        ` as HTMLParagraphElement
        this.loadError = html`
            <p
                className="user-portal-state"
                role="alert"
                hidden
            >Preferences could not be loaded. Reload the page to try again.</p>
        ` as HTMLParagraphElement
        this.appearanceForm = html`
            <form
                className="user-portal-preference-form"
                onsubmit=${this.saveAppearance}
            >
                <h2>Appearance</h2>
                <label className="user-portal-preference-field">
                    <span>Theme</span>
                    <span id="user-portal-appearance-description">Applies to the workspace and account portal on every device.</span>
                    ${this.appearance}
                </label>
                <div className="user-portal-preference-actions">
                    ${this.appearanceSave.el}
                    ${this.appearanceStatus}
                </div>
            </form>
        ` as HTMLFormElement
        this.agentForm = html`
            <form
                className="user-portal-preference-form"
                onsubmit=${this.saveAgent}
            >
                <h2>Agent behavior</h2>
                <p className="user-portal-section-description">Changes apply when you send your next message. Running turns keep their accepted context.</p>
                <label className="user-portal-preference-field">
                    <span>Workspace context</span>
                    <span id="user-portal-context-mode-description">Explicit uses references and conversation context. Discovery can search accessible workspace content. Mixed combines both.</span>
                    ${this.contextMode}
                </label>
                <label className="user-portal-preference-field">
                    <span>Message during a run</span>
                    <span id="user-portal-mid-run-policy-description">Choose what happens when you send another message while the agent is working.</span>
                    ${this.midRunPolicy}
                </label>
                <div className="user-portal-preference-actions">
                    ${this.agentSave.el}
                    ${this.agentStatus}
                </div>
            </form>
        ` as HTMLFormElement
        this.el = createGentelellaPage({
            document,
            content: [
                header.el,
                html`
                    <div className="user-portal-preferences">
                        ${this.loadError}
                        ${this.appearanceForm}
                        ${this.agentForm}
                    </div>
                ` as HTMLDivElement,
            ],
        }).el
        this.appearance.addEventListener('change', this.changeAppearance)
        this.agentForm.addEventListener('change', this.changeAgent)
        this.unsubscribe = this.store.subscribe(state => {
            this.saved = state.data.preferences ?? {}
            const ready = state.meta.loadingStatus === LoadingStatus.success && Boolean(state.data.userId)
            this.appearanceForm.hidden = !ready
            this.agentForm.hidden = !ready
            this.loadError.hidden = state.meta.loadingStatus !== LoadingStatus.error

            if (!this.appearanceDirty)
                this.appearance.value = this.saved.appearance ?? defaultAppearance

            if (!this.agentDirty) {
                this.contextMode.value = this.saved.agent?.contextMode ?? defaultAgent.contextMode
                this.midRunPolicy.value = this.saved.agent?.midRunPolicy ?? defaultAgent.midRunPolicy
            }

            this.reflectSaveState()
        })
    }

    private readonly changeAppearance = (): void => {
        this.appearanceDirty = this.appearance.value !== (this.saved.appearance ?? defaultAppearance)
        this.appearanceStatus.textContent = ''
        this.reflectSaveState()
    }

    private readonly changeAgent = (): void => {
        this.agentDirty = this.contextMode.value !== (this.saved.agent?.contextMode ?? defaultAgent.contextMode)
            || this.midRunPolicy.value !== (this.saved.agent?.midRunPolicy ?? defaultAgent.midRunPolicy)
        this.agentStatus.textContent = ''
        this.reflectSaveState()
    }

    private readonly saveAppearance = (event: SubmitEvent): void => {
        event.preventDefault()

        if (this.appearanceDirty)
            void this.save(
                { appearance: this.appearance.value },
                this.appearanceSave,
                this.appearanceStatus,
            )
    }

    private readonly saveAgent = (event: SubmitEvent): void => {
        event.preventDefault()

        if (
            this.agentDirty
            || !this.saved.agent
        )
            void this.save(
                { agent: {
                    contextMode: this.contextMode.value as AccountAgentPreferences['contextMode'],
                    midRunPolicy: this.midRunPolicy.value as AccountAgentPreferences['midRunPolicy'],
                } },
                this.agentSave,
                this.agentStatus,
            )
    }

    private async save(
        preferences: AccountPreferences,
        button: GentelellaButtonInstance,
        status: HTMLParagraphElement,
    ): Promise<void> {
        if (
            this.saving
            || this.store.getMeta('loadingStatus') !== LoadingStatus.success
        )
            return

        this.saving = true
        button.setBusy(true)
        status.textContent = ''
        this.reflectSaveState()

        try {
            await this.user.updatePreferences(preferences)

            if (preferences.appearance)
                this.changeAppearance()
            else
                this.changeAgent()

            status.textContent = 'Saved'
        } catch {
            status.textContent = 'Could not save. Try again.'
        } finally {
            this.saving = false

            if (!this.destroyed) {
                button.setBusy(false)
                this.reflectSaveState()
            }
        }
    }

    private reflectSaveState(): void {
        this.appearance.disabled = this.saving
        this.contextMode.disabled = this.saving
        this.midRunPolicy.disabled = this.saving
        this.appearanceSave.setDisabled(this.saving || !this.appearanceDirty)
        this.agentSave.setDisabled(this.saving || (!this.agentDirty && Boolean(this.saved.agent)))
    }

    destroy(): void {
        this.destroyed = true
        this.unsubscribe()
        this.appearance.removeEventListener('change', this.changeAppearance)
        this.agentForm.removeEventListener('change', this.changeAgent)
        this.appearanceSave.destroy()
        this.agentSave.destroy()
        this.el.remove()
    }
}

export const createAccountPreferencesPage = (config: AccountPreferencesPageConfig): AccountPreferencesPage => new AccountPreferencesPage(config)
