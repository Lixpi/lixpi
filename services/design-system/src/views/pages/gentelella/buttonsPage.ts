// Gentelella buttons, button groups and the command components built on them.

import {
    createGentelellaButton,
    createGentelellaButtonGroup,
} from '@lixpi/ui-kit-gentelella/components/button'
import {
    createGentelellaCommandPaletteTrigger,
    createGentelellaPageActionButton,
    type GentelellaPageAction,
} from '@lixpi/ui-kit-gentelella/components/commands'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import {
    type GentelellaButtonSize,
    type GentelellaButtonVariant,
} from '@lixpi/ui-kit-gentelella/class-names'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'

const VARIANTS: GentelellaButtonVariant[] = ['default', 'primary', 'outline', 'ghost', 'success', 'warning', 'danger']
const SIZES: GentelellaButtonSize[] = ['small', 'default', 'large']
const PAGE_ACTIONS: GentelellaPageAction[] = ['compose', 'export', 'invite', 'new-deal', 'new-event', 'new-project', 'new-task', 'print', 'refresh', 'share']

export const createGentelellaButtonsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/button · /commands',
        title: 'Buttons and commands',
        description: 'Buttons attach their spinner only while busy. Command buttons connect to the Gentelella command palette and page-action runtimes.',
    })

    page.addSection({
        title: 'Variants and sizes',
        content: SIZES.map(
            size => createShowcaseSpecimen({
                content: VARIANTS.map(
                    variant => page.own(
                        createGentelellaButton({
                            label: variant,
                            size,
                            variant,
                            onClick: () => announce(`${variant} ${size}`),
                        }),
                    ).el,
                ),
                label: `size: '${size}'`,
            }),
        ),
    })

    const busy = page.own(
        createGentelellaButton({
            label: 'Save',
            variant: 'primary',
            onClick: () => {
                busy.setBusy(true)
                busy.setLabel('Saving')
                setTimeout(() => {
                    busy.setBusy(false)
                    busy.setLabel('Save')
                }, 1500)
            },
        }),
    )
    const disabled = page.own(
        createGentelellaButton({
            disabled: true,
            label: 'Disabled',
        }),
    )
    const toggleDisabled = page.own(
        createGentelellaButton({
            label: 'Toggle disabled',
            variant: 'ghost',
            onClick: () => disabled.setDisabled(!disabled.el.disabled),
        }),
    )
    page.addSection({
        title: 'Icons and state',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: [
                    page.own(
                        createGentelellaButton({
                            iconHtml: GENTELELLA_ICONS.settings,
                            label: 'Settings',
                            variant: 'outline',
                        }),
                    ).el,
                    page.own(
                        createGentelellaButton({
                            ariaLabel: 'Notifications',
                            iconHtml: GENTELELLA_ICONS.bell,
                            iconOnly: true,
                            variant: 'ghost',
                        }),
                    ).el,
                    page.own(
                        createGentelellaButton({
                            ariaLabel: 'Search',
                            iconHtml: GENTELELLA_ICONS.help,
                            iconOnly: true,
                            size: 'small',
                            variant: 'primary',
                        }),
                    ).el,
                ],
                label: 'iconHtml and iconOnly',
            }),
            createShowcaseSpecimen({
                content: busy.el,
                label: 'setBusy and setLabel',
            }),
            createShowcaseSpecimen({
                content: [disabled.el, toggleDisabled.el],
                label: 'setDisabled',
            }),
        ],
    })

    const single = page.own(
        createGentelellaButtonGroup({
            activeValue: 'week',
            ariaLabel: 'Range',
            items: ['Day', 'Week', 'Month'].map(
                label => ({
                    label,
                    value: label.toLowerCase(),
                }),
            ),
            onSelect: value => {
                single.setActiveValue(value)
                announce(`Range ${value}`)
            },
        }),
    )
    const multiple = page.own(
        createGentelellaButtonGroup({
            ariaLabel: 'Formatting',
            items: ['Bold', 'Italic', 'Underline'].map(
                label => ({
                    label,
                    value: label.toLowerCase(),
                    variant: 'outline',
                }),
            ),
            selection: 'multiple',
            onSelect: value => announce(`Toggled ${value}`),
        }),
    )
    page.addSection({
        title: 'Button groups',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: single.el,
                label: "selection: 'single'",
            }),
            createShowcaseSpecimen({
                content: multiple.el,
                label: "selection: 'multiple'",
            }),
        ],
    })

    const palette = page.own(
        createGentelellaCommandPaletteTrigger({ iconHtml: GENTELELLA_ICONS.help }),
    )
    const paletteOutline = page.own(
        createGentelellaCommandPaletteTrigger({
            label: 'Jump to…',
            size: 'small',
            variant: 'outline',
        }),
    )
    page.onMount(() => palette.initializeShortcut())
    page.addSection({
        title: 'Command palette trigger',
        description: 'The trigger opens the Gentelella command palette. initializeShortcut also binds the palette keyboard shortcut for the document.',
        content: createShowcaseRow([palette.el, paletteOutline.el]),
    })

    const actions = PAGE_ACTIONS.map(
        action => page.own(
            createGentelellaPageActionButton({
                action,
                size: 'small',
                variant: 'outline',
            }),
        ),
    )
    page.onMount(() => actions[0]?.initialize())
    page.addSection({
        title: 'Page actions',
        description: 'Every shared page action. initialize connects them to the Gentelella page-action runtime.',
        content: createShowcaseRow(
            actions.map(action => action.el),
        ),
    })

    return page
}
