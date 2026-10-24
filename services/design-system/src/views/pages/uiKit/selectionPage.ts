// Value pickers from @lixpi/ui-kit: the ordered-value slider, the compact
// sliding dropdown and the menu dropdown built on the info bubble.

import {
    createPureDropdown,
    type DropdownOption,
    type PureDropdownConfig,
    type PureDropdownInstance,
} from '@lixpi/ui-kit/components/dropdown'
import { createSlider } from '@lixpi/ui-kit/components/slider'
import { createSlidingDropdown } from '@lixpi/ui-kit/components/sliding-dropdown'
import { uiKitSettings } from '@lixpi/ui-kit'
import {
    claudeIcon,
    gptAvatarIcon,
    geminiColorIcon,
    stabilityIcon,
    bytedanceIcon,
    verticalTrippleDots,
} from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import {
    createGentelellaAvatar,
    createGentelellaCode,
} from '@lixpi/ui-kit-gentelella/components/foundation'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import { createSvgStage } from '$src/views/showcase/svgStage.ts'

const MODELS: DropdownOption[] = [
    {
        color: '#d97757',
        icon: claudeIcon,
        tags: ['text', 'vision'],
        title: 'Claude',
    },
    {
        color: '#10a37f',
        icon: gptAvatarIcon,
        tags: ['text', 'image'],
        title: 'GPT',
    },
    {
        color: '#4285f4',
        icon: geminiColorIcon,
        tags: ['text', 'image', 'video'],
        title: 'Gemini',
    },
    {
        color: '#8e44ad',
        icon: stabilityIcon,
        tags: ['image'],
        title: 'Stable Diffusion',
    },
    {
        color: '#325ab4',
        icon: bytedanceIcon,
        tags: ['video'],
        title: 'Seedance',
    },
]

const DURATIONS = ['4', '6', '8', '10', '12'].map(
    value => ({
        label: `${value}s`,
        value,
    }),
)

const QUALITY = [{
    label: 'Standard',
    value: 'standard',
}, {
    label: 'High',
    value: 'high',
}, {
    label: 'Ultra',
    value: 'ultra',
}, {
    label: 'Draft (unavailable)',
    value: 'draft',
    disabled: true,
}]

const ASPECT_RATIOS = ['1:1', '4:3', '3:2', '16:9', '21:9', '9:16'].map(
    value => ({
        label: value,
        value,
    }),
)

