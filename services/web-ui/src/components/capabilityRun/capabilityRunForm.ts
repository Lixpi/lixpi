import {
    type CapabilityJsonValue,
} from '@lixpi/constants'

import {
    type CapabilityInputSchema,
    type CapabilityInputSchemaProperty,
} from '$src/services/capability-catalog-client.ts'
import { html } from '@lixpi/ui-primitives/dom'

export type CapabilityRunFormInstance = {
    readonly element: HTMLFormElement
    destroy: () => void
}

export type CapabilityRunFormConfig = {
    schema: CapabilityInputSchema
    submitLabel?: string
    onSubmit: (value: Record<string, CapabilityJsonValue>) => void | Promise<void>
}

export function coerceCapabilityFormValue(
    property: CapabilityInputSchemaProperty,
    value: FormDataEntryValue | null,
): CapabilityJsonValue | undefined {
    if (property.type === 'boolean') return value === 'on'
    if (value === null || String(value).trim() === '') return property.default
    const raw = String(value).trim()
    if (property.type === 'number' || property.type === 'integer') {
        return Number(raw)
    }
    if (property.type === 'array') {
        return raw.split(',').map((entry) => {
            const trimmed = entry.trim()
            if (property.items?.type === 'number' || property.items?.type === 'integer') return Number(trimmed)
            return trimmed
        }).filter((entry) => entry !== '')
    }
    return raw
}

export function readCapabilityRunForm(
    schema: CapabilityInputSchema,
    formData: FormData,
): { value?: Record<string, CapabilityJsonValue>; errors: string[] } {
    const value: Record<string, CapabilityJsonValue> = {}
    const errors: string[] = []
    const required = new Set(schema.required ?? [])

    for (const [name, property] of Object.entries(schema.properties)) {
        const coerced = coerceCapabilityFormValue(property, formData.get(name))
        if (coerced === undefined) {
            if (required.has(name)) errors.push(`${property.title ?? name} is required.`)
            continue
        }
        if ((property.type === 'number' || property.type === 'integer') && typeof coerced !== 'number') {
            errors.push(`${property.title ?? name} must be a number.`)
            continue
        }
        if (typeof coerced === 'number' && !Number.isFinite(coerced)) {
            errors.push(`${property.title ?? name} must be a number.`)
            continue
        }
        if (Array.isArray(coerced) && coerced.some((entry) => typeof entry === 'number' && !Number.isFinite(entry))) {
            errors.push(`${property.title ?? name} contains an invalid number.`)
            continue
        }
        value[name] = coerced
    }

    return errors.length > 0 ? { errors } : { value, errors }
}

class CapabilityRunForm implements CapabilityRunFormInstance {
    readonly element: HTMLFormElement
    private readonly errorElement: HTMLDivElement

    constructor(private readonly config: CapabilityRunFormConfig) {
        this.errorElement = html`<div className="capability-run-form-errors" role="alert"></div>` as HTMLDivElement
        this.element = html`
            <form className="capability-run-form">
                <div className="capability-run-form-fields"></div>
                ${this.errorElement}
                <button type="submit" className="capability-run-form-submit">${config.submitLabel ?? 'Run Tool'}</button>
            </form>
        ` as HTMLFormElement
        const fields = this.element.querySelector('.capability-run-form-fields') as HTMLDivElement
        for (const [name, property] of Object.entries(config.schema.properties)) {
            fields.appendChild(this.buildField(name, property, config.schema.required?.includes(name) === true))
        }
        this.element.addEventListener('submit', this.handleSubmit)
    }

    destroy(): void {
        this.element.removeEventListener('submit', this.handleSubmit)
        this.element.remove()
    }

    private readonly handleSubmit = (event: SubmitEvent): void => {
        event.preventDefault()
        const result = readCapabilityRunForm(this.config.schema, new FormData(this.element))
        this.errorElement.replaceChildren(...result.errors.map((error) => html`<div>${error}</div>`))
        if (!result.value) return
        void this.config.onSubmit(result.value)
    }

    private buildField(name: string, property: CapabilityInputSchemaProperty, required: boolean): HTMLElement {
        const id = `capability-run-field-${name}`
        const label = html`<label className="capability-run-form-field" for=${id}></label>` as HTMLLabelElement
        label.appendChild(html`<span>${property.title ?? name}${required ? ' *' : ''}</span>`)

        let input: HTMLElement
        if (property.type === 'boolean') {
            input = html`<input id=${id} name=${name} type="checkbox" checked=${property.default === true} />`
        } else if (property.enum) {
            const select = html`<select id=${id} name=${name} required=${required}></select>` as HTMLSelectElement
            if (!required) select.appendChild(html`<option value="">Select…</option>`)
            for (const option of property.enum) {
                select.appendChild(html`<option value=${String(option)} selected=${property.default === option}>${String(option)}</option>`)
            }
            input = select
        } else if (property.type === 'string' && !name.toLocaleLowerCase().endsWith('id')) {
            input = html`<textarea id=${id} name=${name} required=${required}>${String(property.default ?? '')}</textarea>`
        } else {
            const inputType = property.type === 'number' || property.type === 'integer' ? 'number' : 'text'
            input = html`<input id=${id} name=${name} type=${inputType} required=${required} value=${String(property.default ?? '')} />`
        }
        label.appendChild(input)
        if (property.description) label.appendChild(html`<small>${property.description}</small>`)
        return label
    }
}

export function createCapabilityRunForm(config: CapabilityRunFormConfig): CapabilityRunFormInstance {
    return new CapabilityRunForm(config)
}
