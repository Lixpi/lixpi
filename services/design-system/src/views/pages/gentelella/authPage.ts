// Gentelella authentication surfaces: auth cards, status panels for error and
// maintenance pages, and the countdown.

import {
    createGentelellaAuthCard,
    createGentelellaCountdown,
    createGentelellaStatusPanel,
} from '@lixpi/ui-kit-gentelella/components/auth'
import {
    applyGentelellaFormControl,
    createGentelellaFormField,
} from '@lixpi/ui-kit-gentelella/components/form'
import {
    createGentelellaChoice,
    createGentelellaOtpInput,
    createGentelellaPasswordStrength,
} from '@lixpi/ui-kit-gentelella/components/form-controls'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { ShowcasePage } from '$src/views/showcase/showcasePage.ts'

const field = (
    label: string,
    type: string,
): HTMLElement =>
    createGentelellaFormField({
        control: applyGentelellaFormControl(
            html`
                <input
                    type=${type}
                    placeholder=${label}
                />
            ` as HTMLInputElement,
        ),
        label,
    }).el

export const createGentelellaAuthPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/auth',
        title: 'Authentication',
        description: 'OTP inputs and password strength are independent form controls; these cards compose them.',
    })
    const button = (label: string): HTMLElement =>
        page.own(
            createGentelellaButton({
                label,
                variant: 'primary',
            }),
        ).el

    page.addSection({
        title: 'Auth cards',
        columns: 3,
        content: [
            page.own(
                createGentelellaAuthCard({
                    actions: button('Sign in'),
                    brand: html`<strong>Lixpi</strong>`,
                    content: [
                        field('Email', 'email'),
                        field('Password', 'password'),
                        page.own(
                            createGentelellaChoice({
                                label: 'Remember me',
                                name: 'remember',
                                type: 'checkbox',
                            }),
                        ).el,
                    ],
                    footer: 'No account yet? Create one.',
                    subtitle: 'Welcome back',
                    title: 'Sign in',
                }),
            ).el,
            page.own(
                createGentelellaAuthCard({
                    actions: button('Create account'),
                    content: [
                        field('Name', 'text'),
                        field('Password', 'password'),
                        page.own(
                            createGentelellaPasswordStrength({
                                label: 'Good',
                                value: 3,
                            }),
                        ).el,
                    ],
                    title: 'Create an account',
                }),
            ).el,
            page.own(
                createGentelellaAuthCard({
                    actions: button('Verify'),
                    content: page.own(
                        createGentelellaOtpInput({ length: 6 }),
                    ).el,
                    subtitle: 'Enter the code from your authenticator app',
                    title: 'Two-factor verification',
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Status panels',
        columns: 3,
        content: [
            page.own(
                createGentelellaStatusPanel({
                    actions: button('Go home'),
                    code: '404',
                    description: 'The page you were looking for has moved or never existed.',
                    title: 'Page not found',
                }),
            ).el,
            page.own(
                createGentelellaStatusPanel({
                    code: '403',
                    description: 'Ask an organization owner for access.',
                    icon: html`<span innerHTML=${GENTELELLA_ICONS.users}></span>`,
                    title: 'Access denied',
                }),
            ).el,
            page.own(
                createGentelellaStatusPanel({
                    description: 'We are upgrading the storage cluster.',
                    icon: html`<span innerHTML=${GENTELELLA_ICONS.settings}></span>`,
                    metadata: page.own(
                        createGentelellaCountdown({
                            values: [{
                                label: 'Hours',
                                value: '02',
                            }, {
                                label: 'Minutes',
                                value: 14,
                            }, {
                                label: 'Seconds',
                                value: '09',
                            }],
                        }),
                    ).el,
                    title: 'Down for maintenance',
                }),
            ).el,
        ],
    })

    return page
}
