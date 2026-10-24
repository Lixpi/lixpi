// Entry page for the components mode: the packages this site covers and the
// Gentelella inventory that the package keeps in sync with upstream.

import {
    GENTELELLA_CHART_TYPES,
    GENTELELLA_COMPONENT_FAMILIES,
    GENTELELLA_COMPONENT_SOURCE_PAGES,
    GENTELELLA_STYLE_MODULES,
    GENTELELLA_THEME_TOKENS,
} from '@lixpi/ui-kit-gentelella/inventory'
import { GENTELELLA_RUNTIME_MODULES } from '@lixpi/ui-kit-gentelella/runtime'
import { createGentelellaChip } from '@lixpi/ui-kit-gentelella/components/chip'
import { createGentelellaListGroup } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaStat } from '@lixpi/ui-kit-gentelella/components/widgets'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    createShowcaseRow,
} from '$src/views/showcase/showcasePage.ts'

const PACKAGES = [
    ['@lixpi/ui-primitives', 'DOM templates, SVG utilities, gradients, easing and Sass transitions shared by every browser package.'],
    ['@lixpi/ui-kit', 'Lixpi controls, overlays, panels, progress views, media controls and the icon catalog. D3 SVG controls and DOM components.'],
    ['@lixpi/ui-kit-gentelella', 'Gentelella admin theme components, class contracts and focused runtime modules, used by the portal and registry.'],
    ['@lixpi/canvas-engine', 'Scene geometry, rendering, viewport input, selection and connectors. Shown in canvas mode.'],
    ['@lixpi/canvas-components', 'Canvas media surfaces, traveling outlines, glass effects and the loading surface. Shown in canvas mode.'],
    ['@lixpi/canvas-components-lixpi-specific', 'The Lixpi workspace canvas: renderer, nodes, chrome, menus, progress and panels. Shown in canvas mode.'],
] as const

export const createOverviewPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: 'Lixpi design system',
        title: 'Overview',
        description: 'Every page renders the shared UI packages from packages/lixpi with their real factories and styles. Use the Mode switch in the sidebar to move between regular components and canvas items.',
    })

    const packages = page.own(
        createGentelellaListGroup({
            ariaLabel: 'Packages',
            items: PACKAGES.map(
                ([name, description]) => ({
                    content: `${name}: ${description}`,
                    value: name,
                }),
            ),
        }),
    )
    page.addSection({
        title: 'Packages',
        description: 'Components mode covers the first three packages. Canvas mode covers the canvas packages.',
        content: packages.el,
    })

    const stats = [
        ['Component families', GENTELELLA_COMPONENT_FAMILIES.length, 'teal'],
        ['Chart variants', GENTELELLA_CHART_TYPES.length, 'blue'],
        ['Runtime modules', Object.keys(GENTELELLA_RUNTIME_MODULES).length, 'purple'],
        ['Sass layers', GENTELELLA_STYLE_MODULES.length, 'green'],
        ['Theme tokens', GENTELELLA_THEME_TOKENS.length, 'yellow'],
        ['Upstream demo pages', GENTELELLA_COMPONENT_SOURCE_PAGES.length, 'pink'],
    ] as const
    page.addSection({
        title: 'Gentelella inventory',
        description: 'The package records the upstream contract in its inventory module. These counts come from that module.',
        columns: 3,
        content: stats.map(
            ([label, value, color]) => page.own(
                createGentelellaStat({
                    color,
                    label,
                    value,
                }),
            ).el,
        ),
    })

    const chipRow = (values: readonly string[]): HTMLElement => createShowcaseRow(
        values.map(
            value => page.own(
                createGentelellaChip({ label: value }),
            ).el,
        ),
    )
    page.addSection({
        title: 'Component families',
        content: chipRow(GENTELELLA_COMPONENT_FAMILIES),
    })
    page.addSection({
        title: 'Runtime modules and Sass layers',
        content: [
            chipRow(
                Object.keys(GENTELELLA_RUNTIME_MODULES),
            ),
            chipRow(GENTELELLA_STYLE_MODULES),
        ],
    })
    page.addSection({
        title: 'Upstream demo pages',
        description: 'These pages are sync fixtures, not page templates. The component pages here cover their reusable parts.',
        content: chipRow(GENTELELLA_COMPONENT_SOURCE_PAGES),
    })

    return page
}
