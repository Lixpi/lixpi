import {
    createSlidingSwitch,
    type SlidingSwitchConfig,
    type SlidingSwitchIndicatorInsetShadow,
    type SlidingSwitchInstance,
    type SlidingSwitchOption,
    type SlidingSwitchTransitionConfig,
} from '$src/components/slidingSwitch/index.ts'
import { createTagPill } from '$src/components/tagPill/index.ts'

export type SlidingTabsSwitchTab<Value extends string = string> = {
    label: string
    value: Value
    closable?: boolean
    disabled?: boolean
    ariaLabel?: string
    closeAriaLabel?: string
}

export type SlidingTabsSwitchConfig<Value extends string = string> = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    tabs: SlidingTabsSwitchTab<Value>[]
    selectedValue?: Value
    className?: string
    minTabWidth?: number
    transition?: Partial<SlidingSwitchTransitionConfig>
    activeTabBoxShadow?: string
    activeTabInsetShadow?: SlidingSwitchIndicatorInsetShadow
    onChange?: (value: Value, id: string) => void
    onClose?: (value: Value, id: string, tab: SlidingTabsSwitchTab<Value>) => void
}

export type SlidingTabsSwitchInstance<Value extends string = string> = SlidingSwitchInstance<Value>

function toSlidingSwitchOption<Value extends string>(tab: SlidingTabsSwitchTab<Value>): SlidingSwitchOption<Value> {
    const option: SlidingSwitchOption<Value> = {
        label: tab.label,
        value: tab.value,
    }
    if (tab.closable !== undefined) option.closable = tab.closable
    if (tab.disabled !== undefined) option.disabled = tab.disabled
    if (tab.ariaLabel !== undefined) option.ariaLabel = tab.ariaLabel
    if (tab.closeAriaLabel !== undefined) option.closeAriaLabel = tab.closeAriaLabel
    return option
}

class SlidingTabsSwitch<Value extends string = string> implements SlidingTabsSwitchInstance<Value> {
    private readonly switchInstance: SlidingSwitchInstance<Value>

    constructor(parent: any, private readonly config: SlidingTabsSwitchConfig<Value>) {
        this.switchInstance = createSlidingSwitch<Value>(parent, this.createSwitchConfig())
    }

    private createSwitchConfig(): SlidingSwitchConfig<Value> {
        const switchConfig: SlidingSwitchConfig<Value> = {
            id: this.config.id,
            x: this.config.x,
            y: this.config.y,
            width: this.config.width,
            options: this.config.tabs.map(toSlidingSwitchOption),
            role: 'tablist',
            optionRole: 'tab',
            selectedAriaAttribute: 'aria-selected',
            observeParentResize: true,
            renderOption: (optionParent, state) => createTagPill(optionParent, {
                id: state.id,
                x: state.x,
                y: state.y,
                width: state.width,
                height: state.height,
                label: state.option.label,
                selected: state.selected,
                hovered: state.hovered,
                disabled: state.disabled,
                closable: state.closable,
                surface: 'content',
                closeVisibility: 'hover',
                closeAriaLabel: state.option.closeAriaLabel,
                onClose: (_id, event) => state.onClose(event),
            }),
        }

        if (this.config.height !== undefined) switchConfig.height = this.config.height
        if (this.config.minTabWidth !== undefined) switchConfig.minOptionWidth = this.config.minTabWidth
        if (this.config.transition !== undefined) switchConfig.transition = this.config.transition
        if (this.config.selectedValue !== undefined) switchConfig.selectedValue = this.config.selectedValue
        if (this.config.className !== undefined) switchConfig.className = this.config.className
        if (this.config.activeTabBoxShadow !== undefined) switchConfig.indicatorBoxShadow = this.config.activeTabBoxShadow
        if (this.config.activeTabInsetShadow !== undefined) switchConfig.indicatorInsetShadow = this.config.activeTabInsetShadow
        if (this.config.onChange !== undefined) switchConfig.onChange = this.config.onChange
        if (this.config.onClose !== undefined) {
            switchConfig.onClose = (value, id, option) => this.config.onClose?.(value, id, option)
        }

        return switchConfig
    }

    render(): void {
        this.switchInstance.render()
    }

    resize(x: number, y: number, width: number, height?: number): void {
        this.switchInstance.resize(x, y, width, height)
    }

    setValue(value: Value): void {
        this.switchInstance.setValue(value)
    }

    getValue(): Value {
        return this.switchInstance.getValue()
    }

    getContentWidth(): number {
        return this.switchInstance.getContentWidth()
    }

    getOuterHeight(): number {
        return this.switchInstance.getOuterHeight()
    }

    destroy(): void {
        this.switchInstance.destroy()
    }
}

export function createSlidingTabsSwitch<Value extends string = string>(
    parent: any,
    config: SlidingTabsSwitchConfig<Value>
): SlidingTabsSwitchInstance<Value> {
    return new SlidingTabsSwitch(parent, config)
}
