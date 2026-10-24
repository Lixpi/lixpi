// Gentelella dashboard widgets: stat tiles, activity, distributions, todos,
// legends and profile rings.

import {
    createGentelellaActivityFeed,
    createGentelellaLegend,
    createGentelellaProfileRing,
    createGentelellaStat,
    createGentelellaTodoList,
    createGentelellaVersionDistribution,
    createGentelellaVisitorDistribution,
    type GentelellaWidgetColor,
} from '@lixpi/ui-kit-gentelella/components/widgets'
import { createGentelellaAvatar } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
} from '$src/views/showcase/showcasePage.ts'

const COLORS: GentelellaWidgetColor[] = ['teal', 'blue', 'azure', 'green', 'yellow', 'red', 'pink', 'purple']

export const createGentelellaWidgetsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/widgets',
        title: 'Widgets',
        description: 'Building blocks for dashboards. Combine them with cards and charts rather than copying a dashboard page.',
    })

    page.addSection({
        title: 'Stat tiles',
        description: 'Every color, with and without a change indicator.',
        columns: 4,
        content: COLORS.map(
            (color, index) => page.own(
                createGentelellaStat({
                    change: index % 3 === 2 ? undefined : {
                        direction: index % 2 === 0 ? 'up' : 'down',
                        value: `${(index + 1) * 3}%`,
                    },
                    color,
                    icon: html`<span innerHTML=${GENTELELLA_ICONS.charts}></span>`,
                    label: `${color} metric`,
                    subtext: index % 2 === 0 ? 'vs last week' : undefined,
                    value: (index + 1) * 1240,
                }),
            ).el,
        ),
    })

    const todos = page.own(
        createGentelellaTodoList({
            items: [
                {
                    completed: true,
                    date: 'Today',
                    id: 'brief',
                    priority: 'green',
                    text: 'Approve the brief',
                },
                {
                    date: 'Tomorrow',
                    id: 'frames',
                    priority: 'yellow',
                    text: 'Pick key frames',
                },
                {
                    id: 'review',
                    priority: 'red',
                    text: 'Review the generated variants',
                },
                {
                    id: 'share',
                    priority: 'blue',
                    text: 'Share the board',
                },
            ],
            onChange: (id, completed) => announce(`${id} ${completed ? 'done' : 'reopened'}, ${todos.getRemainingCount()} remaining`),
        }),
    )
    page.addSection({
        title: 'Activity and todos',
        columns: 2,
        content: [
            page.own(
                createGentelellaCard({
                    content: page.own(
                        createGentelellaActivityFeed({
                            items: [
                                {
                                    avatar: page.own(
                                        createGentelellaAvatar({ initials: 'AB' }),
                                    ).el,
                                    body: 'Accepted three image variants',
                                    time: '2m ago',
                                },
                                {
                                    avatar: page.own(
                                        createGentelellaAvatar({
                                            background: '#a55324',
                                            initials: 'CD',
                                        }),
                                    ).el,
                                    body: 'Started a video generation',
                                    time: '1h ago',
                                },
                                {
                                    body: 'Uploaded 12 reference frames',
                                    time: 'Yesterday',
                                },
                            ],
                        }),
                    ).el,
                    title: 'Activity feed',
                }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: todos.el,
                    footer: page.own(
                        createGentelellaButton({
                            label: "setCompleted('share', true)",
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => todos.setCompleted('share', true),
                        }),
                    ).el,
                    title: 'Todo list',
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Distributions',
        columns: 2,
        content: [
            page.own(
                createGentelellaCard({
                    content: page.own(
                        createGentelellaVisitorDistribution({
                            items: [
                                {
                                    flag: '🇺🇸',
                                    name: 'United States',
                                    percent: 42,
                                },
                                {
                                    flag: '🇩🇪',
                                    name: 'Germany',
                                    percent: 21,
                                },
                                {
                                    color: 'var(--green)',
                                    flag: '🇯🇵',
                                    name: 'Japan',
                                    percent: 14,
                                },
                                {
                                    color: 'var(--yellow)',
                                    name: 'Other',
                                    percent: 23,
                                },
                            ],
                        }),
                    ).el,
                    title: 'Visitor distribution',
                }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: page.own(
                        createGentelellaVersionDistribution({
                            items: [
                                {
                                    label: 'v4.2',
                                    percent: 64,
                                },
                                {
                                    color: 'var(--azure)',
                                    label: 'v4.1',
                                    percent: 24,
                                },
                                {
                                    color: 'var(--red)',
                                    label: 'v3',
                                    percent: 12,
                                },
                            ],
                        }),
                    ).el,
                    title: 'Version distribution',
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Legends and profile rings',
        columns: 3,
        content: [
            page.own(
                createGentelellaCard({
                    content: page.own(
                        createGentelellaLegend({
                            items: [
                                {
                                    color: 'var(--primary)',
                                    label: 'Images',
                                    value: '58%',
                                },
                                {
                                    color: 'var(--azure)',
                                    label: 'Video',
                                    value: '27%',
                                },
                                {
                                    color: 'var(--yellow)',
                                    label: 'Documents',
                                    value: '15%',
                                },
                            ],
                            variant: 'donut',
                        }),
                    ).el,
                    title: "variant: 'donut'",
                }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: page.own(
                        createGentelellaLegend({
                            items: [
                                {
                                    color: 'var(--purple)',
                                    label: 'Media',
                                    value: '42 GB',
                                },
                                {
                                    color: 'var(--green)',
                                    label: 'Documents',
                                    value: '3 GB',
                                },
                                {
                                    color: 'var(--border-color)',
                                    label: 'Free',
                                },
                            ],
                            variant: 'storage',
                        }),
                    ).el,
                    title: "variant: 'storage'",
                }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: [
                        page.own(
                            createGentelellaProfileRing({
                                content: page.own(
                                    createGentelellaAvatar({
                                        initials: 'LX',
                                        size: 'large',
                                    }),
                                ).el,
                                label: 'Profile complete',
                                percent: 72,
                            }),
                        ).el,
                        page.own(
                            createGentelellaProfileRing({
                                label: 'Storage used',
                                percent: 35,
                            }),
                        ).el,
                    ],
                    title: 'Profile rings',
                }),
            ).el,
        ],
    })

    return page
}
