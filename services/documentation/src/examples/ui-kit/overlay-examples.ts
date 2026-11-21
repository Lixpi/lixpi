import { createHelpTooltip } from '@lixpi/ui-kit/components/help-tooltip'
import { createInfoBubble } from '@lixpi/ui-kit/components/info-bubble'
import { createContextPreviewPopover } from '@lixpi/ui-kit/components/preview'
import { InteractivePreviewPopover } from '@lixpi/ui-kit/components/popover'
import { createButton } from '@lixpi/ui-kit/components/button'
import {
    contextIcon,
    plusIcon,
    questionMarkCircleIcon,
} from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

type Placement = 'top' | 'bottom' | 'left' | 'right'

const placements: Record<Placement, string> = {
    top: 'Top',
    bottom: 'Bottom',
    left: 'Left',
    right: 'Right',
}

const createHelpTooltipExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'Hover the question mark for a rich tooltip created with createHelpTooltip. The buttons below carry only data-help-tooltip: the application-level provider shows their accessible name or description after a short delay, so no component creates its own tooltip.',
    )
    const rich = example.specimen('Rich tooltip')
    let placement: Placement = 'right'
    let text = 'Reference images guide the composition. The model keeps their framing and palette.'
    const mount = () =>
        createHelpTooltip({
            label: 'About reference images',
            text,
            icon: questionMarkCircleIcon,
            preferredPlacement: placement,
        })
    let tooltip = mount()
    rich.append(tooltip.dom)
    example.own(() => tooltip.destroy())
    const remount = (): void => {
        const previous = tooltip
        tooltip = mount()
        previous.dom.replaceWith(tooltip.dom)
        previous.destroy()
    }
    const simple = example.specimen('Provider tooltips')
    // Each button only opts in to the provider; the provider shows the help.
    const nameButton = createButton({
        label: 'Accessible name',
        ariaLabel: 'Add a reference',
        onClick: () => example.frame.report('Add a reference was pressed.'),
    })
    nameButton.element.dataset.helpTooltip = 'aria-label'
    const descriptionButton = createButton({
        label: 'Accessible description',
        ariaLabel: 'Status',
        onClick: () => example.frame.report('Status was pressed.'),
    })
    descriptionButton.element.setAttribute('aria-description', 'Generation is queued behind two other requests.')
    descriptionButton.element.dataset.helpTooltip = 'aria-description'
    descriptionButton.element.dataset.helpTooltipPlacement = 'bottom'
    const literalButton = createButton({
        label: 'Literal text',
        ariaLabel: 'Settings',
        onClick: () => example.frame.report('Settings was pressed.'),
    })
    literalButton.element.dataset.helpTooltip = 'Opens the model settings for this node'
    simple.append(
        nameButton.element,
        descriptionButton.element,
        literalButton.element,
    )
    example.own(() => {
        nameButton.destroy()
        descriptionButton.destroy()
        literalButton.destroy()
    })
    example.frame.select(
        'Placement',
        placement,
        placements,
        value => {
            placement = value as Placement
            remount()
        },
    )
    example.frame.text(
        'Text',
        text,
        value => {
            text = value
            tooltip.setContent(value)
        },
    )
    example.frame.button('Show', () => tooltip.show())
    example.frame.button('Hide', () => tooltip.hide())
    example.frame.code(
        () => [
            "import { createHelpTooltip } from '@lixpi/ui-kit/components/help-tooltip'",
            "import { questionMarkCircleIcon } from '@lixpi/ui-kit/svg'",
            '',
            'const help = createHelpTooltip({',
            "    label: 'About reference images',",
            `    text: ${JSON.stringify(text)},`,
            '    icon: questionMarkCircleIcon,',
            `    preferredPlacement: '${placement}',`,
            '})',
            'field.append(help.dom)',
            '',
            '// Simple controls only opt in:',
            'html`<button aria-label="Add a reference" data-help-tooltip="aria-label">...</button>`',
        ].join('\n'),
    )

    return example
}

const createInfoBubbleExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createInfoBubble anchors a bubble with an arrow to an element. Clicking the anchor toggles it, and a click outside closes it. The bubble mounts on the document body.',
    )
    const body = example.specimen('Anchored bubble')
    // The info bubble toggles itself on the anchor's clicks.
    const anchorButton = createButton({
        label: 'Usage details',
        onClick: () => {},
    })
    const anchor = anchorButton.element
    anchor.ariaHasPopup = 'dialog'
    body.append(anchor)
    example.own(() => anchorButton.destroy())
    let theme: 'light' | 'dark' = 'light'
    let arrowSide: Placement = 'top'
    const mount = () => {
        const bubble = createInfoBubble({
            id: `documentation-info-bubble-${crypto.randomUUID()}`,
            anchor,
            theme,
            arrowSide,
            headerContent: html`<strong>Usage this month</strong>` as HTMLElement,
            bodyContent: html`<p>412 images, 38 videos and 1.2 hours of audio were generated in this workspace.</p>` as HTMLElement,
            closeOnClickOutside: true,
            onOpen: () => example.frame.report('The bubble is open.'),
            onClose: () => example.frame.report('The bubble is closed.'),
        })
        document.body.append(bubble.dom)

        return bubble
    }
    let bubble = mount()
    example.own(() => bubble.destroy())
    const remount = (): void => {
        bubble.destroy()
        bubble = mount()
    }
    example.frame.select(
        'Theme',
        theme,
        {
            light: 'Light',
            dark: 'Dark',
        },
        value => {
            theme = value as 'light' | 'dark'
            remount()
        },
    )
    example.frame.select(
        'Arrow side',
        arrowSide,
        placements,
        value => {
            arrowSide = value as Placement
            remount()
        },
    )
    example.frame.button('Open', () => bubble.open())
    example.frame.button('Close', () => bubble.close())
    example.frame.code(
        () => [
            "import { createInfoBubble } from '@lixpi/ui-kit/components/info-bubble'",
            '',
            'const bubble = createInfoBubble({',
            "    id: 'usage-details',",
            '    anchor: button,',
            `    theme: '${theme}',`,
            `    arrowSide: '${arrowSide}',`,
            '    headerContent,',
            '    bodyContent,',
            '    closeOnClickOutside: true,',
            '})',
            'document.body.append(bubble.dom)',
        ].join('\n'),
    )

    return example
}

