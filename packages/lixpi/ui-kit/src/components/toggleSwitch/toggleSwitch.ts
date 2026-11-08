import { lixpiLightTheme } from '@lixpi/themes'
import 'd3-transition'
// @ts-ignore - runtime import
import { easeCubicOut } from 'd3-ease'
import { checkMarkIcon } from '../../svg/svgIcons.ts'
import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'

export type ToggleSwitchAppearance = {
    activeFill: string
    activeStroke: string
    inactiveFill: string
    inactiveStroke: string
    knobFill: string
    knobStroke: string
    checkmarkColor: string
    strokeWidth: number
    disabledOpacity: number
}

export type ToggleSwitchConfig = {
    id: string
    x: number
    y: number
    width?: number
    height?: number
    size?: number
    checked?: boolean
    disabled?: boolean
    className?: string
    appearance?: Partial<ToggleSwitchAppearance>
    onChange?: (
        checked: boolean,
        id: string,
    ) => void
}

export type ToggleSwitchInstance = {
    render: () => void
    resize: (
        x: number,
        y: number,
        width: number,
        height?: number,
    ) => void
    setAppearance: (appearance: Partial<ToggleSwitchAppearance>) => void
    setChecked: (checked: boolean) => void
    setDisabled: (disabled: boolean) => void
    getChecked: () => boolean
    destroy: () => void
}

const TOGGLE_WIDTH_RATIO = 1.8
const KNOB_SIZE_RATIO = 0.7
const TOGGLE_DURATION_MS = 200

const DEFAULT_APPEARANCE: ToggleSwitchAppearance = lixpiLightTheme.components.toggleSwitch

class ToggleSwitch implements ToggleSwitchInstance {
    private checked: boolean
    private disabled: boolean
    private x: number
    private y: number
    private width: number
    private height: number
    private appearance: ToggleSwitchAppearance
    private destroyed = false
    private readonly group: any
    private readonly track: any
    private readonly knob: any
    private readonly checkmark: any
    private readonly checkmarkIcon = extractSvgPathIcon(checkMarkIcon)

    constructor(
        parent: any,
        private readonly config: ToggleSwitchConfig,
    ) {
        this.checked = config.checked ?? false
        this.disabled = config.disabled ?? false
        this.x = config.x
        this.y = config.y
        this.height = config.height
            ?? config.size
            ?? 24
        this.width = config.width ?? this.height * TOGGLE_WIDTH_RATIO
        this.appearance = {
            ...DEFAULT_APPEARANCE,
            ...config.appearance,
        }

        this.group = parent
            .append('g')
            .attr('class', `toggle-switch-group toggle-switch ${config.className ?? ''}`)
            .attr('data-toggle-switch-id', config.id)
            .style('opacity', 1)
            .on('click', this.handleClick)
        this.track = this.group.append('rect')
            .attr('class', 'toggle-track')
        this.knob = this.group.append('circle')
            .attr('class', 'toggle-knob')
        this.checkmark = this.group.append('g')
            .attr('class', 'toggle-checkmark')

        for (const pathData of this.checkmarkIcon.pathData)
            this.checkmark.append('path').attr('d', pathData)

        this.paintGeometry()
        this.paintAppearance()
    }

    private knobX(): number {
        const radius = this.height / 2

        return this.checked ? this.width - radius : radius
    }

    private checkmarkTransform(): string {
        const knobSize = this.height * KNOB_SIZE_RATIO
        const iconSize = knobSize * 0.6
        const scale = iconSize / Math.max(this.checkmarkIcon.width, this.checkmarkIcon.height)
        const width = this.checkmarkIcon.width * scale
        const height = this.checkmarkIcon.height * scale
        const x = this.knobX() - width / 2
        const y = this.height / 2 - height / 2

        return `translate(${x}, ${y}) scale(${scale}) translate(${-this.checkmarkIcon.minX}, ${-this.checkmarkIcon.minY})`
    }

