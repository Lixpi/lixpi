// Gentelella overlays through the runtime-backed APIs: modals, toasts, menu
// buttons, popovers and theme tooltips.

import {
    createGentelellaMenuButton,
    createGentelellaPopover,
    openGentelellaModal,
    showGentelellaToast,
} from '@lixpi/ui-kit-gentelella/components/overlay'
import { createGentelellaTooltip } from '@lixpi/ui-kit-gentelella/components/theme'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaChip } from '@lixpi/ui-kit-gentelella/components/chip'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
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

export const createGentelellaOverlaysPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/overlay',
        title: 'Overlays',
        description: 'Modals, toasts and menus come from the focused Gentelella runtimes. Only one modal or menu is open at a time.',
    })
    const button = (
        label: string,
        onClick: () => void,
        variant: 'outline' | 'primary' = 'outline',
    ): HTMLElement =>
        page.own(
            createGentelellaButton({
                label,
                variant,
                onClick,
            }),
        ).el

    page.addSection({
        title: 'Modal',
        content: createShowcaseRow([
            ...(['sm', 'md', 'lg'] as const).map(
                size => button(
                    `size: '${size}'`,
                    () => void openGentelellaModal({
                        body: `A ${size} modal with caller-owned body content.`,
                        size,
                        title: `Modal ${size}`,
                    }),
                ),
            ),
            button(
                'Actions',
                () => void openGentelellaModal({
                    actions: [
                        {
                            label: 'Cancel',
                            variant: 'ghost',
                        },
                        {
                            action: () => announce('Deleted'),
                            label: 'Delete',
                            variant: 'danger',
                        },
                        {
                            action: () => announce('Archived'),
                            closeOnAction: false,
                            label: 'Archive and keep open',
                            variant: 'outline',
                        },
                    ],
                    body: html`<p>Delete <strong>Spring campaign</strong>? This cannot be undone.</p>`,
                    onClose: () => announce('Modal closed'),
                    title: 'Delete project',
                }),
                'primary',
            ),
        ]),
    })

    page.addSection({
        title: 'Toast',
        content: createShowcaseRow(
            (['default', 'success', 'info', 'warning', 'error'] as const).map(
                variant => button(
                    variant,
                    () => void showGentelellaToast(
                        `A ${variant} toast`,
                        {
                            duration: 2500,
                            variant,
                        },
                    ),
                ),
            ),
        ),
    })

    page.addSection({
        title: 'Menu button and popover',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaMenuButton({
                        ariaLabel: 'Project actions',
                        icon: html`<span innerHTML=${GENTELELLA_ICONS.settings}></span>`,
                        items: [
                            {
                                action: () => announce('Rename'),
                                label: 'Rename',
                            },
                            {
                                action: () => announce('Duplicate'),
                                label: 'Duplicate',
                            },
                            '-',
                            {
                                action: () => announce('Delete'),
                                label: 'Delete',
                            },
                        ],
                    }),
                ).el,
                label: "createGentelellaMenuButton with a '-' separator",
            }),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaPopover({
                        content: html`<p>Popovers hold rich content and close on an outside click.</p>`,
                        label: 'Show details',
                        title: 'Details',
                        trigger: page.own(
                            createGentelellaChip({
                                label: 'Open popover',
                                tone: 'primary',
                            }),
                        ).el,
                        width: 260,
                    }),
                ).el,
                label: 'createGentelellaPopover({ width: 260 })',
            }),
        ],
    })

    page.addSection({
        title: 'Tooltips',
        description: 'Theme tooltips are CSS-driven and belong to Gentelella surfaces. Lixpi controls use the UI-kit help tooltip instead.',
        content: createShowcaseRow(
            (['top', 'right', 'bottom', 'left'] as const).map(
                position => page.own(
                    createGentelellaTooltip({
                        content: page.own(
                            createGentelellaChip({
                                label: position,
                            }),
                        ).el,
                        position,
                        tooltip: `Tooltip on the ${position}`,
                    }),
                ).el,
            ),
        ),
    })

    return page
}
