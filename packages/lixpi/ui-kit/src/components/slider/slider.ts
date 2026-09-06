import 'd3-transition'

// @ts-ignore - runtime import
import { easeCubicOut } from 'd3-ease'

export type SliderOption<Value extends string = string> = {
    value: Value
    label: string
    ariaLabel?: string
    disabled?: boolean
}

export type SliderConfig<Value extends string = string> = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    options: SliderOption<Value>[]
    selectedValue?: Value
    className?: string
    observeParentResize?: boolean
    onChange?: (
        value: Value,
        id: string,
    ) => void
}

export type SliderInstance<Value extends string = string> = {
    render: () => void
    resize: (
        x: number,
        y: number,
        width: number,
        height?: number,
    ) => void
    setValue: (value: Value) => void
    getValue: () => Value
    destroy: () => void
}

const DEFAULT_HEIGHT = 66
const RAIL_INSET = 16
const RAIL_STROKE_WIDTH = 4
const THUMB_RADIUS = 9
const THUMB_HALO_RADIUS = 15
const VALUE_BUBBLE_HEIGHT = 28
const VALUE_BUBBLE_POINTER_HEIGHT = 7
const VALUE_BUBBLE_RADIUS = 14
const VALUE_BUBBLE_HORIZONTAL_PADDING = 10
const VALUE_BUBBLE_CHARACTER_WIDTH = 7
const VALUE_BUBBLE_MIN_WIDTH = 38
const TRANSITION_DURATION_MS = 160

const COLORS = {
    rail: 'rgba(105, 115, 133, 0.18)',
    railActive: '#6750a4',
    thumb: '#6750a4',
    thumbHalo: 'rgba(103, 80, 164, 0.12)',
    valueBubble: '#6750a4',
    valueText: '#ffffff',
}

const clamp = (
    value: number,
    min: number,
    max: number,
): number => Math.min(
    max,
    Math.max(min, value),
)

class Slider<Value extends string = string> implements SliderInstance<Value> {
    private readonly id: string
    private readonly options: SliderOption<Value>[]
    private readonly className: string
    private readonly observeParentResize: boolean
    private readonly onChange?: (
        value: Value,
        id: string,
    ) => void

    private x: number
    private y: number
    private width: number
    private height: number
    private currentValue: Value
    private activePointerId: number | null = null
    private destroyed = false

    private readonly parent: any
    private readonly group: any
    private readonly rail: any
    private readonly activeRail: any
    private readonly thumbHalo: any
    private readonly thumb: any
    private readonly valueBubble: any
    private readonly valueBubblePath: any
    private readonly valueText: any
    private readonly hit: any
    private resizeObserver: ResizeObserver | null = null
    private resizeAnimationFrame: number | null = null

    constructor(
        parent: any,
        config: SliderConfig<Value>,
    ) {
        if (config.options.length === 0)
            throw new Error('Slider requires at least one option')

        this.parent = parent
        this.id = config.id
        this.options = config.options
        this.className = config.className ?? ''
        this.observeParentResize = config.observeParentResize ?? true
        this.onChange = config.onChange
        this.x = config.x
        this.y = config.y
        this.width = config.width
        this.height = config.height ?? DEFAULT_HEIGHT
        this.currentValue = config.selectedValue !== undefined
            && this.indexOf(config.selectedValue) >= 0
            ? config.selectedValue
            : this.firstEnabledOption().value

        this.group = parent
            .append('g')
            .attr('class', `slider-group ${this.className}`)
            .attr('data-slider-id', this.id)
            .attr('role', 'slider')
            .attr('tabindex', 0)
            .style('cursor', 'pointer')

        this.rail = this.group
            .append('line')
            .attr('class', 'slider-rail')
            .attr('stroke', COLORS.rail)
            .attr('stroke-width', RAIL_STROKE_WIDTH)
            .attr('stroke-linecap', 'round')
            .attr('pointer-events', 'none')

        this.activeRail = this.group
            .append('line')
            .attr('class', 'slider-rail-active')
            .attr('stroke', COLORS.railActive)
            .attr('stroke-width', RAIL_STROKE_WIDTH)
            .attr('stroke-linecap', 'round')
            .attr('pointer-events', 'none')

        this.thumbHalo = this.group
            .append('circle')
            .attr('class', 'slider-thumb-halo')
            .attr('r', THUMB_HALO_RADIUS)
            .attr('fill', COLORS.thumbHalo)
            .attr('pointer-events', 'none')

        this.thumb = this.group
            .append('circle')
            .attr('class', 'slider-thumb')
            .attr('r', THUMB_RADIUS)
            .attr('fill', COLORS.thumb)
            .attr('pointer-events', 'none')

        this.valueBubble = this.group
            .append('g')
            .attr('class', 'slider-value-bubble')
            .attr('pointer-events', 'none')

        this.valueBubblePath = this.valueBubble
            .append('path')
            .attr('class', 'slider-value-bubble-background')
            .attr('fill', COLORS.valueBubble)

        this.valueText = this.valueBubble
            .append('text')
            .attr('class', 'slider-value-text')
            .attr('fill', COLORS.valueText)
            .attr('font-size', 12)
            .attr('font-weight', 600)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')

        this.hit = this.group
            .append('rect')
            .attr('class', 'slider-hit')
            .attr('fill', 'transparent')

        this.hit.on('pointerdown', (event: PointerEvent) => this.handlePointerDown(event))
        this.group.on('keydown', (event: KeyboardEvent) => this.handleKeydown(event))

        this.bindResizeObserver()
        this.renderInternal(false)
    }

