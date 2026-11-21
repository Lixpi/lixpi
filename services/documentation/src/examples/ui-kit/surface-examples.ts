import {
    createApplicationPanel,
    type ApplicationPanelInstance,
} from '@lixpi/ui-kit/components/application-panel'
import {
    type SidePanelSide,
} from '@lixpi/ui-kit/components/side-panel'
import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import {
    createBlockCardTilesList,
    type BlockCardTileItem,
} from '@lixpi/ui-kit/components/block-card-tiles-list'
import {
    lixpiLogo,
    trashBinIcon,
} from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

type PanelPlacement = 'push' | 'overlay'

const createApplicationPanelExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createApplicationPanel is the panel every Lixpi application docks on its left or right: the web UI navigation and conversation panels and the navigation and inspector around this page. The frame below contains its fixed layers, so the panel docks to the frame instead of the window. Hosts choose only the side, the placement and the content; the look comes from uiKitSettings.applicationPanel, which no application overrides.',
    )
    const frame = html`<div className="documentation-ui-frame"></div>` as HTMLElement
    const content = html`
        <div className="documentation-ui-frame-content documentation-ui-docked-content">
            <p>The content beside the panel. A pushed panel shrinks it; an overlay panel covers it.</p>
        </div>
    ` as HTMLElement
    frame.append(content)
    example.specimen('Panel', frame)
    let side: SidePanelSide = 'left'
    let placement: PanelPlacement = 'push'
    const mount = (): ApplicationPanelInstance => {
        const panel = createApplicationPanel({
            container: frame,
            content,
            side,
            label: 'Example panel',
            open: true,
            placement,
            onResizeEnd: width => example.frame.report(`Resized to ${Math.round(width)} pixels.`),
            onOpenChange: open => {
                void panel.setOpen(open)
                example.frame.report(open ? 'The panel is open.' : 'The panel is closed.')
            },
        })
        panel.body.append(
            html`
                <button
                    type="button"
                    className="navigation-side-panel-row navigation-side-panel-row-active"
                ><span className="navigation-side-panel-row-title">Autumn launch</span></button>
            ` as HTMLElement,
            html`
                <button
                    type="button"
                    className="navigation-side-panel-row"
                ><span className="navigation-side-panel-row-title">Product photography</span></button>
            ` as HTMLElement,
        )

        return panel
    }
    let panel = mount()
    example.own(() => panel.destroy())
    const rebuild = (): void => {
        panel.destroy()
        panel = mount()
    }
    example.frame.select(
        'Side',
        side,
        {
            left: 'Left',
            right: 'Right',
        },
        value => {
            side = value as SidePanelSide
            rebuild()
        },
    )
    example.frame.select(
        'Placement',
        placement,
        {
            push: 'Push',
            overlay: 'Overlay',
        },
        value => {
            placement = value as PanelPlacement
            rebuild()
        },
    )
    example.frame.button('Open', () => void panel.setOpen(true))
    example.frame.button('Close', () => void panel.setOpen(false))
    example.frame.code(
        () => [
            "import { createApplicationPanel } from '@lixpi/ui-kit/components/application-panel'",
            "import '@lixpi/ui-kit/styles/side-panel'",
            "import '@lixpi/ui-kit/styles/action-panel'",
            "import '@lixpi/ui-kit/styles/application-panel'",
            '',
            'const panel = createApplicationPanel({',
            '    container: root,',
            '    content: mainPane,',
            `    side: '${side}',`,
            "    label: 'Navigation',",
            '    open: true,',
            `    placement: '${placement}',`,
            '})',
            'panel.body.append(navigationList)',
            '',
            '// mainPane CSS: margin-inline-start: var(--application-panel-left-dock-width, 0px)',
        ].join('\n'),
    )

    return example
}

const createAuthPanelExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'AuthPanel is the sign-in surface shared by Lixpi browser applications. The brand side runs the shifting gradient renderer. setBusy disables the actions while a sign-in request runs.',
    )
    const container = html`<div className="documentation-ui-auth"></div>` as HTMLElement
    example.specimen('Sign in', container)
    let message = ''
    const mount = () => {
        const panel = new AuthPanel({
            brand: 'Lixpi',
            logo: lixpiLogo,
            title: 'Welcome back',
            description: 'Sign in to continue to your workspaces.',
            message: message || undefined,
            actions: [
                {
                    label: 'Sign in',
                    onClick: () => example.frame.report('Sign in was pressed.'),
                },
                {
                    label: 'Create an account',
                    secondary: true,
                    onClick: () => example.frame.report('Create an account was pressed.'),
                },
            ],
        })
        container.replaceChildren(panel.dom)

        return panel
    }
    let panel = mount()
    example.own(() => panel.destroy())
    example.frame.text(
        'Notice',
        message,
        value => {
            message = value
            panel.destroy()
            panel = mount()
        },
    )
    example.frame.toggle(
        'Busy',
        false,
        busy => panel.setBusy(busy),
    )
    example.frame.code(
        () => [
            "import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'",
            '',
            'const panel = new AuthPanel({',
            "    brand: 'Lixpi',",
            '    logo: lixpiLogo,',
            "    title: 'Welcome back',",
            "    description: 'Sign in to continue to your workspaces.',",
            ...(message ? [`    message: ${JSON.stringify(message)},`] : []),
            "    actions: [{ label: 'Sign in', onClick: () => auth.login() }],",
            '})',
            'document.body.append(panel.dom)',
        ].join('\n'),
    )

    return example
}

