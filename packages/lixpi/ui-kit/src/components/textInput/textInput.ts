// TextInput and TextArea - the text fields every Lixpi application uses.
//
// Renderer: TypeScript `html` DOM. A native <input> or <textarea> styled from
// the theme's `textInput` profile and the preset's semantic roles. The element
// is the source of truth for its value; `onInput` reports what the user types,
// and `setValue` changes it without reporting.

import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

export type TextInputType = 'text' | 'search' | 'number' | 'email' | 'url'

export type TextInputConfig = {
    // Accessible name. Pass `labelledBy` instead when a visible label exists.
    ariaLabel?: string
    labelledBy?: string
    describedBy?: string
    value?: string
    placeholder?: string
    type?: TextInputType
    // Step for number fields; `any` accepts every finite number.
    step?: string
    autocomplete?: string
    disabled?: boolean
    // A host hook for placement only, such as width or margins. Paint, size
    // and shape always come from the shared field styles.
    className?: string
    onInput?: (
        value: string,
        event: Event,
    ) => void
    onChange?: (
        value: string,
        event: Event,
    ) => void
    document?: Document
}

export type TextInputInstance = {
    readonly element: HTMLInputElement
    getValue: () => string
    setValue: (value: string) => void
    setInvalid: (invalid: boolean) => void
    setDisabled: (disabled: boolean) => void
    destroy: () => void
}

class TextInput implements TextInputInstance {
    readonly element: HTMLInputElement

    constructor(private readonly config: TextInputConfig) {
        const html = createDocumentHtml(config.document ?? document)
        this.element = html`
            <input
                className=${config.className ? `text-input ${config.className}` : 'text-input'}
                type=${config.type ?? 'text'}
                autocomplete=${config.autocomplete ?? 'off'}
            />
        ` as HTMLInputElement
        this.element.value = config.value ?? ''
        this.element.placeholder = config.placeholder ?? ''
        this.element.disabled = config.disabled ?? false

        if (config.step)
            this.element.step = config.step

        if (config.ariaLabel)
            this.element.setAttribute('aria-label', config.ariaLabel)

        if (config.labelledBy)
            this.element.setAttribute('aria-labelledby', config.labelledBy)

        if (config.describedBy)
            this.element.setAttribute('aria-describedby', config.describedBy)

        this.element.addEventListener('input', this.handleInput)
        this.element.addEventListener('change', this.handleChange)
    }

    private handleInput = (event: Event): void => void this.config.onInput?.(this.element.value, event)

    private handleChange = (event: Event): void => void this.config.onChange?.(this.element.value, event)

    getValue = (): string => this.element.value

    setValue = (value: string): void => void (this.element.value = value)

    setInvalid = (invalid: boolean): void => {
        if (invalid)
            this.element.setAttribute('aria-invalid', 'true')
        else
            this.element.removeAttribute('aria-invalid')
    }

    setDisabled = (disabled: boolean): void => void (this.element.disabled = disabled)

    destroy = (): void => {
        this.element.removeEventListener('input', this.handleInput)
        this.element.removeEventListener('change', this.handleChange)
        this.element.remove()
    }
}

export const createTextInput = (config: TextInputConfig = {}): TextInputInstance => new TextInput(config)

export type TextAreaConfig = Omit<TextInputConfig, 'type' | 'step' | 'autocomplete'> & {
    rows?: number
    spellcheck?: boolean
}

export type TextAreaInstance = Omit<TextInputInstance, 'element'> & {
    readonly element: HTMLTextAreaElement
}

class TextArea implements TextAreaInstance {
    readonly element: HTMLTextAreaElement

    constructor(private readonly config: TextAreaConfig) {
        const html = createDocumentHtml(config.document ?? document)
        this.element = html`<textarea className=${config.className ? `text-input text-area ${config.className}` : 'text-input text-area'}></textarea>` as HTMLTextAreaElement
        this.element.value = config.value ?? ''
        this.element.placeholder = config.placeholder ?? ''
        this.element.disabled = config.disabled ?? false
        this.element.rows = config.rows ?? 3
        this.element.spellcheck = config.spellcheck ?? true

        if (config.ariaLabel)
            this.element.setAttribute('aria-label', config.ariaLabel)

        if (config.labelledBy)
            this.element.setAttribute('aria-labelledby', config.labelledBy)

        if (config.describedBy)
            this.element.setAttribute('aria-describedby', config.describedBy)

        this.element.addEventListener('input', this.handleInput)
        this.element.addEventListener('change', this.handleChange)
    }

    private handleInput = (event: Event): void => void this.config.onInput?.(this.element.value, event)

    private handleChange = (event: Event): void => void this.config.onChange?.(this.element.value, event)

    getValue = (): string => this.element.value

    setValue = (value: string): void => void (this.element.value = value)

    setInvalid = (invalid: boolean): void => {
        if (invalid)
            this.element.setAttribute('aria-invalid', 'true')
        else
            this.element.removeAttribute('aria-invalid')
    }

    setDisabled = (disabled: boolean): void => void (this.element.disabled = disabled)

    destroy = (): void => {
        this.element.removeEventListener('input', this.handleInput)
        this.element.removeEventListener('change', this.handleChange)
        this.element.remove()
    }
}

export const createTextArea = (config: TextAreaConfig = {}): TextAreaInstance => new TextArea(config)
