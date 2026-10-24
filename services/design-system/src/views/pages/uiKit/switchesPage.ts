// D3 SVG selection controls from @lixpi/ui-kit: the toggle switch, the sliding
// single-select, the tab strip built on it, and the tag pill primitive.

import {
    SLIDING_SWITCH_TRANSITION_DURATION_MS,
    createSlidingSwitch,
} from '@lixpi/ui-kit/components/sliding-switch'
import { createSlidingTabsSwitch } from '@lixpi/ui-kit/components/sliding-tabs-switch'
import {
    createTagPill,
    type TagPillConfig,
} from '@lixpi/ui-kit/components/tag-pill'
import { createToggleSwitch } from '@lixpi/ui-kit/components/toggle-switch'
import {
    claudeIcon,
    geminiIcon,
    tagIcon,
} from '@lixpi/ui-kit/svg'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import { createSvgStage } from '$src/views/showcase/svgStage.ts'

const VIEW_OPTIONS = [{
    label: 'List',
    value: 'list',
}, {
    label: 'Grid',
    value: 'grid',
}, {
    label: 'Timeline',
    value: 'timeline',
}]

const MEDIA_OPTIONS = [{
    label: 'Image',
    value: 'image',
}, {
    label: 'Video',
    value: 'video',
}, {
    label: 'Audio',
    value: 'audio',
    disabled: true,
}, {
    label: 'Document',
    value: 'document',
}]

const TAB_OPTIONS = ['Brief', 'Moodboard', 'Character sheet', 'Shot list', 'Notes'].map(
    label => ({
        closable: true,
        label,
        value: label.toLowerCase().replace(/\s+/g, '-'),
    }),
)

