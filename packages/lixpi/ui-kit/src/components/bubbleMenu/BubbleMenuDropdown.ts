import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { chevronDownIcon } from '../../svg/svgIcons.ts'
import { BubbleMenu } from './BubbleMenu.ts'
import {
    applyBubbleMenuStyleProperties,
    bubbleMenuSettings,
} from './settings.ts'
import {
    type BubbleMenuPositionRequest,
} from './types.ts'

export type BubbleMenuDropdownOption<Value extends string> = {
    value: Value
    label: string
    icon: string
    disabled?: boolean
}

export type BubbleMenuDropdownOptions<Value extends string> = {
    document: Document
    label: string
    menuLabel?: string
    value: Value | undefined
    fallbackIcon?: string
    options: readonly BubbleMenuDropdownOption<Value>[]
    onChange: (value: Value) => void
    onOpen?: () => void
    getBounds?: () => DOMRect
    getScale?: () => number
}

export class BubbleMenuDropdown<Value extends string> {
    readonly element: HTMLElement
    readonly trigger: HTMLButtonElement
    readonly menuElement: HTMLElement

    private readonly menu: BubbleMenu
    private readonly labelIcon: HTMLElement
    private readonly choices: Array<{
        option: BubbleMenuDropdownOption<Value>
        button: HTMLButtonElement
    }>
    private readonly view: Window | null
    private destroyed = false

    constructor(private readonly config: BubbleMenuDropdownOptions<Value>) {
        const html = createDocumentHtml(config.document)
        this.labelIcon = html`<span className="dropdown-label"></span>` as HTMLElement
        this.trigger = html`
            <button
                type="button"
                className="bubble-menu-dropdown-toggle"
                aria-label=${config.label}
                aria-haspopup="menu"
                aria-expanded="false"
                data-help-tooltip="aria-label"
                onpointerdown=${this.preserveFocus}
                onclick=${this.handleTriggerClick}
                onkeydown=${this.handleTriggerKeyDown}
            >${this.labelIcon}</button>
        ` as HTMLButtonElement
        this.trigger.insertAdjacentHTML('beforeend', chevronDownIcon)
        this.element = html`<div className="bubble-menu-dropdown">${this.trigger}</div>` as HTMLElement
        applyBubbleMenuStyleProperties(this.element)

        this.choices = config.options.map(option => {
            const button = html`
                <button
                    type="button"
                    className="bubble-menu-dropdown-item"
                    role="menuitemradio"
                    aria-label=${option.label}
                    aria-checked="false"
                    data-help-tooltip="aria-label"
                    tabindex="-1"
                    disabled=${option.disabled}
                    innerHTML=${option.icon}
                    onpointerdown=${this.preserveFocus}
                    onclick=${(event: MouseEvent) => this.choose(event, option)}
                ></button>
            ` as HTMLButtonElement

            return {
                option,
                button,
            }
        })
        this.menu = new BubbleMenu({
            parentEl: this.element,
            label: config.menuLabel ?? config.label,
            role: 'menu',
            orientation: 'vertical',
            getScale: config.getScale,
            items: this.choices.map(
                ({ button }) => ({
                    element: button,
                    context: ['options'],
                }),
            ),
        })
        this.menuElement = this.menu.element
        this.menuElement.addEventListener('keydown', this.handleMenuKeyDown)
        this.view = config.document.defaultView
        this.setValue(config.value)
    }

    get isOpen(): boolean {
        return this.menu.isVisible
    }

    setValue(value: Value | undefined): void {
        const selected = this.choices.find(({ option }) => option.value === value)
        this.trigger.classList.toggle('is-active', selected !== undefined)
        this.labelIcon.innerHTML = selected?.option.icon
            ?? this.config.fallbackIcon
            ?? ''

        for (const { button } of this.choices) {
            button.ariaChecked = String(button === selected?.button)
            button.classList.toggle('is-active', button === selected?.button)
        }
    }

    open(): void {
        if (
            this.destroyed
            || this.isOpen
        )
            return

        this.menu.show(
            'options',
            this.position(),
        )
        this.trigger.ariaExpanded = 'true'
        this.config.document.addEventListener(
            'pointerdown',
            this.handleOutside,
            true,
        )
        this.config.document.addEventListener('keydown', this.handleDocumentKeyDown)
        this.config.document.addEventListener(
            'scroll',
            this.handleScroll,
            true,
        )
        this.view?.addEventListener('resize', this.reposition)
        this.config.onOpen?.()
    }

