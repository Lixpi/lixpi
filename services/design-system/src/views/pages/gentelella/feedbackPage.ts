// Gentelella feedback: banners, statuses, chips, spinners, empty states,
// progress, skeletons, timelines, steppers, wizards and async regions.

import { createGentelellaBanner } from '@lixpi/ui-kit-gentelella/components/banner'
import { createGentelellaStatus } from '@lixpi/ui-kit-gentelella/components/status'
import { createGentelellaChip } from '@lixpi/ui-kit-gentelella/components/chip'
import { createGentelellaSpinner } from '@lixpi/ui-kit-gentelella/components/spinner'
import { createGentelellaEmptyState } from '@lixpi/ui-kit-gentelella/components/empty-state'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaTable } from '@lixpi/ui-kit-gentelella/components/table'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import {
    createGentelellaAsyncRegion,
    createGentelellaLoadingBar,
    createGentelellaProgress,
    createGentelellaSkeleton,
    createGentelellaSkeletonTable,
    createGentelellaStepper,
    createGentelellaTimeline,
    createGentelellaWizard,
    type GentelellaAsyncRegionState,
} from '@lixpi/ui-kit-gentelella/components/feedback'
import {
    type GentelellaBannerVariant,
} from '@lixpi/ui-kit-gentelella/class-names'
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

const BANNER_VARIANTS: GentelellaBannerVariant[] = ['default', 'info', 'success', 'warning', 'danger']
const CHIP_TONES = ['default', 'primary', 'blue', 'green', 'yellow', 'red', 'purple'] as const

