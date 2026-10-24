// The UI-kit artwork catalog from @lixpi/ui-kit/svg. Every SVG string the
// catalog exports is rendered, so new icons appear here without a page change.

import * as uiKitSvg from '@lixpi/ui-kit/svg'
import { createCollapseExpandIcon } from '@lixpi/ui-kit/svg/animated'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/uiKit/icons.scss'

const isSvgMarkup = (value: unknown): value is string => typeof value === 'string' && value.trimStart().startsWith('<svg')

export const getUiKitSvgCatalog = (): Array<[string, string]> =>
    Object.entries(uiKitSvg).filter((entry): entry is [string, string] => isSvgMarkup(entry[1]))
        .sort(([left], [right]) => left.localeCompare(right))

const createIconTile = (
    name: string,
    markup: string,
): HTMLElement =>
    html`
        <figure className="design-system-icon-tile">
            <span
                className="design-system-icon-glyph"
                innerHTML=${markup}
            ></span>
            <figcaption className="design-system-icon-name">${name}</figcaption>
        </figure>
    ` as HTMLElement

export const createIconsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit/svg',
        title: 'Icons and artwork',
        description: 'Components inject these icons through innerHTML or appendSvgPathIcon. Icons inherit currentColor where their artwork allows it.',
    })
    const catalog = getUiKitSvgCatalog()

    page.addSection({
        title: `Icon catalog (${catalog.length})`,
        content: html`
            <div className="design-system-icon-grid">${catalog.map(([name, markup]) => createIconTile(name, markup))}</div>
        `,
    })
    page.addSection({
        title: 'On a dark surface',
        description: 'The same catalog under the canvas chrome color, where icons drawn with currentColor switch to the light foreground.',
        content: createShowcaseSpecimen({
            content: html`
                <div className="design-system-icon-grid design-system-icon-grid-compact">${catalog.map(
                    ([name, markup]) => createIconTile(name, markup),
                )}</div>
            `,
            label: 'color: #f4f6fa',
            surface: 'dark',
        }),
    })

    const collapsed = page.own(
        createCollapseExpandIcon({ state: 'collapsed' }),
    )
    const expanded = page.own(
        createCollapseExpandIcon({ state: 'expanded' }),
    )
    const toggled = page.own(
        createCollapseExpandIcon({
            className: 'design-system-animated-icon',
            state: 'collapsed',
        }),
    )
    const toggle = (animate: boolean): void => void toggled.setState(toggled.getState() === 'collapsed' ? 'expanded' : 'collapsed', { animate })
    page.addSection({
        title: 'Animated collapse and expand icon',
        description: 'createCollapseExpandIcon is the UI-kit icon built on AnimatedSvgIcon from UI primitives. Collapsed content shows outward chevrons; expanded content shows inward ones.',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: collapsed.element,
                label: "state: 'collapsed'",
            }),
            createShowcaseSpecimen({
                content: expanded.element,
                label: "state: 'expanded'",
            }),
            createShowcaseSpecimen({
                content: createShowcaseRow([
                    toggled.element,
                    page.own(
                        createGentelellaButton({
                            label: 'Animate',
                            onClick: () => toggle(true),
                            size: 'small',
                            variant: 'primary',
                        }),
                    ).el,
                    page.own(
                        createGentelellaButton({
                            label: 'Jump',
                            onClick: () => toggle(false),
                            size: 'small',
                            variant: 'outline',
                        }),
                    ).el,
                ]),
                label: 'setState(next, { animate })',
            }),
        ],
    })

    page.addSection({
        title: 'Structured artwork',
        description: 'Some artwork is data rather than markup. The progress ripple and video controls consume these objects; their pages render them.',
        content: page.own(
            createGentelellaCode({
                code: [
                    `progressRippleArtwork.viewBox = ${JSON.stringify(uiKitSvg.progressRippleArtwork.viewBox)}`,
                    `progressRippleArtwork.paths = ${uiKitSvg.progressRippleArtwork.paths.length} layers`,
                    `videoControlIcons = { ${Object.keys(uiKitSvg.videoControlIcons).join(', ')} }`,
                ].join('\n'),
            }),
        ).el,
    })

    return page
}
