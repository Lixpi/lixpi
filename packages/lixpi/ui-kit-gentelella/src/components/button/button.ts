import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    gentelellaButtonClassName,
    gentelellaClasses,
    type GentelellaButtonSize,
    type GentelellaButtonVariant,
} from '../../classNames.ts'

export type GentelellaButtonConfig = {
    ariaLabel?: string
    className?: string
    disabled?: boolean
    document?: Document
    iconHtml?: string
    iconOnly?: boolean
    label?: string
    onClick?: (event: MouseEvent) => void
    size?: GentelellaButtonSize
    type?: 'button' | 'reset' | 'submit'
    variant?: GentelellaButtonVariant
}

export type GentelellaButtonInstance = {
    readonly el: HTMLButtonElement
    destroy: () => void
    setBusy: (busy: boolean) => void
    setDisabled: (disabled: boolean) => void
    setLabel: (label: string) => void
}

class GentelellaButton implements GentelellaButtonInstance {
    readonly el: HTMLButtonElement

    private readonly iconEl: HTMLSpanElement | null
    private readonly labelEl: HTMLSpanElement
    private readonly spinnerEl: HTMLSpanElement

    constructor(config: GentelellaButtonConfig) {
        const html = createDocumentHtml(config.document ?? globalThis.document)
        this.iconEl = config.iconHtml
            ? html`<span innerHTML=${config.iconHtml}></span>` as HTMLSpanElement
            : null
        this.spinnerEl = html`
            <span
                className=${`${gentelellaClasses.button.spinner} ${gentelellaClasses.spinner.base} ${gentelellaClasses.spinner.small}`}
            ></span>
        ` as HTMLSpanElement
        this.labelEl = html`<span>${config.label ?? ''}</span>` as HTMLSpanElement
        this.el = html`
            <button
                className=${gentelellaButtonClassName(config)}
                type=${config.type ?? 'button'}
                aria-label=${config.ariaLabel ?? (config.iconOnly ? config.label : undefined)}
                disabled=${config.disabled}
                onclick=${config.onClick}
            >
                ${this.iconEl}
                ${this.labelEl}
            </button>
        ` as HTMLButtonElement
    }

    setBusy(busy: boolean): void {
        if (busy)
            this.el.insertBefore(this.spinnerEl, this.labelEl)
        else
            this.spinnerEl.remove()

        if (this.iconEl)
            this.iconEl.hidden = busy

        if (busy)
            this.el.setAttribute('aria-busy', 'true')
        else
            this.el.removeAttribute('aria-busy')
    }

    setDisabled(disabled: boolean): void {
        this.el.disabled = disabled
    }

    setLabel(label: string): void {
        this.labelEl.textContent = label
    }

    destroy(): void {
        this.el.remove()
    }
}

export const createGentelellaButton = (config: GentelellaButtonConfig): GentelellaButtonInstance => new GentelellaButton(config)

export type GentelellaButtonGroupItem = Omit<GentelellaButtonConfig, 'document' | 'onClick'> & {
    value: string
}

export type GentelellaButtonGroupConfig = {
    activeValue?: string
    ariaLabel: string
    className?: string
    document?: Document
    items: GentelellaButtonGroupItem[]
    onSelect?: (
        value: string,
        event: MouseEvent,
    ) => void
    selection?: 'multiple' | 'single'
}

export type GentelellaButtonGroupInstance = {
    readonly el: HTMLDivElement
    destroy: () => void
    setActiveValue: (value: string | null) => void
}

class GentelellaButtonGroup implements GentelellaButtonGroupInstance {
    readonly el: HTMLDivElement

    private readonly buttons = new Map<string, HTMLButtonElement>()

    constructor(private readonly config: GentelellaButtonGroupConfig) {
        const html = createDocumentHtml(config.document ?? globalThis.document)
        this.el = html`
            <div
                className=${`${gentelellaClasses.button.group} ${config.className ?? ''}`.trim()}
                role="group"
                aria-label=${config.ariaLabel}
                data=${config.selection === 'single' ? { group: '' } : undefined}
            ></div>
        ` as HTMLDivElement

        for (const item of config.items) {
            const button = createGentelellaButton({
                ...item,
                document: config.document,
                onClick: event => this.handleSelect(item.value, event),
            })
            this.buttons.set(item.value, button.el)
            this.el.append(button.el)
        }

        this.setActiveValue(config.activeValue ?? null)
    }

    private handleSelect(
        value: string,
        event: MouseEvent,
    ): void {
        if (this.config.selection !== 'multiple')
            this.setActiveValue(value)

        this.config.onSelect?.(value, event)
    }

    setActiveValue(value: string | null): void {
        for (const [itemValue, button] of this.buttons) {
            const active = itemValue === value
            button.classList.toggle(gentelellaClasses.state.active, active)
            button.setAttribute(
                'aria-pressed',
                String(active),
            )
        }
    }

    destroy(): void {
        this.buttons.clear()
        this.el.remove()
    }
}

export const createGentelellaButtonGroup = (config: GentelellaButtonGroupConfig): GentelellaButtonGroupInstance => new GentelellaButtonGroup(config)
