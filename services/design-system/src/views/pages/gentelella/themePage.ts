// Gentelella theme tokens, leased theme previews and swatches, and the class
// contract that dynamic markup builds from instead of raw class strings.

import {
    applyGentelellaTheme,
    createGentelellaThemePreview,
    createGentelellaThemeSwatches,
    type GentelellaThemeSwatch,
} from '@lixpi/ui-kit-gentelella/components/theme'
import { GENTELELLA_THEME_TOKENS } from '@lixpi/ui-kit-gentelella/inventory'
import {
    combineGentelellaClassNames,
    gentelellaBannerClassName,
    gentelellaButtonClassName,
    gentelellaClasses,
    gentelellaSpinnerClassName,
    gentelellaStatusClassName,
    gentelellaTabClassName,
} from '@lixpi/ui-kit-gentelella/class-names'
import {
    GentelellaElementComponent,
    createGentelellaComponentInstance,
    createGentelellaElement,
} from '@lixpi/ui-kit-gentelella/component'
import { appendGentelellaContent } from '@lixpi/ui-kit-gentelella/content'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaTable } from '@lixpi/ui-kit-gentelella/components/table'
import { createGentelellaStatus } from '@lixpi/ui-kit-gentelella/components/status'
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
import '$src/views/pages/gentelella/theme.scss'

const SWATCHES: GentelellaThemeSwatch[] = [
    {
        color: '#2a9d8f',
        label: 'Teal',
        values: {
            '--primary': '#2a9d8f',
            '--primary-dk': '#21867a',
            '--primary-lt': '#d4efec',
        },
    },
    {
        color: '#3d649c',
        label: 'Steel',
        values: {
            '--primary': '#3d649c',
            '--primary-dk': '#2f4f7d',
            '--primary-lt': '#dde6f3',
        },
    },
    {
        color: '#a55324',
        label: 'Rust',
        values: {
            '--primary': '#a55324',
            '--primary-dk': '#86421c',
            '--primary-lt': '#f6e3d8',
        },
    },
    {
        color: '#6d4fb2',
        label: 'Violet',
        values: {
            '--primary': '#6d4fb2',
            '--primary-dk': '#583f93',
            '--primary-lt': '#e7e0f6',
            '--radius': '14px',
        },
    },
]

const isColorToken = (token: string): boolean => !/(font|line-height|radius|space|shadow|sidebar-w|weight|size)/.test(token)

class ThemeTokenTable {
    readonly element: HTMLElement

    private readonly table = createGentelellaTable({ responsive: true })
    private readonly body = html`<tbody></tbody>` as HTMLTableSectionElement

    constructor() {
        this.table.tableEl.append(
            html`
                <thead>
                    <tr>
                        <th>Token</th>
                        <th>Current value</th>
                        <th>Sample</th>
                    </tr>
                </thead>
            `,
            this.body,
        )
        this.element = this.table.el
    }

    // Values depend on the light or dark theme, so they are read after mounting
    // and again when the theme attribute changes.
    refresh(): void {
        const styles = getComputedStyle(this.element.ownerDocument.documentElement)
        this.body.replaceChildren(
            ...GENTELELLA_THEME_TOKENS.map(token => {
                const value = styles.getPropertyValue(token).trim()
                const sample = html`<span className="design-system-token-sample"></span>` as HTMLElement

                if (isColorToken(token))
                    sample.style.setProperty('background', `var(${token})`)
                else
                    sample.textContent = '—'

                return html`
                    <tr>
                        <td><code>${token}</code></td>
                        <td><code>${value}</code></td>
                        <td>${sample}</td>
                    </tr>
                `
            }),
        )
    }

    destroy(): void {
        this.table.destroy()
    }
}