    private paintGeometry(): void {
        this.group.attr('transform', `translate(${this.x}, ${this.y})`)
        this.track
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', this.height / 2)
            .attr('ry', this.height / 2)
        this.knob
            .attr(
                'cx',
                this.knobX(),
            )
            .attr('cy', this.height / 2)
            .attr('r', this.height * KNOB_SIZE_RATIO / 2)
        this.checkmark.attr('opacity', this.checked ? 1 : 0)
        this.checkmark.selectAll('path').attr(
            'transform',
            this.checkmarkTransform(),
        )
    }

    private paintAppearance(): void {
        this.track
            .attr('fill', this.checked ? this.appearance.activeFill : this.appearance.inactiveFill)
            .attr('stroke', this.checked ? this.appearance.activeStroke : this.appearance.inactiveStroke)
            .attr('stroke-width', this.appearance.strokeWidth)
            .attr('opacity', this.disabled ? this.appearance.disabledOpacity : 1)
        this.knob
            .attr('fill', this.appearance.knobFill)
            .attr('stroke', this.appearance.knobStroke)
            .attr('stroke-width', this.appearance.strokeWidth)
        this.checkmark.selectAll('path').attr('fill', this.appearance.checkmarkColor)
        this.group.style('cursor', this.disabled ? 'not-allowed' : 'pointer')
    }

    private handleClick = (event: MouseEvent): void => {
        if (
            this.disabled
            || !this.config.onChange
            || this.destroyed
        )
            return

        event.stopPropagation()
        this.setChecked(!this.checked)
        this.config.onChange(this.checked, this.config.id)
    }

    render(): void {
        if (this.destroyed)
            return

        this.track
            .transition()
            .duration(TOGGLE_DURATION_MS)
            .ease(easeCubicOut)
            .attr('fill', this.checked ? this.appearance.activeFill : this.appearance.inactiveFill)
            .attr('stroke', this.checked ? this.appearance.activeStroke : this.appearance.inactiveStroke)
            .attr('opacity', this.disabled ? this.appearance.disabledOpacity : 1)
        this.knob.transition()
            .duration(TOGGLE_DURATION_MS)
            .ease(easeCubicOut)
            .attr(
                'cx',
                this.knobX(),
            )
        this.checkmark.transition()
            .duration(TOGGLE_DURATION_MS)
            .ease(easeCubicOut)
            .attr('opacity', this.checked ? 1 : 0)
        this.checkmark.selectAll('path').transition()
            .duration(TOGGLE_DURATION_MS)
            .ease(easeCubicOut)
            .attr(
                'transform',
                this.checkmarkTransform(),
            )
        this.group.style('cursor', this.disabled ? 'not-allowed' : 'pointer')
    }

    setAppearance(appearance: Partial<ToggleSwitchAppearance>): void {
        if (this.destroyed)
            return

        for (const [name, value] of Object.entries(appearance))
            if (value !== undefined)
                Reflect.set(
                    this.appearance,
                    name,
                    value,
                )

        // Track colors update immediately while knob/checkmark motion continues.
        this.track.interrupt()
        this.paintAppearance()
    }

    resize(
        x: number,
        y: number,
        width: number,
        height: number = this.height,
    ): void {
        if (this.destroyed)
            return

        this.x = x
        this.y = y
        this.width = width
        this.height = height
        this.track.interrupt()
        this.knob.interrupt()
        this.checkmark.interrupt()
        this.checkmark.selectAll('path').interrupt()
        this.paintGeometry()
        this.paintAppearance()
    }

    setChecked(checked: boolean): void {
        this.checked = checked
        this.render()
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled
        this.render()
    }

    getChecked(): boolean {
        return this.checked
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.track.interrupt()
        this.knob.interrupt()
        this.checkmark.interrupt()
        this.checkmark.selectAll('path').interrupt()
        this.group.on('click', null).remove()
    }
}

export const createToggleSwitch = (
    parent: any,
    config: ToggleSwitchConfig,
): ToggleSwitchInstance => new ToggleSwitch(parent, config)