    toggle(): void {
        if (this.isOpen)
            this.hide()
        else
            this.open()
    }

    hide(): void {
        if (!this.isOpen)
            return

        this.menu.hide()
        this.trigger.ariaExpanded = 'false'
        this.config.document.removeEventListener(
            'pointerdown',
            this.handleOutside,
            true,
        )
        this.config.document.removeEventListener('keydown', this.handleDocumentKeyDown)
        this.config.document.removeEventListener(
            'scroll',
            this.handleScroll,
            true,
        )
        this.view?.removeEventListener('resize', this.reposition)
    }

    reposition = (): void => {
        if (this.isOpen)
            this.menu.reposition(
                this.position(),
            )
    }

    destroy(): void {
        this.destroyed = true
        this.hide()
        this.menu.destroy()
        this.element.remove()
    }

    private position(): BubbleMenuPositionRequest {
        const target = this.element.getBoundingClientRect()
        const bounds = this.config.getBounds?.() ?? new DOMRect(
            0,
            0,
            this.view?.innerWidth ?? 0,
            this.view?.innerHeight ?? 0,
        )

        return {
            targetRect: target,
            placement: 'auto',
            horizontalAlignment: 'start',
            bounds,
            gap: bubbleMenuSettings.placement.dropdownGap,
            clampToParent: false,
        }
    }

    private preserveFocus = (event: Event): void => void event.preventDefault()

    private handleTriggerClick = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        this.toggle()
    }

    private handleTriggerKeyDown = (event: KeyboardEvent): void => {
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
            case 'Enter':
            case ' ': {
                event.preventDefault()
                event.stopPropagation()
                this.open()
                const buttons = this.getEnabledButtons()
                const checked = buttons.find(button => button.ariaChecked === 'true')
                const fallback = event.key === 'ArrowUp' ? buttons.at(-1) : buttons[0]
                const target = checked ?? fallback
                target?.focus({ preventScroll: true })

                break
            }
            case 'Escape':
                this.dismissWithKeyboard(event)

                break
        }
    }

    private handleMenuKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this.dismissWithKeyboard(event)

            return
        }

        const buttons = this.getEnabledButtons()
        const activeElement = this.config.document.activeElement as HTMLButtonElement
        const current = buttons.indexOf(activeElement)

        if (
            (event.key === 'Enter' || event.key === ' ')
            && current >= 0
        ) {
            event.preventDefault()
            event.stopPropagation()
            activeElement.click()

            return
        }

        if (!buttons.length)
            return

        let next: number

        switch (event.key) {
            case 'ArrowDown':
                next = (current + 1) % buttons.length

                break
            case 'ArrowUp':
                next = current > 0 ? current - 1 : buttons.length - 1

                break
            case 'Home':
                next = 0

                break
            case 'End':
                next = buttons.length - 1

                break
            default:
                return
        }

        event.preventDefault()
        event.stopPropagation()
        buttons[next]?.focus({ preventScroll: true })
    }

    private getEnabledButtons(): HTMLButtonElement[] {
        return this.choices.map(({ button }) => button).filter(button => !button.disabled)
    }

    private dismissWithKeyboard(event: KeyboardEvent): void {
        if (!this.isOpen)
            return

        event.preventDefault()
        event.stopPropagation()
        this.hide()
        this.trigger.focus({ preventScroll: true })
    }

    private choose(
        event: MouseEvent,
        option: BubbleMenuDropdownOption<Value>,
    ): void {
        if (
            !this.isOpen
            || option.disabled
        )
            return

        const focusedInside = this.menuElement.contains(this.config.document.activeElement)
        event.preventDefault()
        event.stopPropagation()
        this.setValue(option.value)
        this.hide()

        if (focusedInside)
            this.trigger.focus({ preventScroll: true })

        this.config.onChange(option.value)
    }

    private handleDocumentKeyDown = (event: KeyboardEvent): void => {
        if (
            event.key === 'Escape'
            && !event.defaultPrevented
        )
            this.hide()
    }

    private handleScroll = (event: Event): void => {
        if (!this.menuElement.contains(event.target as Node | null))
            this.reposition()
    }

    private handleOutside = (event: PointerEvent): void => {
        if (!this.element.contains(event.target as Node | null))
            this.hide()
    }
}