    private firstEnabledOption(): SliderOption<Value> {
        return this.options.find(option => !option.disabled) ?? this.options[0]!
    }

    private indexOf(value: Value): number {
        return this.options.findIndex(option => option.value === value)
    }

    private selectedOption(): SliderOption<Value> {
        return this.options[this.indexOf(this.currentValue)] ?? this.firstEnabledOption()
    }

    private railStart(): number {
        return Math.min(RAIL_INSET, this.width / 2)
    }

    private railEnd(): number {
        return Math.max(
            this.railStart(),
            this.width - RAIL_INSET,
        )
    }

    private railY(): number {
        return Math.max(VALUE_BUBBLE_HEIGHT + VALUE_BUBBLE_POINTER_HEIGHT + THUMB_HALO_RADIUS, this.height - THUMB_HALO_RADIUS)
    }

    private optionX(index: number): number {
        if (this.options.length === 1)
            return (this.railStart() + this.railEnd()) / 2

        const ratio = index / (this.options.length - 1)

        return this.railStart() + ratio * (this.railEnd() - this.railStart())
    }

    private valueBubbleWidth(label: string): number {
        return Math.max(VALUE_BUBBLE_MIN_WIDTH, label.length * VALUE_BUBBLE_CHARACTER_WIDTH + VALUE_BUBBLE_HORIZONTAL_PADDING * 2)
    }

    private valueBubblePathData(
        width: number,
        pointerX: number,
    ): string {
        const bodyBottom = VALUE_BUBBLE_HEIGHT
        const pointerHalfWidth = 5
        const pointerLeft = clamp(
            pointerX - pointerHalfWidth,
            VALUE_BUBBLE_RADIUS,
            width - VALUE_BUBBLE_RADIUS,
        )
        const pointerRight = clamp(
            pointerX + pointerHalfWidth,
            VALUE_BUBBLE_RADIUS,
            width - VALUE_BUBBLE_RADIUS,
        )

        return [
            `M ${VALUE_BUBBLE_RADIUS} 0`,
            `H ${width - VALUE_BUBBLE_RADIUS}`,
            `Q ${width} 0 ${width} ${VALUE_BUBBLE_RADIUS}`,
            `V ${bodyBottom - VALUE_BUBBLE_RADIUS}`,
            `Q ${width} ${bodyBottom} ${width - VALUE_BUBBLE_RADIUS} ${bodyBottom}`,
            `H ${pointerRight}`,
            `L ${pointerX} ${bodyBottom + VALUE_BUBBLE_POINTER_HEIGHT}`,
            `L ${pointerLeft} ${bodyBottom}`,
            `H ${VALUE_BUBBLE_RADIUS}`,
            `Q 0 ${bodyBottom} 0 ${bodyBottom - VALUE_BUBBLE_RADIUS}`,
            `V ${VALUE_BUBBLE_RADIUS}`,
            `Q 0 0 ${VALUE_BUBBLE_RADIUS} 0`,
            'Z',
        ].join(' ')
    }

    private updateAccessibility(): void {
        const index = this.indexOf(this.currentValue)
        const option = this.selectedOption()
        this.group
            .attr('aria-label', option.ariaLabel ?? option.label)
            .attr('aria-valuemin', 0)
            .attr(
                'aria-valuemax',
                Math.max(0, this.options.length - 1),
            )
            .attr(
                'aria-valuenow',
                Math.max(0, index),
            )
            .attr('aria-valuetext', option.label)
    }

