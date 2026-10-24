// Gentelella admin surfaces: contacts, projects, profile summaries, FAQs and
// integrations, plus the runtime detail modals for contacts and projects.

import {
    createGentelellaContactCard,
    createGentelellaFaqList,
    createGentelellaIntegrationCard,
    createGentelellaProfileSummary,
    createGentelellaProjectCard,
    openGentelellaContactDetails,
    openGentelellaProjectDetails,
} from '@lixpi/ui-kit-gentelella/components/admin'
import { createGentelellaAvatar } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaStatus } from '@lixpi/ui-kit-gentelella/components/status'
import { createGentelellaSwitch } from '@lixpi/ui-kit-gentelella/components/form-controls'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { ShowcasePage } from '$src/views/showcase/showcasePage.ts'

const CONTACTS = [
    ['Ada Byron', 'AB', 'blue', 'Art director', 12, 34, 8],
    ['Lin Park', 'LP', 'green', 'Producer', 7, 18, 3],
    ['Mo Reyes', 'MR', 'purple', 'Illustrator', 4, 9, 14],
] as const

const PROJECTS = [
    {
        client: 'Northwind',
        description: 'Key art and social cut-downs for the spring launch.',
        due: '14 Nov',
        progress: 64,
        status: ['In progress', 'blue'],
        title: 'Spring campaign',
    },
    {
        client: 'Contoso',
        description: 'Character sheets for the pilot episode.',
        due: '2 Dec',
        progress: 20,
        status: ['Planning', 'yellow'],
        title: 'Pilot characters',
    },
    {
        client: 'Fabrikam',
        description: 'Product renders for the catalog refresh.',
        due: 'Done',
        progress: 100,
        status: ['Complete', 'green'],
        title: 'Catalog renders',
    },
] as const

export const createGentelellaAdminPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/admin',
        title: 'Admin',
        description: 'Select a contact or project card to open its Gentelella detail modal.',
    })

    page.addSection({
        title: 'Contact cards',
        columns: 3,
        content: CONTACTS.map(
            ([name, initials, color, role, projects, tasks, messages]) => page.own(
                createGentelellaContactCard({
                    actions: page.own(
                        createGentelellaButton({
                            label: 'Message',
                            size: 'small',
                            variant: 'outline',
                        }),
                    ).el,
                    avatar: page.own(
                        createGentelellaAvatar({
                            background: `var(--${color})`,
                            initials,
                            size: 'large',
                        }),
                    ).el,
                    channels: [{
                        label: 'Email',
                        value: `${name.split(' ')[0].toLowerCase()}@studio.com`,
                    }],
                    id: initials,
                    name,
                    role,
                    statistics: [{
                        label: 'Projects',
                        value: projects,
                    }, {
                        label: 'Tasks',
                        value: tasks,
                    }],
                    onSelect: () => openGentelellaContactDetails({
                        color,
                        ini: initials,
                        msgs: messages,
                        name,
                        projects,
                        role,
                        tasks,
                    }),
                }),
            ).el,
        ),
    })

    page.addSection({
        title: 'Project cards',
        columns: 3,
        content: PROJECTS.map(
            project => page.own(
                createGentelellaProjectCard({
                    client: project.client,
                    description: project.description,
                    dueDate: project.due,
                    id: project.title,
                    members: [{ initials: 'AB' }, {
                        background: '#a55324',
                        initials: 'LP',
                    }],
                    progress: project.progress,
                    status: page.own(
                        createGentelellaStatus({
                            label: project.status[0],
                            tone: project.status[1],
                        }),
                    ).el,
                    title: project.title,
                    onSelect: () => openGentelellaProjectDetails({
                        client: project.client,
                        desc: project.description,
                        due: project.due,
                        // Gentelella 4.2 types members as objects, but its modal reads
                        // each entry as member initials. Pass what the runtime renders.
                        members: ['AB', 'LP'] as unknown as Parameters<typeof openGentelellaProjectDetails>[0]['members'],
                        pct: project.progress,
                        sCls: project.status[1],
                        status: project.status[0],
                        title: project.title,
                    }),
                }),
            ).el,
        ),
    })

    page.addSection({
        title: 'Profile summary',
        content: page.own(
            createGentelellaProfileSummary({
                actions: page.own(
                    createGentelellaButton({
                        label: 'Edit profile',
                        variant: 'primary',
                    }),
                ).el,
                avatar: page.own(
                    createGentelellaAvatar({
                        initials: 'AB',
                        size: 'extra-large',
                        status: 'online',
                    }),
                ).el,
                metadata: [{
                    label: 'Member since',
                    value: 'March 2025',
                }, {
                    label: 'Workspaces',
                    value: 9,
                }, {
                    label: 'Location',
                    value: 'Lisbon',
                }],
                name: 'Ada Byron',
                role: 'Art director',
            }),
        ).el,
    })

    page.addSection({
        title: 'FAQ',
        content: page.own(
            createGentelellaFaqList({
                items: [
                    {
                        answer: 'Each workspace keeps its own canvases, documents and media.',
                        id: 'workspaces',
                        question: 'How are workspaces separated?',
                    },
                    {
                        answer: html`<p>Accepted outputs stay in the workspace. Rejected ones are removed from it.</p>`,
                        id: 'review',
                        question: 'What happens when I reject a variant?',
                    },
                    {
                        answer: 'Yes. Organization members can open shared Assets.',
                        id: 'sharing',
                        question: 'Can my team see my Assets?',
                    },
                ],
            }),
        ).el,
    })

    page.addSection({
        title: 'Integration cards',
        columns: 3,
        content: [
            page.own(
                createGentelellaIntegrationCard({
                    action: page.own(
                        createGentelellaSwitch({
                            checked: true,
                            label: 'Connected',
                        }),
                    ).el,
                    connected: true,
                    description: 'Sync shared folders into the media library.',
                    icon: html`<span innerHTML=${GENTELELLA_ICONS.files}></span>`,
                    name: 'Drive',
                }),
            ).el,
            page.own(
                createGentelellaIntegrationCard({
                    action: page.own(
                        createGentelellaButton({
                            label: 'Connect',
                            size: 'small',
                            variant: 'outline',
                        }),
                    ).el,
                    description: 'Post review requests to a channel.',
                    icon: html`<span innerHTML=${GENTELELLA_ICONS.chat}></span>`,
                    name: 'Chat',
                }),
            ).el,
            page.own(
                createGentelellaIntegrationCard({
                    description: 'Card without an action.',
                    name: 'Calendar',
                }),
            ).el,
        ],
    })

    return page
}