export const createSelectionPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit',
        title: 'Sliders and dropdowns',
        description: 'The slider and sliding dropdown are D3 SVG controls. The dropdown is DOM built on the info bubble, with keyboard navigation, outside dismissal and focus restoration.',
    })

    const sliderVariants = [
        {
            label: 'Five durations, selected 6s',
            options: DURATIONS,
            selectedValue: '6',
        },
        {
            label: 'A special value sizes the bubble to its label',
            options: [...DURATIONS, {
                label: 'Smart length',
                value: 'smart',
            }],
            selectedValue: 'smart',
        },
        {
            label: 'Disabled values are skipped',
            options: DURATIONS.map(
                option => ({
                    ...option,
                    disabled: option.value === '8',
                }),
            ),
            selectedValue: '4',
        },
    ]
    page.addSection({
        title: 'Slider',
        description: 'Drag the thumb or use the arrow keys, Home and End. setValue changes the value without calling onChange.',
        content: sliderVariants.map((variant, index) => {
            const stage = createSvgStage({
                height: 66,
                width: 360,
            })
            const slider = page.own(
                createSlider(
                    stage.svg,
                    {
                        id: `slider-${index}`,
                        options: variant.options,
                        selectedValue: variant.selectedValue,
                        width: 360,
                        x: 0,
                        y: 0,
                        onChange: value => announce(`Slider value ${value}`),
                    },
                ),
            )
            const reset = page.own(
                createGentelellaButton({
                    label: 'setValue(first)',
                    onClick: () => slider.setValue(variant.options[0].value),
                    size: 'small',
                    variant: 'ghost',
                }),
            )

            return createShowcaseSpecimen({
                content: [stage.host, reset.el],
                label: variant.label,
            })
        }),
    })

    const dropdownVariants: Array<{
        config: Partial<Parameters<typeof createSlidingDropdown>[1]>
        label: string
    }> = [
        {
            config: {
                ariaLabel: 'Quality',
                options: QUALITY,
                selectedValue: 'standard',
            },
            label: 'Quality with a disabled option',
        },
        {
            config: {
                ariaLabel: 'Aspect ratio',
                options: ASPECT_RATIOS,
                selectedValue: '16:9',
            },
            label: 'Long list, opens around the selected row',
        },
        {
            config: {
                ariaLabel: 'Duration',
                optionHorizontalPadding: 20,
                options: DURATIONS,
                selectedValue: '8',
                transition: {
                    durationMs: 400,
                    snapDurationMs: 120,
                },
            },
            label: 'optionHorizontalPadding: 20, slower open',
        },
        {
            config: {
                ariaLabel: 'Aspect ratio',
                height: 48,
                indicatorBoxShadow: '0 2px 6px rgba(26, 39, 68, 0.18)',
                indicatorInsetShadow: {
                    bottomColor: 'rgba(0, 0, 0, 0.04)',
                    topColor: 'rgba(255, 255, 255, 0.9)',
                },
                options: ASPECT_RATIOS,
                selectedValue: '1:1',
            },
            label: 'height: 48 with indicator shadows',
        },
    ]
    page.addSection({
        title: 'Sliding dropdown',
        description: 'Click the row or chevron, scroll, drag or use the arrow keys. The open tape portals above the page so it never resizes or clips its host.',
        columns: 4,
        content: dropdownVariants.map((variant, index) => {
            const stage = createSvgStage({
                height: variant.config.height ?? 66,
                width: 180,
            })
            page.own(
                createSlidingDropdown(
                    stage.svg,
                    {
                        id: `sliding-dropdown-${index}`,
                        options: QUALITY,
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
            })
        }),
    })

    const dropdown = (
        id: string,
        config: Partial<PureDropdownConfig>,
    ): HTMLElement => {
        const instance: PureDropdownInstance<DropdownOption> = page.own(
            createPureDropdown({
                id,
                options: MODELS,
                selectedValue: MODELS[0],
                onSelect: option => {
                    instance.update(option)
                    announce(`Selected ${option.title}`)
                },
                ...config,
            }),
        )

        return instance.dom
    }
    const avatar = page.own(
        createGentelellaAvatar({
            initials: 'LX',
            size: 'small',
            status: 'online',
        }),
    )
    let errorActive = true
    const errorDropdown: PureDropdownInstance<DropdownOption> = page.own(
        createPureDropdown({
            errorState: { title: 'Model unavailable' },
            id: 'dropdown-error',
            options: MODELS,
            selectedValue: MODELS[1],
            onSelect: option => errorDropdown.update(option),
        }),
    )
    const toggleError = page.own(
        createGentelellaButton({
            label: 'Toggle error state',
            onClick: () => {
                errorActive = !errorActive
                errorDropdown.setErrorState({
                    enabled: errorActive,
                    title: 'Model unavailable',
                })
            },
            size: 'small',
            variant: 'outline',
        }),
    )
    page.addSection({
        title: 'Dropdown',
        description: 'Only one dropdown is open at a time. Options can carry an icon, a color and filter tags.',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: dropdown('dropdown-light', { theme: 'light' }),
                label: "theme: 'light'",
            }),
            createShowcaseSpecimen({
                content: dropdown('dropdown-dark', { theme: 'dark' }),
                label: "theme: 'dark' (default)",
                surface: 'dark',
            }),
            createShowcaseSpecimen({
                content: dropdown(
                    'dropdown-monochrome',
                    {
                        ignoreColorValuesForOptions: true,
                        ignoreColorValuesForSelectedValue: true,
                        theme: 'light',
                    },
                ),
                label: 'Color values ignored',
            }),
            createShowcaseSpecimen({
                content: dropdown(
                    'dropdown-icon-only',
                    {
                        renderTitleForSelectedValue: false,
                        theme: 'light',
                        triggerLabel: 'Model',
                    },
                ),
                label: 'Icon-only trigger',
            }),
            createShowcaseSpecimen({
                content: dropdown(
                    'dropdown-titles-only',
                    {
                        renderIconForOptions: false,
                        renderIconForSelectedValue: false,
                        theme: 'light',
                    },
                ),
                label: 'Titles only',
            }),
            createShowcaseSpecimen({
                content: dropdown(
                    'dropdown-tags',
                    {
                        availableTags: ['text', 'image', 'video', 'vision'],
                        enableTagFilter: true,
                        theme: 'light',
                    },
                ),
                label: 'Tag filter',
            }),
            createShowcaseSpecimen({
                content: dropdown(
                    'dropdown-avatar',
                    {
                        theme: 'light',
                        triggerContent: avatar.el,
                        triggerLabel: 'Account menu',
                    },
                ),
                label: 'triggerContent with an avatar',
            }),
            createShowcaseSpecimen({
                content: dropdown(
                    'dropdown-custom-icon',
                    {
                        buttonIcon: verticalTrippleDots,
                        mountToBody: true,
                        popoverClassName: 'design-system-dropdown-popover',
                        theme: 'light',
                    },
                ),
                label: 'buttonIcon, mountToBody, popoverClassName',
            }),
            createShowcaseSpecimen({
                content: createShowcaseRow([errorDropdown.dom, toggleError.el]),
                label: 'errorState and setErrorState',
            }),
        ],
    })

    page.addSection({
        title: 'Runtime settings',
        description: 'Applications pass their own values through configureUiKit once at startup. The design system passes the package defaults shown here.',
        content: page.own(
            createGentelellaCode({
                code: JSON.stringify(
                    uiKitSettings,
                    null,
                    4,
                ),
            }),
        ).el,
    })

    return page
}
