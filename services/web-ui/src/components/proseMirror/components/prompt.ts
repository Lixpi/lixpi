import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'

const PREFIX = 'ProseMirror-prompt'

type FieldElement = HTMLInputElement | HTMLSelectElement

type SelectOption = {
    label: string
    value: string
}

export type FieldOptions = {
    label: string
    value?: string
    required?: boolean
    options?: SelectOption[]
    validate?: (value: string) => string | null
    clean?: (value: string) => unknown
}

export type PromptOptions = {
    fields: Record<string, Field>
    title?: string
    callback: (values: Record<string, unknown>) => void
}

class PromptView {
    private readonly wrapper: HTMLDivElement
    private readonly form: HTMLFormElement
    private readonly domFields: FieldElement[]
    private readonly outsideListenerTimer: ReturnType<typeof setTimeout>

    constructor(private readonly options: PromptOptions) {
        this.domFields = Object.values(options.fields).map(field => field.render())
        const title = options.title ? (html`<h5>${options.title}</h5>` as HTMLHeadingElement) : null
        const fieldRows = this.domFields.map(field => html`<div>${field}</div>` as HTMLDivElement)
        this.form = html`
            <form>
                ${title} ${fieldRows}
                <div className=${`${PREFIX}-buttons`}>
                    <button
                        type="submit"
                        className=${`${PREFIX}-submit`}
                    >OK</button>
                    <button
                        type="button"
                        className=${`${PREFIX}-cancel`}
                        onclick=${this.close}
                    >Cancel</button>
                </div>
            </form>
        ` as HTMLFormElement
        this.wrapper = html`<div className=${PREFIX}>${this.form}</div>` as HTMLDivElement
        document.body.appendChild(this.wrapper)

        this.form.addEventListener('submit', this.handleSubmit)
        this.form.addEventListener('keydown', this.handleKeyDown)
        this.outsideListenerTimer = setTimeout(() => window.addEventListener('mousedown', this.handleMouseOutside), 50)

        const box = this.wrapper.getBoundingClientRect()
        applyStyle(
            this.wrapper,
            {
                top: `${(window.innerHeight - box.height) / 2}px`,
                left: `${(window.innerWidth - box.width) / 2}px`,
            },
        )

        this.domFields.at(0)?.focus()
    }

    private readonly handleMouseOutside = (event: MouseEvent): void => {
        if (!this.wrapper.contains(event.target as Node))
            this.close()
    }

    private readonly handleSubmit = (event: SubmitEvent): void => {
        event.preventDefault()
        this.submit()
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault()
            this.close()

            return
        }

        if (
            event.key === 'Enter'
            && !event.ctrlKey
            && !event.metaKey
            && !event.shiftKey
        ) {
            event.preventDefault()
            this.submit()

            return
        }

        if (event.key === 'Tab') {
            window.setTimeout(() => {
                if (!this.wrapper.contains(document.activeElement))
                    this.close()
            }, 500)
        }
    }

    private submit(): void {
        const values = this.getValues()

        if (!values)
            return

        this.close()
        this.options.callback(values)
    }

    private getValues(): Record<string, unknown> | null {
        const result: Record<string, unknown> = {}
        const fields = Object.entries(this.options.fields)

        for (const [index, [name, field]] of fields.entries()) {
            const dom = this.domFields[index]
            const value = field.read(dom)
            const validationError = field.validate(value)

            if (validationError) {
                this.reportInvalid(dom, validationError)

                return null
            }

            result[name] = field.clean(value)
        }

        return result
    }

    private reportInvalid(
        dom: FieldElement,
        message: string,
    ): void {
        const parent = dom.parentElement

        if (!parent)
            return

        const error = html`<div className="ProseMirror-invalid">${message}</div>` as HTMLDivElement
        parent.appendChild(error)
        applyStyle(
            error,
            {
                left: `${dom.offsetLeft + dom.offsetWidth + 2}px`,
                top: `${dom.offsetTop - 5}px`,
            },
        )
        setTimeout(() => error.remove(), 1_500)
    }

    close = (): void => {
        clearTimeout(this.outsideListenerTimer)
        window.removeEventListener('mousedown', this.handleMouseOutside)
        this.form.removeEventListener('submit', this.handleSubmit)
        this.form.removeEventListener('keydown', this.handleKeyDown)
        this.wrapper.remove()
    }
}

export const openPrompt = (options: PromptOptions): void => void new PromptView(options)

export abstract class Field {
    constructor(protected readonly options: FieldOptions) {}

    abstract render(): FieldElement

    read(dom: FieldElement): string {
        return dom.value
    }

    validateType(_value: string): string | null {
        return null
    }

    validate(value: string): string | null {
        if (
            !value
            && this.options.required
        )
            return 'Required field'

        return this.validateType(value) ?? this.options.validate?.(value) ?? null
    }

    clean(value: string): unknown {
        return this.options.clean?.(value) ?? value
    }
}

export class TextField extends Field {
    render(): HTMLInputElement {
        return html`
            <input
                type="text"
                placeholder=${this.options.label}
                value=${this.options.value ?? ''}
                autocomplete="off"
            />
        ` as HTMLInputElement
    }
}

export class SelectField extends Field {
    render(): HTMLSelectElement {
        const options = (this.options.options ?? []).map(
            option =>
                html`
                    <option
                        value=${option.value}
                        selected=${option.value === this.options.value}
                        label=${option.label}
                    ></option>
                ` as HTMLOptionElement,
        )

        return html`<select>
            ${options}
        </select>` as HTMLSelectElement
    }
}