const previewContent = (text: string): HTMLElement =>
    html`
        <div>
            <strong>Creative brief</strong>
            <p>${text}</p>
        </div>
    ` as HTMLElement

const createContextPreviewExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createContextPreviewPopover wraps a small trigger and shows a larger preview while the pointer or focus is on it. The content can be replaced while the popover stays mounted.',
    )
    const body = example.specimen('Prompt context item')
    let text = 'A poster for an autumn product launch with warm light and generous negative space.'
    let placement: Placement = 'bottom'
    const trigger = (): HTMLElement =>
        html`
            <span
                className="documentation-ui-preview-trigger"
                innerHTML=${contextIcon}
            ></span>
        ` as HTMLElement
    const mount = () =>
        createContextPreviewPopover({
            accessibleLabel: 'Creative brief',
            content: previewContent(text),
            contentClassName: 'documentation-ui-preview-content',
            triggerContent: trigger(),
            preferredPlacement: placement,
        })
    let popover = mount()
    body.append(popover.dom)
    example.own(() => popover.destroy())
    example.frame.text(
        'Preview text',
        text,
        value => {
            text = value
            popover.updateContent({
                accessibleLabel: 'Creative brief',
                content: previewContent(value),
                contentClassName: 'documentation-ui-preview-content',
            })
        },
    )
    example.frame.select(
        'Placement',
        placement,
        placements,
        value => {
            placement = value as Placement
            const previous = popover
            popover = mount()
            previous.dom.replaceWith(popover.dom)
            previous.destroy()
        },
    )
    example.frame.code(
        () => [
            "import { createContextPreviewPopover } from '@lixpi/ui-kit/components/preview'",
            '',
            'const preview = createContextPreviewPopover({',
            "    accessibleLabel: 'Creative brief',",
            '    content: briefPreview,',
            "    contentClassName: 'brief-preview',",
            '    triggerContent: briefChip,',
            `    preferredPlacement: '${placement}',`,
            '})',
            'chips.append(preview.dom)',
        ].join('\n'),
    )

    return example
}

const createInteractivePreviewExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'InteractivePreviewPopover owns only open and close behavior. It opens on hover or focus, stays open while the pointer or focus moves into the popover, and closes on Escape, an outside press or after the pointer leaves both. The host styles the is-open class.',
    )
    const body = example.specimen('Hover card')
    const triggerButton = createButton({
        label: 'Collaborators',
        onClick: () => {},
    })
    const trigger = triggerButton.element
    trigger.ariaExpanded = 'false'
    trigger.setAttribute('aria-controls', 'documentation-interactive-preview')
    const inviteButton = createButton({
        label: 'Invite',
        icon: plusIcon,
        variant: 'primary',
        onClick: () => example.frame.report('Invite was pressed inside the popover.'),
    })
    const popover = html`
        <div
            id="documentation-interactive-preview"
            className="documentation-ui-popover documentation-ui-card"
        >
            <p>Three people can edit this workspace.</p>
            ${inviteButton.element}
        </div>
    ` as HTMLElement
    const root = html`<div className="documentation-ui-popover-root">${trigger}${popover}</div>` as HTMLElement
    body.append(root)
    let closeDelayMs = 80
    let preview = new InteractivePreviewPopover({
        root,
        trigger,
        popover,
        closeDelayMs,
        afterOpen: () => example.frame.report('Opened.'),
        afterClose: () => example.frame.report('Closed.'),
    })
    example.own(() => preview.destroy())
    example.frame.number(
        'Close delay (ms)',
        { value: closeDelayMs },
        value => {
            if (value < 0)
                throw new Error('The delay cannot be negative.')

            closeDelayMs = value
        },
    )
    example.frame.button('Apply delay', () => {
        // destroy() removes both elements, so they are mounted again for the
        // replacement controller.
        preview.destroy()
        body.append(root)
        root.append(trigger, popover)
        preview = new InteractivePreviewPopover({
            root,
            trigger,
            popover,
            closeDelayMs,
            afterOpen: () => example.frame.report('Opened.'),
            afterClose: () => example.frame.report('Closed.'),
        })
    })
    example.frame.button('Open', () => preview.open())
    example.frame.button('Close', () => preview.close())
    example.frame.code(
        () => [
            "import { InteractivePreviewPopover } from '@lixpi/ui-kit/components/popover'",
            '',
            'const preview = new InteractivePreviewPopover({',
            '    root,',
            '    trigger,',
            '    popover,',
            `    closeDelayMs: ${closeDelayMs},`,
            '})',
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'ui-kit-help-tooltip': createHelpTooltipExample,
    'ui-kit-info-bubble': createInfoBubbleExample,
    'ui-kit-context-preview': createContextPreviewExample,
    'ui-kit-interactive-preview': createInteractivePreviewExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown UI kit overlay example: ${id}`)

    return factory(host)
}
