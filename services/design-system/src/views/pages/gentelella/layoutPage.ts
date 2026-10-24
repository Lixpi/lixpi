// Gentelella page structure: page headers, cards, tabs, drawers, tables of
// content, the page wrapper and the application shell this site runs in.

import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { createGentelellaPage } from '@lixpi/ui-kit-gentelella/components/page'
import { createGentelellaPageHeader } from '@lixpi/ui-kit-gentelella/components/page-header'
import { createGentelellaTabs } from '@lixpi/ui-kit-gentelella/components/tabs'
import { createGentelellaDrawer } from '@lixpi/ui-kit-gentelella/components/drawer'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaStatus } from '@lixpi/ui-kit-gentelella/components/status'
import { createGentelellaApplicationShell } from '@lixpi/ui-kit-gentelella/components/application-shell'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/gentelella/layout.scss'

export const createGentelellaLayoutPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella',
        title: 'Page layout',
        description: 'Structure for application screens. The sidebar and content area around this text is the application shell.',
    })

    const header = page.own(
        createGentelellaPageHeader({
            actions: page.own(
                createGentelellaButton({
                    label: 'Rename',
                    variant: 'outline',
                    onClick: () => header.setTitle(header.titleEl.textContent === 'Models' ? 'Model catalog' : 'Models'),
                }),
            ).el,
            pretitle: 'Catalog',
            title: 'Models',
        }),
    )
    const plainHeader = page.own(
        createGentelellaPageHeader({ title: 'Header without pretitle or actions' }),
    )
    page.addSection({
        title: 'Page header',
        content: [
            createShowcaseSpecimen({
                content: header.el,
                label: 'pretitle, actions and setTitle',
            }),
            createShowcaseSpecimen({
                content: plainHeader.el,
                label: 'title only',
            }),
        ],
    })

    const collapsible = page.own(
        createGentelellaCard({
            collapsible: true,
            content: 'Collapsible cards toggle their body from the header.',
            title: 'Collapsible',
        }),
    )
    const appendable = page.own(
        createGentelellaCard({
            content: 'appendContent adds caller nodes to the body.',
            title: 'Appendable',
        }),
    )
    page.addSection({
        title: 'Cards',
        columns: 3,
        content: [
            page.own(
                createGentelellaCard({ content: 'A card with body content only.' }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: 'Title and subtitle in the header.',
                    subtitle: 'Last updated today',
                    title: 'Title and subtitle',
                }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: 'Header trailing content and a footer.',
                    footer: 'Footer content',
                    headerTrailing: page.own(
                        createGentelellaStatus({
                            label: 'Active',
                            tone: 'green',
                        }),
                    ).el,
                    title: 'Trailing and footer',
                }),
            ).el,
            collapsible.el,
            createShowcaseSpecimen({
                content: [
                    appendable.el,
                    page.own(
                        createGentelellaButton({
                            label: 'appendContent',
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => appendable.appendContent(html`<p>Appended at ${new Date().toLocaleTimeString()}</p>`),
                        }),
                    ).el,
                    page.own(
                        createGentelellaButton({
                            label: 'Collapse the collapsible card',
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => collapsible.setCollapsed(true),
                        }),
                    ).el,
                ],
                label: 'appendContent and setCollapsed',
            }),
        ],
    })

    const tabItems = [
        {
            label: 'Overview',
            value: 'overview',
        },
        {
            label: 'Activity',
            value: 'activity',
        },
        {
            label: 'Settings',
            value: 'settings',
        },
        {
            disabled: true,
            label: 'Archived',
            value: 'archived',
        },
    ]
    page.addSection({
        title: 'Tabs',
        content: (['underline', 'pill', 'chart'] as const).map(variant => {
            const tabs = page.own(
                createGentelellaTabs({
                    activeValue: 'overview',
                    ariaLabel: `${variant} tabs`,
                    items: tabItems,
                    variant,
                    onSelect: value => {
                        tabs.setActiveValue(value)
                        announce(`${variant}: ${value}`)
                    },
                }),
            )

            return createShowcaseSpecimen({
                content: tabs.el,
                label: `variant: '${variant}'`,
            })
        }),
    })

    const drawer = page.own(
        createGentelellaDrawer({
            body: 'Drawers own their backdrop. Click the backdrop to close.',
            header: html`<strong>Drawer</strong>`,
            onBackdropClick: () => drawer.setOpen(false),
        }),
    )
    page.onMount(() => document.body.append(drawer.backdropEl, drawer.el))
    page.addSection({
        title: 'Drawer',
        content: page.own(
            createGentelellaButton({
                label: 'Open drawer',
                variant: 'primary',
                onClick: () => drawer.setOpen(true),
            }),
        ).el,
    })

    const innerPage = page.own(
        createGentelellaPage({
            content: page.own(
                createGentelellaPageHeader({ title: 'Nested page' }),
            ).el,
        }),
    )
    innerPage.appendContent(page.own(
        createGentelellaCard({ content: 'createGentelellaPage wraps page content with the theme spacing.' }),
    ).el)
    page.addSection({
        title: 'Page wrapper',
        content: innerPage.el,
    })

    const shell = page.own(
        createGentelellaApplicationShell({
            brand: {
                mark: 'LX',
                name: 'Sample app',
            },
            footerContent: 'Footer content',
            navigationGroups: [{
                items: [{
                    iconHtml: GENTELELLA_ICONS.dashboard,
                    label: 'Dashboard',
                    path: '/dashboard',
                }, {
                    iconHtml: GENTELELLA_ICONS.projects,
                    label: 'Projects',
                    path: '/projects',
                }],
                label: 'Main',
            }, {
                items: [{
                    iconHtml: GENTELELLA_ICONS.settings,
                    label: 'Settings',
                    path: '/settings',
                }],
                label: 'Account',
            }],
            onNavigate: path => {
                shell.setActivePath(path)
                announce(`Navigate to ${path}`)
            },
        }),
    )
    shell.setActivePath('/dashboard')
    shell.contentEl.append(page.own(
        createGentelellaCard({ content: 'contentEl hosts the routed view.' }),
    ).el)
    page.addSection({
        title: 'Application shell',
        description: 'The same component frames this site. A second instance runs here inside a fixed-height frame.',
        content: createShowcaseRow([html`<div className="design-system-shell-frame">${shell.el}</div>`]),
    })

    return page
}
