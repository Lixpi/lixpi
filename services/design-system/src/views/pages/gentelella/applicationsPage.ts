// Gentelella application surfaces: calendar, chat, kanban, file manager,
// notifications, settings and the inbox. Runtime-backed surfaces can be
// upgraded by their Gentelella runtime, which owns their interaction.

import {
    createGentelellaCalendar,
    createGentelellaChatBubble,
    createGentelellaChatComposer,
    createGentelellaChatConversation,
    createGentelellaChatLayout,
    createGentelellaFileItem,
    createGentelellaFileManager,
    createGentelellaInboxRoot,
    createGentelellaKanbanBoard,
    createGentelellaKanbanCard,
    createGentelellaKanbanColumn,
    createGentelellaNotificationList,
    createGentelellaSettingsRow,
    createGentelellaSettingsSection,
    type GentelellaCalendarDay,
} from '@lixpi/ui-kit-gentelella/components/applications'
import { createGentelellaAvatarStack } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaSwitch } from '@lixpi/ui-kit-gentelella/components/form-controls'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaProgress } from '@lixpi/ui-kit-gentelella/components/feedback'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/gentelella/gentelella-pages.scss'

const MONTH_DAYS: GentelellaCalendarDay[] = Array.from({ length: 35 }, (_, index) => {
    const day = index - 2
    const muted = day < 1 || day > 31

    return {
        date: `2026-10-${String(
            Math.max(
                1,
                Math.min(31, day),
            ),
        ).padStart(2, '0')}`,
        day: muted
            ? day < 1
                ? 30 + day
                : day - 31
            : day,
        events: day === 8
            ? [{
                color: 'var(--primary)',
                id: 'review',
                label: 'Review',
            }]
            : day === 14
                ? [{
                    color: 'var(--green)',
                    id: 'launch',
                    label: 'Launch',
                }, {
                    color: 'var(--yellow)',
                    id: 'retro',
                    label: 'Retro',
                }]
                : [],
        muted,
        today: day === 23,
    }
})

