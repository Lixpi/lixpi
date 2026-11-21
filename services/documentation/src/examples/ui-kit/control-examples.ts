import {
    BUTTON_SIZES,
    createButton,
    type ButtonInstance,
    type ButtonSize,
    type ButtonVariant,
} from '@lixpi/ui-kit/components/button'
import {
    createTextArea,
    createTextInput,
} from '@lixpi/ui-kit/components/text-input'
import { createToggleSwitch } from '@lixpi/ui-kit/components/toggle-switch'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
    type SlidingSwitchOption,
} from '@lixpi/ui-kit/components/sliding-switch'
import { createSlidingTabsSwitch } from '@lixpi/ui-kit/components/sliding-tabs-switch'
import { createSlider } from '@lixpi/ui-kit/components/slider'
import { createSlidingDropdown } from '@lixpi/ui-kit/components/sliding-dropdown'
import {
    createTagPill,
    type TagPillVariant,
} from '@lixpi/ui-kit/components/tag-pill'
import {
    imageIcon,
    plusIcon,
    tagIcon,
    videoIcon,
} from '@lixpi/ui-kit/svg'

import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

const TOGGLE_INSET = 2
const SWITCH_HEIGHT = 30
const SLIDER_HEIGHT = 66
const DROPDOWN_HEIGHT = 38

const mediaOptions: SlidingSwitchOption[] = [
    {
        label: 'Image',
        value: 'image',
    },
    {
        label: 'Video',
        value: 'video',
    },
    {
        label: 'Audio',
        value: 'audio',
    },
    {
        label: 'Text',
        value: 'text',
        disabled: true,
    },
]

const optionTitles = (options: readonly SlidingSwitchOption[]): Record<string, string> => Object.fromEntries(
    options.map(option => [option.value, option.label]),
)

const createButtonExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createButton is the one text button every Lixpi application uses. Primary marks the main action of a surface and secondary the rest. Small, medium and large each have three sizes, from xxx-small to xxx-large; xx-medium is the default. Write a button by hand only when it is part of another component\'s own design, such as a menu item or an icon control.',
    )
    let variant: ButtonVariant = 'primary'
    let size: ButtonSize = 'xx-medium'
    let label = 'Generate'
    let withIcon = false
    let disabled = false
    let clicks = 0
    const live = example.specimen('Live button')
    let button: ButtonInstance | null = null
    const mount = (): void => {
        button?.destroy()
        button = createButton({
            label,
            variant,
            size,
            icon: withIcon ? plusIcon : undefined,
            disabled,
            onClick: () => {
                clicks += 1
                example.frame.report(`Pressed ${clicks} times.`)
            },
        })
        live.replaceChildren(button.element)
    }
    mount()
    example.own(() => button?.destroy())
    const gallery = example.specimen('Variants')
    const galleryButtons = [
        createButton({
            label: 'Primary',
            variant: 'primary',
        }),
        createButton({ label: 'Secondary' }),
        createButton({
            label: 'With icon',
            icon: plusIcon,
        }),
        createButton({
            label: 'Disabled',
            disabled: true,
        }),
    ]
    gallery.append(...galleryButtons.map(item => item.element))
    const scale = example.specimen('Sizes')
    scale.dataset.align = 'center'
    const scaleButtons = BUTTON_SIZES.map(
        name => createButton({
            label: name,
            variant: 'primary',
            size: name,
            icon: plusIcon,
        }),
    )
    scale.append(...scaleButtons.map(item => item.element))
    example.own(() => {
        for (const item of scaleButtons)
            item.destroy()
    })
    example.own(() => {
        for (const item of galleryButtons)
            item.destroy()
    })
    example.frame.text(
        'Label',
        label,
        value => {
            label = value
            button?.setLabel(value)
        },
    )
    example.frame.select(
        'Variant',
        variant,
        {
            primary: 'Primary',
            secondary: 'Secondary',
        },
        value => {
            variant = value as ButtonVariant
            mount()
        },
    )
    example.frame.select(
        'Size',
        size,
        Object.fromEntries(
            BUTTON_SIZES.map(name => [name, name]),
        ),
        value => {
            size = value as ButtonSize
            mount()
        },
    )
    example.frame.toggle(
        'Icon',
        withIcon,
        value => {
            withIcon = value
            mount()
        },
    )
    example.frame.toggle(
        'Disabled',
        disabled,
        value => {
            disabled = value
            button?.setDisabled(value)
        },
    )
    example.frame.code(
        () => [
            "import { createButton } from '@lixpi/ui-kit/components/button'",
            "import '@lixpi/ui-kit/styles/button'",
            '',
            'const button = createButton({',
            `    label: ${JSON.stringify(label)},`,
            `    variant: '${variant}',`,
            `    size: '${size}',`,
            ...(withIcon ? ['    icon: plusIcon,'] : []),
            ...(disabled ? ['    disabled: true,'] : []),
            '    onClick: () => composer.submit(),',
            '})',
            'toolbar.append(button.element)',
        ].join('\n'),
    )

    return example
}

const createTextInputExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createTextInput and createTextArea are the text fields every Lixpi application uses. The element owns its value: onInput reports typing, setValue changes the value without reporting, and setInvalid marks a rejected value.',
    )
    const fields = example.specimen('Fields')
    const status = createTextInput({
        ariaLabel: 'Workspace name',
        placeholder: 'Workspace name',
        onInput: value => example.frame.report(`Typed ${JSON.stringify(value)}.`),
    })
    const number = createTextInput({
        ariaLabel: 'Width in pixels',
        type: 'number',
        step: 'any',
        value: '1024',
        onInput: value => number.setInvalid(!Number.isFinite(
            Number.parseFloat(value),
        )),
    })
    const area = createTextArea({
        ariaLabel: 'Prompt',
        placeholder: 'Describe the image',
        rows: 4,
    })
    const disabledField = createTextInput({
        ariaLabel: 'Read-only identifier',
        value: 'asset-7f3c',
        disabled: true,
    })
    fields.append(
        html`<div className="documentation-ui-field-column">${status.element}${number.element}${area.element}${disabledField.element}</div>` as HTMLElement,
    )
    example.own(() => {
        for (const field of [status, number, area, disabledField])
            field.destroy()
    })
    example.frame.button('Mark the name invalid', () => status.setInvalid(true))
    example.frame.button('Clear the mark', () => status.setInvalid(false))
    example.frame.button('Set the name', () => status.setValue('Autumn launch'))
    example.frame.code(
        () => [
            "import { createTextInput, createTextArea } from '@lixpi/ui-kit/components/text-input'",
            "import '@lixpi/ui-kit/styles/text-input'",
            '',
            "const name = createTextInput({ ariaLabel: 'Workspace name', placeholder: 'Workspace name', onInput: value => draft.rename(value) })",
            "const prompt = createTextArea({ ariaLabel: 'Prompt', rows: 4 })",
            "name.setInvalid(true)",
        ].join('\n'),
    )

    return example
}

const createToggleExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createToggleSwitch renders an on/off switch into a caller-owned SVG. Click it or focus it and press Space. Programmatic setChecked does not report a change; only the user does.',
    )
    const body = example.specimen('Toggle switch')
    let width = 46
    let height = 26
    const svg = example.svg(
        body,
        {
            width: width + TOGGLE_INSET * 2,
            height: height + TOGGLE_INSET * 2,
        },
    )
    const toggle = createToggleSwitch(
        svg,
        {
            id: 'documentation-toggle-switch',
            x: TOGGLE_INSET,
            y: TOGGLE_INSET,
            width,
            height,
            checked: true,
            onChange: checked => example.frame.report(`The user switched it ${checked ? 'on' : 'off'}.`),
        },
    )
    example.own(() => toggle.destroy())
    const resize = (): void => {
        toggle.resize(
            TOGGLE_INSET,
            TOGGLE_INSET,
            width,
            height,
        )
        svg
            .attr('width', width + TOGGLE_INSET * 2)
            .attr('height', height + TOGGLE_INSET * 2)
    }
    example.frame.toggle(
        'Checked',
        true,
        checked => toggle.setChecked(checked),
    )
    example.frame.toggle(
        'Disabled',
        false,
        disabled => toggle.setDisabled(disabled),
    )
    example.frame.number(
        'Width',
        { value: width },
        value => {
            width = value
            resize()
        },
    )
    example.frame.number(
        'Height',
        { value: height },
        value => {
            height = value
            resize()
        },
    )
    example.frame.code(
        () => [
            "import { createToggleSwitch } from '@lixpi/ui-kit/components/toggle-switch'",
            '',
            "const toggle = createToggleSwitch(select(svg), {",
            "    id: 'notifications',",
            `    x: ${TOGGLE_INSET},`,
            `    y: ${TOGGLE_INSET},`,
            `    width: ${width},`,
            `    height: ${height},`,
            `    checked: ${toggle.getChecked()},`,
            '    onChange: checked => settings.setNotifications(checked),',
            '})',
        ].join('\n'),
    )

    return example
}

const createSlidingSwitchExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createSlidingSwitch draws segmented options with an indicator that slides to the selected one. Disabled options cannot be chosen. In the second switch every option is closable; closing one rebuilds the switch without it.',
    )
    let width = 360
    const body = example.specimen('Segmented options')
    const svg = example.svg(
        body,
        {
            width,
            height: SWITCH_HEIGHT,
        },
    )
    const sliding = createSlidingSwitch(
        svg,
        {
            id: 'documentation-sliding-switch',
            x: 0,
            y: 0,
            width,
            height: SWITCH_HEIGHT,
            options: mediaOptions,
            selectedValue: 'image',
            onChange: value => example.frame.report(`Selected ${value}.`),
        },
    )
    example.own(() => sliding.destroy())
    example.frame.select(
        'Selected option',
        'image',
        optionTitles(
            mediaOptions.filter(option => !option.disabled),
        ),
        value => sliding.setValue(value),
    )
    example.frame.number(
        'Width',
        { value: width },
        value => {
            if (value <= 0)
                throw new Error('Width must be greater than zero.')

            width = value
            svg.attr('width', width)
            sliding.resize(
                0,
                0,
                width,
                SWITCH_HEIGHT,
            )
        },
    )

    const closableBody = example.specimen('Closable options')
    const closableSvg = example.svg(
        closableBody,
        {
            width: 360,
            height: SWITCH_HEIGHT,
        },
    )
    let closableOptions = mediaOptions.slice(0, 3).map(
        option => ({
            ...option,
            closable: true,
        }),
    )
    let closable: SlidingSwitchInstance | null = null
    const mountClosable = (): void => {
        closable?.destroy()
        closable = createSlidingSwitch(
            closableSvg,
            {
                id: 'documentation-sliding-switch-closable',
                x: 0,
                y: 0,
                width: 360,
                height: SWITCH_HEIGHT,
                options: closableOptions,
                selectedValue: closableOptions[0]?.value,
                onClose: value => {
                    closableOptions = closableOptions.filter(option => option.value !== value)
                    example.frame.report(`Closed ${value}. ${closableOptions.length} options remain.`)
                    mountClosable()
                },
            },
        )
    }
    mountClosable()
    example.own(() => closable?.destroy())
    example.frame.button('Restore closed options', () => {
        closableOptions = mediaOptions.slice(0, 3).map(
            option => ({
                ...option,
                closable: true,
            }),
        )
        mountClosable()
    })
    example.frame.code(
        () => [
            "import { createSlidingSwitch } from '@lixpi/ui-kit/components/sliding-switch'",
            '',
            'const mediaMode = createSlidingSwitch(select(svg), {',
            "    id: 'media-mode',",
            '    x: 0,',
            '    y: 0,',
            `    width: ${width},`,
            `    height: ${SWITCH_HEIGHT},`,
            "    options: [{ label: 'Image', value: 'image' }, { label: 'Text', value: 'text', disabled: true }],",
            `    selectedValue: '${sliding.getValue()}',`,
            '    onChange: value => composer.setMode(value),',
            '})',
        ].join('\n'),
    )

    return example
}

const createTabsExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createSlidingTabsSwitch is the tab bar built on the sliding switch. The active tab carries the raised shadow that the documentation inspector uses for its Parameters and Code tabs.',
    )
    const body = example.specimen('Tabs')
    const svg = example.svg(
        body,
        {
            width: 320,
            height: SWITCH_HEIGHT,
        },
    )
    const tabs = createSlidingTabsSwitch(
        svg,
        {
            id: 'documentation-sliding-tabs',
            x: 0,
            y: 0,
            width: 320,
            height: SWITCH_HEIGHT,
            tabs: [
                {
                    label: 'Parameters',
                    value: 'parameters',
                },
                {
                    label: 'Code',
                    value: 'code',
                },
                {
                    label: 'History',
                    value: 'history',
                },
            ],
            selectedValue: 'parameters',
            onChange: value => example.frame.report(`Opened the ${value} tab.`),
        },
    )
    example.own(() => tabs.destroy())
    example.frame.select(
        'Active tab',
        'parameters',
        {
            parameters: 'Parameters',
            code: 'Code',
            history: 'History',
        },
        value => tabs.setValue(value),
    )
    example.frame.code(
        () => [
            "import { createSlidingTabsSwitch } from '@lixpi/ui-kit/components/sliding-tabs-switch'",
            '',
            'const tabs = createSlidingTabsSwitch(select(svg), {',
            "    id: 'inspector-view',",
            '    x: 0,',
            '    y: 0,',
            '    width: 320,',
            `    height: ${SWITCH_HEIGHT},`,
            "    tabs: [{ label: 'Parameters', value: 'parameters' }, { label: 'Code', value: 'code' }],",
            `    selectedValue: '${tabs.getValue()}',`,
            '    onChange: view => inspector.show(view),',
            '})',
        ].join('\n'),
    )

    return example
}

const sliderOptions = [
    {
        value: 'draft',
        label: 'Draft',
    },
    {
        value: 'standard',
        label: 'Standard',
    },
    {
        value: 'high',
        label: 'High',
    },
    {
        value: 'ultra',
        label: 'Ultra',
    },
]

const createSliderExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createSlider steps between labelled options. Drag the handle, click a stop, or focus the slider and use the arrow keys.',
    )
    let width = 380
    const body = example.specimen('Quality')
    const svg = example.svg(
        body,
        {
            width,
            height: SLIDER_HEIGHT,
        },
    )
    const slider = createSlider(
        svg,
        {
            id: 'documentation-slider',
            x: 0,
            y: 0,
            width,
            height: SLIDER_HEIGHT,
            options: sliderOptions,
            selectedValue: 'standard',
            onChange: value => example.frame.report(`Quality is ${value}.`),
        },
    )
    example.own(() => slider.destroy())
    example.frame.select(
        'Value',
        'standard',
        Object.fromEntries(
            sliderOptions.map(option => [option.value, option.label]),
        ),
        value => slider.setValue(value),
    )
    example.frame.number(
        'Width',
        { value: width },
        value => {
            if (value <= 0)
                throw new Error('Width must be greater than zero.')

            width = value
            svg.attr('width', width)
            slider.resize(
                0,
                0,
                width,
                SLIDER_HEIGHT,
            )
        },
    )
    example.frame.code(
        () => [
            "import { createSlider } from '@lixpi/ui-kit/components/slider'",
            '',
            'const quality = createSlider(select(svg), {',
            "    id: 'quality',",
            '    x: 0,',
            '    y: 0,',
            `    width: ${width},`,
            "    options: [{ value: 'draft', label: 'Draft' }, { value: 'high', label: 'High' }],",
            `    selectedValue: '${slider.getValue()}',`,
            '    onChange: value => settings.setQuality(value),',
            '})',
        ].join('\n'),
    )

    return example
}

const createSlidingDropdownExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createSlidingDropdown shows the selected option and opens a list in place, sliding its indicator to the hovered option. Choose with the pointer, or with the arrow keys and Enter.',
    )
    const body = example.specimen('Model')
    const svg = example.svg(
        body,
        {
            width: 220,
            height: DROPDOWN_HEIGHT,
        },
    )
    const dropdown = createSlidingDropdown(
        svg,
        {
            id: 'documentation-sliding-dropdown',
            x: 0,
            y: 0,
            width: 220,
            height: DROPDOWN_HEIGHT,
            optionHorizontalPadding: 7,
            options: [
                {
                    label: 'Fast draft',
                    value: 'fast',
                },
                {
                    label: 'Balanced',
                    value: 'balanced',
                },
                {
                    label: 'Highest quality',
                    value: 'quality',
                },
            ],
            selectedValue: 'balanced',
            ariaLabel: 'Model',
            observeParentResize: false,
            onChange: value => example.frame.report(`Selected ${value}.`),
            onOpenChange: open => example.frame.report(open ? 'The list is open.' : 'The list is closed.'),
        },
    )
    example.own(() => dropdown.destroy())
    example.frame.button('Open', () => dropdown.setOpen(true))
    example.frame.button('Close', () => dropdown.setOpen(false))
    example.frame.code(
        () => [
            "import { createSlidingDropdown } from '@lixpi/ui-kit/components/sliding-dropdown'",
            '',
            'const model = createSlidingDropdown(select(svg), {',
            "    id: 'model',",
            '    x: 0,',
            '    y: 0,',
            '    width: 220,',
            `    height: ${DROPDOWN_HEIGHT},`,
            "    options: [{ label: 'Balanced', value: 'balanced' }],",
            `    selectedValue: '${dropdown.getValue()}',`,
            "    ariaLabel: 'Model',",
            '    onChange: value => composer.setModel(value),',
            '})',
        ].join('\n'),
    )

    return example
}

const tagVariants: Record<TagPillVariant, string> = {
    neutral: 'Neutral',
    explicit: 'Explicit',
    auto: 'Auto',
}

const createTagPillExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createTagPill renders one SVG pill. Click a pill to select it, and use the close button on closable pills. Variants change the stroke treatment.',
    )
    let variant: TagPillVariant = 'neutral'
    let selected = false
    const pills = example.specimen('Pills')
    let mounted: Array<{ destroy: () => void }> = []
    const release = (): void => {
        for (const pill of mounted)
            pill.destroy()

        mounted = []
        pills.replaceChildren()
    }
    const mount = (): void => {
        release()

        const configs = [
            {
                label: 'Portrait',
                icon: imageIcon,
                closable: false,
            },
            {
                label: 'Campaign video',
                icon: videoIcon,
                closable: true,
            },
            {
                label: 'Tag',
                icon: tagIcon,
                closable: true,
            },
            {
                label: 'Plain text',
                icon: undefined,
                closable: false,
            },
        ]

        for (const [index, config] of configs.entries()) {
            const svg = example.svg(
                pills,
                {
                    width: 180,
                    height: 28,
                },
            )
            const pill = createTagPill(
                svg,
                {
                    id: `documentation-tag-${index}`,
                    x: 2,
                    y: 2,
                    label: config.label,
                    icon: config.icon,
                    closable: config.closable,
                    selected,
                    variant,
                    onClick: () => example.frame.report(`Clicked ${config.label}.`),
                    onClose: () => {
                        svg.attr('display', 'none')
                        example.frame.report(`Removed ${config.label}.`)
                    },
                },
            )
            mounted.push(pill)
        }
    }
    mount()
    example.own(release)
    example.frame.select(
        'Variant',
        variant,
        tagVariants,
        value => {
            variant = value as TagPillVariant
            mount()
        },
    )
    example.frame.toggle(
        'Selected',
        selected,
        value => {
            selected = value
            mount()
        },
    )
    example.frame.button('Restore pills', mount)
    example.frame.code(
        () => [
            "import { createTagPill } from '@lixpi/ui-kit/components/tag-pill'",
            "import { imageIcon } from '@lixpi/ui-kit/svg'",
            '',
            'const pill = createTagPill(select(svg), {',
            "    id: 'portrait',",
            '    x: 0,',
            '    y: 0,',
            "    label: 'Portrait',",
            '    icon: imageIcon,',
            `    variant: '${variant}',`,
            `    selected: ${selected},`,
            '    closable: true,',
            '    onClose: id => selection.remove(id),',
            '})',
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'ui-kit-button': createButtonExample,
    'ui-kit-text-input': createTextInputExample,
    'ui-kit-toggle-switch': createToggleExample,
    'ui-kit-sliding-switch': createSlidingSwitchExample,
    'ui-kit-sliding-tabs-switch': createTabsExample,
    'ui-kit-slider': createSliderExample,
    'ui-kit-sliding-dropdown': createSlidingDropdownExample,
    'ui-kit-tag-pill': createTagPillExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown UI kit control example: ${id}`)

    return factory(host)
}
