import {
    createSlidingSwitch,
    type SlidingSwitchAppearance,
    type SlidingSwitchConfig,
    type SlidingSwitchIndicatorInsetShadow,
    type SlidingSwitchInstance,
    type SlidingSwitchOption,
    type SlidingSwitchOptionRenderState,
    type SlidingSwitchTransitionConfig,
} from '../slidingSwitch/index.ts'
import {
    createTagPill,
    type TagPillRenderState,
} from '../tagPill/index.ts'

export type SlidingTabsSwitchTab<Value extends string = string> = {
    label: string
    value: Value
    closable?: boolean
    disabled?: boolean
    ariaLabel?: string
    closeAriaLabel?: string
}

export type SlidingTabsSwitchConfig<Value extends string = string> = Partial<SlidingSwitchAppearance> & {
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
    onChange?: (
        value: Value,
        id: string,
    ) => void
    onClose?: (
        value: Value,
        id: string,
        tab: SlidingTabsSwitchTab<Value>,
    ) => void
}

export type SlidingTabsSwitchInstance<Value extends string = string> = SlidingSwitchInstance<Value>

const toSlidingSwitchOption = <Value extends string>(tab: SlidingTabsSwitchTab<Value>): SlidingSwitchOption<Value> => {
    const option: SlidingSwitchOption<Value> = {
        label: tab.label,
        value: tab.value,
    }

    if (tab.closable !== undefined)
        option.closable = tab.closable

    if (tab.disabled !== undefined)
        option.disabled = tab.disabled

    if (tab.ariaLabel !== undefined)
        option.ariaLabel = tab.ariaLabel

    if (tab.closeAriaLabel !== undefined)
        option.closeAriaLabel = tab.closeAriaLabel

    return option
}

class SlidingTabsSwitch<Value extends string = string> implements SlidingTabsSwitchInstance<Value> {
    private readonly switchInstance: SlidingSwitchInstance<Value>
    private appearance: Partial<SlidingSwitchAppearance>

    constructor(
        parent: any,
        private readonly config: SlidingTabsSwitchConfig<Value>,
    ) {
        this.appearance = {
            trackBackgroundColor: config.trackBackgroundColor,
            indicatorBackgroundColor: config.indicatorBackgroundColor,
            unselectedOptionColor: config.unselectedOptionColor,
            hoveredOptionColor: config.hoveredOptionColor,
            selectedOptionColor: config.selectedOptionColor,
            disabledOptionColor: config.disabledOptionColor,
            closeHoverColor: config.closeHoverColor,
            indicatorBoxShadow: config.indicatorBoxShadow,
            indicatorInsetShadow: config.indicatorInsetShadow,
            fontFamily: config.fontFamily,
            fontSize: config.fontSize,
            fontWeight: config.fontWeight,
        }
        this.switchInstance = createSlidingSwitch<Value>(
            parent,
            this.createSwitchConfig(),
        )
    }

    private createSwitchConfig(): SlidingSwitchConfig<Value> {
        const switchConfig: SlidingSwitchConfig<Value> = {
            ...this.appearance,
            id: this.config.id,
            x: this.config.x,
            y: this.config.y,
            width: this.config.width,
            options: this.config.tabs.map(toSlidingSwitchOption),
            role: 'tablist',
            optionRole: 'tab',
            selectedAriaAttribute: 'aria-selected',
            observeParentResize: true,
            renderOption: (optionParent, state) => {
                const pill = createTagPill(
                    optionParent,
                    {
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
                        ...this.optionAppearance(state),
                    },
                )

                return {
                    resize: (
                        x,
                        y,
                        width,
                        height,
                    ) => pill.resize(
                        x,
                        y,
                        width,
                        height,
                    ),
                    render: next => pill.render({
                        selected: next.selected,
                        hovered: next.hovered,
                        disabled: next.disabled,
                        closable: next.closable,
                        ...this.optionAppearance(next),
                    }),
                    destroy: () => pill.destroy(),
                }
            },
        }

        if (this.config.height !== undefined)
            switchConfig.height = this.config.height

        if (this.config.minTabWidth !== undefined)
            switchConfig.minOptionWidth = this.config.minTabWidth

        if (this.config.transition !== undefined)
            switchConfig.transition = this.config.transition

        if (this.config.selectedValue !== undefined)
            switchConfig.selectedValue = this.config.selectedValue

        if (this.config.className !== undefined)
            switchConfig.className = this.config.className

        if (this.config.activeTabBoxShadow !== undefined)
            switchConfig.indicatorBoxShadow = this.config.activeTabBoxShadow

        if (this.config.activeTabInsetShadow !== undefined)
            switchConfig.indicatorInsetShadow = this.config.activeTabInsetShadow

        if (this.config.onChange !== undefined)
            switchConfig.onChange = this.config.onChange

        if (this.config.onClose !== undefined)
            switchConfig.onClose = (
                value,
                id,
                option,
            ) => this.config.onClose?.(
                value,
                id,
                option,
            )

        return switchConfig
    }

    private optionAppearance(state: SlidingSwitchOptionRenderState<Value>): TagPillRenderState {
        const textColor = state.disabled
            ? this.appearance.disabledOptionColor
            : state.selected
                ? this.appearance.selectedOptionColor
                : state.hovered
                    ? this.appearance.hoveredOptionColor
                    : this.appearance.unselectedOptionColor

        return {
            textColor: textColor ?? state.color,
            fontFamily: this.appearance.fontFamily ?? state.fontFamily,
            fontSize: this.appearance.fontSize ?? state.fontSize,
            fontWeight: this.appearance.fontWeight ?? state.fontWeight,
            colors: this.appearance.closeHoverColor === undefined ? undefined : {
                closeHover: this.appearance.closeHoverColor,
            },
        }
    }

    setAppearance(appearance: Partial<SlidingSwitchAppearance>): void {
        this.appearance = {
            ...this.appearance,
            ...appearance,
        }
        this.switchInstance.setAppearance(appearance)
    }

    render(): void {
        this.switchInstance.render()
    }

    resize(
        x: number,
        y: number,
        width: number,
        height?: number,
    ): void {
        this.switchInstance.resize(
            x,
            y,
            width,
            height,
        )
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

export const createSlidingTabsSwitch = <Value extends string = string>(
    parent: any,
    config: SlidingTabsSwitchConfig<Value>,
): SlidingTabsSwitchInstance<Value> => new SlidingTabsSwitch(parent, config)
