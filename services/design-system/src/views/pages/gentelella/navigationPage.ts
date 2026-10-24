// Gentelella navigation: nested sidebar groups with badges and active state,
// and the topbar with breadcrumbs, search and actions.

import {
    createGentelellaSidebarNavigation,
    createGentelellaTopbar,
    type GentelellaNavigationGroup,
} from '@lixpi/ui-kit-gentelella/components/navigation'
import { createGentelellaBreadcrumbs } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/gentelella/navigation.scss'

const icon = (name: keyof typeof GENTELELLA_ICONS): HTMLElement => html`<span innerHTML=${GENTELELLA_ICONS[name]}></span>` as HTMLElement

const GROUPS: GentelellaNavigationGroup[] = [
    {
        items: [
            {
                href: '#dashboard',
                icon: icon('dashboard'),
                key: 'dashboard',
                label: 'Dashboard',
            },
            {
                badge: {
                    text: '3',
                    tone: 'red',
                },
                children: [
                    {
                        href: '#active',
                        key: 'active',
                        label: 'Active',
                    },
                    {
                        badge: {
                            text: 'New',
                            tone: 'teal',
                        },
                        href: '#review',
                        key: 'review',
                        label: 'In review',
                    },
                    {
                        href: '#archived',
                        key: 'archived',
                        label: 'Archived',
                    },
                ],
                icon: icon('projects'),
                key: 'projects',
                label: 'Projects',
            },
        ],
        label: 'Workspace',
    },
    {
        items: [
            {
                badge: {
                    text: 'Beta',
                    tone: 'blue',
                },
                href: '#billing',
                icon: icon('receipt'),
                key: 'billing',
                label: 'Billing',
            },
            {
                href: '#settings',
                icon: icon('settings'),
                key: 'settings',
                label: 'Settings',
            },
        ],
        label: 'Account',
    },
]

export const createGentelellaNavigationPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/navigation',
        title: 'Navigation',
        description: 'Navigation components keep their own active state. The host decides what navigating means.',
    })

    const sidebar = page.own(
        createGentelellaSidebarNavigation({
            activeKey: 'review',
            ariaLabel: 'Sample navigation',
            groups: GROUPS,
            onNavigate: (item, event) => {
                event.preventDefault()
                sidebar.setActiveKey(item.key)
                announce(`Navigate to ${item.label}`)
            },
        }),
    )
    page.addSection({
        title: 'Sidebar navigation',
        description: 'Groups, nested parents, leaves and badges. Selecting a leaf moves the active state.',
        content: createShowcaseSpecimen({
            content: html`<div className="design-system-sidebar-frame">${sidebar.el}</div>`,
            label: "activeKey: 'review'",
        }),
    })

    const topbar = page.own(
        createGentelellaTopbar({
            actions: [
                page.own(
                    createGentelellaButton({
                        ariaLabel: 'Notifications',
                        iconHtml: GENTELELLA_ICONS.bell,
                        iconOnly: true,
                        variant: 'ghost',
                    }),
                ).el,
                page.own(
                    createGentelellaButton({
                        label: 'New project',
                        size: 'small',
                        variant: 'primary',
                    }),
                ).el,
            ],
            breadcrumbs: page.own(
                createGentelellaBreadcrumbs({
                    items: [{
                        href: '#',
                        label: 'Workspaces',
                    }, { label: 'Campaign' }],
                }),
            ).el,
            searchPlaceholder: 'Search assets',
            onSearch: query => announce(`Search: ${query}`),
        }),
    )
    page.addSection({
        title: 'Topbar',
        description: 'Breadcrumbs, search and actions. searchEl exposes the search input to the host.',
        content: [
            createShowcaseSpecimen({
                content: topbar.el,
                label: 'breadcrumbs, search and actions',
            }),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaTopbar(),
                ).el,
                label: 'createGentelellaTopbar() with defaults',
            }),
        ],
    })

    return page
}