export const createGentelellaThemePage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/theme · /class-names',
        title: 'Theme and classes',
        description: 'Every public Gentelella custom property, previews that lease token overrides to a subtree, and the class-name contract.',
    })

    const previewContent = (): HTMLElement[] => [
        page.own(
            createGentelellaButton({
                label: 'Primary action',
                variant: 'primary',
            }),
        ).el,
        page.own(
            createGentelellaStatus({
                label: 'Status',
                tone: 'green',
            }),
        ).el,
        page.own(
            createGentelellaCard({
                content: 'Cards inside the preview use the leased tokens.',
                title: 'Preview card',
            }),
        ).el,
    ]
    const preview = page.own(
        createGentelellaThemePreview({ content: previewContent() }),
    )
    const swatches = page.own(
        createGentelellaThemeSwatches({
            swatches: SWATCHES,
            onChange: swatch => {
                preview.setValues(swatch.values)
                announce(`Preview theme ${swatch.label}`)
            },
        }),
    )
    const applied = html`<div className="design-system-theme-applied"></div>` as HTMLElement
    appendGentelellaContent(
        applied,
        previewContent(),
    )
    applyGentelellaTheme(applied, SWATCHES[2].values)
    page.addSection({
        title: 'Theme preview and swatches',
        description: 'Picking a swatch leases its tokens to the preview subtree. applyGentelellaTheme writes tokens permanently to an element.',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [swatches.el, preview.el],
                label: 'createGentelellaThemeSwatches with createGentelellaThemePreview',
            }),
            createShowcaseSpecimen({
                content: applied,
                label: 'applyGentelellaTheme(element, rust values)',
            }),
        ],
    })

    const tokens = page.own(
        new ThemeTokenTable(),
    )
    const observer = new MutationObserver(() => tokens.refresh())
    page.onMount(() => {
        tokens.refresh()
        observer.observe(
            document.documentElement,
            {
                attributeFilter: ['data-theme'],
                attributes: true,
            },
        )
    })
    page.own({ destroy: () => observer.disconnect() })
    page.addSection({
        title: `Theme tokens (${GENTELELLA_THEME_TOKENS.length})`,
        description: 'Values follow the light and dark theme switch in the sidebar.',
        content: tokens.element,
    })

    const rawButton = createGentelellaElement(
        'button',
        gentelellaButtonClassName({
            size: 'small',
            variant: 'success',
        }),
        {
            attributes: { type: 'button' },
            content: 'Built from gentelellaButtonClassName',
        },
    )
    const rawBanner = createGentelellaElement(
        'div',
        gentelellaBannerClassName({ variant: 'warning' }),
        { content: 'Built from gentelellaBannerClassName' },
    )
    const rawStatus = createGentelellaElement(
        'span',
        gentelellaStatusClassName({ tone: 'blue' }),
        { content: 'gentelellaStatusClassName' },
    )
    const rawSpinner = createGentelellaElement(
        'span',
        gentelellaSpinnerClassName({
            dots: true,
            tone: 'azure',
        }),
        { trustedInnerHtml: '<span></span><span></span><span></span>' },
    )
    const tabStrip = createGentelellaElement(
        'div',
        gentelellaClasses.tabs.underline,
        {
            content: ['Active tab', 'Inactive tab'].map(
                (label, index) => createGentelellaElement(
                    'button',
                    gentelellaTabClassName(index === 0),
                    {
                        attributes: { type: 'button' },
                        content: label,
                    },
                ),
            ),
        },
    )
    const instances = [rawButton, rawBanner, rawStatus, rawSpinner, tabStrip].map(
        element => page.own(
            createGentelellaComponentInstance(element),
        ),
    )
    const manual = page.own(
        new GentelellaElementComponent(
            createGentelellaElement(
                'div',
                combineGentelellaClassNames(gentelellaClasses.card.base, 'design-system-theme-manual-card'),
                { content: 'GentelellaElementComponent wraps an element in the same instance API.' },
            ),
        ),
    )
    page.addSection({
        title: 'Class contract',
        description: 'Small dynamic fragments use the class builders and createGentelellaElement instead of copying theme class strings.',
        content: [
            createShowcaseRow(
                instances.map(instance => instance.el),
            ),
            manual.el,
            page.own(
                createGentelellaCode({
                    code: [
                        `gentelellaButtonClassName({ variant: 'success', size: 'small' }) = '${gentelellaButtonClassName({
                            size: 'small',
                            variant: 'success',
                        })}'`,
                        `gentelellaBannerClassName({ variant: 'warning' }) = '${gentelellaBannerClassName({ variant: 'warning' })}'`,
                        `gentelellaStatusClassName({ tone: 'blue' }) = '${gentelellaStatusClassName({ tone: 'blue' })}'`,
                        `gentelellaTabClassName(true) = '${gentelellaTabClassName(true)}'`,
                        `combineGentelellaClassNames('card', false, 'card') = '${combineGentelellaClassNames(
                            'card',
                            false,
                            'card',
                        )}'`,
                        `Object.keys(gentelellaClasses) = ${Object.keys(gentelellaClasses).length} component groups`,
                    ].join('\n'),
                }),
            ).el,
        ],
    })

    return page
}