export const createGentelellaApplicationsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/applications',
        title: 'Applications',
        description: 'Composable parts of the Gentelella app demos. Data and actions stay with the caller.',
    })

    const calendar = page.own(
        createGentelellaCalendar({
            days: MONTH_DAYS,
            label: 'October 2026',
            monthLabel: 'October 2026',
            onEventSelect: id => announce(`Event ${id}`),
            onNavigate: direction => announce(`Calendar ${direction}`),
        }),
    )
    page.addSection({
        title: 'Calendar',
        description: 'The composed month. initialize hands the grid to the Gentelella calendar runtime, which replaces the days with its own seeded month and navigation.',
        content: [
            calendar.el,
            page.own(
                createGentelellaButton({
                    label: 'initialize()',
                    size: 'small',
                    variant: 'outline',
                    onClick: () => calendar.initialize(),
                }),
            ).el,
        ],
    })

    const thread = html`<div className="design-system-chat-thread"></div>` as HTMLElement
    const composer = page.own(
        createGentelellaChatComposer({
            placeholder: 'Write a message',
            onSend: message => {
                thread.append(
                    page.own(
                        createGentelellaChatBubble({
                            content: message,
                            mine: true,
                            time: 'now',
                        }),
                    ).el,
                )
                composer.clear()
            },
        }),
    )
    thread.append(
        page.own(
            createGentelellaChatBubble({
                author: 'Ada',
                content: 'Can you pick the hero frame?',
                time: '09:12',
            }),
        ).el,
        page.own(
            createGentelellaChatBubble({
                content: 'Frame 03 reads best at small sizes.',
                mine: true,
                time: '09:14',
            }),
        ).el,
    )
    const conversations = [
        {
            active: true,
            id: 'ada',
            initials: 'AD',
            message: 'Can you pick the hero frame?',
            name: 'Ada',
            online: true,
            time: '09:12',
        },
        {
            id: 'lin',
            initials: 'LN',
            message: 'Uploaded the wardrobe references',
            name: 'Lin',
            time: 'Yesterday',
            unreadCount: 3,
        },
        {
            id: 'mo',
            initials: 'MO',
            message: 'Thanks!',
            name: 'Mo',
            time: 'Mon',
        },
    ].map(
        conversation => page.own(
            createGentelellaChatConversation({
                ...conversation,
                onSelect: id => announce(`Conversation ${id}`),
            }),
        ).el,
    )
    page.addSection({
        title: 'Chat',
        description: 'Conversations, bubbles and the composer inside the chat layout. Send a message to append a bubble.',
        content: page.own(
            createGentelellaChatLayout({
                conversations,
                thread: [thread, composer.el],
            }),
        ).el,
    })

    const card = (
        id: string,
        title: string,
        labels: Parameters<typeof createGentelellaKanbanCard>[0]['labels'],
        description?: string,
    ): HTMLElement =>
        page.own(
            createGentelellaKanbanCard({
                assignees: page.own(
                    createGentelellaAvatarStack({
                        avatars: [{ initials: 'AD' }, {
                            background: '#a55324',
                            initials: 'LN',
                        }],
                    }),
                ).el,
                description,
                id,
                labels,
                metadata: 'Due Fri',
                title,
                onSelect: cardId => announce(`Card ${cardId}`),
            }),
        ).el
    const board = page.own(
        createGentelellaKanbanBoard({
            columns: [
                page.own(
                    createGentelellaKanbanColumn({
                        cards: [
                            card(
                                'brief',
                                'Write the brief',
                                [{
                                    color: 'blue',
                                    text: 'Docs',
                                }],
                                'Goals, audience and tone',
                            ),
                            card(
                                'refs',
                                'Collect references',
                                [{
                                    color: 'purple',
                                    text: 'Research',
                                }],
                            ),
                        ],
                        count: 2,
                        id: 'todo',
                        title: 'To do',
                        onAdd: id => announce(`Add to ${id}`),
                    }),
                ).el,
                page.own(
                    createGentelellaKanbanColumn({
                        cards: [card(
                            'frames',
                            'Generate key frames',
                            [{
                                color: 'yellow',
                                text: 'Generation',
                            }, {
                                color: 'red',
                                text: 'Urgent',
                            }],
                        )],
                        count: 1,
                        id: 'doing',
                        title: 'In progress',
                        onAdd: id => announce(`Add to ${id}`),
                    }),
                ).el,
                page.own(
                    createGentelellaKanbanColumn({
                        cards: [card(
                            'board',
                            'Share the board',
                            [{
                                color: 'green',
                                text: 'Done',
                            }],
                        )],
                        count: 1,
                        id: 'done',
                        title: 'Done',
                        onAdd: id => announce(`Add to ${id}`),
                    }),
                ).el,
            ],
        }),
    )
    page.addSection({
        title: 'Kanban',
        content: board.el,
    })

    const fileManager = page.own(
        createGentelellaFileManager({
            items: [
                ['briefs', 'folder', 'Briefs', '4 files', true],
                ['frames', 'folder', 'Key frames', '12 files', false],
                ['hero', 'file', 'hero-frame.png', '2.4 MB', true],
                ['shot-list', 'file', 'shot-list.pdf', '640 KB', false],
                ['notes', 'file', 'notes.md', '12 KB', false],
            ].map(
                ([id, kind, name, metadata, starred]) => page.own(
                    createGentelellaFileItem({
                        id: String(id),
                        kind: kind as 'file' | 'folder',
                        metadata: String(metadata),
                        name: String(name),
                        starred: Boolean(starred),
                        onSelect: itemId => announce(`Open ${itemId}`),
                    }),
                ).el,
            ),
            navigation: page.own(
                createGentelellaButton({
                    label: 'All files',
                    variant: 'ghost',
                }),
            ).el,
            storage: page.own(
                createGentelellaProgress({
                    label: '42 of 100 GB',
                    value: 42,
                }),
            ).el,
            toolbar: createShowcaseRow([
                page.own(
                    createGentelellaButton({
                        label: 'Grid',
                        size: 'small',
                        variant: 'outline',
                        onClick: () => fileManager.setView('grid'),
                    }),
                ).el,
                page.own(
                    createGentelellaButton({
                        label: 'List',
                        size: 'small',
                        variant: 'outline',
                        onClick: () => fileManager.setView('list'),
                    }),
                ).el,
            ]),
            view: 'grid',
        }),
    )
    page.onMount(() => fileManager.initialize())
    page.addSection({
        title: 'File manager',
        description: 'Folder and file items with navigation, storage and toolbar regions. setView switches between grid and list.',
        content: fileManager.el,
    })

    page.addSection({
        title: 'Notifications',
        content: page.own(
            createGentelellaNotificationList({
                items: [
                    {
                        body: 'Your video finished rendering.',
                        id: 'render',
                        kind: 'info',
                        time: '2m',
                        unread: true,
                    },
                    {
                        body: 'Ada mentioned you on the moodboard.',
                        from: 'Ada',
                        id: 'mention',
                        kind: 'mention',
                        time: '1h',
                        unread: true,
                    },
                    {
                        body: 'Review three candidates before Friday.',
                        id: 'task',
                        kind: 'task',
                        time: 'Yesterday',
                    },
                    {
                        body: 'Storage is 90% full.',
                        id: 'alert',
                        kind: 'alert',
                        time: 'Mon',
                    },
                ],
                onSelect: id => announce(`Notification ${id}`),
            }),
        ).el,
    })

    page.addSection({
        title: 'Settings',
        content: page.own(
            createGentelellaSettingsSection({
                actions: page.own(
                    createGentelellaButton({
                        label: 'Save',
                        variant: 'primary',
                    }),
                ).el,
                description: 'Rows pair a label and description with any control.',
                rows: [
                    page.own(
                        createGentelellaSettingsRow({
                            control: page.own(
                                createGentelellaSwitch({
                                    checked: true,
                                    label: 'Enabled',
                                }),
                            ).el,
                            description: 'Show a notification when a generation finishes.',
                            label: 'Completion alerts',
                        }),
                    ).el,
                    page.own(
                        createGentelellaSettingsRow({
                            control: page.own(
                                createGentelellaSwitch({
                                    label: 'Enabled',
                                }),
                            ).el,
                            label: 'Weekly digest',
                        }),
                    ).el,
                ],
                title: 'Notifications',
            }),
        ).el,
    })

    const inbox = page.own(
        createGentelellaInboxRoot(),
    )
    page.onMount(() => void inbox.initialize())
    page.addSection({
        title: 'Inbox',
        description: 'The inbox root is a host for the Gentelella inbox runtime, which renders the complete inbox with its seeded messages.',
        content: inbox.el,
    })

    return page
}