export const createGentelellaFeedbackPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella',
        title: 'Feedback',
        description: 'Page-level messages, inline statuses and every loading and progress treatment the theme ships.',
    })

    page.addSection({
        title: 'Banners',
        content: BANNER_VARIANTS.map(
            variant => page.own(
                createGentelellaBanner({
                    actions: page.own(
                        createGentelellaButton({
                            label: 'Review',
                            size: 'small',
                            variant: 'outline',
                        }),
                    ).el,
                    body: `A ${variant} banner with an icon and an action.`,
                    iconHtml: GENTELELLA_ICONS.bell,
                    title: `${variant[0].toUpperCase()}${variant.slice(1)}`,
                    variant,
                }),
            ).el,
        ),
    })

    const status = page.own(
        createGentelellaStatus({
            label: 'Syncing',
            tone: 'blue',
        }),
    )
    page.addSection({
        title: 'Statuses and chips',
        content: [
            createShowcaseRow([
                ...(['green', 'yellow', 'red', 'blue', 'gray'] as const).map(
                    tone => page.own(
                        createGentelellaStatus({
                            label: tone,
                            tone,
                        }),
                    ).el,
                ),
                status.el,
                page.own(
                    createGentelellaButton({
                        label: 'setLabel',
                        size: 'small',
                        variant: 'ghost',
                        onClick: () => status.setLabel(status.el.textContent?.includes('Syncing') ? 'Synced' : 'Syncing'),
                    }),
                ).el,
            ]),
            createShowcaseRow(
                CHIP_TONES.map(
                    tone => page.own(
                        createGentelellaChip({
                            label: tone,
                            tone,
                        }),
                    ).el,
                ),
            ),
            createShowcaseRow([
                page.own(
                    createGentelellaChip({
                        active: true,
                        label: 'Toggle me',
                        tone: 'primary',
                        onToggle: active => announce(`Chip ${active ? 'on' : 'off'}`),
                    }),
                ).el,
                ...['Portrait', 'Landscape', 'Square'].map(label => {
                    const chip = page.own(
                        createGentelellaChip({
                            data: { value: label.toLowerCase() },
                            label,
                            removable: true,
                            onRemove: () => {
                                chip.destroy()
                                announce(`Removed ${label}`)
                            },
                        }),
                    )

                    return chip.el
                }),
            ]),
        ],
    })

    page.addSection({
        title: 'Spinners',
        columns: 4,
        content: [
            ...(['small', 'default', 'large'] as const).map(
                size => createShowcaseSpecimen({
                    content: page.own(
                        createGentelellaSpinner({ size }),
                    ).el,
                    label: `size: '${size}'`,
                }),
            ),
            ...(['azure', 'red', 'yellow'] as const).map(
                tone => createShowcaseSpecimen({
                    content: page.own(
                        createGentelellaSpinner({ tone }),
                    ).el,
                    label: `tone: '${tone}'`,
                }),
            ),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaSpinner({ dots: true }),
                ).el,
                label: 'dots',
            }),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaSpinner({ label: 'Loading models' }),
                ).el,
                label: 'label',
            }),
        ],
    })

    page.addSection({
        title: 'Empty states',
        columns: 2,
        content: [
            page.own(
                createGentelellaEmptyState({
                    action: page.own(
                        createGentelellaButton({
                            label: 'New workspace',
                            variant: 'primary',
                        }),
                    ).el,
                    description: 'Create a workspace to start a canvas.',
                    iconHtml: GENTELELLA_ICONS.projects,
                    title: 'No workspaces yet',
                }),
            ).el,
            page.own(
                createGentelellaEmptyState({ title: 'Title only' }),
            ).el,
        ],
    })

    const progress = page.own(
        createGentelellaProgress({
            label: 'Upload',
            value: 20,
        }),
    )
    let progressValue = 20
    const timer = setInterval(() => {
        progressValue = (progressValue + 15) % 105
        progress.setValue(progressValue)
    }, 1000)
    page.own({ destroy: () => clearInterval(timer) })
    page.addSection({
        title: 'Progress and loading bars',
        content: [
            progress.el,
            page.own(
                createGentelellaProgress({
                    color: 'var(--green)',
                    label: 'Storage',
                    value: 72,
                }),
            ).el,
            page.own(
                createGentelellaProgress({
                    color: 'var(--red)',
                    value: 95,
                }),
            ).el,
            page.own(
                createGentelellaLoadingBar({ label: 'Loading' }),
            ).el,
        ],
    })

    const skeletonTable = page.own(
        createGentelellaTable(),
    )
    skeletonTable.tableEl.append(
        page.own(
            createGentelellaSkeletonTable({
                columns: 4,
                rows: 3,
            }),
        ).el,
    )
    page.addSection({
        title: 'Skeletons',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    page.own(
                        createGentelellaSkeleton({ variant: 'circle' }),
                    ).el,
                    page.own(
                        createGentelellaSkeleton({ variant: 'text-large' }),
                    ).el,
                    page.own(
                        createGentelellaSkeleton({ variant: 'text' }),
                    ).el,
                    page.own(
                        createGentelellaSkeleton({
                            height: 80,
                            variant: 'rectangle',
                            width: '100%',
                        }),
                    ).el,
                ],
                label: "variants: 'circle', 'text-large', 'text', 'rectangle'",
            }),
            createShowcaseSpecimen({
                content: skeletonTable.el,
                label: 'createGentelellaSkeletonTable({ columns: 4, rows: 3 })',
            }),
        ],
    })

    page.addSection({
        title: 'Timeline',
        content: page.own(
            createGentelellaTimeline({
                entries: [
                    {
                        description: 'Uploaded 12 frames',
                        time: '09:12',
                        title: 'Upload finished',
                        tone: 'green',
                    },
                    {
                        description: 'Character sheet requested',
                        time: '09:20',
                        title: 'Generation started',
                        tone: 'blue',
                    },
                    {
                        time: '09:24',
                        title: 'Review requested',
                        tone: 'primary',
                    },
                    {
                        description: 'One variant needs a safer prompt',
                        time: '09:25',
                        title: 'Attention needed',
                        tone: 'yellow',
                    },
                    {
                        time: '09:30',
                        title: 'Variant rejected',
                        tone: 'red',
                    },
                ],
            }),
        ).el,
    })

    let activeStep = 1
    const stepper = page.own(
        createGentelellaStepper({
            items: [
                {
                    description: 'Choose a plan',
                    label: 'Plan',
                    state: 'complete',
                },
                {
                    description: 'Add details',
                    label: 'Details',
                    state: 'active',
                },
                {
                    label: 'Confirm',
                    state: 'pending',
                },
            ],
        }),
    )
    const wizard = page.own(
        createGentelellaWizard({
            steps: [
                {
                    content: html`<p>Name the workspace.</p>`,
                    label: 'Name',
                },
                {
                    content: html`<p>Invite collaborators.</p>`,
                    label: 'Members',
                },
                {
                    content: html`<p>Review and create.</p>`,
                    label: 'Review',
                },
            ],
            onStepChange: index => announce(`Wizard step ${index + 1}`),
        }),
    )
    page.addSection({
        title: 'Stepper and wizard',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    stepper.el,
                    page.own(
                        createGentelellaButton({
                            label: 'setActiveIndex(next)',
                            size: 'small',
                            variant: 'outline',
                            onClick: () => {
                                activeStep = (activeStep + 1) % 3
                                stepper.setActiveIndex(activeStep)
                            },
                        }),
                    ).el,
                ],
                label: 'createGentelellaStepper',
            }),
            createShowcaseSpecimen({
                content: [
                    wizard.el,
                    createShowcaseRow([
                        page.own(
                            createGentelellaButton({
                                label: 'previous()',
                                size: 'small',
                                variant: 'ghost',
                                onClick: () => wizard.previous(),
                            }),
                        ).el,
                        page.own(
                            createGentelellaButton({
                                label: 'next()',
                                size: 'small',
                                variant: 'primary',
                                onClick: () => wizard.next(),
                            }),
                        ).el,
                    ]),
                ],
                label: 'createGentelellaWizard',
            }),
        ],
    })

    const regionStates: Array<[string, GentelellaAsyncRegionState]> = [
        ['Loading', {
            columns: 3,
            rows: 2,
            type: 'loading',
        }],
        ['Content', {
            content: html`<p>Loaded content replaces the skeleton.</p>`,
            type: 'content',
        }],
        ['Empty', {
            description: 'Nothing matched the filter.',
            title: 'No results',
            type: 'empty',
        }],
        ['Error', {
            message: 'The catalog could not be loaded.',
            type: 'error',
        }],
    ]
    const region = page.own(
        createGentelellaAsyncRegion({ state: regionStates[0][1] }),
    )
    page.addSection({
        title: 'Async region',
        description: 'One region switches between loading, content, empty and error states.',
        content: [
            createShowcaseRow(
                regionStates.map(
                    ([label, state]) => page.own(
                        createGentelellaButton({
                            label,
                            size: 'small',
                            variant: 'outline',
                            onClick: () => region.setState(state),
                        }),
                    ).el,
                ),
            ),
            region.el,
        ],
    })

    return page
}
