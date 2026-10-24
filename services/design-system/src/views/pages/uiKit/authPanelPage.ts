// The authentication and account-setup layout from
// @lixpi/ui-kit/components/auth-panel. It fills the viewport height, so one
// configuration is shown at a time.

import {
    AuthPanel,
    type AuthPanelConfig,
} from '@lixpi/ui-kit/components/auth-panel'
import { lixpiLogo } from '@lixpi/ui-kit/svg'
import { createGentelellaTabs } from '@lixpi/ui-kit-gentelella/components/tabs'
import { createGentelellaSwitch } from '@lixpi/ui-kit-gentelella/components/form-controls'
import {
    applyGentelellaFormControl,
    createGentelellaFormField,
} from '@lixpi/ui-kit-gentelella/components/form'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/uiKit/auth-panel-page.scss'

type AuthPanelVariant = {
    config: () => AuthPanelConfig
    label: string
    value: string
}

const VARIANTS: AuthPanelVariant[] = [
    {
        label: 'Sign in',
        value: 'sign-in',
        config: () => ({
            actions: [{
                label: 'Sign in',
                onClick: () => announce('Sign in'),
            }],
            brand: 'Lixpi',
            description: 'Sign in to open your workspaces.',
            logo: lixpiLogo,
            title: 'Welcome back.',
        }),
    },
    {
        label: 'Notice and two actions',
        value: 'notice',
        config: () => ({
            actions: [{
                label: 'Try again',
                onClick: () => announce('Try again'),
            }, {
                label: 'Sign out',
                onClick: () => announce('Sign out'),
                secondary: true,
            }],
            brand: 'Lixpi',
            description: 'We could not load your account options. Please try again.',
            logo: lixpiLogo,
            message: 'Your session expired while you were away.',
            title: 'Your setup needs another moment.',
        }),
    },
    {
        label: 'Caller content, no logo',
        value: 'content',
        config: () => ({
            actions: [{
                label: 'Continue',
                onClick: () => announce('Continue'),
            }],
            brand: 'Lixpi',
            content: createGentelellaFormField({
                control: applyGentelellaFormControl(
                    html`
                        <input
                            type="text"
                            placeholder="Studio name"
                        />
                    ` as HTMLInputElement,
                ),
                hint: 'You can change this later.',
                label: 'Organization name',
            }).el,
            description: 'Name your organization to finish setting up.',
            title: 'One more step.',
        }),
    },
]

class AuthPanelPreview {
    readonly element: HTMLElement

    private panel: AuthPanel | null = null
    private current = VARIANTS[0]

    constructor() {
        this.element = html`<div className="design-system-auth-panel-frame"></div>` as HTMLElement
        this.show(this.current.value)
    }

    show(value: string): void {
        this.current = VARIANTS.find(variant => variant.value === value) ?? VARIANTS[0]
        this.panel?.destroy()
        this.panel = new AuthPanel(
            this.current.config(),
        )
        this.element.replaceChildren(this.panel.dom)
    }

    setBusy(busy: boolean): void {
        this.panel?.setBusy(busy)
    }

    destroy(): void {
        this.panel?.destroy()
        this.panel = null
        this.element.remove()
    }
}

export const createAuthPanelPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit/components/auth-panel',
        title: 'Auth panel',
        description: 'web-ui and the user portal show this panel for sign-in, access recovery and onboarding. The host owns authentication and every action.',
    })
    const preview = page.own(
        new AuthPanelPreview(),
    )
    const tabs = page.own(
        createGentelellaTabs({
            activeValue: VARIANTS[0].value,
            ariaLabel: 'Auth panel configuration',
            items: VARIANTS.map(
                variant => ({
                    label: variant.label,
                    value: variant.value,
                }),
            ),
            variant: 'pill',
            onSelect: value => {
                tabs.setActiveValue(value)
                preview.show(value)
                busy.setChecked(false)
            },
        }),
    )
    const busy = page.own(
        createGentelellaSwitch({
            label: 'setBusy',
            onChange: checked => preview.setBusy(checked),
        }),
    )
    page.addSection({
        title: 'Configurations',
        content: [
            createShowcaseRow([tabs.el, busy.el]),
            preview.element,
        ],
    })

    return page
}
