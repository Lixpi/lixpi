import { createActionPanel } from '@lixpi/ui-kit/components/action-panel'
import {
    createPureDropdown,
    type DropdownOption,
} from '@lixpi/ui-kit/components/dropdown'
import {
    BubbleMenu,
    BubbleMenuDropdown,
    type BubbleMenuItem,
    type BubbleMenuPlacement,
} from '@lixpi/ui-kit/components/bubble-menu'
import {
    alignCenterIcon,
    alignLeftIcon,
    alignRightIcon,
    boldIcon,
    claudeIcon,
    codeBlockIcon,
    downloadIcon,
    geminiColorIcon,
    gptAvatarIcon,
    heading1Icon,
    imageIcon,
    italicIcon,
    linkIcon,
    paragraphIcon,
    pencilIcon,
    plusIcon,
    redoIcon,
    stabilityIcon,
    strikethroughIcon,
    trashBinIcon,
    undoIcon,
} from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

const actionIcons: Readonly<Record<string, string>> = {
    plus: plusIcon,
    pencil: pencilIcon,
    download: downloadIcon,
    trash: trashBinIcon,
    undo: undoIcon,
    redo: redoIcon,
}

const createActionPanelExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createActionPanel holds icon buttons and host elements in display order. One button makes a circle; more buttons stretch it into a pill. Buttons keep their accessible names and show them through the shared help tooltip.',
    )
    const body = example.specimen('Panels')
    const single = createActionPanel({
        document,
        children: [{
            iconSvg: plusIcon,
            ariaLabel: 'Add',
            onClick: () => example.frame.report('Add was pressed.'),
        }],
    })
    const panel = createActionPanel({
        document,
        children: [
            {
                iconSvg: undoIcon,
                ariaLabel: 'Undo',
                onClick: () => example.frame.report('Undo was pressed.'),
            },
            {
                iconSvg: redoIcon,
                ariaLabel: 'Redo',
                onClick: () => example.frame.report('Redo was pressed.'),
            },
        ],
    })
    body.append(single.element, panel.element)
    example.own(() => single.destroy())
    example.own(() => panel.destroy())
    let buttons = 2
    let nextIcon = 'plus'
    example.frame.select(
        'Next icon',
        nextIcon,
        {
            plus: 'Plus',
            pencil: 'Pencil',
            download: 'Download',
            trash: 'Trash',
        },
        value => void (nextIcon = value),
    )
    example.frame.button('Add a button', () => {
        const label = `${nextIcon} ${buttons + 1}`
        panel.element.append(
            panel.createButton({
                iconSvg: actionIcons[nextIcon],
                ariaLabel: label,
                onClick: () => example.frame.report(`${label} was pressed.`),
            }),
        )
        buttons += 1
        example.frame.report(`The panel has ${buttons} buttons.`)
    })
    example.frame.button('Remove the last button', () => {
        const last = panel.element.querySelector('.action-panel-button:last-child')

        if (
            !last
            || buttons === 0
        )
            throw new Error('The panel has no buttons left.')

        last.remove()
        buttons -= 1
        example.frame.report(`The panel has ${buttons} buttons.`)
    })
    example.frame.code(
        () => [
            "import { createActionPanel } from '@lixpi/ui-kit/components/action-panel'",
            "import { undoIcon, redoIcon } from '@lixpi/ui-kit/svg'",
            '',
            'const panel = createActionPanel({',
            '    document,',
            '    children: [',
            "        { iconSvg: undoIcon, ariaLabel: 'Undo', onClick: () => history.undo() },",
            "        { iconSvg: redoIcon, ariaLabel: 'Redo', onClick: () => history.redo() },",
            '    ],',
            '})',
            'toolbar.append(panel.element)',
            `// ${buttons} buttons are mounted.`,
        ].join('\n'),
    )

    return example
}

type ModelOption = DropdownOption & {
    value: string
}

const modelOptions: ModelOption[] = [
    {
        title: 'GPT image',
        value: 'gpt',
        icon: gptAvatarIcon,
        tags: ['image', 'fast'],
    },
    {
        title: 'Claude',
        value: 'claude',
        icon: claudeIcon,
        tags: ['text'],
    },
    {
        title: 'Gemini',
        value: 'gemini',
        icon: geminiColorIcon,
        tags: ['image', 'video'],
    },
    {
        title: 'Stable Diffusion',
        value: 'stability',
        icon: stabilityIcon,
        tags: ['image'],
    },
]

const createDropdownExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createPureDropdown shows a selected value and opens a menu of options with optional icons and tag filtering. Menus mount on the document body so they are never clipped by the host.',
    )
    const body = example.specimen('Model')
    let selected = modelOptions[0]
    let tagFilter = true
    const mount = () =>
        createPureDropdown<ModelOption>({
            id: `documentation-dropdown-${crypto.randomUUID()}`,
            triggerLabel: 'Model',
            selectedValue: selected,
            options: modelOptions,
            enableTagFilter: tagFilter,
            availableTags: ['image', 'video', 'text', 'fast'],
            mountToBody: true,
            popoverClassName: 'application-panel-popover',
            onSelect: option => {
                selected = option
                dropdown.update(option)
                example.frame.report(`Selected ${option.title}.`)
            },
        })
    let dropdown = mount()
    body.append(dropdown.dom)
    example.own(() => dropdown.destroy())
    const remount = (): void => {
        const previous = dropdown
        dropdown = mount()
        previous.dom.replaceWith(dropdown.dom)
        previous.destroy()
    }
    example.frame.toggle(
        'Tag filter',
        tagFilter,
        value => {
            tagFilter = value
            remount()
        },
    )
    example.frame.toggle(
        'Error state',
        false,
        enabled => dropdown.setErrorState(enabled ? {
            enabled: true,
            title: 'Model unavailable',
        } : undefined),
    )
    example.frame.code(
        () => [
            "import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'",
            '',
            'const dropdown = createPureDropdown({',
            "    id: 'model',",
            `    selectedValue: { title: '${selected.title}', value: '${selected.value}' },`,
            '    options,',
            `    enableTagFilter: ${tagFilter},`,
            "    availableTags: ['image', 'video', 'text'],",
            '    mountToBody: true,',
            '    onSelect: option => dropdown.update(option),',
            '})',
        ].join('\n'),
    )

    return example
}

const toolbarButton = (
    label: string,
    icon: string,
    onClick: () => void,
): HTMLButtonElement =>
    html`
        <button
            type="button"
            className="bubble-menu-button"
            aria-label=${label}
            data-help-tooltip="aria-label"
            innerHTML=${icon}
            onmousedown=${(event: MouseEvent) => event.preventDefault()}
            onclick=${onClick}
        ></button>
    ` as HTMLButtonElement

const placements: Record<BubbleMenuPlacement, string> = {
    above: 'Above',
    below: 'Below',
    left: 'Left',
    right: 'Right',
    auto: 'Automatic',
}

const createBubbleMenuExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'BubbleMenu is the floating toolbar used over selections. Each item lists the contexts it belongs to, so one menu shows text formatting for text and image actions for an image. Choose a context and placement, then show it against the target.',
    )
    const frame = html`<div className="documentation-ui-frame"></div>` as HTMLElement
    const target = html`<span className="documentation-ui-bubble-target">Selected text</span>` as HTMLElement
    frame.append(target)
    example.specimen('Toolbar', frame)
    const report = (label: string) => () => example.frame.report(`${label} was pressed.`)
    const items: BubbleMenuItem[] = [
        {
            element: toolbarButton(
                'Bold',
                boldIcon,
                report('Bold'),
            ),
            context: ['text'],
        },
        {
            element: toolbarButton(
                'Italic',
                italicIcon,
                report('Italic'),
            ),
            context: ['text'],
        },
        {
            element: toolbarButton(
                'Strikethrough',
                strikethroughIcon,
                report('Strikethrough'),
            ),
            context: ['text'],
        },
        {
            element: toolbarButton(
                'Link',
                linkIcon,
                report('Link'),
            ),
            context: ['text'],
        },
        {
            element: toolbarButton(
                'Align left',
                alignLeftIcon,
                report('Align left'),
            ),
            context: ['image'],
        },
        {
            element: toolbarButton(
                'Align center',
                alignCenterIcon,
                report('Align center'),
            ),
            context: ['image'],
        },
        {
            element: toolbarButton(
                'Align right',
                alignRightIcon,
                report('Align right'),
            ),
            context: ['image'],
        },
        {
            element: toolbarButton(
                'Download',
                downloadIcon,
                report('Download'),
            ),
            context: ['image'],
        },
    ]
    const menu = new BubbleMenu({
        parentEl: frame,
        label: 'Formatting toolbar',
        items,
        onShow: context => example.frame.report(`Showing the ${context} toolbar.`),
        onHide: () => example.frame.report('The toolbar is hidden.'),
    })
    example.own(() => menu.destroy())
    let context = 'text'
    let placement: BubbleMenuPlacement = 'above'
    const show = (): void =>
        void menu.show(
            context,
            {
                targetRect: target.getBoundingClientRect(),
                placement,
                bounds: frame.getBoundingClientRect(),
                clampToParent: true,
            },
        )
    example.frame.select(
        'Context',
        context,
        {
            text: 'Text',
            image: 'Image',
        },
        value => {
            context = value

            if (menu.isVisible)
                show()
        },
    )
    example.frame.select(
        'Placement',
        placement,
        placements,
        value => {
            placement = value as BubbleMenuPlacement

            if (menu.isVisible)
                show()
        },
    )
    example.frame.button('Show', show)
    example.frame.button('Hide', () => menu.hide())
    example.frame.code(
        () => [
            "import { BubbleMenu } from '@lixpi/ui-kit/components/bubble-menu'",
            '',
            'const menu = new BubbleMenu({',
            '    parentEl: editorHost,',
            "    items: [{ element: boldButton, context: ['text'] }, { element: downloadButton, context: ['image'] }],",
            '})',
            '',
            `menu.show('${context}', {`,
            '    targetRect: selection.getBoundingClientRect(),',
            `    placement: '${placement}',`,
            '})',
        ].join('\n'),
    )

    return example
}

