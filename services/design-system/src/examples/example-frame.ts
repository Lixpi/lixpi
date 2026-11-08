import { err as debugError } from '@lixpi/debug-tools'
import { html } from '@lixpi/ui-primitives/dom'
import { canvasLibraryToggleGeometry } from '@lixpi/ui-kit/canvas-library'
import { select } from 'd3-selection'
import {
    createPureDropdown,
    type DropdownOption,
    type PureDropdownInstance,
} from '@lixpi/ui-kit/components/dropdown'
import {
    createToggleSwitch,
    type ToggleSwitchInstance,
} from '@lixpi/ui-kit/components/toggle-switch'
import {
    bindCanvasTheme,
    type CanvasTheme,
    type CanvasThemeSource,
} from '@lixpi/canvas-components/theme'
import { getExampleTheme } from './example-theme.ts'
import { FixtureEditor } from './workspace/fixture-editor.ts'

type ParameterOption = DropdownOption & { value: string }

export type NumericParameter = {
    value: number
}

export class ExampleFrame {
    private readonly widgets = new Set<{ destroy(): void }>()
    private readonly controlPrefix = crypto.randomUUID()
    private controlSequence = 0
    readonly theme: CanvasThemeSource
    private readonly releaseTheme: () => void
    private readonly themeSubscriptions = new Set<() => void>()
    readonly stage = html`<div className="canvas-example-stage"></div>` as HTMLDivElement
    readonly controls = html`
        <div
            className="canvas-example-controls"
            aria-label="Actions"
        ></div>
    ` as HTMLDivElement
    readonly parameters = html`<div className="canvas-example-parameters"></div>` as HTMLDivElement
    readonly status = html`
        <output
            className="canvas-example-status"
            aria-live="polite"
        ></output>
    ` as HTMLOutputElement
    private readonly controlError = html`
        <output
            className="canvas-example-control-error"
            data-error="true"
            aria-live="polite"
        ></output>
    ` as HTMLOutputElement
    readonly inspector: HTMLElement
    readonly el: HTMLDivElement
    private readonly instructionsElement = html`<div className="canvas-example-instructions"></div>` as HTMLElement
    private readonly codeElement = html`<div></div>` as HTMLElement
    private readonly instructionsEditor: FixtureEditor
    private readonly codeEditor: FixtureEditor
    private readonly codeSection: HTMLElement
    private source: (() => string) | null = null
    private currentCode: string | null = null

    constructor(
        host: HTMLElement,
        instructions: string,
        theme?: CanvasThemeSource,
    ) {
        this.theme = theme ?? getExampleTheme(host)
        this.releaseTheme = bindCanvasTheme(this.stage, this.theme)
        this.instructionsEditor = FixtureEditor.readOnly(this.instructionsElement, instructions)
        this.codeEditor = FixtureEditor.readOnly(this.codeElement, '')
        this.codeSection = html`
            <section
                className="canvas-example-code"
                hidden
            >
                <h3>Code</h3>
                ${this.codeElement}
            </section>
        ` as HTMLElement
        this.inspector = html`
            <section className="canvas-example-inspector">
                ${this.instructionsElement}
                ${this.status}
                ${this.controlError}
                ${this.parameters}
                <section className="canvas-example-actions">
                    <h3>Actions</h3>
                    ${this.controls}
                </section>
                ${this.codeSection}
            </section>
        ` as HTMLElement
        this.el = html`<div className="canvas-example">${this.stage}</div>` as HTMLDivElement
        host.append(this.el)
    }

    setInstructions(content: string | HTMLElement): void {
        this.instructionsEditor.setContent(content)
    }

    onThemeChange(listener: (theme: CanvasTheme) => void): () => void {
        const update = (theme: CanvasTheme): void => {
            listener(theme)
            this.refreshCode()
        }
        const unsubscribe = this.theme.subscribe(update)
        const release = () => {
            unsubscribe()
            this.themeSubscriptions.delete(release)
        }
        this.themeSubscriptions.add(release)
        update(this.theme.value)

        return release
    }

    button(
        label: string,
        action: () => void,
    ): HTMLButtonElement {
        const button = html`
            <button
                type="button"
                className="canvas-example-button navigation-side-panel-row"
                onclick=${() => void this.runControl(action)}
            ><span className="navigation-side-panel-row-title">${label}</span></button>
        ` as HTMLButtonElement
        this.controls.append(button)

        return button
    }

    number(
        label: string,
        settings: NumericParameter,
        onChange: (value: number) => void,
    ): HTMLInputElement {
        const messageId = `${this.controlPrefix}-number-${this.controlSequence++}`
        const feedback = html`
            <output
                id=${messageId}
                className="canvas-example-parameter-feedback"
                aria-live="polite"
            ></output>
        ` as HTMLOutputElement
        const input = html`
            <input
                type="number"
                step="any"
                value=${settings.value}
                aria-label=${label}
                aria-describedby=${messageId}
            />
        ` as HTMLInputElement
        input.addEventListener('input', () => {
            const entered = input.value
            const value = input.valueAsNumber
            feedback.textContent = ''
            feedback.removeAttribute('data-error')
            input.removeAttribute('aria-invalid')

            try {
                if (!Number.isFinite(value))
                    throw new Error('Enter a finite number.')

                onChange(value)

                if (
                    input.value !== entered
                    && input.valueAsNumber !== value
                )
                    feedback.textContent = `The component applied ${input.value}; the entered value is ${entered}.`

                this.refreshCode()
            } catch (error) {
                feedback.textContent = error instanceof Error ? error.message : String(error)
                feedback.dataset.error = 'true'
                input.setAttribute('aria-invalid', 'true')
            } finally {
                input.value = entered
            }
        })
        const field = this.field(label, input)
        field.append(feedback)

        return input
    }

