import { xIcon } from '$src/svgIcons/index.ts'
import { appendSvgPathIcon } from '$src/components/svgIconPaths.ts'

export type TagPillVariant = 'neutral' | 'explicit' | 'auto'
export type TagPillCloseVisibility = 'always' | 'hover'
export type TagPillLabelAlign = 'start' | 'center'
export type TagPillClosePlacement = 'start' | 'end'

export type TagPillSizing = {
    size?: number
    minWidth?: number
    fontSize?: number
    fontWeight?: number
    horizontalPadding?: number
    closeSize?: number
    closeIconSize?: number
    closeGap?: number
    iconSize?: number
    iconGap?: number
    textWidthFactor?: number
}

export type TagPillConfig = TagPillSizing & {
    id: string
    x: number
    y: number
    width?: number
    height?: number
    label: string
    icon?: string
    iconColor?: string
    textColor?: string
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
    | 'icon'
    | 'iconColor'
    | 'textColor'
    | 'selected'
    | 'hovered'
    | 'disabled'
    | 'closable'
    | 'variant'
    | 'closeVisibility'
    | 'labelAlign'
    | 'closePlacement'
    | 'closeAriaLabel'
    | 'size'
    | 'minWidth'
    | 'fontSize'
    | 'fontWeight'
    | 'horizontalPadding'
    | 'closeSize'
    | 'closeIconSize'
    | 'closeGap'
    | 'iconSize'
    | 'iconGap'
    | 'textWidthFactor'
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

const DEFAULT_HEIGHT = 24
const DEFAULT_MIN_WIDTH = 0
const FONT_SIZE = 12
const FONT_WEIGHT = 400
const HORIZONTAL_PADDING = 4
const CLOSE_SIZE = 14
const CLOSE_ICON_SIZE = 7
const CLOSE_GAP = 6
// Icons default to the label cap height (~0.9em) so a glyph never exceeds the
// capital letters next to it.
const ICON_CAP_HEIGHT_RATIO = 0.9
const ICON_GAP = 3
const TEXT_WIDTH_FACTOR = 0.58

const COLORS = {
    neutral: {
        fill: 'rgba(108, 117, 135, 0.08)',
        fillActive: 'rgba(255, 255, 255, 0.72)',
        fillHover: 'rgba(255, 255, 255, 0.72)',
        stroke: 'transparent',
        strokeActive: 'rgba(105, 115, 133, 0.12)',
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

function estimateLabelWidth(label: string, fontSize: number, textWidthFactor: number): number {
    return Math.ceil(label.length * fontSize * textWidthFactor)
}

function getCloseReserve(closable: boolean, closeSize: number, closeGap: number): number {
    return closable ? closeSize + closeGap : 0
}

function estimateTagPillWidthFromLabelWidth(
    labelWidth: number,
    minWidth: number,
    closable: boolean,
    horizontalPadding: number,
    closeSize: number,
    closeGap: number,
    labelAlign: TagPillLabelAlign
): number {
    const closeReserve = getCloseReserve(closable, closeSize, closeGap)
    const reservedCloseWidth = labelAlign === 'center' ? closeReserve * 2 : closeReserve
    return Math.max(minWidth, Math.ceil(labelWidth + horizontalPadding * 2 + reservedCloseWidth))
}

class TagPill implements TagPillInstance {
    private explicitWidth: boolean
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
    private minWidth: number
    private fontSize: number
    private fontWeight: number
    private horizontalPadding: number
    private closeSize: number
    private closeIconSize: number
    private closeGap: number
    private icon: string
    private iconSize: number
    private iconGap: number
    private iconColor: string
    private textColor: string
    private textWidthFactor: number
    private labelWidth: number
    private autoWidthSignature = ''

    private readonly group: any
    private readonly background: any
    private readonly text: any
    private readonly iconGroup: any
    private readonly closeGroup: any
    private readonly closeBackground: any
    private readonly closeIcon: any

    constructor(private readonly parent: any, private readonly config: TagPillConfig) {
        this.x = config.x
        this.y = config.y
        this.height = config.height ?? config.size ?? DEFAULT_HEIGHT
        this.label = config.label
        this.selected = config.selected ?? false
        this.hovered = config.hovered ?? false
        this.disabled = config.disabled ?? false
        this.closable = config.closable ?? false
        this.variant = config.variant ?? 'neutral'
        this.surface = config.surface ?? 'pill'
        this.closeVisibility = config.closeVisibility ?? 'always'
        this.labelAlign = config.labelAlign ?? 'center'
        this.closePlacement = config.closePlacement ?? 'start'
        this.closeAriaLabel = config.closeAriaLabel ?? `Remove ${config.label}`
        this.minWidth = config.minWidth ?? DEFAULT_MIN_WIDTH
        this.fontSize = config.fontSize ?? FONT_SIZE
        this.fontWeight = config.fontWeight ?? FONT_WEIGHT
        this.horizontalPadding = config.horizontalPadding ?? HORIZONTAL_PADDING
        this.closeSize = config.closeSize ?? CLOSE_SIZE
        this.closeIconSize = config.closeIconSize ?? CLOSE_ICON_SIZE
        this.closeGap = config.closeGap ?? CLOSE_GAP
        this.icon = config.icon ?? ''
        this.iconSize = config.iconSize ?? Math.round(this.fontSize * ICON_CAP_HEIGHT_RATIO)
        this.iconGap = config.iconGap ?? ICON_GAP
        this.iconColor = config.iconColor ?? ''
        this.textColor = config.textColor ?? ''
        this.textWidthFactor = config.textWidthFactor ?? TEXT_WIDTH_FACTOR
        this.labelWidth = estimateLabelWidth(this.label, this.fontSize, this.textWidthFactor)
        this.explicitWidth = config.width !== undefined
        this.width = config.width ?? this.estimateCurrentWidth()

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
            .attr('font-size', this.fontSize)
            .attr('font-weight', this.fontWeight)
            .attr('dominant-baseline', 'central')

        this.iconGroup = this.group.append('g')
            .attr('class', 'tag-pill-icon')

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

    private estimateCurrentWidth(labelWidth: number = estimateLabelWidth(this.label, this.fontSize, this.textWidthFactor)): number {
        const iconReserve = this.icon ? this.iconSize + this.iconGap : 0
        return estimateTagPillWidthFromLabelWidth(
            labelWidth + iconReserve,
            this.minWidth,
            this.closable,
            this.horizontalPadding,
            this.closeSize,
            this.closeGap,
            this.labelAlign
        )
    }

    // Measure the actual rendered label so auto-sized pills keep identical padding
    // for every label. The character-count estimate over-reserves space for narrow
    // glyphs (spaces, digits, i/l), and the overshoot grows with label length, which
    // is what leaves longer pills with more whitespace than short ones. Falls back to
    // the estimate when the text node cannot be measured yet (detached or unsupported,
    // e.g. jsdom).
    private measureLabelWidth(): number {
        try {
            const measured = (this.text.node?.() as SVGTextElement | null)?.getComputedTextLength?.()
            if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
                return Math.ceil(measured)
            }
        } catch {
            // getComputedTextLength is unavailable in non-rendering environments (e.g. jsdom);
            // fall through to the character-based estimate.
        }
        return estimateLabelWidth(this.label, this.fontSize, this.textWidthFactor)
    }

    private getAutoWidthSignature(): string {
        return JSON.stringify({
            label: this.label,
            closable: this.closable,
            minWidth: this.minWidth,
            fontSize: this.fontSize,
            fontWeight: this.fontWeight,
            horizontalPadding: this.horizontalPadding,
            closeSize: this.closeSize,
            closeGap: this.closeGap,
            labelAlign: this.labelAlign,
            hasIcon: this.icon.length > 0,
            iconSize: this.iconSize,
            iconGap: this.iconGap,
            textWidthFactor: this.textWidthFactor,
        })
    }

    private updateHostSvgGeometry(): void {
        const node = this.parent.node?.()
        if (node?.tagName?.toLowerCase() !== 'svg') return

        this.parent
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .style('width', `${this.width}px`)
            .style('height', `${this.height}px`)
            .style('min-width', `${this.width}px`)
            .style('overflow', 'visible')
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
        if (state.width !== undefined) {
            this.explicitWidth = true
            this.width = state.width
        }
        this.height = state.height ?? state.size ?? this.height
        this.minWidth = state.minWidth ?? this.minWidth
        this.fontSize = state.fontSize ?? this.fontSize
        this.fontWeight = state.fontWeight ?? this.fontWeight
        this.horizontalPadding = state.horizontalPadding ?? this.horizontalPadding
        this.closeSize = state.closeSize ?? this.closeSize
        this.closeIconSize = state.closeIconSize ?? this.closeIconSize
        this.closeGap = state.closeGap ?? this.closeGap
        this.icon = state.icon ?? this.icon
        this.iconSize = state.iconSize ?? this.iconSize
        this.iconGap = state.iconGap ?? this.iconGap
        this.iconColor = state.iconColor ?? this.iconColor
        this.textColor = state.textColor ?? this.textColor
        this.textWidthFactor = state.textWidthFactor ?? this.textWidthFactor

        const palette = COLORS[this.variant]
        this.text
            .attr('font-size', this.fontSize)
            .attr('font-weight', this.fontWeight)
            .attr('fill', this.textColor || palette.text)
            .attr('opacity', this.disabled ? 0.58 : 1)
            .text(this.label)

        if (!this.explicitWidth) {
            const nextAutoWidthSignature = this.getAutoWidthSignature()
            if (nextAutoWidthSignature !== this.autoWidthSignature) {
                this.labelWidth = this.measureLabelWidth()
                this.width = this.estimateCurrentWidth(this.labelWidth)
                this.autoWidthSignature = nextAutoWidthSignature
            }
        }

        const radius = this.height / 2
        const closeVisible = this.closable && !this.disabled && (this.closeVisibility === 'always' || this.hovered)
        const closeDisplay = closeVisible ? null : 'none'
        const closeReserve = getCloseReserve(this.closable, this.closeSize, this.closeGap)
        const closeX = this.closePlacement === 'start'
            ? this.horizontalPadding + this.closeSize / 2
            : this.width - this.horizontalPadding - this.closeSize / 2
        const closeY = this.height / 2
        const iconReserve = this.icon ? this.iconSize + this.iconGap : 0
        const textStartX = this.horizontalPadding + (this.closePlacement === 'start' ? closeReserve : 0)
        // Center keeps the icon + label centered as one block (icon shifts the label
        // right by half its reserve); start places the icon first, then the label.
        const textX = this.labelAlign === 'center'
            ? this.width / 2 + iconReserve / 2
            : textStartX + iconReserve
        const textAnchor = this.labelAlign === 'center' ? 'middle' : 'start'
        const iconCenterX = this.labelAlign === 'center'
            ? textX - this.labelWidth / 2 - this.iconGap - this.iconSize / 2
            : textStartX + this.iconSize / 2
        const fill = this.surface === 'content'
            ? !this.selected && this.hovered ? CONTENT_HOVER_FILL : 'transparent'
            : this.selected ? palette.fillActive : this.hovered ? palette.fillHover : palette.fill
        const stroke = this.surface === 'content'
            ? 'transparent'
            : this.selected ? palette.strokeActive : palette.stroke
        const opacity = this.disabled ? 0.45 : this.selected || this.hovered ? 1 : 0.7

        this.updateHostSvgGeometry()

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
            .attr('r', this.closeSize / 2)

        appendSvgPathIcon(this.closeIcon, xIcon, {
            x: -this.closeIconSize / 2,
            y: -this.closeIconSize / 2,
            size: this.closeIconSize,
            fill: this.textColor || palette.text,
        })

        if (this.icon) {
            appendSvgPathIcon(this.iconGroup, this.icon, {
                x: iconCenterX - this.iconSize / 2,
                y: this.height / 2 - this.iconSize / 2,
                size: this.iconSize,
                fill: this.iconColor || palette.text,
            })
            this.iconGroup.attr('display', null)
        } else {
            this.iconGroup.selectAll('*').remove()
            this.iconGroup.attr('display', 'none')
        }
    }

    resize(x: number, y: number, width: number, height: number = this.height): void {
        this.x = x
        this.y = y
        this.explicitWidth = true
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