const textStyles = [
    {
        value: 'paragraph',
        label: 'Paragraph',
        icon: paragraphIcon,
    },
    {
        value: 'heading',
        label: 'Heading',
        icon: heading1Icon,
    },
    {
        value: 'code',
        label: 'Code block',
        icon: codeBlockIcon,
    },
    {
        value: 'image',
        label: 'Image',
        icon: imageIcon,
        disabled: true,
    },
]

const createBubbleMenuDropdownExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'BubbleMenuDropdown is an icon trigger that opens a vertical menu of radio choices. Here it sits in an inline bubble toolbar, as it does in the editor block controls. The Image choice is disabled.',
    )
    const frame = html`<div className="documentation-ui-frame"></div>` as HTMLElement
    const content = html`<div className="documentation-ui-frame-content"></div>` as HTMLElement
    frame.append(content)
    example.specimen('Block style', frame)
    let value = 'paragraph'
    const dropdown = new BubbleMenuDropdown({
        document,
        label: 'Change block style',
        menuLabel: 'Block style',
        value,
        options: textStyles,
        getBounds: () => frame.getBoundingClientRect(),
        onChange: next => {
            value = next
            dropdown.setValue(next)
            example.frame.report(`Changed the block to ${next}.`)
        },
    })
    const toolbar = new BubbleMenu({
        parentEl: content,
        inline: true,
        label: 'Block controls',
        items: [
            {
                element: dropdown.element,
                context: ['block'],
            },
            {
                element: toolbarButton(
                    'Bold',
                    boldIcon,
                    () => example.frame.report('Bold was pressed.'),
                ),
                context: ['block'],
            },
        ],
    })
    example.own(() => toolbar.destroy())
    example.own(() => dropdown.destroy())
    example.frame.button('Open the menu', () => dropdown.open())
    example.frame.button('Close the menu', () => dropdown.hide())
    example.frame.code(
        () => [
            "import { BubbleMenuDropdown } from '@lixpi/ui-kit/components/bubble-menu'",
            '',
            'const style = new BubbleMenuDropdown({',
            '    document,',
            "    label: 'Change block style',",
            `    value: '${value}',`,
            "    options: [{ value: 'paragraph', label: 'Paragraph', icon: paragraphIcon }],",
            '    onChange: value => editor.setBlockStyle(value),',
            '})',
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'ui-kit-action-panel': createActionPanelExample,
    'ui-kit-dropdown': createDropdownExample,
    'ui-kit-bubble-menu': createBubbleMenuExample,
    'ui-kit-bubble-menu-dropdown': createBubbleMenuDropdownExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown UI kit menu example: ${id}`)

    return factory(host)
}
