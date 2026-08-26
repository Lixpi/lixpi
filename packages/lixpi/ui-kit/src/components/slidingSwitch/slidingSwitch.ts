// Side-effect import: patches the d3-selection prototype so `.transition()` exists.
import 'd3-transition'

// @ts-ignore - runtime import
import { easeCubicOut } from 'd3-ease'
import { xIcon } from '../../svg/svgIcons.ts'
import { appendSvgPathIcon } from '../../svg/svgIconPaths.ts'

export type SlidingSwitchOption<Value extends string = string> = {
    label: string
    value: Value
    closable?: boolean
    disabled?: boolean
    ariaLabel?: string
    closeAriaLabel?: string
}

export type SlidingSwitchOptionRenderState<Value extends string = string> = {
    id: string
    option: SlidingSwitchOption<Value>
    index: number
    x: number
    y: number
    width: number
    height: number
    selected: boolean
    hovered: boolean
    disabled: boolean
    closable: boolean
    onClose: (event: Event) => void
}

export type SlidingSwitchOptionRenderInstance<Value extends string = string> = {
    resize?: (x: number, y: number, width: number, height?: number) => void
    render?: (state: SlidingSwitchOptionRenderState<Value>) => void
    destroy?: () => void
}

export type SlidingSwitchOptionRenderer<Value extends string = string> = (
    parent: any,
    state: SlidingSwitchOptionRenderState<Value>
) => SlidingSwitchOptionRenderInstance<Value> | void

export type SlidingSwitchIndicatorInsetShadow = {
    topColor: string
    bottomColor: string
}

export type SlidingSwitchVisualOverflowPadding = {
    top: number
    right: number
    bottom: number
    left: number
}

export type SlidingSwitchTransitionConfig = {
    durationMs: number
    minDurationMs: number
    distanceSpeedupFactor: number
}

export type SlidingSwitchReshuffleItemsOnValueChange = {
    enable: boolean
    selectedElementPosition: 'left' | 'right'
}

export type SlidingSwitchConfig<Value extends string = string> = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    options: SlidingSwitchOption<Value>[]
    selectedValue?: Value
    className?: string
    role?: string
    optionRole?: string
    selectedAriaAttribute?: 'aria-checked' | 'aria-selected'
    minOptionWidth?: number
    observeParentResize?: boolean
    visualOverflowPadding?: Partial<SlidingSwitchVisualOverflowPadding>
    indicatorBoxShadow?: string
    indicatorInsetShadow?: SlidingSwitchIndicatorInsetShadow
    transition?: Partial<SlidingSwitchTransitionConfig>
    reshuffleItemsOnValueChange?: SlidingSwitchReshuffleItemsOnValueChange
    renderOption?: SlidingSwitchOptionRenderer<Value>
    onChange?: (value: Value, id: string) => void
    onClose?: (value: Value, id: string, option: SlidingSwitchOption<Value>) => void
}

export type SlidingSwitchInstance<Value extends string = string> = {
    render: () => void
    resize: (x: number, y: number, width: number, height?: number) => void
    setValue: (value: Value) => void
    getValue: () => Value
    getContentWidth: () => number
    getOuterHeight: () => number
    destroy: () => void
}

type SlidingSwitchOptionView<Value extends string = string> = {
    option: SlidingSwitchOption<Value>
    index: number
    group: any
    hit: any
    label: any | null
    closeGroup: any | null
    closeBackground: any | null
    closeIcon: any | null
    customRenderer: SlidingSwitchOptionRenderInstance<Value> | null
}

const PADDING = 2
const DEFAULT_SLIDING_SWITCH_TRANSITION_DURATION_MS = 150
export const SLIDING_SWITCH_TRANSITION_DURATION_MS = DEFAULT_SLIDING_SWITCH_TRANSITION_DURATION_MS
const DEFAULT_MIN_SLIDING_SWITCH_TRANSITION_DURATION_MS = 70
const DEFAULT_DISTANCE_SPEEDUP_FACTOR = 0.28
const RESHUFFLE_INITIAL_SLIDE_OVERLAP_RATIO = 0.3
const DEFAULT_HEIGHT = 26
const FONT_SIZE = 12
const FONT_WEIGHT = 400
const CLOSE_SIZE = 14
const CLOSE_ICON_SIZE = 7
const CLOSE_GAP = 6
const SHADOW_PADDING_TOP = 10
const SHADOW_PADDING_RIGHT = 14
const SHADOW_PADDING_BOTTOM = 0
const SHADOW_PADDING_LEFT = 14
let slidingSwitchInstanceCounter = 0