export const createSwitchesPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit',
        title: 'Switches and pills',
        description: 'These controls render SVG through D3 into a caller-owned SVG and own their own selection, hover and keyboard behavior. Callbacks report user changes; setters do not.',
    })

    const toggleVariants: Array<{
        checked?: boolean
        disabled?: boolean
        height?: number
        label: string
        size?: number
        width?: number
    }> = [
        { label: 'checked: false' },
        {
            checked: true,
            label: 'checked: true',
        },
        {
            disabled: true,
            label: 'disabled: true',
        },
        {
            checked: true,
            disabled: true,
            label: 'checked and disabled',
        },
        {
            label: 'size: 16',
            size: 16,
        },
        {
            checked: true,
            height: 30,
            label: 'width: 64, height: 30',
            width: 64,
        },
    ]
    page.addSection({
        title: 'Toggle switch',
        columns: 3,
        content: toggleVariants.map((variant, index) => {
            const height = variant.height
                ?? variant.size
                ?? 24
            const stage = createSvgStage({
                height: height + 8,
                width: (variant.width ?? height * 1.8) + 8,
            })
            page.own(
                createToggleSwitch(
                    stage.svg.append('g'),
                    {
                        checked: variant.checked,
                        disabled: variant.disabled,
                        height: variant.height,
                        id: `toggle-${index}`,
                        size: variant.size,
                        width: variant.width,
                        x: 4,
                        y: 4,
                        onChange: checked => announce(`Toggle ${index + 1}: ${checked ? 'on' : 'off'}`),
                    },
                ),
            )

            return createShowcaseSpecimen({
                content: stage.host,
                label: variant.label,
            })
        }),
    })

    const slidingVariants: Array<{
        config: Partial<Parameters<typeof createSlidingSwitch>[1]>
        label: string
        width: number
    }> = [
        {
            config: { options: VIEW_OPTIONS },
            label: 'Three options',
            width: 220,
        },
        {
            config: {
                options: MEDIA_OPTIONS,
                selectedValue: 'video',
            },
            label: 'Disabled option',
            width: 300,
        },
        {
            config: {
                height: 32,
                options: VIEW_OPTIONS,
                transition: {
                    distanceSpeedupFactor: 0,
                    durationMs: 600,
                    minDurationMs: 600,
                },
            },
            label: 'height: 32, slow 600 ms transition',
            width: 260,
        },
        {
            config: {
                options: MEDIA_OPTIONS.map(
                    option => ({
                        ...option,
                        disabled: false,
                    }),
                ),
                reshuffleItemsOnValueChange: {
                    enable: true,
                    selectedElementPosition: 'left',
                },
            },
            label: 'Reshuffle, selected on the left',
            width: 300,
        },
        {
            config: {
                options: MEDIA_OPTIONS.map(
                    option => ({
                        ...option,
                        disabled: false,
                    }),
                ),
                reshuffleItemsOnValueChange: {
                    enable: true,
                    selectedElementPosition: 'right',
                },
            },
            label: 'Reshuffle, selected on the right',
            width: 300,
        },
        {
            config: {
                minOptionWidth: 110,
                options: TAB_OPTIONS.map(
                    option => ({
                        label: option.label,
                        value: option.value,
                    }),
                ),
            },
            label: 'minOptionWidth: 110 inside a 260 wide viewport',
            width: 260,
        },
        {
            config: {
                hoveredOptionColor: '#ffffff',
                indicatorBackgroundColor: '#5d656d',
                indicatorBoxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
                indicatorInsetShadow: {
                    bottomColor: 'rgba(0, 0, 0, 0.2)',
                    topColor: 'rgba(255, 255, 255, 0.25)',
                },
                options: VIEW_OPTIONS,
                selectedOptionColor: '#f5f3f3',
                trackBackgroundColor: 'rgba(255, 255, 255, 0.08)',
                unselectedOptionColor: 'rgba(245, 243, 243, 0.6)',
            },
            label: 'Appearance overrides with indicator shadows',
            width: 240,
        },
        {
            config: {
                options: VIEW_OPTIONS.map(
                    option => ({
                        ...option,
                        closable: true,
                    }),
                ),
                onClose: value => announce(`Close requested for ${value}`),
            },
            label: 'Closable options',
            width: 260,
        },
    ]
    page.addSection({
        title: 'Sliding switch',
        description: `The indicator slides over ${SLIDING_SWITCH_TRANSITION_DURATION_MS} ms by default and speeds up for distant jumps. Arrow keys, Home and End work on the focused segment.`,
        columns: 2,
        content: slidingVariants.map((variant, index) => {
            const stage = createSvgStage({
                height: 32,
                width: variant.width,
            })
            page.own(
                createSlidingSwitch(
                    stage.svg,
                    {
                        id: `sliding-switch-${index}`,
                        options: VIEW_OPTIONS,
                        width: variant.width,
                        x: 0,
                        y: 0,
                        onChange: value => announce(`Selected ${value}`),
                        ...variant.config,
                    },
                ),
            )

            return createShowcaseSpecimen({
                content: stage.host,
                label: variant.label,
                surface: variant.config.trackBackgroundColor ? 'dark' : 'plain',
            })
        }),
    })

    const tabVariants: Array<{
        config: Partial<Parameters<typeof createSlidingTabsSwitch>[1]>
        label: string
    }> = [
        {
            config: {},
            label: 'Default tabs, close on hover',
        },
        {
            config: { minTabWidth: 120 },
            label: 'minTabWidth: 120, scrolls sideways',
        },
        {
            config: {
                activeTabBoxShadow: '0 1px 4px rgba(26, 39, 68, 0.25)',
                activeTabInsetShadow: {
                    bottomColor: 'rgba(0, 0, 0, 0.06)',
                    topColor: 'rgba(255, 255, 255, 0.9)',
                },
            },
            label: 'Active tab shadows',
        },
    ]
    page.addSection({
        title: 'Sliding tabs switch',
        description: 'A tab strip that composes the sliding switch with tag pills in content mode.',
        content: tabVariants.map((variant, index) => {
            const stage = createSvgStage({
                height: 30,
                width: 480,
            })
            page.own(
                createSlidingTabsSwitch(
                    stage.svg,
                    {
                        height: 28,
                        id: `tabs-${index}`,
                        selectedValue: TAB_OPTIONS[1].value,
                        tabs: TAB_OPTIONS,
                        width: 480,
                        x: 0,
                        y: 0,
                        onChange: value => announce(`Opened ${value}`),
                        onClose: value => announce(`Close requested for ${value}`),
                        ...variant.config,
                    },
                ),
            )

            return createShowcaseSpecimen({
                content: stage.host,
                label: variant.label,
            })
        }),
    })

    const pillVariants: Array<{
        config: Partial<TagPillConfig>
        label: string
    }> = [
        {
            config: {},
            label: "variant: 'neutral'",
        },
        {
            config: { variant: 'explicit' },
            label: "variant: 'explicit'",
        },
        {
            config: { variant: 'auto' },
            label: "variant: 'auto'",
        },
        {
            config: { selected: true },
            label: 'selected',
        },
        {
            config: { hovered: true },
            label: 'hovered',
        },
        {
            config: { disabled: true },
            label: 'disabled',
        },
        {
            config: { closable: true },
            label: 'closable',
        },
        {
            config: {
                closable: true,
                closePlacement: 'end',
            },
            label: "closePlacement: 'end'",
        },
        {
            config: {
                closable: true,
                closeVisibility: 'hover',
            },
            label: "closeVisibility: 'hover'",
        },
        {
            config: {
                icon: claudeIcon,
                label: 'Claude',
            },
            label: 'icon',
        },
        {
            config: {
                icon: geminiIcon,
                iconColor: '#3d649c',
                label: 'Gemini',
                labelAlign: 'start',
                width: 140,
            },
            label: "iconColor, labelAlign: 'start'",
        },
        {
            config: {
                colors: {
                    fill: '#dcece9',
                    fillHover: '#c3dedd',
                    stroke: '#82b2c0',
                    text: '#1a3a47',
                },
                icon: tagIcon,
                label: 'Custom colors',
            },
            label: 'colors override',
        },
        {
            config: {
                surface: 'content',
                hovered: true,
            },
            label: "surface: 'content', hovered",
        },
        {
            config: {
                fontSize: 14,
                fontWeight: 600,
                height: 32,
                horizontalPadding: 18,
            },
            label: 'height 32, 14px semibold',
        },
    ]
    page.addSection({
        title: 'Tag pill',
        description: 'Pills size to their label unless a width is given, and never truncate it.',
        columns: 4,
        content: pillVariants.map((variant, index) => {
            const stage = createSvgStage({
                height: (variant.config.height ?? 24) + 4,
                width: 170,
            })
            page.own(
                createTagPill(
                    stage.svg,
                    {
                        id: `pill-${index}`,
                        label: 'Context tag',
                        x: 2,
                        y: 2,
                        onClick: id => announce(`Clicked ${id}`),
                        onClose: id => announce(`Close requested for ${id}`),
                        ...variant.config,
                    },
                ),
            )

            return createShowcaseSpecimen({
                content: stage.host,
                label: variant.label,
            })
        }),
    })

    return page
}
