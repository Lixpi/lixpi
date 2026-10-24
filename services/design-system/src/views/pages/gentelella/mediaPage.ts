// Gentelella media: the upstream icon catalog, single icons and media tiles.

import {
    GENTELELLA_ICONS,
    createGentelellaIcon,
    createGentelellaIconCatalog,
    createGentelellaMediaTile,
    type GentelellaIconName,
} from '@lixpi/ui-kit-gentelella/components/media'
import { createGentelellaBadge } from '@lixpi/ui-kit-gentelella/components/foundation'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DEMO_PALETTES,
    DemoMedia,
} from '$src/fixtures/demoMedia.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseRow,
} from '$src/views/showcase/showcasePage.ts'

export const createGentelellaMediaPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/media',
        title: 'Icons and media',
        description: 'The Gentelella icon set drives the navigation icons on this site. Lixpi product icons live in the UI-kit catalog.',
    })
    const media = page.own(
        new DemoMedia(),
    )
    const names = Object.keys(GENTELELLA_ICONS) as GentelellaIconName[]

    page.addSection({
        title: `Icon catalog (${names.length})`,
        description: 'Select an icon to copy its name.',
        content: page.own(
            createGentelellaIconCatalog({
                onSelect: name => {
                    void navigator.clipboard?.writeText(name)
                    announce(`Copied ${name}`)
                },
            }),
        ).el,
    })

    page.addSection({
        title: 'Single icons',
        description: 'Decorative by default, or labelled with role img.',
        content: createShowcaseRow([
            ...names.slice(0, 8).map(
                name => page.own(
                    createGentelellaIcon({ name }),
                ).el,
            ),
            page.own(
                createGentelellaIcon({
                    label: 'Settings',
                    name: 'settings',
                }),
            ).el,
        ]),
    })

    const palettes = Object.entries(DEMO_PALETTES)
    const tiles = palettes.map(
        ([name, colors], index) => page.own(
            createGentelellaMediaTile({
                badge: index === 0 ? page.own(
                    createGentelellaBadge({
                        content: 'New',
                        tone: 'teal',
                    }),
                ).el : undefined,
                id: name,
                imageAlt: `${name} gradient`,
                imageSrc: media.createImageCanvas({
                    colors: [...colors],
                    height: 300,
                    width: 400,
                }).toDataURL('image/png'),
                metadata: '400 × 300 · PNG',
                title: `${name[0].toUpperCase()}${name.slice(1)} frame`,
                onSelect: id => announce(`Open ${id}`),
            }),
        ).el,
    )
    page.addSection({
        title: 'Media tiles',
        columns: 4,
        content: tiles,
    })

    return page
}
