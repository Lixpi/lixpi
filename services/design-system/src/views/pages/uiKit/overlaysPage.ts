// Floating surfaces from @lixpi/ui-kit: the info bubble, help tooltips, the
// context preview and interactive preview popovers, and the bubble menu.

import {
    createInfoBubble,
    infoBubbleStateManager,
    type InfoBubbleConfig,
} from '@lixpi/ui-kit/components/info-bubble'
import {
    createHelpTooltip,
    type HelpTooltipConfig,
} from '@lixpi/ui-kit/components/help-tooltip'
import { createContextPreviewPopover } from '@lixpi/ui-kit/components/preview'
import { InteractivePreviewPopover } from '@lixpi/ui-kit/components/popover'
import {
    BubbleMenu,
    type BubbleMenuItem,
} from '@lixpi/ui-kit/components/bubble-menu'
import {
    boldIcon,
    downloadIcon,
    imageIcon,
    infoCircleFilledIcon,
    italicIcon,
    linkIcon,
    questionMarkCircleIcon,
    strikethroughIcon,
    trashBinIcon,
} from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { createGentelellaChip } from '@lixpi/ui-kit-gentelella/components/chip'
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
import '$src/views/pages/uiKit/overlays.scss'

type BubbleVariant = Pick<InfoBubbleConfig, 'arrowCrossOffset' | 'arrowSide' | 'closeOnClickOutside' | 'offset' | 'theme'> & {
    header?: string
    label: string
}

const BUBBLE_VARIANTS: BubbleVariant[] = [
    {
        arrowSide: 'top',
        label: "arrowSide: 'top', dark",
    },
    {
        arrowSide: 'bottom',
        label: "arrowSide: 'bottom', light",
        theme: 'light',
    },
    {
        arrowSide: 'left',
        header: 'Thread context',
        label: "arrowSide: 'left' with header",
        theme: 'light',
    },
    {
        arrowSide: 'right',
        arrowCrossOffset: 20,
        label: "arrowSide: 'right', arrowCrossOffset: 20",
    },
    {
        arrowSide: 'top',
        label: 'offset { y: 36 }',
        offset: {
            x: 0,
            y: 36,
        },
        theme: 'light',
    },
    {
        arrowSide: 'top',
        closeOnClickOutside: false,
        label: 'closeOnClickOutside: false',
        theme: 'light',
    },
]

const createMenuButton = (
    label: string,
    icon: string,
): HTMLButtonElement =>
    html`
        <button
            type="button"
            className="bubble-menu-button"
            aria-label=${label}
            data-help-tooltip="aria-label"
            innerHTML=${icon}
        ></button>
    ` as HTMLButtonElement

