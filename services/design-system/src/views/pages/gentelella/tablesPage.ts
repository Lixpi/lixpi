// Gentelella tables: the static table roots and the typed data table that the
// DataTables runtime enhances with sorting, paging, selection and export.

import { createGentelellaTable } from '@lixpi/ui-kit-gentelella/components/table'
import {
    createGentelellaCustomerCell,
    createGentelellaDataTable,
    type GentelellaDataTableColumn,
} from '@lixpi/ui-kit-gentelella/components/data-table'
import { createGentelellaStatus } from '@lixpi/ui-kit-gentelella/components/status'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'

type ModelRow = {
    color: string
    initials: string
    modality: string
    name: string
    price: number
    provider: string
    status: 'Available' | 'Deprecated' | 'Preview'
}

const ROWS: ModelRow[] = [
    ['Claude', 'Anthropic', 'Text', 3, 'Available', '#d97757'],
    ['GPT Image 1', 'OpenAI', 'Image', 4, 'Available', '#10a37f'],
    ['Nano Banana Pro', 'Google', 'Image', 2.5, 'Preview', '#4285f4'],
    ['Veo 3', 'Google', 'Video', 12, 'Available', '#4285f4'],
    ['Stable Image Ultra', 'Stability', 'Image', 8, 'Deprecated', '#8e44ad'],
    ['Seedance 2.0', 'ByteDance', 'Video', 10, 'Preview', '#325ab4'],
    ['Gemini', 'Google', 'Text', 1.25, 'Available', '#4285f4'],
].map(
    ([name, provider, modality, price, status, color]) => ({
        color: String(color),
        initials: String(name).slice(0, 2).toUpperCase(),
        modality: String(modality),
        name: String(name),
        price: Number(price),
        provider: String(provider),
        status: status as ModelRow['status'],
    }),
)

const STATUS_TONES = {
    Available: 'green',
    Deprecated: 'red',
    Preview: 'yellow',
} as const

const createStaticRows = (): HTMLElement[] => [
    html`
        <thead>
            <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Modality</th>
            </tr>
        </thead>
    `,
    html`
        <tbody>${ROWS.slice(0, 4).map(
            row => html`
                <tr>
                    <td>${row.name}</td>
                    <td>${row.provider}</td>
                    <td>${row.modality}</td>
                </tr>
            `,
        )}</tbody>
    `,
]

export const createGentelellaTablesPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/table · /data-table',
        title: 'Tables',
        description: 'Static tables use the theme table root. The data table renders typed columns and lets the DataTables runtime add sorting, paging and export once mounted.',
    })

    const responsive = page.own(
        createGentelellaTable({ responsive: true }),
    )
    responsive.tableEl.append(...createStaticRows())
    const plain = page.own(
        createGentelellaTable({ responsive: false }),
    )
    plain.tableEl.append(...createStaticRows())
    page.addSection({
        title: 'Static tables',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: responsive.el,
                label: 'responsive: true',
            }),
            createShowcaseSpecimen({
                content: plain.el,
                label: 'responsive: false',
            }),
        ],
    })

    const columns: GentelellaDataTableColumn<ModelRow>[] = [
        {
            header: 'Model',
            render: row => page.own(
                createGentelellaCustomerCell({
                    avatarColor: row.color,
                    initials: row.initials,
                    name: row.name,
                }),
            ).el,
        },
        {
            header: 'Provider',
            render: row => row.provider,
        },
        {
            header: 'Modality',
            render: row => row.modality,
        },
        {
            align: 'right',
            header: 'Price per 1M',
            render: row => `$${row.price.toFixed(2)}`,
        },
        {
            align: 'center',
            header: 'Status',
            orderable: false,
            render: row => page.own(
                createGentelellaStatus({
                    label: row.status,
                    tone: STATUS_TONES[row.status],
                }),
            ).el,
        },
    ]
    const table = page.own(
        createGentelellaDataTable<ModelRow>({
            ariaLabel: 'Models',
            columns,
            exportName: 'models',
            getRowId: row => row.name,
            pageLength: 5,
            responsive: true,
            rows: ROWS,
            selectable: true,
            onSelectionChange: ids => announce(`${ids.length} selected`),
        }),
    )
    page.onMount(() => void table.initialize())
    page.addSection({
        title: 'Data table',
        description: 'Selectable rows, a page length of five, export and per-column alignment. Status is not orderable.',
        content: [
            table.el,
            page.own(
                createGentelellaButton({
                    label: 'getSelectedIds()',
                    size: 'small',
                    variant: 'outline',
                    onClick: () => announce(`Selected: ${table.getSelectedIds().join(', ') || 'none'}`),
                }),
            ).el,
        ],
    })

    const simple = page.own(
        createGentelellaDataTable<ModelRow>({
            ariaLabel: 'Available models',
            columns: columns.slice(1, 4),
            rows: ROWS.filter(row => row.status === 'Available'),
        }),
    )
    page.addSection({
        title: 'Plain data table and setRows',
        description: 'Without selection or paging options. setRows replaces the rendered rows.',
        content: [
            simple.el,
            page.own(
                createGentelellaButton({
                    label: 'Show every model',
                    size: 'small',
                    variant: 'outline',
                    onClick: () => simple.setRows(ROWS),
                }),
            ).el,
        ],
    })

    return page
}