    private updateHostSvgGeometry(): void {
        const node = this.parent.node?.()

        if (node?.tagName?.toLowerCase() !== 'svg')
            return

        this.parent
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .style('width', `${this.width}px`)
            .style('min-width', '0')
            .style('overflow', 'visible')
    }

    private renderInternal(animate: boolean): void {
        if (this.destroyed)
            return

        const selectedIndex = Math.max(
            0,
            this.indexOf(this.currentValue),
        )
        const selectedOption = this.selectedOption()
        const selectedX = this.optionX(selectedIndex)
        const railY = this.railY()
        const bubbleWidth = this.valueBubbleWidth(selectedOption.label)
        const bubbleLeft = clamp(
            selectedX - bubbleWidth / 2,
            0,
            Math.max(0, this.width - bubbleWidth),
        )
        const bubblePointerX = selectedX - bubbleLeft

        this.updateHostSvgGeometry()
        this.updateAccessibility()
        this.group.attr('transform', `translate(${this.x}, ${this.y})`)

        this.rail
            .attr(
                'x1',
                this.railStart(),
            )
            .attr(
                'x2',
                this.railEnd(),
            )
            .attr('y1', railY)
            .attr('y2', railY)

        this.hit
            .attr('x', 0)
            .attr('y', VALUE_BUBBLE_HEIGHT)
            .attr('width', this.width)
            .attr(
                'height',
                Math.max(1, this.height - VALUE_BUBBLE_HEIGHT),
            )

        this.valueBubblePath.attr(
            'd',
            this.valueBubblePathData(bubbleWidth, bubblePointerX),
        )
        this.valueText
            .attr('x', bubbleWidth / 2)
            .attr('y', VALUE_BUBBLE_HEIGHT / 2)
            .text(selectedOption.label)

        if (animate) {
            this.activeRail.interrupt().transition()
                .duration(TRANSITION_DURATION_MS)
                .ease(easeCubicOut)
                .attr('x2', selectedX)
            this.thumbHalo.interrupt().transition()
                .duration(TRANSITION_DURATION_MS)
                .ease(easeCubicOut)
                .attr('cx', selectedX)
            this.thumb.interrupt().transition()
                .duration(TRANSITION_DURATION_MS)
                .ease(easeCubicOut)
                .attr('cx', selectedX)
            this.valueBubble.interrupt().transition()
                .duration(TRANSITION_DURATION_MS)
                .ease(easeCubicOut)
                .attr('transform', `translate(${bubbleLeft}, 0)`)
        } else {
            this.activeRail.interrupt().attr('x2', selectedX)
            this.thumbHalo.interrupt().attr('cx', selectedX)
            this.thumb.interrupt().attr('cx', selectedX)
            this.valueBubble.interrupt().attr('transform', `translate(${bubbleLeft}, 0)`)
        }

        this.activeRail
            .attr(
                'x1',
                this.railStart(),
            )
            .attr('y1', railY)
            .attr('y2', railY)
        this.thumbHalo.attr('cy', railY)
        this.thumb.attr('cy', railY)
    }

    private applyValue(
        value: Value,
        notify: boolean,
        animate: boolean,
    ): void {
        const nextIndex = this.indexOf(value)

        if (
            nextIndex < 0
            || this.options[nextIndex]?.disabled
        )
            return

        const changed = value !== this.currentValue
        this.currentValue = value
        this.renderInternal(changed && animate)

        if (
            changed
            && notify
        )
            this.onChange?.(value, this.id)
    }

    private nearestEnabledIndex(index: number): number {
        if (!this.options[index]?.disabled)
            return index

        for (let distance = 1; distance < this.options.length; distance += 1) {
            const leftIndex = index - distance

            if (
                leftIndex >= 0
                && !this.options[leftIndex]?.disabled
            )
                return leftIndex

            const rightIndex = index + distance

            if (
                rightIndex < this.options.length
                && !this.options[rightIndex]?.disabled
            )
                return rightIndex
        }

        return this.indexOf(this.currentValue)
    }

    private indexFromPointer(event: PointerEvent): number {
        const hitNode = this.hit.node() as SVGRectElement
        const rect = hitNode.getBoundingClientRect()

        if (
            rect.width <= 0
            || this.options.length === 1
        )
            return 0

        const ratio = clamp(
            (event.clientX - rect.left) / rect.width,
            0,
            1,
        )

        return this.nearestEnabledIndex(
            Math.round(ratio * (this.options.length - 1)),
        )
    }

