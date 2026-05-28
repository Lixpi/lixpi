import { html } from '$src/utils/domTemplates.ts'

// @ts-ignore - runtime import
import { select } from 'd3-selection'

export type ContextSelectorOption<Value extends string = string> = {
    label: string
    value: Value
}

type ContextSelectorConfig<Value extends string = string> = {
    id: string
    options: ContextSelectorOption<Value>[]
    selectedValue?: Value
    ariaLabel?: string
    onChange?: (value: Value) => void
}

type ContextSelectorInstance<Value extends string = string> = {
    dom: HTMLDivElement
    getValue: () => Value
    setValue: (value: Value) => void
    destroy: () => void
}

export function createContextSelector<Value extends string = string>(
    config: ContextSelectorConfig<Value>
): ContextSelectorInstance<Value> {
    const {
        id,
        options,
        selectedValue,
        ariaLabel = 'Context Selector',
        onChange,
    } = config

    if (options.length === 0) {
        throw new Error('Context selector requires at least one option')
    }

    const initialValue = selectedValue !== undefined && options.some((option) => option.value === selectedValue)
        ? selectedValue
        : options[0]!.value
    let currentValue = initialValue
    let dom: HTMLDivElement
    let buttons: HTMLButtonElement[] = []

    const renderSelection = (animate: boolean): void => {
        const selectedIndex = options.findIndex((option) => option.value === currentValue)
        const indicator = select(dom).select('.context-selector-indicator')

        for (const [index, button] of buttons.entries()) {
            const selected = index === selectedIndex
            select(button)
                .classed('context-selector-option-selected', selected)
                .attr('aria-checked', String(selected))
                .attr('aria-pressed', String(selected))
        }

        indicator
            .classed('context-selector-indicator-animated', animate)
            .style('transform', `translateX(${selectedIndex * 100}%)`)
    }

    const selectValue = (value: Value, notify: boolean): void => {
        if (!options.some((option) => option.value === value)) return

        const changed = value !== currentValue
        currentValue = value
        renderSelection(changed)

        if (changed && notify) onChange?.(value)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

        event.preventDefault()
        const currentIndex = options.findIndex((option) => option.value === currentValue)
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? options.length - 1
                : event.key === 'ArrowRight'
                    ? (currentIndex + 1) % options.length
                    : (currentIndex - 1 + options.length) % options.length
        selectValue(options[nextIndex]!.value, true)
        buttons[nextIndex]!.focus()
    }

    buttons = options.map((option) => html`
        <button
            type="button"
            className="context-selector-option"
            role="radio"
            aria-checked="false"
            aria-pressed="false"
            onclick=${() => selectValue(option.value, true)}
            onkeydown=${handleKeyDown}
        >
            <span className="context-selector-option-label">${option.label}</span>
        </button>
    ` as HTMLButtonElement)

    const indicatorStyle = {
        width: `calc((100% - 4px) / ${options.length})`,
    }
    dom = html`
        <div className="context-selector" id="${id}" role="radiogroup" aria-label="${ariaLabel}">
            <span className="context-selector-indicator" style=${indicatorStyle}></span>
            ${buttons}
        </div>
    ` as HTMLDivElement

    renderSelection(false)

    return {
        dom,
        getValue: () => currentValue,
        setValue: (value: Value) => selectValue(value, false),
        destroy: () => {
            buttons = []
        },
    }
}
