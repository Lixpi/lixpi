import { xIcon } from '$src/svgIcons/index.ts'
import { appendSvgPathIcon } from '$src/components/svgIconPaths.ts'

export type TagPillVariant = 'neutral' | 'explicit' | 'auto'
export type TagPillCloseVisibility = 'always' | 'hover'
export type TagPillLabelAlign = 'start' | 'center'
export type TagPillClosePlacement = 'start' | 'end'

export type TagPillConfig = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    label: string
    selected?: boolean
    hovered?: boolean
    disabled?: boolean
    closable?: boolean
    variant?: TagPillVariant
    surface?: 'pill' | 'content'
    closeVisibility?: TagPillCloseVisibility
    labelAlign?: TagPillLabelAlign
    closePlacement?: TagPillClosePlacement
    className?: string
    closeAriaLabel?: string
    onClick?: (id: string, event: Event) => void
    onClose?: (id: string, event: Event) => void
}

export type TagPillRenderState = Partial<Pick<
    TagPillConfig,
    | 'label'
    | 'selected'
    | 'hovered'
    | 'disabled'
    | 'closable'
    | 'variant'
    | 'closeVisibility'
    | 'labelAlign'
    | 'closePlacement'
    | 'closeAriaLabel'
>> & {
    width?: number
    height?: number
}

export type TagPillInstance = {
    render: (state?: TagPillRenderState) => void
    resize: (x: number, y: number, width: number, height?: number) => void
    setSelected: (selected: boolean) => void
    destroy: () => void
}

const DEFAULT_HEIGHT = 28
const FONT_SIZE = 12
const FONT_WEIGHT = 400
const HORIZONTAL_PADDING = 9
const CLOSE_SIZE = 14
const CLOSE_ICON_SIZE = 7
const CLOSE_GAP = 6
const TEXT_WIDTH_FACTOR = 0.58

const COLORS = {
    neutral: {
        fill: 'rgba(108, 117, 135, 0.08)',
        fillActive: 'rgba(255, 255, 255, 0.78)',
        fillHover: 'rgba(255, 255, 255, 0.78)',
        stroke: 'transparent',
        strokeActive: 'rgba(78, 126, 238, 0.18)',
        text: '#1a2744',
        closeHover: 'rgba(26, 39, 68, 0.1)',
    },
    explicit: {
        fill: 'rgba(130, 178, 192, 0.18)',
        fillActive: 'rgba(130, 178, 192, 0.24)',
        fillHover: 'rgba(130, 178, 192, 0.24)',
        stroke: 'rgba(130, 178, 192, 0.32)',
        strokeActive: 'rgba(130, 178, 192, 0.42)',
        text: '#1a3a47',
        closeHover: 'rgba(26, 58, 71, 0.16)',
    },
    auto: {
        fill: 'rgba(246, 199, 179, 0.22)',
        fillActive: 'rgba(246, 199, 179, 0.3)',
        fillHover: 'rgba(246, 199, 179, 0.3)',
        stroke: 'rgba(212, 149, 106, 0.72)',
        strokeActive: 'rgba(212, 149, 106, 0.82)',
        text: '#5a3a2a',
        closeHover: 'rgba(90, 58, 42, 0.16)',
    },
}

const CONTENT_HOVER_FILL = 'rgba(105, 115, 133, 0.055)'

function truncateLabel(label: string, maxWidth: number): string {
    const maxChars = Math.max(0, Math.floor(maxWidth / (FONT_SIZE * TEXT_WIDTH_FACTOR)))
    if (label.length <= maxChars) return label
    if (maxChars <= 3) return label.slice(0, maxChars)
    return `${label.slice(0, maxChars - 3)}...`
}

class TagPill implements TagPillInstance {
    private x: number
    private y: number
    private width: number
    private height: number
    private label: string
    private selected: boolean
    private hovered: boolean
    private disabled: boolean
    private closable: boolean
    private variant: TagPillVariant
    private surface: 'pill' | 'content'
    private closeVisibility: TagPillCloseVisibility
    private labelAlign: TagPillLabelAlign
    private closePlacement: TagPillClosePlacement
    private closeAriaLabel: string

    private readonly group: any
    private readonly background: any
    private readonly text: any
    private readonly closeGroup: any
    private readonly closeBackground: any
    private readonly closeIcon: any

    constructor(parent: any, private readonly config: TagPillConfig) {
        this.x = config.x
        this.y = config.y
        this.width = config.width
        this.height = config.height ?? DEFAULT_HEIGHT
        this.label = config.label
        this.selected = config.selected ?? false
        this.hovered = config.hovered ?? false
        this.disabled = config.disabled ?? false
        this.closable = config.closable ?? false
        this.variant = config.variant ?? 'neutral'
        this.surface = config.surface ?? 'pill'
        this.closeVisibility = config.closeVisibility ?? 'always'
        this.labelAlign = config.labelAlign ?? 'start'
        this.closePlacement = config.closePlacement ?? 'end'
        this.closeAriaLabel = config.closeAriaLabel ?? `Remove ${config.label}`

        this.group = parent.append('g')
            .attr('class', `tag-pill-group ${config.className ?? ''}`)
            .attr('transform', `translate(${this.x}, ${this.y})`)
            .attr('data-tag-pill-id', config.id)
            .attr('role', config.onClick ? 'button' : null)
            .attr('tabindex', config.onClick ? 0 : null)
            .attr('aria-label', this.label)
            .style('cursor', config.onClick && !this.disabled ? 'pointer' : 'default')

        this.background = this.group.append('rect')
            .attr('class', 'tag-pill-background')

        this.text = this.group.append('text')
            .attr('class', 'tag-pill-label')
            .attr('font-size', FONT_SIZE)
            .attr('font-weight', FONT_WEIGHT)
            .attr('dominant-baseline', 'central')

        this.closeGroup = this.group.append('g')
            .attr('class', 'tag-pill-close')
            .attr('role', 'button')

        this.closeBackground = this.closeGroup.append('circle')
            .attr('class', 'tag-pill-close-background')
            .attr('fill', 'transparent')

        this.closeIcon = this.closeGroup.append('g')
            .attr('class', 'tag-pill-close-icon')

        this.bindEvents()
        this.render()
    }

