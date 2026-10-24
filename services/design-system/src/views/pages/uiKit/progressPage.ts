// Progress and list surfaces from @lixpi/ui-kit: the nested progress
// timeline, the ripple marker, block card tiles and the error placeholder.

import {
    createProgressTimeline,
    type ProgressTimelineConfig,
    type ProgressTimelineItem,
    type ProgressTimelineItemStatus,
} from '@lixpi/ui-kit/components/progress-timeline'
import { createProgressRippleIcon } from '@lixpi/ui-kit/components/progress-ripple'
import {
    createBlockCardTilesList,
    createBlockCardTile,
    type BlockCardTileItem,
} from '@lixpi/ui-kit/components/block-card-tiles-list'
import { createErrorPlaceholder } from '@lixpi/ui-kit/components/loading-placeholder'
import {
    claudeIcon,
    geminiIcon,
    plusIcon,
    progressRippleArtwork,
    stabilityIcon,
} from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
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
import '$src/views/pages/uiKit/progress.scss'

const STATUSES: ProgressTimelineItemStatus[] = ['pending', 'running', 'completed', 'attention', 'failed', 'cancelled', 'skipped']

const STATUS_ITEMS: ProgressTimelineItem[] = STATUSES.map(
    status => ({
        id: `status-${status}`,
        status,
        summary: `This step is ${status}.`,
        title: `${status[0].toUpperCase()}${status.slice(1)} step`,
    }),
)

const pipelineItems = (stage: number): ProgressTimelineItem[] => {
    const statusAt = (index: number): ProgressTimelineItemStatus => index < stage
        ? 'completed'
        : index === stage
            ? 'running'
            : 'pending'

    return [
        {
            id: 'reasoning',
            meta: stage > 0 ? '3 references' : undefined,
            showSummaryWhenCollapsed: true,
            source: {
                icon: claudeIcon,
                kind: 'reasoning-model',
                name: 'Claude',
            },
            status: statusAt(0),
            summary: 'Reading the brief and the selected frames to plan the shots.',
        },
        {
            children: [
                {
                    id: 'tool-search',
                    source: {
                        kind: 'tool',
                        name: 'Reference search',
                    },
                    status: statusAt(1),
                    summary: 'Found four matching wardrobe references.',
                },
                {
                    id: 'skill-pose',
                    source: {
                        kind: 'skill',
                        name: 'Pose sheet',
                    },
                    status: statusAt(1),
                    summary: 'Front, profile and back poses prepared.',
                },
            ],
            id: 'capability',
            source: {
                kind: 'capability',
                name: 'Character creator',
            },
            status: statusAt(1),
            summary: 'Building the character sheet.',
        },
        {
            children: [
                {
                    id: 'image-1',
                    meta: '1024 × 1024',
                    source: {
                        icon: geminiIcon,
                        kind: 'media-model',
                        name: 'Nano Banana Pro',
                    },
                    status: statusAt(2),
                    title: 'Variant 1',
                },
                {
                    id: 'image-2',
                    source: {
                        icon: stabilityIcon,
                        kind: 'media-model',
                        name: 'Stable Image Ultra',
                    },
                    status: stage >= 2 ? 'attention' : 'pending',
                    summary: 'The provider asked for a safer prompt.',
                    title: 'Variant 2',
                },
            ],
            id: 'media',
            source: { kind: 'pipeline' },
            status: statusAt(2),
            title: 'Generate images',
        },
    ]
}

const TILES: BlockCardTileItem[] = [
    {
        id: 'brief',
        primaryMeta: 'Updated today',
        secondaryMeta: 'Ready',
        selected: true,
        title: 'Campaign brief',
    },
    {
        action: {
            ariaLabel: 'Add to canvas',
            iconSvg: plusIcon,
        },
        id: 'moodboard',
        markerAriaLabel: 'Has unsaved changes',
        primaryMeta: 'Updated yesterday',
        secondaryMeta: '12 references',
        title: 'Moodboard with a long title that truncates',
    },
    {
        id: 'shot-list',
        primaryMeta: 'Updated last week',
        secondaryMeta: 'Draft',
        title: 'Shot list',
    },
]