const COLORS = {
    track: 'rgba(105, 115, 133, 0.09)',
    indicator: 'rgba(255, 255, 255, 0.72)',
    optionText: 'rgba(49, 59, 78, 0.68)',
    optionTextActive: '#1a2744',
    optionTextDisabled: 'rgba(49, 59, 78, 0.32)',
    closeHover: 'rgba(26, 39, 68, 0.1)',
}

class SlidingSwitch<Value extends string = string> implements SlidingSwitchInstance<Value> {
    private readonly id: string
    private readonly options: SlidingSwitchOption<Value>[]
    private readonly className: string
    private readonly role: string
    private readonly optionRole: string
    private readonly selectedAriaAttribute: 'aria-checked' | 'aria-selected'
    private readonly minOptionWidth: number | null
    private readonly observeParentResize: boolean
    private readonly visualOverflowPadding: SlidingSwitchVisualOverflowPadding
    private readonly indicatorBoxShadow: string
    private readonly indicatorInsetShadow: SlidingSwitchIndicatorInsetShadow | null
    private readonly indicatorInsetGradientId: string
    private readonly transitionConfig: SlidingSwitchTransitionConfig
    private readonly reshuffleItemsOnValueChange: SlidingSwitchReshuffleItemsOnValueChange | null
    private readonly onChange?: (value: Value, id: string) => void
    private readonly onClose?: (value: Value, id: string, option: SlidingSwitchOption<Value>) => void
    private readonly renderOption?: SlidingSwitchOptionRenderer<Value>

    private x: number
    private y: number
    private requestedWidth: number
    private width: number
    private height: number
    private currentValue: Value
    private hoveredValue: Value | null = null
    private destroyed = false

    private readonly group: any
    private readonly parent: any
    private readonly indicatorInsetGradient: any
    private readonly track: any
    private readonly indicator: any
    private readonly indicatorInset: any
    private readonly optionViews: SlidingSwitchOptionView<Value>[] = []
    private resizeObserver: ResizeObserver | null = null
    private readonly observedResizeTargets: Set<Element> = new Set()
    private resizeAnimationFrame: number | null = null
    private indicatorAnimationTargetX: number | null = null
    private indicatorAnimationTimer: ReturnType<typeof setTimeout> | null = null
    private reshuffleAnimationTimer: ReturnType<typeof setTimeout> | null = null
    private reshuffleRemainingDuration: number | null = null
    private reshuffleAnimationActive = false