    select(
        label: string,
        value: string,
        options: Readonly<Record<string, string>>,
        onChange: (value: string) => void,
    ): PureDropdownInstance<ParameterOption> {
        const dropdown = createPureDropdown<ParameterOption>({
            id: `${this.controlPrefix}-${this.controlSequence++}`,
            triggerLabel: label,
            selectedValue: {
                title: options[value] ?? value,
                value,
            },
            options: Object.entries(options).map(
                ([key, title]) => ({
                    title,
                    value: key,
                }),
            ),
            renderIconForOptions: false,
            renderIconForSelectedValue: false,
            mountToBody: true,
            popoverClassName: 'canvas-library-dropdown-popover',
            onSelect: option => void this.runControl(() => onChange(option.value)),
        })
        this.widgets.add(dropdown)
        this.field(label, dropdown.dom)

        return dropdown
    }

    toggle(
        label: string,
        value: boolean,
        onChange: (value: boolean) => void,
    ): ToggleSwitchInstance {
        const host = html`<span className="canvas-example-toggle"></span>` as HTMLSpanElement
        const svg = select(host)
            .append('svg')
            .attr('role', 'switch')
            .attr('tabindex', 0)
            .attr('aria-label', label)
            .attr(
                'aria-checked',
                String(value),
            )
        const update = (checked: boolean): void => {
            svg.attr(
                'aria-checked',
                String(checked),
            )
            this.runControl(() => onChange(checked))
        }
        const initialGeometry = canvasLibraryToggleGeometry(this.theme.value.controls.height)
        const toggle = createToggleSwitch(
            svg,
            {
                id: `${this.controlPrefix}-${this.controlSequence++}`,
                ...initialGeometry.control,
                checked: value,
                onChange: update,
            },
        )
        let disabled = false
        const setChecked = toggle.setChecked.bind(toggle)
        toggle.setChecked = checked => {
            setChecked(checked)
            svg.attr(
                'aria-checked',
                String(checked),
            )
        }
        const setDisabled = toggle.setDisabled.bind(toggle)
        toggle.setDisabled = value => {
            disabled = value
            setDisabled(value)
            svg
                .attr(
                    "aria-disabled",
                    String(value),
                )
                .attr("tabindex", value ? -1 : 0)
        }
        svg.on('keydown', (event: KeyboardEvent) => {
            if (disabled)
                return

            if (
                event.key !== 'Enter'
                && event.key !== ' '
            )
                return

            event.preventDefault()
            event.stopPropagation()
            const checked = !toggle.getChecked()
            toggle.setChecked(checked)
            update(checked)
        })
        this.onThemeChange(theme => {
            const geometry = canvasLibraryToggleGeometry(theme.controls.height)
            toggle.resize(
                geometry.control.x,
                geometry.control.y,
                geometry.control.width,
                geometry.control.height,
            )
            svg
                .attr('width', geometry.host.width)
                .attr('height', geometry.host.height)
            host.style.setProperty('--canvas-example-toggle-width', `${geometry.host.width}px`)
            host.style.setProperty('--canvas-example-toggle-height', `${geometry.host.height}px`)
        })
        this.widgets.add(toggle)
        this.field(label, host)

        return toggle
    }

    text(
        label: string,
        value: string,
        onChange: (value: string) => void,
    ): HTMLInputElement {
        const input = html`
            <input
                type="text"
                value=${value}
            />
        ` as HTMLInputElement
        input.addEventListener('input', () => void this.runControl(() => onChange(input.value)))
        this.field(label, input)

        return input
    }

    private field(
        label: string,
        input: HTMLElement,
    ): HTMLLabelElement {
        const field = html`<label className="canvas-example-parameter"><span>${label}</span>${input}</label>` as HTMLLabelElement
        this.parameters.append(field)

        return field
    }

    private runControl(action: () => void): void {
        try {
            action()
            this.refreshCode()
            this.controlError.textContent = ''
        } catch (error) {
            this.controlError.textContent = error instanceof Error ? error.message : String(error)
        }
    }

    code(source: () => string): void {
        this.source = source
        this.codeSection.hidden = false
        this.refreshCode()
    }

    refreshCode(): void {
        if (!this.source)
            return

        const source = this.source()

        if (source === this.currentCode)
            return

        this.currentCode = source
        this.codeEditor.setContent({
            type: 'doc',
            content: [{
                type: 'code_block',
                content: source ? [{
                    type: 'text',
                    text: source,
                }] : [],
            }],
        })
    }

    report = (message: string): void => {
        this.status.removeAttribute('data-error')
        this.status.textContent = message
        this.refreshCode()
    }

    error = (error: unknown): void => {
        this.report(error instanceof Error ? error.message : String(error))
        this.status.dataset.error = 'true'
        debugError(error)
    }

    destroy(): void {
        for (const release of [...this.themeSubscriptions])
            release()

        for (const widget of this.widgets)
            widget.destroy()

        this.widgets.clear()
        this.instructionsEditor.destroy()
        this.codeEditor.destroy()
        this.releaseTheme()
        this.inspector.remove()
        this.el.remove()
    }
}