export const createProgressPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit',
        title: 'Progress, lists and errors',
        description: 'The progress timeline renders whatever items a host projects into it. The workspace uses it for reasoning, capability and media-generation progress.',
    })

    page.addSection({
        title: 'Timeline statuses',
        description: 'Attention, failed and cancelled items open automatically. Clean completed items stay collapsed.',
        content: page.own(
            createProgressTimeline({
                ariaLabel: 'Statuses',
                items: STATUS_ITEMS,
            }),
        ).element,
    })

    let stage = 0
    const streaming = page.own(
        createProgressTimeline({
            ariaLabel: 'Generation pipeline',
            defaultViewMode: 'focused',
            items: pipelineItems(stage),
            rippleClockId: 'design-system-pipeline',
            getItemDetailKey: detail => JSON.stringify(detail),
            renderItemDetail: detail => {
                const code = createGentelellaCode({ code: JSON.stringify(
                    detail,
                    null,
                    2,
                ) })

                return {
                    destroy: () => code.destroy(),
                    element: code.el,
                }
            },
        }),
    )
    const viewState = html`<span className="design-system-progress-view-state"></span>` as HTMLElement
    const reportViewState = (): void => {
        const state = streaming.getViewState()
        viewState.textContent = `mode: ${state.mode}, ${state.hiddenItemCount} of ${state.totalItemCount} hidden`
    }
    const advance = (): void => {
        stage = (stage + 1) % 4
        streaming.setItems(
            pipelineItems(stage).map(
                item => item.id === 'reasoning'
                    ? {
                        ...item,
                        detail: { step: stage },
                    }
                    : item,
            ),
        )
        reportViewState()
    }
    const timer = setInterval(advance, 2400)
    page.own({ destroy: () => clearInterval(timer) })
    reportViewState()
    page.addSection({
        title: 'Streaming pipeline',
        description: 'Nested children, source labels with provider icons, meta text, summaries kept visible while collapsed and a host-rendered detail block. Items update every few seconds through setItems.',
        content: [
            createShowcaseRow([
                page.own(
                    createGentelellaButton({
                        label: "setViewMode('focused')",
                        onClick: () => {
                            streaming.setViewMode('focused')
                            reportViewState()
                        },
                        size: 'small',
                        variant: 'outline',
                    }),
                ).el,
                page.own(
                    createGentelellaButton({
                        label: "setViewMode('all')",
                        onClick: () => {
                            streaming.setViewMode('all')
                            reportViewState()
                        },
                        size: 'small',
                        variant: 'outline',
                    }),
                ).el,
                page.own(
                    createGentelellaButton({
                        label: 'Advance',
                        onClick: advance,
                        size: 'small',
                        variant: 'primary',
                    }),
                ).el,
                viewState,
            ]),
            streaming.element,
        ],
    })

    const viewVariants: Array<{
        config: Partial<ProgressTimelineConfig>
        label: string
    }> = [
        {
            config: {
                defaultViewMode: 'focused',
                preserveTopLevelItemsInFocusedView: true,
            },
            label: 'preserveTopLevelItemsInFocusedView',
        },
        {
            config: {
                defaultViewMode: 'all',
                expandAllItemsInAllView: true,
            },
            label: 'expandAllItemsInAllView',
        },
    ]
    page.addSection({
        title: 'View options',
        columns: 2,
        content: viewVariants.map(
            variant => createShowcaseSpecimen({
                content: page.own(
                    createProgressTimeline({
                        ariaLabel: variant.label,
                        items: pipelineItems(2),
                        ...variant.config,
                    }),
                ).element,
                label: variant.label,
            }),
        ),
    })

    const ripples = ['#cbbfff', '#82b2c0', '#a55324', '#5d656d'].map(color => {
        const ripple = page.own(
            createProgressRippleIcon({
                artwork: progressRippleArtwork,
                className: 'design-system-progress-ripple',
                color,
            }),
        )
        page.onMount(() => ripple.syncActive())

        return createShowcaseSpecimen({
            content: ripple.element,
            label: `color: ${color}`,
        })
    })
    page.addSection({
        title: 'Progress ripple',
        description: 'The active marker used by running timeline items and node footers. syncActive starts it; reset stops it.',
        columns: 4,
        content: ripples,
    })

    const list = page.own(
        createBlockCardTilesList({
            emptyText: 'Nothing here yet',
            items: TILES,
            title: 'Documents',
            onAction: item => announce(`Action on ${item.title}`),
            onSelect: item => {
                list.setItems(
                    TILES.map(
                        tile => ({
                            ...tile,
                            selected: tile.id === item.id,
                        }),
                    ),
                )
                announce(`Selected ${item.title}`)
            },
        }),
    )
    const empty = page.own(
        createBlockCardTilesList({
            emptyText: 'Nothing here yet',
            items: [],
            title: 'Empty list',
        }),
    )
    const single = page.own(
        createBlockCardTile({
            item: TILES[1],
            onAction: item => announce(`Action on ${item.title}`),
        }),
    )
    page.addSection({
        title: 'Block card tiles',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: list.element,
                label: 'createBlockCardTilesList',
            }),
            createShowcaseSpecimen({
                content: empty.element,
                label: 'emptyText',
            }),
            createShowcaseSpecimen({
                content: single.element,
                label: 'createBlockCardTile with an action',
            }),
        ],
    })

    const errorVariants = [
        {
            label: "theme: 'light', with overlay",
            surface: 'plain',
            theme: 'light',
            withOverlay: true,
        },
        {
            label: "theme: 'dark', with overlay",
            surface: 'dark',
            theme: 'dark',
            withOverlay: true,
        },
        {
            label: 'withOverlay: false',
            surface: 'plain',
            theme: 'light',
            withOverlay: false,
        },
    ] as const
    page.addSection({
        title: 'Error placeholder',
        description: 'Shown in place of content that failed to load, with a retry action.',
        columns: 3,
        content: errorVariants.map(variant => {
            const placeholder = page.own(
                createErrorPlaceholder({
                    message: 'Failed to load document',
                    retryLabel: 'Try again',
                    theme: variant.theme,
                    withOverlay: variant.withOverlay,
                    onRetry: () => {
                        placeholder.setMessage('Still failing. Try again later.')
                        announce('Retry requested')
                    },
                }),
            )

            return createShowcaseSpecimen({
                content: html`<div className="design-system-error-host">${placeholder.dom}</div>`,
                label: variant.label,
                surface: variant.surface,
            })
        }),
    })

    return page
}