    constructor(parent: any, config: SlidingSwitchConfig<Value>) {
        if (config.options.length === 0) {
            throw new Error('Sliding switch requires at least one option')
        }

        this.parent = parent
        this.id = config.id
        this.options = [...config.options]
        this.className = config.className ?? ''
        this.role = config.role ?? 'radiogroup'
        this.optionRole = config.optionRole ?? 'radio'
        this.selectedAriaAttribute = config.selectedAriaAttribute ?? 'aria-checked'
        this.minOptionWidth = config.minOptionWidth ?? null
        this.observeParentResize = config.observeParentResize ?? config.minOptionWidth !== undefined
        this.indicatorBoxShadow = config.indicatorBoxShadow ?? 'none'
        this.indicatorInsetShadow = config.indicatorInsetShadow ?? null
        this.transitionConfig = this.createTransitionConfig(config.transition)
        this.reshuffleItemsOnValueChange = config.reshuffleItemsOnValueChange?.enable
            ? config.reshuffleItemsOnValueChange
            : null
        this.visualOverflowPadding = this.createVisualOverflowPadding(config.visualOverflowPadding)
        slidingSwitchInstanceCounter += 1
        this.indicatorInsetGradientId = `${this.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${slidingSwitchInstanceCounter}-indicator-inset`
        this.onChange = config.onChange
        this.onClose = config.onClose
        this.renderOption = config.renderOption
        this.x = config.x
        this.y = config.y
        this.requestedWidth = config.width
        this.width = this.resolveContentWidth(config.width)
        this.height = config.height ?? DEFAULT_HEIGHT
        this.currentValue = config.selectedValue !== undefined && this.indexOf(config.selectedValue) >= 0
            ? config.selectedValue
            : this.options[0]!.value
        this.moveSelectedOptionToConfiguredPosition(this.currentValue)

        this.group = parent.append('g')
            .attr('class', `sliding-switch-group ${this.className}`)
            .attr('transform', `translate(${this.x}, ${this.y})`)
            .attr('data-sliding-switch-id', this.id)
            .attr('role', this.role)
            .style('cursor', 'pointer')

        const defs = this.group.append('defs')
        this.indicatorInsetGradient = defs.append('linearGradient')
            .attr('id', this.indicatorInsetGradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%')

        this.track = this.group.append('rect')
            .attr('class', 'sliding-switch-track')

        this.indicator = this.group.append('rect')
            .attr('class', 'sliding-switch-indicator')

        this.indicatorInset = this.group.append('rect')
            .attr('class', 'sliding-switch-indicator-inset-shadow')
            .attr('pointer-events', 'none')

        for (const [index, option] of this.options.entries()) {
            this.optionViews.push(this.createOptionView(option, index))
        }

        this.bindResizeObserver()
        this.renderInternal(false)
    }

    private createVisualOverflowPadding(padding: Partial<SlidingSwitchVisualOverflowPadding> | undefined): SlidingSwitchVisualOverflowPadding {
        const hasOuterShadow = this.indicatorBoxShadow !== 'none'
        return {
            top: padding?.top ?? (hasOuterShadow ? SHADOW_PADDING_TOP : 0),
            right: padding?.right ?? (hasOuterShadow ? SHADOW_PADDING_RIGHT : 0),
            bottom: padding?.bottom ?? (hasOuterShadow ? SHADOW_PADDING_BOTTOM : 0),
            left: padding?.left ?? (hasOuterShadow ? SHADOW_PADDING_LEFT : 0),
        }
    }

    private resolveContentWidth(width: number): number {
        if (this.minOptionWidth === null) return width
        return Math.max(width, this.options.length * this.minOptionWidth + PADDING * 2)
    }

    private createTransitionConfig(config: Partial<SlidingSwitchTransitionConfig> | undefined): SlidingSwitchTransitionConfig {
        return {
            durationMs: Math.max(0, config?.durationMs ?? DEFAULT_SLIDING_SWITCH_TRANSITION_DURATION_MS),
            minDurationMs: Math.max(0, config?.minDurationMs ?? DEFAULT_MIN_SLIDING_SWITCH_TRANSITION_DURATION_MS),
            distanceSpeedupFactor: Math.max(0, config?.distanceSpeedupFactor ?? DEFAULT_DISTANCE_SPEEDUP_FACTOR),
        }
    }

    private transitionDuration(fromIndex: number | null, toIndex: number): number {
        if (fromIndex === null || fromIndex < 0 || toIndex < 0) return this.transitionConfig.durationMs
        const travelDistance = Math.max(1, Math.abs(toIndex - fromIndex))
        const speedup = 1 + (travelDistance - 1) * this.transitionConfig.distanceSpeedupFactor
        return Math.max(
            this.transitionConfig.minDurationMs,
            Math.round(this.transitionConfig.durationMs / speedup)
        )
    }

    private clearIndicatorAnimationTimer(): void {
        if (this.indicatorAnimationTimer === null) return
        clearTimeout(this.indicatorAnimationTimer)
        this.indicatorAnimationTimer = null
    }

    private clearReshuffleAnimationTimer(): void {
        if (this.reshuffleAnimationTimer === null) return
        clearTimeout(this.reshuffleAnimationTimer)
        this.reshuffleAnimationTimer = null
    }

    private stopAnimations(): void {
        this.clearIndicatorAnimationTimer()
        this.clearReshuffleAnimationTimer()
        this.indicatorAnimationTargetX = null
        this.reshuffleRemainingDuration = null
        this.reshuffleAnimationActive = false
        this.indicator.interrupt()
        this.indicatorInset.interrupt()
        for (const view of this.optionViews) {
            view.group.interrupt().attr('transform', 'translate(0, 0)')
        }
        this.synchronizeOptionDomOrder()
    }

    private animateIndicatorTo(targetX: number, duration: number): void {
        this.clearIndicatorAnimationTimer()
        this.indicatorAnimationTargetX = targetX
        this.indicator.interrupt()
        this.indicatorInset.interrupt()
        this.indicator.transition().duration(duration).ease(easeCubicOut).attr('x', targetX)
        this.indicatorInset.transition().duration(duration).ease(easeCubicOut).attr('x', targetX)
        this.indicatorAnimationTimer = setTimeout(() => {
            this.indicatorAnimationTimer = null
            this.indicatorAnimationTargetX = null
            if (this.destroyed) return
            this.indicator.attr('x', targetX)
            this.indicatorInset.attr('x', targetX)
        }, duration)
    }

    private outerWidth(): number {
        return this.width + this.visualOverflowPadding.left + this.visualOverflowPadding.right
    }

    private outerHeight(): number {
        return this.height + this.visualOverflowPadding.top + this.visualOverflowPadding.bottom
    }

    private updateHostSvgGeometry(): void {
        const node = this.parent.node?.()
        if (node?.tagName?.toLowerCase() !== 'svg') return

        this.parent
            .attr('width', this.outerWidth())
            .attr('height', this.outerHeight())
            .attr('viewBox', `0 0 ${this.outerWidth()} ${this.outerHeight()}`)
            .style('width', `${this.outerWidth()}px`)
            .style('min-width', `${this.outerWidth()}px`)
            .style('overflow', 'hidden')
    }

    private bindResizeObserver(): void {
        if (!this.observeParentResize || typeof ResizeObserver === 'undefined') return

        this.resizeObserver = new ResizeObserver(() => {
            this.scheduleObservedResize()
        })
        this.updateResizeObserverTargets()
        this.scheduleObservedResize()
    }

    private getResizeMeasureElement(): Element | null {
        const node = this.parent.node?.()
        if (!node) return null
        return node.parentElement ?? node.ownerSVGElement?.parentElement ?? null
    }

    private getResizeObserverTargets(): Element[] {
        const targets: Element[] = []
        let target = this.getResizeMeasureElement()
        while (target && targets.length < 3) {
            targets.push(target)
            target = target.parentElement
        }
        return targets
    }

    private updateResizeObserverTargets(): void {
        if (!this.resizeObserver) return

        const nextTargets = new Set(this.getResizeObserverTargets())
        for (const target of this.observedResizeTargets) {
            if (!nextTargets.has(target)) {
                this.resizeObserver.unobserve(target)
                this.observedResizeTargets.delete(target)
            }
        }
        for (const target of nextTargets) {
            if (!this.observedResizeTargets.has(target)) {
                this.resizeObserver.observe(target)
                this.observedResizeTargets.add(target)
            }
        }
    }

    private scheduleObservedResize(): void {
        if (this.destroyed) return
        if (typeof requestAnimationFrame === 'undefined') {
            this.resizeToObservedWidth()
            return
        }
        if (this.resizeAnimationFrame !== null) return

        this.resizeAnimationFrame = requestAnimationFrame(() => {
            this.resizeAnimationFrame = null
            this.resizeToObservedWidth()
        })
    }

    private resizeToObservedWidth(): void {
        if (this.destroyed) return

        this.updateResizeObserverTargets()
        const measureElement = this.getResizeMeasureElement()
        const clientWidth = measureElement && 'clientWidth' in measureElement
            ? Number(measureElement.clientWidth)
            : 0
        const containerWidth = clientWidth > 0
            ? clientWidth
            : measureElement?.getBoundingClientRect().width ?? 0
        if (!Number.isFinite(containerWidth) || containerWidth <= 0) return
        if (Math.abs(containerWidth - this.requestedWidth) < 0.5) return
        this.resize(this.x, this.y, containerWidth, this.height)
    }

    private indexOf(value: Value): number {
        return this.options.findIndex((option) => option.value === value)
    }

    private selectedPositionIndex(): number {
        return this.reshuffleItemsOnValueChange?.selectedElementPosition === 'left'
            ? 0
            : this.options.length - 1
    }

    private reshuffleStepCount(value: Value): number {
        if (!this.reshuffleItemsOnValueChange) return 0
        return Math.abs(this.indexOf(value) - this.selectedPositionIndex())
    }

    private reshufflePhaseDuration(totalDuration: number, stepCount: number): number {
        if (stepCount === 0) return totalDuration
        return totalDuration / (stepCount + 1 - RESHUFFLE_INITIAL_SLIDE_OVERLAP_RATIO)
    }

    private moveSelectedOptionToConfiguredPosition(value: Value): void {
        if (!this.reshuffleItemsOnValueChange) return
        const currentIndex = this.indexOf(value)
        const targetIndex = this.selectedPositionIndex()
        if (currentIndex < 0 || currentIndex === targetIndex) return

        const [selectedOption] = this.options.splice(currentIndex, 1)
        if (selectedOption) this.options.splice(targetIndex, 0, selectedOption)
    }

    private swapOptionPositions(firstIndex: number, secondIndex: number): void {
        const firstOption = this.options[firstIndex]!
        this.options[firstIndex] = this.options[secondIndex]!
        this.options[secondIndex] = firstOption

        const firstView = this.optionViews[firstIndex]!
        const secondView = this.optionViews[secondIndex]!
        this.optionViews[firstIndex] = secondView
        this.optionViews[secondIndex] = firstView
        firstView.index = secondIndex
        secondView.index = firstIndex
    }

    private synchronizeOptionDomOrder(): void {
        for (const view of this.optionViews) view.group.raise()
    }

    private completeReshuffleAnimation(): void {
        this.clearIndicatorAnimationTimer()
        this.indicatorAnimationTargetX = null
        this.reshuffleRemainingDuration = null
        this.reshuffleAnimationActive = false
        this.indicator.interrupt()
        this.indicatorInset.interrupt()
        this.synchronizeOptionDomOrder()
        this.renderInternal(false)
    }

    private animateNextReshuffleStep(value: Value): void {
        if (this.destroyed || !this.reshuffleItemsOnValueChange) return

        const currentIndex = this.indexOf(value)
        const targetIndex = this.selectedPositionIndex()
        if (currentIndex < 0 || currentIndex === targetIndex) {
            this.completeReshuffleAnimation()
            return
        }

        const direction = targetIndex > currentIndex ? 1 : -1
        const nextIndex = currentIndex + direction
        const selectedView = this.optionViews[currentIndex]!
        const displacedView = this.optionViews[nextIndex]!
        const movement = direction * this.segmentWidth()
        const remainingStepCount = this.reshuffleStepCount(value)
        const remainingDuration = this.reshuffleRemainingDuration ?? 0
        const stepDuration = remainingStepCount > 0
            ? Math.round(remainingDuration / remainingStepCount)
            : 0

        this.swapOptionPositions(currentIndex, nextIndex)
        selectedView.group.raise()
        selectedView.group
            .interrupt()
            .attr('transform', 'translate(0, 0)')
            .transition()
            .duration(stepDuration)
            .ease(easeCubicOut)
            .attr('transform', `translate(${movement}, 0)`)
        displacedView.group
            .interrupt()
            .attr('transform', 'translate(0, 0)')
            .transition()
            .duration(stepDuration)
            .ease(easeCubicOut)
            .attr('transform', `translate(${-movement}, 0)`)
        this.animateIndicatorTo(this.segmentX(nextIndex), stepDuration)

        this.reshuffleAnimationTimer = setTimeout(() => {
            this.reshuffleAnimationTimer = null
            if (this.destroyed) return
            selectedView.group.interrupt().attr('transform', 'translate(0, 0)')
            displacedView.group.interrupt().attr('transform', 'translate(0, 0)')
            if (this.reshuffleRemainingDuration !== null) {
                this.reshuffleRemainingDuration = Math.max(0, this.reshuffleRemainingDuration - stepDuration)
            }
            this.renderOptionView(selectedView)
            this.renderOptionView(displacedView)
            this.synchronizeOptionDomOrder()
            this.animateNextReshuffleStep(value)
        }, stepDuration)
    }

    private scheduleReshuffleAnimation(value: Value, phaseDuration: number, totalDuration: number): void {
        if (!this.reshuffleItemsOnValueChange || this.indexOf(value) === this.selectedPositionIndex()) return
        const reshuffleDelay = Math.ceil(phaseDuration * (1 - RESHUFFLE_INITIAL_SLIDE_OVERLAP_RATIO))
        this.reshuffleRemainingDuration = Math.max(0, totalDuration - reshuffleDelay)
        this.reshuffleAnimationActive = true
        this.reshuffleAnimationTimer = setTimeout(() => {
            this.reshuffleAnimationTimer = null
            this.animateNextReshuffleStep(value)
        }, reshuffleDelay)
    }

    private segmentWidth(): number {
        return (this.width - PADDING * 2) / this.options.length
    }

    private segmentX(index: number): number {
        return PADDING + index * this.segmentWidth()
    }

    private createOptionState(option: SlidingSwitchOption<Value>, index: number): SlidingSwitchOptionRenderState<Value> {
        const selected = option.value === this.currentValue
        const disabled = option.disabled ?? false
        return {
            id: `${this.id}:${option.value}`,
            option,
            index,
            x: this.segmentX(index),
            y: PADDING,
            width: this.segmentWidth(),
            height: this.height - PADDING * 2,
            selected,
            hovered: this.hoveredValue === option.value,
            disabled,
            closable: Boolean(option.closable && this.onClose && !disabled),
            onClose: (event: Event) => this.closeOption(option, event),
        }
    }

    private createOptionView(option: SlidingSwitchOption<Value>, index: number): SlidingSwitchOptionView<Value> {
        const group = this.group.append('g')
            .attr('class', 'sliding-switch-option-group')
            .attr('data-value', option.value)

        const hit = group.append('rect')
            .attr('class', 'sliding-switch-hit')
            .attr('fill', 'transparent')

        const state = this.createOptionState(option, index)
        const customRenderer = this.renderOption?.(group, state) ?? null

        const view: SlidingSwitchOptionView<Value> = {
            option,
            index,
            group,
            hit,
            label: null,
            closeGroup: null,
            closeBackground: null,
            closeIcon: null,
            customRenderer,
        }

        if (!customRenderer) this.createDefaultOptionContent(view)

        group
            .on('click', (event: Event) => this.selectOption(option, event))
            .on('keydown', (event: KeyboardEvent) => this.handleOptionKeydown(option, event))
            .on('mouseenter', () => {
                this.hoveredValue = option.value
                this.renderInternal(false)
            })
            .on('mouseleave', () => {
                if (this.hoveredValue === option.value) this.hoveredValue = null
                this.renderInternal(false)
            })

        return view
    }

    private createDefaultOptionContent(view: SlidingSwitchOptionView<Value>): void {
        view.label = view.group.append('text')
            .attr('class', 'sliding-switch-option')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', FONT_SIZE)
            .attr('font-weight', FONT_WEIGHT)
            .attr('data-value', view.option.value)

        view.closeGroup = view.group.append('g')
            .attr('class', 'sliding-switch-option-close')
            .attr('role', 'button')

        view.closeBackground = view.closeGroup.append('circle')
            .attr('class', 'sliding-switch-option-close-background')
            .attr('fill', 'transparent')

        view.closeIcon = view.closeGroup.append('g')
            .attr('class', 'sliding-switch-option-close-icon')

        view.closeGroup
            .on('click', (event: Event) => this.closeOption(view.option, event))
            .on('keydown', (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                this.closeOption(view.option, event)
            })
            .on('mouseenter', () => view.closeBackground?.attr('fill', COLORS.closeHover))
            .on('mouseleave', () => view.closeBackground?.attr('fill', 'transparent'))
    }

    private selectOption(option: SlidingSwitchOption<Value>, event: Event): void {
        if (event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        this.applyValue(option.value, true)
    }

    private closeOption(option: SlidingSwitchOption<Value>, event: Event): void {
        if (!option.closable || !this.onClose || option.disabled) return
        event.preventDefault()
        event.stopPropagation()
        this.onClose(option.value, this.id, option)
    }

    private handleOptionKeydown(option: SlidingSwitchOption<Value>, event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            this.selectOption(option, event)
            return
        }

        const offsetByKey: Record<string, number> = {
            ArrowRight: 1,
            ArrowDown: 1,
            ArrowLeft: -1,
            ArrowUp: -1,
        }
        const offset = offsetByKey[event.key]
        if (offset !== undefined) {
            event.preventDefault()
            event.stopPropagation()
            this.selectByOffset(offset)
            return
        }

        if (event.key === 'Home') {
            event.preventDefault()
            event.stopPropagation()
            this.selectFirstEnabled()
            return
        }

        if (event.key === 'End') {
            event.preventDefault()
            event.stopPropagation()
            this.selectLastEnabled()
        }
    }

    private selectByOffset(offset: number): void {
        const startIndex = this.indexOf(this.currentValue)
        for (let step = 1; step <= this.options.length; step += 1) {
            const index = (startIndex + offset * step + this.options.length) % this.options.length
            const option = this.options[index]!
            if (option.disabled) continue
            this.applyValue(option.value, true)
            return
        }
    }

    private selectFirstEnabled(): void {
        const option = this.options.find((candidate) => !candidate.disabled)
        if (option) this.applyValue(option.value, true)
    }

    private selectLastEnabled(): void {
        for (let index = this.options.length - 1; index >= 0; index -= 1) {
            const option = this.options[index]!
            if (option.disabled) continue
            this.applyValue(option.value, true)
            return
        }
    }

    private renderDefaultOptionContent(view: SlidingSwitchOptionView<Value>, state: SlidingSwitchOptionRenderState<Value>): void {
        const textColor = state.disabled
            ? COLORS.optionTextDisabled
            : state.selected || state.hovered ? COLORS.optionTextActive : COLORS.optionText
        const closeVisible = state.closable && state.hovered
        const closeReserve = state.closable ? CLOSE_SIZE + CLOSE_GAP : 0
        const textCenterX = state.x + closeReserve + (state.width - closeReserve) / 2
        const closeCenterX = state.x + CLOSE_SIZE / 2 + 4
        const closeCenterY = state.y + state.height / 2

        view.label
            ?.attr('x', textCenterX)
            .attr('y', state.y + state.height / 2)
            .attr('fill', textColor)
            .text(state.option.label)

        view.closeGroup
            ?.attr('transform', `translate(${closeCenterX}, ${closeCenterY})`)
            .attr('display', closeVisible ? null : 'none')
            .attr('tabindex', closeVisible ? 0 : null)
            .attr('aria-label', state.option.closeAriaLabel ?? `Close ${state.option.label}`)
            .attr('aria-hidden', String(!closeVisible))
            .style('cursor', closeVisible ? 'pointer' : 'default')

        view.closeBackground
            ?.attr('cx', 0)
            .attr('cy', 0)
            .attr('r', CLOSE_SIZE / 2)

        if (view.closeIcon) {
            appendSvgPathIcon(view.closeIcon, xIcon, {
                x: -CLOSE_ICON_SIZE / 2,
                y: -CLOSE_ICON_SIZE / 2,
                size: CLOSE_ICON_SIZE,
                fill: state.disabled ? COLORS.optionTextDisabled : COLORS.optionTextActive,
            })
        }
    }

    private renderOptionView(view: SlidingSwitchOptionView<Value>): void {
        const state = this.createOptionState(view.option, view.index)
        const selectedValue = String(state.selected)
        const checkedValue = String(state.selected)

        view.group
            .attr('transform', `translate(0, 0)`)
            .attr('role', this.optionRole)
            .attr('tabindex', state.disabled ? null : 0)
            .attr('aria-label', state.option.ariaLabel ?? state.option.label)
            .attr('aria-disabled', String(state.disabled))
            .attr('aria-selected', this.selectedAriaAttribute === 'aria-selected' ? selectedValue : null)
            .attr('aria-checked', this.selectedAriaAttribute === 'aria-checked' ? checkedValue : null)
            .style('cursor', state.disabled ? 'not-allowed' : 'pointer')

        view.hit
            .attr('x', state.x)
            .attr('y', state.y)
            .attr('width', state.width)
            .attr('height', state.height)
            .attr('rx', state.height / 2)
            .attr('ry', state.height / 2)

        if (view.customRenderer) {
            view.customRenderer.resize?.(state.x, state.y, state.width, state.height)
            view.customRenderer.render?.(state)
            return
        }

        this.renderDefaultOptionContent(view, state)
    }

    private renderInternal(
        animate: boolean,
        fromIndex: number | null = null,
        animationDuration?: number,
    ): void {
        if (this.destroyed) return

        const selectedIndex = this.indexOf(this.currentValue)
        const segmentWidth = this.segmentWidth()
        const indicatorHeight = this.height - PADDING * 2
        const targetX = this.segmentX(selectedIndex)

        this.updateHostSvgGeometry()

        this.group.attr(
            'transform',
            `translate(${this.x + this.visualOverflowPadding.left}, ${this.y + this.visualOverflowPadding.top})`
        )

        this.track
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', this.height / 2)
            .attr('ry', this.height / 2)
            .attr('fill', COLORS.track)

        this.indicator
            .attr('y', PADDING)
            .attr('width', segmentWidth)
            .attr('height', indicatorHeight)
            .attr('rx', indicatorHeight / 2)
            .attr('ry', indicatorHeight / 2)
            .attr('fill', COLORS.indicator)
            .attr('stroke', 'none')
            .attr('stroke-width', 0)
            .style('filter', this.indicatorBoxShadow === 'none' ? null : `drop-shadow(${this.indicatorBoxShadow})`)

        if (this.indicatorInsetShadow) {
            this.indicatorInsetGradient.selectAll('*').remove()
            this.indicatorInsetGradient.append('stop')
                .attr('offset', '0%')
                .attr('stop-color', this.indicatorInsetShadow.topColor)
            this.indicatorInsetGradient.append('stop')
                .attr('offset', '38%')
                .attr('stop-color', 'rgba(255, 255, 255, 0)')
            this.indicatorInsetGradient.append('stop')
                .attr('offset', '72%')
                .attr('stop-color', 'rgba(0, 0, 0, 0)')
            this.indicatorInsetGradient.append('stop')
                .attr('offset', '100%')
                .attr('stop-color', this.indicatorInsetShadow.bottomColor)
        }

        this.indicatorInset
            .attr('y', PADDING)
            .attr('width', segmentWidth)
            .attr('height', indicatorHeight)
            .attr('rx', indicatorHeight / 2)
            .attr('ry', indicatorHeight / 2)
            .attr('fill', this.indicatorInsetShadow ? `url(#${this.indicatorInsetGradientId})` : 'transparent')
            .attr('stroke', 'none')
            .attr('stroke-width', 0)

        if (animate) {
            const duration = animationDuration ?? this.transitionDuration(fromIndex, selectedIndex)
            this.animateIndicatorTo(targetX, duration)
        } else if (this.indicatorAnimationTargetX === null) {
            this.indicator.interrupt()
            this.indicatorInset.interrupt()
            this.indicator.attr('x', targetX)
            this.indicatorInset.attr('x', targetX)
        } else if (Math.abs(targetX - this.indicatorAnimationTargetX) >= 0.5) {
            this.animateIndicatorTo(targetX, this.transitionConfig.durationMs)
        } else {
            this.indicatorAnimationTargetX = targetX
        }

        if (!this.reshuffleAnimationActive) {
            for (const view of this.optionViews) this.renderOptionView(view)
        }
    }

    private applyValue(value: Value, notify: boolean): void {
        const nextIndex = this.indexOf(value)
        if (nextIndex < 0 || this.options[nextIndex]?.disabled) return
        const changed = value !== this.currentValue
        if (!changed) {
            this.renderInternal(false)
            return
        }

        if (this.reshuffleAnimationActive) {
            this.stopAnimations()
            this.renderInternal(false)
        }
        const previousIndex = this.indexOf(this.currentValue)
        const selectedIndex = this.indexOf(value)
        const totalAnimationDuration = this.transitionDuration(previousIndex, selectedIndex)
        const stepCount = this.reshuffleStepCount(value)
        const phaseDuration = this.reshufflePhaseDuration(totalAnimationDuration, stepCount)
        this.currentValue = value
        this.renderInternal(true, previousIndex, phaseDuration)
        this.scheduleReshuffleAnimation(value, phaseDuration, totalAnimationDuration)
        if (notify) this.onChange?.(value, this.id)
    }

    render = (): void => {
        if (!this.reshuffleAnimationActive) {
            this.renderInternal(false)
            return
        }
        this.stopAnimations()
        this.renderInternal(false)
    }

    resize(x: number, y: number, width: number, height: number = this.height): void {
        const animateIndicator = this.indicatorAnimationTargetX !== null && !this.reshuffleAnimationActive
        if (this.reshuffleAnimationActive) this.stopAnimations()
        this.x = x
        this.y = y
        this.requestedWidth = width
        this.width = this.resolveContentWidth(width)
        this.height = height
        this.renderInternal(animateIndicator)
    }

    setValue(value: Value): void {
        this.applyValue(value, false)
    }

    getValue(): Value {
        return this.currentValue
    }

    getContentWidth(): number {
        return this.width
    }

    getOuterHeight(): number {
        return this.outerHeight()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        if (this.resizeAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.resizeAnimationFrame)
            this.resizeAnimationFrame = null
        }
        this.stopAnimations()
        this.resizeObserver?.disconnect()
        this.observedResizeTargets.clear()
        for (const view of this.optionViews) view.customRenderer?.destroy?.()
        this.group.remove()
    }
}

export function createSlidingSwitch<Value extends string = string>(
    parent: any,
    config: SlidingSwitchConfig<Value>
): SlidingSwitchInstance<Value> {
    return new SlidingSwitch(parent, config)
}
