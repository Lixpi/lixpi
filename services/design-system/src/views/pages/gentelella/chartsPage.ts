// Every Gentelella ECharts variant, the chart header with tabs and the map
// integration host. ECharts loads on demand when the page initializes charts.

import {
    createGentelellaChart,
    createGentelellaChartHeader,
    createGentelellaMapHost,
} from '@lixpi/ui-kit-gentelella/components/chart'
import { GENTELELLA_CHART_TYPES } from '@lixpi/ui-kit-gentelella/inventory'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/gentelella/gentelella-pages.scss'

export const createGentelellaChartsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/chart',
        title: 'Charts and maps',
        description: `All ${GENTELELLA_CHART_TYPES.length} chart hosts. The Gentelella runtime draws each one with its built-in demo series and the current theme tokens.`,
    })
    const charts = GENTELELLA_CHART_TYPES.map(
        type => page.own(
            createGentelellaChart({
                ariaLabel: `${type} chart`,
                height: 240,
                type,
            }),
        ),
    )
    page.onMount(() => void charts[0]?.initialize())

    const header = page.own(
        createGentelellaChartHeader({
            activeValue: 'week',
            stat: html`<strong>12,480</strong>`,
            subtitle: 'Sessions across every workspace',
            tabs: [{
                label: 'Day',
                value: 'day',
            }, {
                label: 'Week',
                value: 'week',
            }, {
                label: 'Month',
                value: 'month',
            }],
            title: 'Traffic',
            onTabChange: value => {
                header.setActiveValue(value)
                announce(`Range ${value}`)
            },
        }),
    )
    page.addSection({
        title: 'Chart header',
        content: page.own(
            createGentelellaCard({
                content: [header.el, charts[GENTELELLA_CHART_TYPES.indexOf('revenue-line')].el],
            }),
        ).el,
    })

    page.addSection({
        title: 'Chart variants',
        columns: 2,
        content: GENTELELLA_CHART_TYPES
            .map(
                (type, index) => ({
                    chart: charts[index],
                    type,
                }),
            )
            .filter(({ type }) => type !== 'revenue-line')
            .map(
                ({
                    chart,
                    type,
                }) => page.own(
                    createGentelellaCard({
                        content: chart.el,
                        title: type,
                    }),
                ).el,
            ),
    })

    const map = page.own(
        createGentelellaMapHost({
            ariaLabel: 'Integration map host',
            height: 220,
            id: 'design-system-map',
            onMount: element => void element.append(
                html`<p className="design-system-map-note">onMount received the host element. A map library mounts here.</p>`,
            ),
        }),
    )
    page.onMount(() => map.mount())
    page.addSection({
        title: 'Map host',
        description: 'The map host sizes and labels the region and hands it to the caller through onMount.',
        content: map.el,
    })

    return page
}