    private bindEvents(): void {
        this.group
            .on('mouseenter', () => {
                this.hovered = true
                this.render()
            })
            .on('mouseleave', () => {
                this.hovered = false
                this.render()
            })

        if (this.config.onClick) {
            this.group
                .on('click', (event: Event) => this.handleClick(event))
                .on('keydown', (event: KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    this.handleClick(event)
                })
        }

        this.closeGroup
            .on('click', (event: Event) => this.handleClose(event))
            .on('keydown', (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                this.handleClose(event)
            })
            .on('mouseenter', () => this.closeBackground.attr('fill', COLORS[this.variant].closeHover))
            .on('mouseleave', () => this.closeBackground.attr('fill', 'transparent'))
    }

    private handleClick(event: Event): void {
        if (this.disabled) return
        event.preventDefault()
        event.stopPropagation()
        this.config.onClick?.(this.config.id, event)
    }

    private handleClose(event: Event): void {
        if (!this.closable || this.disabled) return
        event.preventDefault()
        event.stopPropagation()
        this.config.onClose?.(this.config.id, event)
    }

    render = (state: TagPillRenderState = {}): void => {
        this.label = state.label ?? this.label
        this.selected = state.selected ?? this.selected
        this.hovered = state.hovered ?? this.hovered
        this.disabled = state.disabled ?? this.disabled
        this.closable = state.closable ?? this.closable
        this.variant = state.variant ?? this.variant
        this.closeVisibility = state.closeVisibility ?? this.closeVisibility
        this.labelAlign = state.labelAlign ?? this.labelAlign
        this.closePlacement = state.closePlacement ?? this.closePlacement
        this.closeAriaLabel = state.closeAriaLabel ?? this.closeAriaLabel
        this.width = state.width ?? this.width
        this.height = state.height ?? this.height

        const palette = COLORS[this.variant]
        const radius = this.height / 2
        const closeVisible = this.closable && !this.disabled && (this.closeVisibility === 'always' || this.hovered)
        const closeDisplay = closeVisible ? null : 'none'
        const closeReserve = this.closable ? CLOSE_SIZE + CLOSE_GAP : 0
        const closeX = this.closePlacement === 'start'
            ? HORIZONTAL_PADDING + CLOSE_SIZE / 2
            : this.width - HORIZONTAL_PADDING - CLOSE_SIZE / 2
        const closeY = this.height / 2
        const textMaxWidth = Math.max(0, this.width - HORIZONTAL_PADDING * 2 - closeReserve)
        const textStartX = HORIZONTAL_PADDING + (this.closePlacement === 'start' ? closeReserve : 0)
        const textX = this.labelAlign === 'center' ? this.width / 2 : textStartX
        const textAnchor = this.labelAlign === 'center' ? 'middle' : 'start'
        const fill = this.surface === 'content'
            ? !this.selected && this.hovered ? CONTENT_HOVER_FILL : 'transparent'
            : this.selected ? palette.fillActive : this.hovered ? palette.fillHover : palette.fill
        const stroke = this.surface === 'content'
            ? 'transparent'
            : this.selected ? palette.strokeActive : palette.stroke
        const opacity = this.disabled ? 0.45 : this.selected || this.hovered ? 1 : 0.7

        this.group
            .attr('transform', `translate(${this.x}, ${this.y})`)
            .attr('aria-label', this.label)
            .attr('aria-disabled', String(this.disabled))
            .style('cursor', this.config.onClick && !this.disabled ? 'pointer' : 'default')

        this.background
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', radius)
            .attr('ry', radius)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', 1)
            .attr('opacity', opacity)

        this.text
            .attr('x', textX)
            .attr('y', this.height / 2)
            .attr('text-anchor', textAnchor)
            .attr('fill', palette.text)
            .attr('opacity', this.disabled ? 0.58 : 1)
            .text(truncateLabel(this.label, textMaxWidth))

        this.closeGroup
            .attr('transform', `translate(${closeX}, ${closeY})`)
            .attr('display', closeDisplay)
            .attr('tabindex', closeVisible ? 0 : null)
            .attr('aria-label', this.closeAriaLabel)
            .attr('aria-hidden', String(!closeVisible))
            .style('cursor', closeVisible ? 'pointer' : 'default')

        this.closeBackground
            .attr('cx', 0)
            .attr('cy', 0)
            .attr('r', CLOSE_SIZE / 2)

        appendSvgPathIcon(this.closeIcon, xIcon, {
            x: -CLOSE_ICON_SIZE / 2,
            y: -CLOSE_ICON_SIZE / 2,
            size: CLOSE_ICON_SIZE,
            fill: palette.text,
        })
    }

    resize(x: number, y: number, width: number, height: number = this.height): void {
        this.x = x
        this.y = y
        this.width = width
        this.height = height
        this.render()
    }

    setSelected(selected: boolean): void {
        this.selected = selected
        this.render()
    }

    destroy(): void {
        this.group.remove()
    }
}

export function createTagPill(parent: any, config: TagPillConfig): TagPillInstance {
    return new TagPill(parent, config)
}
