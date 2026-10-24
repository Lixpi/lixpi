// Gentelella foundation components: alerts, avatars, badges, breadcrumbs,
// code, dividers, grids, list groups, pagination, status dots and type.

import {
    createGentelellaAccordion,
    createGentelellaAlert,
    createGentelellaAvatar,
    createGentelellaAvatarStack,
    createGentelellaBadge,
    createGentelellaBreadcrumbs,
    createGentelellaCode,
    createGentelellaDivider,
    createGentelellaGrid,
    createGentelellaListGroup,
    createGentelellaPagination,
    createGentelellaStatusDot,
    createGentelellaTypographySample,
    type GentelellaAlertVariant,
    type GentelellaAvatarSize,
    type GentelellaGridColumns,
} from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
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

const ALERT_VARIANTS: GentelellaAlertVariant[] = ['info', 'success', 'warning', 'danger', 'error']
const AVATAR_SIZES: GentelellaAvatarSize[] = ['extra-small', 'small', 'default', 'medium', 'large', 'extra-large', 'extra-extra-large']
const GRID_COLUMNS: GentelellaGridColumns[] = [1, 2, 3, 4, '4-8', '8-4']

export const createGentelellaFoundationPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/foundation',
        title: 'Foundation',
        description: 'The base vocabulary of the Gentelella theme. Each factory returns an instance that owns its element.',
    })

    page.addSection({
        title: 'Alerts',
        content: ALERT_VARIANTS.map(
            variant => page.own(
                createGentelellaAlert({
                    body: `This is a ${variant} alert with supporting text.`,
                    title: `${variant[0].toUpperCase()}${variant.slice(1)}`,
                    variant,
                }),
            ).el,
        ),
    })

    page.addSection({
        title: 'Avatars',
        description: 'Sizes, initials, background colors and presence status.',
        content: [
            createShowcaseRow(
                AVATAR_SIZES.map(
                    size => page.own(
                        createGentelellaAvatar({
                            initials: 'LX',
                            size,
                        }),
                    ).el,
                ),
            ),
            createShowcaseRow(
                (['online', 'away', 'offline'] as const).map(
                    (status, index) => page.own(
                        createGentelellaAvatar({
                            background: ['#3d649c', '#a55324', '#6d4fb2'][index],
                            initials: ['AB', 'CD', 'EF'][index],
                            size: 'large',
                            status,
                        }),
                    ).el,
                ),
            ),
            page.own(
                createGentelellaAvatarStack({
                    avatars: ['AB', 'CD', 'EF', 'GH', 'IJ'].map(
                        (initials, index) => ({
                            background: ['#3d649c', '#a55324', '#6d4fb2', '#39766f', '#5d656d'][index],
                            initials,
                        }),
                    ),
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Badges and status dots',
        content: [
            createShowcaseRow(
                (['blue', 'red', 'teal'] as const).map(
                    tone => page.own(
                        createGentelellaBadge({
                            content: tone,
                            tone,
                        }),
                    ).el,
                ),
            ),
            createShowcaseRow(
                (['green', 'yellow', 'red', 'blue', 'gray'] as const).map(
                    tone => page.own(
                        createGentelellaStatusDot({
                            label: tone,
                            tone,
                        }),
                    ).el,
                ),
            ),
        ],
    })

    page.addSection({
        title: 'Breadcrumbs and pagination',
        content: [
            page.own(
                createGentelellaBreadcrumbs({
                    items: [{
                        href: '#',
                        label: 'Workspaces',
                    }, {
                        href: '#',
                        label: 'Campaign',
                    }, { label: 'Moodboard' }],
                }),
            ).el,
            page.own(
                createGentelellaPagination({
                    currentPage: 3,
                    items: [
                        {
                            disabled: false,
                            label: 'Previous',
                            page: 2,
                        },
                        {
                            label: '1',
                            page: 1,
                        },
                        'ellipsis',
                        {
                            label: '3',
                            page: 3,
                        },
                        {
                            label: '4',
                            page: 4,
                        },
                        'ellipsis',
                        {
                            label: '12',
                            page: 12,
                        },
                        {
                            disabled: true,
                            label: 'Next',
                            page: 4,
                        },
                    ],
                    onSelect: selected => announce(`Page ${selected}`),
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Accordion and list group',
        columns: 2,
        content: [
            page.own(
                createGentelellaAccordion({
                    items: [
                        {
                            content: 'Workspaces hold canvases, documents and generated media.',
                            open: true,
                            title: 'What is a workspace?',
                        },
                        {
                            content: 'Organization members can open shared Assets.',
                            title: 'Who can see my Assets?',
                        },
                        {
                            content: 'Accept a candidate to keep it, or reject it to remove it.',
                            title: 'How does review work?',
                        },
                    ],
                }),
            ).el,
            page.own(
                createGentelellaListGroup({
                    ariaLabel: 'Sections',
                    items: [
                        {
                            active: true,
                            content: 'Profile',
                            value: 'profile',
                        },
                        {
                            content: 'Organizations',
                            value: 'organizations',
                        },
                        {
                            content: 'Billing',
                            value: 'billing',
                        },
                        {
                            content: 'Disabled entry',
                            disabled: true,
                            value: 'disabled',
                        },
                    ],
                    onSelect: value => announce(`Selected ${value}`),
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Code and dividers',
        content: [
            html`
                <p>Inline code: ${page.own(
                    createGentelellaCode({
                        code: 'createGentelellaCard()',
                        inline: true,
                    }),
                ).el}</p>
            `,
            page.own(
                createGentelellaCode({ code: "const card = createGentelellaCard({ title: 'Settings' })\nhost.append(card.el)" }),
            ).el,
            page.own(
                createGentelellaDivider(),
            ).el,
            page.own(
                createGentelellaDivider({ label: 'With a label' }),
            ).el,
            page.own(
                createGentelellaDivider({
                    label: 'Dashed',
                    variant: 'dashed',
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Grids',
        description: 'Equal columns or the 4-8 and 8-4 splits.',
        content: GRID_COLUMNS.map(columns => {
            const count = typeof columns === 'number' ? columns : 2

            return createShowcaseSpecimen({
                content: page.own(
                    createGentelellaGrid({
                        children: Array.from(
                            { length: count },
                            (_, index) => page.own(
                                createGentelellaCard({ content: `Column ${index + 1}` }),
                            ).el,
                        ),
                        columns,
                    }),
                ).el,
                label: `columns: ${JSON.stringify(columns)}`,
            })
        }),
    })

    page.addSection({
        title: 'Typography',
        content: (['h1', 'h2', 'h3', 'h4', 'p', 'div'] as const).map(
            tagName => page.own(
                createGentelellaTypographySample({
                    content: 'The quick brown fox jumps over the lazy dog',
                    label: tagName,
                    tagName,
                }),
            ).el,
        ),
    })

    return page
}