    private applyPointerValue(
        event: PointerEvent,
        animate: boolean,
    ): void {
        const option = this.options[this.indexFromPointer(event)]

        if (option)
            this.applyValue(
                option.value,
                true,
                animate,
            )
    }

    private readonly handleWindowPointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId)
            return

        event.preventDefault()
        event.stopPropagation()
        this.applyPointerValue(event, false)
    }

    private readonly handleWindowPointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId)
            return

        event.preventDefault()
        event.stopPropagation()
        this.activePointerId = null
        this.removeWindowPointerListeners()
    }

    private handlePointerDown(event: PointerEvent): void {
        event.preventDefault()
        event.stopPropagation()
        this.activePointerId = event.pointerId
        this.applyPointerValue(event, true)
        window.addEventListener(
            'pointermove',
            this.handleWindowPointerMove,
            { passive: false },
        )
        window.addEventListener(
            'pointerup',
            this.handleWindowPointerUp,
            { passive: false },
        )
        window.addEventListener(
            'pointercancel',
            this.handleWindowPointerUp,
            { passive: false },
        )
    }

    private removeWindowPointerListeners(): void {
        window.removeEventListener('pointermove', this.handleWindowPointerMove)
        window.removeEventListener('pointerup', this.handleWindowPointerUp)
        window.removeEventListener('pointercancel', this.handleWindowPointerUp)
    }

    private handleKeydown(event: KeyboardEvent): void {
        const currentIndex = this.indexOf(this.currentValue)
        const nextByKey: Record<string, number> = {
            ArrowLeft: currentIndex - 1,
            ArrowDown: currentIndex - 1,
            ArrowRight: currentIndex + 1,
            ArrowUp: currentIndex + 1,
            Home: 0,
            End: this.options.length - 1,
        }
        const requestedIndex = nextByKey[event.key]

        if (requestedIndex === undefined)
            return

        event.preventDefault()
        event.stopPropagation()
        const nextIndex = this.nearestEnabledIndex(
            clamp(
                requestedIndex,
                0,
                this.options.length - 1,
            ),
        )
        const option = this.options[nextIndex]

        if (option)
            this.applyValue(
                option.value,
                true,
                true,
            )
    }

    private bindResizeObserver(): void {
        if (
            !this.observeParentResize
            || typeof ResizeObserver === 'undefined'
        )
            return

        const node = this.parent.node?.()
        const measureElement = node?.parentElement

        if (!measureElement)
            return

        this.resizeObserver = new ResizeObserver(() => this.scheduleObservedResize())
        this.resizeObserver.observe(measureElement)
    }

    private scheduleObservedResize(): void {
        if (
            this.destroyed
            || this.resizeAnimationFrame !== null
        )
            return

        if (typeof requestAnimationFrame === 'undefined') {
            this.resizeToParent()

            return
        }

        this.resizeAnimationFrame = requestAnimationFrame(() => {
            this.resizeAnimationFrame = null
            this.resizeToParent()
        })
    }

    private resizeToParent(): void {
        const node = this.parent.node?.()
        const measureElement = node?.parentElement
        const nextWidth = Number(measureElement?.clientWidth ?? 0)
            || measureElement?.getBoundingClientRect().width
            || 0

        if (
            !Number.isFinite(nextWidth)
            || nextWidth <= 0
            || Math.abs(nextWidth - this.width) < 0.5
        )
            return

        this.resize(
            this.x,
            this.y,
            nextWidth,
            this.height,
        )
    }

    render = (): void => void this.renderInternal(false)

    resize(
        x: number,
        y: number,
        width: number,
        height = this.height,
    ): void {
        this.x = x
        this.y = y
        this.width = width
        this.height = height
        this.renderInternal(false)
    }

    setValue(value: Value): void {
        if (value === this.currentValue)
            return

        this.applyValue(
            value,
            false,
            false,
        )
    }

    getValue(): Value {
        return this.currentValue
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.activePointerId = null
        this.removeWindowPointerListeners()

        if (
            this.resizeAnimationFrame !== null
            && typeof cancelAnimationFrame !== 'undefined'
        ) {
            cancelAnimationFrame(this.resizeAnimationFrame)
            this.resizeAnimationFrame = null
        }

        this.resizeObserver?.disconnect()
        this.activeRail.interrupt()
        this.thumbHalo.interrupt()
        this.thumb.interrupt()
        this.valueBubble.interrupt()
        this.group.remove()
    }
}

export const createSlider = <Value extends string = string>(
    parent: any,
    config: SliderConfig<Value>,
): SliderInstance<Value> => new Slider(parent, config)