export const createOverlaysPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit',
        title: 'Bubbles and tooltips',
        description: 'Each surface owns its positioning, dismissal and cleanup. Visible help always goes through the shared tooltip, never a native title.',
    })

    page.addSection({
        title: 'Info bubble',
        description: 'The bubble flips to the opposite side when the preferred side has no room. Only one bubble is open at a time.',
        columns: 3,
        content: BUBBLE_VARIANTS.map((variant, index) => {
            const anchor = page.own(
                createGentelellaButton({
                    label: 'Open bubble',
                    variant: 'outline',
                }),
            )
            const bubble = page.own(
                createInfoBubble({
                    anchor: anchor.el,
                    arrowCrossOffset: variant.arrowCrossOffset,
                    arrowSide: variant.arrowSide,
                    bodyContent: html`<p className="design-system-bubble-body">Bubble content follows its anchor while the page scrolls.</p>` as HTMLElement,
                    closeOnClickOutside: variant.closeOnClickOutside,
                    headerContent: variant.header ? html`<strong>${variant.header}</strong>` as HTMLElement : undefined,
                    id: `info-bubble-${index}`,
                    offset: variant.offset,
                    theme: variant.theme,
                    onClose: () => anchor.el.classList.remove('active'),
                    onOpen: () => anchor.el.classList.add('active'),
                }),
            )

            return createShowcaseSpecimen({
                content: [anchor.el, bubble.dom],
                label: variant.label,
            })
        }),
    })
    page.el.append(
        page.own(
            createGentelellaButton({
                label: 'infoBubbleStateManager.closeAll()',
                onClick: () => infoBubbleStateManager.closeAll(),
                variant: 'ghost',
            }),
        ).el,
    )

    const providerTriggers = [
        html`
            <button
                type="button"
                className="design-system-tooltip-target"
                aria-label="Add to library"
                data-help-tooltip="aria-label"
                innerHTML=${imageIcon}
            ></button>
        `,
        html`
            <button
                type="button"
                className="design-system-tooltip-target"
                aria-label="Download"
                aria-description="Saves the original file"
                data-help-tooltip="aria-description"
                innerHTML=${downloadIcon}
            ></button>
        `,
        html`
            <button
                type="button"
                className="design-system-tooltip-target"
                aria-label="Delete"
                data-help-tooltip="Moves the node to the trash"
                innerHTML=${trashBinIcon}
            ></button>
        `,
        ...(['top', 'right', 'bottom', 'left'] as const).map(
            placement => html`
                <button
                    type="button"
                    className="design-system-tooltip-target"
                    aria-label=${`Fixed ${placement} placement`}
                    data-help-tooltip="aria-label"
                    data-help-tooltip-placement=${placement}
                    innerHTML=${infoCircleFilledIcon}
                ></button>
            `,
        ),
    ]
    page.addSection({
        title: 'Help tooltip provider',
        description: 'The application root runs one delegated provider. Controls opt in with data-help-tooltip naming aria-label, aria-description or literal text, and can fix a side with data-help-tooltip-placement.',
        content: createShowcaseRow(providerTriggers),
    })

    const richContent = html`
        <span className="design-system-tooltip-rich">
            <strong>Model details</strong>
            <span>Interactive content stays open while the pointer moves into it.</span>
        </span>
    ` as HTMLElement
    const tooltipVariants: Array<{
        config: HelpTooltipConfig
        label: string
    }> = [
        {
            config: {
                label: 'What is this?',
                text: 'Direct tooltips open immediately.',
            },
            label: 'Text with the fallback question mark',
        },
        {
            config: {
                icon: questionMarkCircleIcon,
                label: 'Help',
                text: 'The trigger shows a supplied icon.',
            },
            label: 'icon',
        },
        {
            config: {
                content: richContent,
                interactive: true,
                label: 'Model details',
                preferredPlacement: 'right',
            },
            label: "Rich interactive content, preferredPlacement: 'right'",
        },
        {
            config: {
                label: 'Status chip',
                placementOrder: ['bottom', 'top'],
                text: 'A custom trigger with bottom-first placement.',
                triggerContent: page.own(
                    createGentelellaChip({
                        label: 'Hover me',
                        tone: 'primary',
                    }),
                ).el,
            },
            label: 'triggerContent, placementOrder',
        },
        {
            config: {
                label: 'Large trigger',
                text: 'Trigger and icon sizes are configurable.',
                iconSize: 18,
                triggerSize: 28,
            },
            label: 'triggerSize: 28, iconSize: 18',
        },
    ]
    page.addSection({
        title: 'Direct help tooltips',
        description: 'createHelpTooltip owns its trigger when the help needs rich content or its own trigger.',
        columns: 3,
        content: tooltipVariants.map(
            variant => createShowcaseSpecimen({
                content: page.own(
                    createHelpTooltip(variant.config),
                ).dom,
                label: variant.label,
            }),
        ),
    })

    const previewVariants = [
        {
            inlinePopover: false,
            label: 'Floating preview on the tooltip surface',
            placement: 'top',
        },
        {
            inlinePopover: true,
            label: 'inlinePopover, top',
            placement: 'top',
        },
        {
            inlinePopover: true,
            inlineLabelTrigger: true,
            label: 'inlinePopover with inlineLabelTrigger, right',
            placement: 'right',
        },
        {
            inlinePopover: false,
            label: "preferredPlacement: 'bottom'",
            placement: 'bottom',
        },
    ] as const
    page.addSection({
        title: 'Context preview popover',
        description: 'Prompt references show their preview on hover or focus. Supply trigger content and preview content; the component owns focus, Escape and outside interaction.',
        columns: 2,
        content: previewVariants.map(variant => {
            const preview = page.own(
                createGentelellaCard({
                    content: 'Hero frame for the opening shot, 1920 by 1080.',
                    title: 'Frame 01',
                }),
            )
            const popover = page.own(
                createContextPreviewPopover({
                    accessibleLabel: 'Frame 01 preview',
                    content: preview.el,
                    contentClassName: 'design-system-preview-content',
                    inlineLabelTrigger: 'inlineLabelTrigger' in variant ? variant.inlineLabelTrigger : undefined,
                    inlinePopover: variant.inlinePopover,
                    preferredPlacement: variant.placement,
                    triggerContent: page.own(
                        createGentelellaChip({
                            label: '@Frame 01',
                            tone: 'blue',
                        }),
                    ).el,
                }),
            )

            return createShowcaseSpecimen({
                content: popover.dom,
                label: variant.label,
            })
        }),
    })

    const interactiveTrigger = page.own(
        createGentelellaButton({
            label: 'Hover or focus',
            variant: 'outline',
        }),
    )
    const interactivePopover = page.own(
        createGentelellaCard({
            className: 'design-system-interactive-popover',
            content: 'The popover stays open while the pointer is over it, and closes on Escape or an outside press.',
            title: 'Interactive preview',
        }),
    )
    const interactiveRoot = html`
        <div className="design-system-interactive-root">
            ${interactiveTrigger.el}
            ${interactivePopover.el}
        </div>
    ` as HTMLElement
    page.own(
        new InteractivePreviewPopover({
            closeDelayMs: 200,
            popover: interactivePopover.el,
            root: interactiveRoot,
            trigger: interactiveTrigger.el,
            afterClose: () => announce('Interactive preview closed'),
        }),
    )
    page.addSection({
        title: 'Interactive preview popover',
        description: 'InteractivePreviewPopover coordinates activation and dismissal around caller-owned root, trigger and popover elements. It only toggles their is-open state; the caller styles the surface.',
        content: interactiveRoot,
    })

    const menuHost = html`<div className="design-system-bubble-menu-host"></div>` as HTMLElement
    const textTarget = html`<p className="design-system-bubble-menu-target">Selected text in an editor</p>` as HTMLElement
    const imageTarget = html`
        <div
            className="design-system-bubble-menu-target design-system-bubble-menu-image"
            innerHTML=${imageIcon}
        ></div>
    ` as HTMLElement
    menuHost.append(textTarget, imageTarget)
    const items: BubbleMenuItem[] = [
        ...[['Bold', boldIcon], ['Italic', italicIcon], ['Strikethrough', strikethroughIcon], ['Link', linkIcon]].map(
            ([label, icon]) => ({
                context: ['text'],
                element: createMenuButton(label, icon),
            }),
        ),
        ...[['Download', downloadIcon], ['Delete', trashBinIcon]].map(
            ([label, icon]) => ({
                context: ['image'],
                element: createMenuButton(label, icon),
            }),
        ),
    ]

    for (const item of items)
        item.element.addEventListener('click', () => announce(`${item.element.getAttribute('aria-label')} clicked`))

    const menu = page.own(
        new BubbleMenu({
            items,
            label: 'Formatting',
            parentEl: menuHost,
            onHide: () => announce('Bubble menu hidden'),
        }),
    )
    const showMenu = (
        context: 'image' | 'text',
        target: HTMLElement,
        placement: 'above' | 'below',
    ): void =>
        void menu.show(
            context,
            {
                placement,
                targetRect: target.getBoundingClientRect(),
            },
        )
    page.addSection({
        title: 'Bubble menu',
        description: 'One menu switches its items by context and positions itself against a target rectangle, including inside transformed parents.',
        content: [
            menuHost,
            createShowcaseRow([
                page.own(
                    createGentelellaButton({
                        label: "Text context, 'above'",
                        onClick: () => showMenu(
                            'text',
                            textTarget,
                            'above',
                        ),
                        variant: 'outline',
                    }),
                ).el,
                page.own(
                    createGentelellaButton({
                        label: "Image context, 'below'",
                        onClick: () => showMenu(
                            'image',
                            imageTarget,
                            'below',
                        ),
                        variant: 'outline',
                    }),
                ).el,
                page.own(
                    createGentelellaButton({
                        label: 'Hide',
                        onClick: () => menu.forceHide(),
                        variant: 'ghost',
                    }),
                ).el,
            ]),
        ],
    })

    return page
}
