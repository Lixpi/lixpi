// Button - the one text button every Lixpi application uses.
//
// Renderer: TypeScript `html` DOM. A native <button> with a label and an
// optional leading icon. Its geometry comes from the theme's `button`
// profile and its paint from the preset's semantic roles, so a button looks
// the same in every application. Hosts choose only the variant, `primary`
// for the main action of a surface and `secondary` for the rest, and a size.

import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

export type ButtonVariant = 'primary' | 'secondary'

// Small, medium and large each have three sizes, smallest first. `xx-medium`
// is the default; the largest sizes are for a surface's one main action, such
// as signing in.
export const BUTTON_SIZES = [
    'xxx-small',
    'xx-small',
    'x-small',
    'x-medium',
    'xx-medium',
    'xxx-medium',
    'x-large',
    'xx-large',
    'xxx-large',
] as const

export type ButtonSize = typeof BUTTON_SIZES[number]

export type ButtonConfig = {
    label: string
    // Optional for hosts that wire the element's events themselves.
    onClick?: (event: MouseEvent) => void
    variant?: ButtonVariant
    size?: ButtonSize
    // Leading SVG icon markup from `@lixpi/ui-kit/svg`.
    icon?: string
    // Accessible name when it differs from the visible label.
    ariaLabel?: string
    type?: 'button' | 'submit'
    disabled?: boolean
    // A host hook for placement only, such as margins or alignment. Paint,
    // size and shape always come from the shared button styles.
    className?: string
    document?: Document
}

export type ButtonInstance = {
    readonly element: HTMLButtonElement
    setLabel: (label: string) => void
    setDisabled: (disabled: boolean) => void
    destroy: () => void
}

class Button implements ButtonInstance {
    readonly element: HTMLButtonElement
    private readonly labelElement: HTMLSpanElement

    constructor(private readonly config: ButtonConfig) {
        const html = createDocumentHtml(config.document ?? document)
        this.labelElement = html`<span className="button-label">${config.label}</span>` as HTMLSpanElement
        this.element = html`
            <button
                type=${config.type ?? 'button'}
                className=${config.className ? `button ${config.className}` : 'button'}
                data-variant=${config.variant ?? 'secondary'}
                data-size=${config.size ?? 'xx-medium'}
            >
                ${
                    config.icon ? html`
                        <span
                            className="button-icon"
                            aria-hidden="true"
                            innerHTML=${config.icon}
                        ></span>
                    ` : null
                }
                ${this.labelElement}
            </button>
        ` as HTMLButtonElement

        if (config.onClick)
            this.element.addEventListener('click', config.onClick)

        if (config.ariaLabel)
            this.element.setAttribute('aria-label', config.ariaLabel)

        this.element.disabled = config.disabled ?? false
    }

    setLabel(label: string): void {
        this.labelElement.textContent = label
    }

    setDisabled(disabled: boolean): void {
        this.element.disabled = disabled
    }

    destroy(): void {
        if (this.config.onClick)
            this.element.removeEventListener('click', this.config.onClick)

        this.element.remove()
    }
}

export const createButton = (config: ButtonConfig): ButtonInstance => new Button(config)