const initialTiles = (): BlockCardTileItem[] => [
    {
        id: 'brief',
        title: 'Creative brief',
        primaryMeta: 'Document',
        secondaryMeta: 'Edited 2 hours ago',
        selected: true,
        action: {
            ariaLabel: 'Delete Creative brief',
            iconSvg: trashBinIcon,
        },
    },
    {
        id: 'poster',
        title: 'Launch poster',
        primaryMeta: 'Image',
        secondaryMeta: '1024 x 1536',
        action: {
            ariaLabel: 'Delete Launch poster',
            iconSvg: trashBinIcon,
        },
    },
    {
        id: 'teaser',
        title: 'Teaser video',
        primaryMeta: 'Video',
        secondaryMeta: '12 seconds',
    },
]

const createBlockCardTilesExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createBlockCardTilesList renders a titled list of cards. Selecting a card and pressing its action report to the host, which owns the items and calls setItems with the result.',
    )
    const body = example.specimen('Recent items')
    let items = initialTiles()
    const list = createBlockCardTilesList({
        title: 'Recent items',
        items,
        emptyText: 'Nothing here yet.',
        onSelect: item => {
            items = items.map(
                candidate => ({
                    ...candidate,
                    selected: candidate.id === item.id,
                }),
            )
            list.setItems(items)
            example.frame.report(`Selected ${item.title}.`)
        },
        onAction: item => {
            items = items.filter(candidate => candidate.id !== item.id)
            list.setItems(items)
            example.frame.report(`Deleted ${item.title}.`)
        },
    })
    list.element.classList.add('documentation-ui-list')
    body.append(list.element)
    example.own(() => list.destroy())
    example.frame.button('Restore items', () => {
        items = initialTiles()
        list.setItems(items)
    })
    example.frame.button('Clear items', () => {
        items = []
        list.setItems(items)
    })
    example.frame.code(
        () => [
            "import { createBlockCardTilesList } from '@lixpi/ui-kit/components/block-card-tiles-list'",
            '',
            'const list = createBlockCardTilesList({',
            "    title: 'Recent items',",
            '    items,',
            "    emptyText: 'Nothing here yet.',",
            '    onSelect: item => store.select(item.id),',
            '    onAction: item => store.remove(item.id),',
            '})',
            `// ${items.length} items are shown.`,
        ].join('\n'),
    )

    return example
}

const createTypographyExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'Import @lixpi/ui-kit/styles/typography once to give an application the shared fonts, headings, body text, links and code. Navigation rows come from @lixpi/ui-kit/styles/navigation-side-panel and need only their class names.',
    )
    example.specimen(
        'Text',
        html`
            <div>
                <h1>Heading one</h1>
                <h2>Heading two</h2>
                <h3>Heading three</h3>
                <h4>Heading four</h4>
                <h5>Heading five</h5>
                <h6>Heading six</h6>
                <p>Body text with <strong>strong</strong>, <em>emphasis</em>, a <a href="#typography">link</a> and <code>inline code</code>.</p>
                <ul>
                    <li>An unordered item</li>
                    <li>Another item</li>
                </ul>
                <ol>
                    <li>An ordered item</li>
                    <li>Another item</li>
                </ol>
                <pre><code>const theme = getTheme('lixpi-light')</code></pre>
            </div>
        ` as HTMLElement,
    )
    example.specimen(
        'Navigation rows',
        html`
            <nav
                className="application-panel-body documentation-ui-list"
                aria-label="Example navigation"
            >
                <div className="navigation-side-panel-section-heading">Workspaces</div>
                <button
                    type="button"
                    className="navigation-side-panel-row navigation-side-panel-row-active"
                ><span className="navigation-side-panel-row-title">Autumn launch</span></button>
                <button
                    type="button"
                    className="navigation-side-panel-row"
                ><span className="navigation-side-panel-row-title">Product photography</span></button>
                <button
                    type="button"
                    className="navigation-side-panel-row"
                ><span className="navigation-side-panel-row-title">Brand guidelines</span></button>
            </nav>
        ` as HTMLElement,
    )
    example.frame.code(
        () => [
            "import '@lixpi/ui-kit/styles/typography'",
            "import '@lixpi/ui-kit/styles/navigation-side-panel'",
            '',
            'html`<button className="navigation-side-panel-row navigation-side-panel-row-active">',
            '    <span className="navigation-side-panel-row-title">Autumn launch</span>',
            '</button>`',
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'ui-kit-application-panel': createApplicationPanelExample,
    'ui-kit-auth-panel': createAuthPanelExample,
    'ui-kit-block-card-tiles': createBlockCardTilesExample,
    'ui-kit-typography': createTypographyExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown UI kit surface example: ${id}`)

    return factory(host)
}
