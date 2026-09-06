// Side-effect import: patches the d3-selection prototype so `.transition()` exists.
import 'd3-transition'

// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { easePupOut } from '@lixpi/ui-primitives/animation'
import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import {
    uiKitSettings,
    type UiKitSlidingDropdownStyles,
} from '../../runtime-settings.ts'
import { appendSvgPathIcon } from '@lixpi/ui-primitives/svg'
import { chevronDownIcon } from '../../svg/svgIcons.ts'
import {
    type SlidingSwitchIndicatorInsetShadow,
    type SlidingSwitchOption,
    type SlidingSwitchOptionRenderInstance,
    type SlidingSwitchOptionRenderer,
    type SlidingSwitchOptionRenderState,
    type SlidingSwitchTransitionConfig,
    type SlidingSwitchVisualOverflowPadding,
} from '../slidingSwitch/slidingSwitch.ts'

export type SlidingDropdownOption<Value extends string = string> = SlidingSwitchOption<Value>
export type SlidingDropdownOptionRenderState<Value extends string = string> = SlidingSwitchOptionRenderState<Value>
export type SlidingDropdownOptionRenderInstance<Value extends string = string> = SlidingSwitchOptionRenderInstance<Value>
export type SlidingDropdownOptionRenderer<Value extends string = string> = SlidingSwitchOptionRenderer<Value>
export type SlidingDropdownIndicatorInsetShadow = SlidingSwitchIndicatorInsetShadow
export type SlidingDropdownVisualOverflowPadding = SlidingSwitchVisualOverflowPadding
export type SlidingDropdownTransitionConfig = SlidingSwitchTransitionConfig & {
    snapDurationMs: number
}

export type SlidingDropdownConfig<Value extends string = string> = {
    id: string
    x: number
    y: number
    width?: number
    height?: number
    optionHorizontalPadding?: number
    options: SlidingDropdownOption<Value>[]
    selectedValue?: Value
    className?: string
    ariaLabel?: string
    observeParentResize?: boolean
    visualOverflowPadding?: Partial<SlidingDropdownVisualOverflowPadding>
    indicatorBoxShadow?: string
    indicatorInsetShadow?: SlidingDropdownIndicatorInsetShadow
    transition?: Partial<SlidingDropdownTransitionConfig>
    renderOption?: SlidingDropdownOptionRenderer<Value>
    onChange?: (
        value: Value,
        id: string,
    ) => void
    onOpenChange?: (
        open: boolean,
        id: string,
    ) => void
}

export type SlidingDropdownInstance<Value extends string = string> = {
    render: () => void
    resize: (
        x: number,
        y: number,
        width: number,
        height?: number,
    ) => void
    setValue: (value: Value) => void
    getValue: () => Value
    setOpen: (open: boolean) => void
    isOpen: () => boolean
    getOuterHeight: () => number
    destroy: () => void
}

type SlidingDropdownOptionView<Value extends string = string> = {
    option: SlidingDropdownOption<Value>
    sourceIndex: number
    group: any
    hit: any
    content: any
    label: any | null
    customRenderer: SlidingDropdownOptionRenderInstance<Value> | null
}

type SlidingDropdownHostStyleSnapshot = {
    position: string
    alignSelf: string
    justifySelf: string
    width: string
    height: string
    minWidth: string
    overflow: string
    zIndex: string
    boxSizing: string
}

type SlidingDropdownSvgStyleSnapshot = {
    display: string
    position: string
    top: string
    left: string
    width: string
    height: string
    minWidth: string
    maxWidth: string
    overflow: string
    pointerEvents: string
    zIndex: string
}

type SlidingDropdownSvgAttributeSnapshot = {
    width: string | null
    height: string | null
    viewBox: string | null
    preserveAspectRatio: string | null
    open: string | null
}

const PADDING = 2
const DEFAULT_OPEN_TRANSITION_DURATION_MS = 200
const DEFAULT_CLOSE_TRANSITION_DURATION_MS = 70
const DEFAULT_SNAP_TRANSITION_DURATION_MS = 50
const DEFAULT_DISTANCE_SPEEDUP_FACTOR = 0.28
const CLICK_TRANSITION_DURATION_MULTIPLIER = 2
const DEFAULT_WIDTH = 156
const DEFAULT_HEIGHT = 66
const DEFAULT_OPTION_HORIZONTAL_PADDING = 12
const FALLBACK_CHARACTER_WIDTH_RATIO = 0.6
const CHEVRON_GAP = 2
const CHEVRON_SIZE = 18
const OPEN_Z_INDEX = 10110
const POINTER_DRAG_THRESHOLD_PX = 6
const SHADOW_PADDING_TOP = 10
const SHADOW_PADDING_RIGHT = 14
const SHADOW_PADDING_BOTTOM = 0
const SHADOW_PADDING_LEFT = 14
let slidingDropdownInstanceCounter = 0

class SlidingDropdown<Value extends string = string> implements SlidingDropdownInstance<Value> {
    private readonly id: string
    private readonly options: SlidingDropdownOption<Value>[]
    private readonly className: string
    private readonly ariaLabel: string
    private readonly observeParentResize: boolean
    private readonly optionHorizontalPadding: number
    private readonly visualOverflowPadding: SlidingDropdownVisualOverflowPadding
    private readonly styles: UiKitSlidingDropdownStyles
    private readonly indicatorBoxShadow: string
    private readonly indicatorInsetShadow: SlidingDropdownIndicatorInsetShadow | null
    private readonly indicatorInsetGradientId: string
    private readonly openShadowFilterId: string
    private readonly transitionConfig: SlidingDropdownTransitionConfig
    private readonly renderOption?: SlidingDropdownOptionRenderer<Value>
    private readonly onChange?: (
        value: Value,
        id: string,
    ) => void
    private readonly onOpenChange?: (
        open: boolean,
        id: string,
    ) => void

    private x: number
    private y: number
    private requestedWidth: number
    private availableWidth = Number.POSITIVE_INFINITY
    private width: number
    private height: number
    private currentValue: Value
    private hoveredValue: Value | null = null
    private pendingValue: Value | null = null
    private tapeOffset: number
    private openViewportTop = 0
    private openViewportHeight: number
    private tapePointerId: number | null = null
    private tapePointerCaptured = false
    private tapePointerStartY = 0
    private tapePointerStartOffset = 0
    private suppressClickUntil = 0
    private open = false
    private animating = false
    private destroyed = false

    private readonly parent: any
    private readonly svgNode: SVGSVGElement | null
    private readonly svgParentNode: Node | null
    private readonly svgNextSibling: ChildNode | null
    private readonly hostNode: HTMLElement | null
    private readonly hostSelection: any | null
    private readonly hostStyleSnapshot: SlidingDropdownHostStyleSnapshot | null
    private readonly svgStyleSnapshot: SlidingDropdownSvgStyleSnapshot | null
    private readonly svgAttributeSnapshot: SlidingDropdownSvgAttributeSnapshot | null
    private readonly group: any
    private readonly indicatorInsetGradient: any
    private readonly viewportClipId: string
    private readonly viewportClip: any
    private readonly viewportHit: any
    private readonly openShadow: any
    private readonly track: any
    private readonly indicator: any
    private readonly indicatorInset: any
    private readonly optionsGroup: any
    private readonly chevronControl: any
    private readonly chevronIcon: any
    private readonly optionViews: SlidingDropdownOptionView<Value>[] = []
    private readonly optionContentRightEdges = new Map<Value, number>()
    private chevronRotationDegrees = 0
    private resizeObserver: ResizeObserver | null = null
    private readonly observedResizeTargets: Set<Element> = new Set()
    private resizeAnimationFrame: number | null = null
    private animationTimer: ReturnType<typeof setTimeout> | null = null
    private tapeSnapAnimationTimer: ReturnType<typeof setTimeout> | null = null
    private scrollPortalNode: HTMLDivElement | null = null
    private scrollPortalSpacerNode: HTMLDivElement | null = null
    private chevronPortalSvg: any | null = null
    private portalScaleX = 1
    private portalScaleY = 1
    private scrollScaleY = 1
    private scrollMaximumTop = 0
    private syncingScrollPosition = false
    private tapeSnapAnimating = false
    private portaled = false

    constructor(
        parent: any,
        config: SlidingDropdownConfig<Value>,
    ) {
        if (config.options.length === 0)
            throw new Error('Sliding dropdown requires at least one option')

        this.parent = parent
        this.id = config.id
        this.options = config.options
        this.className = config.className ?? ''
        this.ariaLabel = config.ariaLabel ?? config.id
        this.observeParentResize = config.observeParentResize ?? true
        this.optionHorizontalPadding = Math.max(0, config.optionHorizontalPadding ?? DEFAULT_OPTION_HORIZONTAL_PADDING)
        this.styles = uiKitSettings.slidingDropdown.styles
        this.indicatorBoxShadow = config.indicatorBoxShadow ?? this.styles.indicator.boxShadow
        this.indicatorInsetShadow = config.indicatorInsetShadow ?? this.styles.indicator.insetShadow
        this.transitionConfig = this.createTransitionConfig(config.transition)
        this.visualOverflowPadding = this.createVisualOverflowPadding(config.visualOverflowPadding)
        this.renderOption = config.renderOption
        this.onChange = config.onChange
        this.onOpenChange = config.onOpenChange
        this.x = config.x
        this.y = config.y
        this.requestedWidth = config.width ?? DEFAULT_WIDTH
        this.width = this.requestedWidth
        this.height = config.height ?? DEFAULT_HEIGHT
        this.currentValue = config.selectedValue !== undefined
            && this.indexOf(config.selectedValue) >= 0
            ? config.selectedValue
            : this.options[0]!.value
        this.tapeOffset = this.optionsOffset(
            this.selectedIndex(),
        )
        this.openViewportHeight = this.height

        const parentNode = parent.node?.()
        this.svgNode = parentNode?.tagName?.toLowerCase() === 'svg'
            ? parentNode as SVGSVGElement
            : null
        this.svgParentNode = this.svgNode?.parentNode ?? null
        this.svgNextSibling = this.svgNode?.nextSibling ?? null
        this.hostNode = this.svgNode?.parentElement ?? null
        this.hostSelection = this.hostNode ? select(this.hostNode) : null
        this.hostStyleSnapshot = this.captureHostStyleSnapshot()
        this.svgStyleSnapshot = this.captureSvgStyleSnapshot()
        this.svgAttributeSnapshot = this.captureSvgAttributeSnapshot()

        slidingDropdownInstanceCounter += 1
        this.indicatorInsetGradientId = `${this.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${slidingDropdownInstanceCounter}-indicator-inset`
        this.openShadowFilterId = `${this.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${slidingDropdownInstanceCounter}-open-shadow`
        this.viewportClipId = `${this.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${slidingDropdownInstanceCounter}-viewport-clip`

        this.group = parent
            .append('g')
            .attr('class', `sliding-dropdown-group ${this.className}`)
            .attr('data-sliding-dropdown-id', this.id)
            .attr('role', 'combobox')
            .attr('aria-haspopup', 'listbox')
            .attr('aria-label', this.ariaLabel)
            .style('touch-action', 'manipulation')

        const defs = this.group.append('defs')
        this.indicatorInsetGradient = defs
            .append('linearGradient')
            .attr('id', this.indicatorInsetGradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%')

        const openShadowFilter = defs
            .append('filter')
            .attr('id', this.openShadowFilterId)
            .attr('class', 'sliding-dropdown-open-shadow-filter')
            .attr('x', '-50%')
            .attr('y', '-50%')
            .attr('width', '200%')
            .attr('height', '200%')
            .attr('color-interpolation-filters', 'sRGB')
        openShadowFilter
            .append('feMorphology')
            .attr('in', 'SourceAlpha')
            .attr('operator', 'dilate')
            .attr('radius', this.styles.openShadow.spreadRadius)
            .attr('result', 'spread')
        openShadowFilter
            .append('feGaussianBlur')
            .attr('in', 'spread')
            .attr('stdDeviation', this.styles.openShadow.blurRadius / 2)
            .attr('result', 'blur')
        openShadowFilter
            .append('feOffset')
            .attr('in', 'blur')
            .attr('dx', this.styles.openShadow.offsetX)
            .attr('dy', this.styles.openShadow.offsetY)
            .attr('result', 'offset')
        openShadowFilter
            .append('feFlood')
            .attr('flood-color', this.styles.openShadow.color)
            .attr('flood-opacity', this.styles.openShadow.opacity)
            .attr('result', 'color')
        openShadowFilter
            .append('feComposite')
            .attr('in', 'color')
            .attr('in2', 'offset')
            .attr('operator', 'in')
            .attr('result', 'shadow')
        openShadowFilter.append('feMerge')
            .append('feMergeNode')
            .attr('in', 'shadow')

        this.viewportClip = defs
            .append('clipPath')
            .attr('id', this.viewportClipId)
            .attr('clipPathUnits', 'userSpaceOnUse')
            .append('rect')

        this.viewportHit = this.group
            .append('rect')
            .attr('class', 'sliding-dropdown-viewport-hit')
            .attr('fill', 'transparent')

        this.openShadow = this.group
            .append('rect')
            .attr('class', 'sliding-dropdown-open-shadow')
            .attr('pointer-events', 'none')

        const trackViewport = this.group.append('g')
            .attr('clip-path', `url(#${this.viewportClipId})`)
        this.track = trackViewport.append('rect')
            .attr('class', 'sliding-dropdown-track')

        this.indicator = this.group.append('rect')
            .attr('class', 'sliding-dropdown-indicator')

        this.indicatorInset = this.group
            .append('rect')
            .attr('class', 'sliding-dropdown-indicator-inset-shadow')
            .attr('pointer-events', 'none')

        const optionsViewport = this.group.append('g')
            .attr('clip-path', `url(#${this.viewportClipId})`)
        this.optionsGroup = optionsViewport
            .append('g')
            .attr('class', 'sliding-dropdown-options')
            .attr('role', 'listbox')

        this.chevronControl = this.group
            .append('g')
            .attr('class', 'sliding-dropdown-chevron-control')
            .attr('aria-hidden', 'true')
            .style('cursor', 'pointer')
            .on('pointerdown', (event: PointerEvent) => event.stopPropagation())
            .on('click', this.handleChevronClick)
        this.chevronControl
            .append('rect')
            .attr('class', 'sliding-dropdown-chevron-hit')
            .attr('x', -CHEVRON_SIZE / 2)
            .attr('y', -CHEVRON_SIZE / 2)
            .attr('width', CHEVRON_SIZE)
            .attr('height', CHEVRON_SIZE)
            .attr('fill', 'transparent')
            .attr('pointer-events', 'all')
        this.chevronIcon = this.chevronControl
            .append('g')
            .attr('class', 'sliding-dropdown-chevron-icon')
            .attr('pointer-events', 'none')
        appendSvgPathIcon(
            this.chevronIcon,
            chevronDownIcon,
            {
                x: -CHEVRON_SIZE / 2,
                y: -CHEVRON_SIZE / 2,
                size: CHEVRON_SIZE,
                fill: this.styles.option.activeTextColor,
            },
        )

        this.group
            .on('wheel', this.handleWheel)
            .on('pointerdown', this.handleTapePointerDown)
            .on('pointermove', this.handleTapePointerMove)
            .on('pointerup', this.handleTapePointerEnd)
            .on('pointercancel', this.handleTapePointerEnd)

        for (const [sourceIndex, option] of this.options.entries()) {
            this.optionViews.push(
                this.createOptionView(option, sourceIndex),
            )
        }

        this.renderOptionViews()
        this.measureOptionContentRightEdges()

        this.bindResizeObserver()
        this.renderInternal()
        this.measureOptionContentRightEdges()
        this.renderInternal()
    }

    private captureHostStyleSnapshot(): SlidingDropdownHostStyleSnapshot | null {
        if (!this.hostNode)
            return null

        return {
            position: this.hostNode.style.position,
            alignSelf: this.hostNode.style.alignSelf,
            justifySelf: this.hostNode.style.justifySelf,
            width: this.hostNode.style.width,
            height: this.hostNode.style.height,
            minWidth: this.hostNode.style.minWidth,
            overflow: this.hostNode.style.overflow,
            zIndex: this.hostNode.style.zIndex,
            boxSizing: this.hostNode.style.boxSizing,
        }
    }

    private captureSvgStyleSnapshot(): SlidingDropdownSvgStyleSnapshot | null {
        if (!this.svgNode)
            return null

        return {
            display: this.svgNode.style.display,
            position: this.svgNode.style.position,
            top: this.svgNode.style.top,
            left: this.svgNode.style.left,
            width: this.svgNode.style.width,
            height: this.svgNode.style.height,
            minWidth: this.svgNode.style.minWidth,
            maxWidth: this.svgNode.style.maxWidth,
            overflow: this.svgNode.style.overflow,
            pointerEvents: this.svgNode.style.pointerEvents,
            zIndex: this.svgNode.style.zIndex,
        }
    }

    private captureSvgAttributeSnapshot(): SlidingDropdownSvgAttributeSnapshot | null {
        if (!this.svgNode)
            return null

        return {
            width: this.parent.attr('width'),
            height: this.parent.attr('height'),
            viewBox: this.parent.attr('viewBox'),
            preserveAspectRatio: this.parent.attr('preserveAspectRatio'),
            open: this.parent.attr('data-sliding-dropdown-open'),
        }
    }

    private restoreOwnedLayout(): void {
        if (
            this.hostSelection
            && this.hostStyleSnapshot
        ) {
            this.hostSelection
                .style('position', this.hostStyleSnapshot.position || null)
                .style('align-self', this.hostStyleSnapshot.alignSelf || null)
                .style('justify-self', this.hostStyleSnapshot.justifySelf || null)
                .style('width', this.hostStyleSnapshot.width || null)
                .style('height', this.hostStyleSnapshot.height || null)
                .style('min-width', this.hostStyleSnapshot.minWidth || null)
                .style('overflow', this.hostStyleSnapshot.overflow || null)
                .style('z-index', this.hostStyleSnapshot.zIndex || null)
                .style('box-sizing', this.hostStyleSnapshot.boxSizing || null)
        }

        if (this.svgStyleSnapshot) {
            this.parent
                .style('display', this.svgStyleSnapshot.display || null)
                .style('position', this.svgStyleSnapshot.position || null)
                .style('top', this.svgStyleSnapshot.top || null)
                .style('left', this.svgStyleSnapshot.left || null)
                .style('width', this.svgStyleSnapshot.width || null)
                .style('height', this.svgStyleSnapshot.height || null)
                .style('min-width', this.svgStyleSnapshot.minWidth || null)
                .style('max-width', this.svgStyleSnapshot.maxWidth || null)
                .style('overflow', this.svgStyleSnapshot.overflow || null)
                .style('pointer-events', this.svgStyleSnapshot.pointerEvents || null)
                .style('z-index', this.svgStyleSnapshot.zIndex || null)
        }

        if (this.svgAttributeSnapshot) {
            this.parent
                .attr('width', this.svgAttributeSnapshot.width)
                .attr('height', this.svgAttributeSnapshot.height)
                .attr('viewBox', this.svgAttributeSnapshot.viewBox)
                .attr('preserveAspectRatio', this.svgAttributeSnapshot.preserveAspectRatio)
                .attr('data-sliding-dropdown-open', this.svgAttributeSnapshot.open)
        }
    }

    private createTransitionConfig(config: Partial<SlidingDropdownTransitionConfig> | undefined): SlidingDropdownTransitionConfig {
        return {
            durationMs: Math.max(0, config?.durationMs ?? DEFAULT_OPEN_TRANSITION_DURATION_MS),
            minDurationMs: Math.max(0, config?.minDurationMs ?? DEFAULT_CLOSE_TRANSITION_DURATION_MS),
            snapDurationMs: Math.max(0, config?.snapDurationMs ?? DEFAULT_SNAP_TRANSITION_DURATION_MS),
            distanceSpeedupFactor: Math.max(0, config?.distanceSpeedupFactor ?? DEFAULT_DISTANCE_SPEEDUP_FACTOR),
        }
    }

    private createVisualOverflowPadding(padding: Partial<SlidingDropdownVisualOverflowPadding> | undefined): SlidingDropdownVisualOverflowPadding {
        const hasOuterShadow = this.indicatorBoxShadow !== 'none'

        return {
            top: padding?.top ?? (hasOuterShadow ? SHADOW_PADDING_TOP : 0),
            right: padding?.right ?? (hasOuterShadow ? SHADOW_PADDING_RIGHT : 0),
            bottom: padding?.bottom ?? (hasOuterShadow ? SHADOW_PADDING_BOTTOM : 0),
            left: padding?.left ?? (hasOuterShadow ? SHADOW_PADDING_LEFT : 0),
        }
    }

    private transitionDuration(
        fromIndex: number,
        toIndex: number,
    ): number {
        const travelDistance = Math.max(
            1,
            Math.abs(toIndex - fromIndex),
        )
        const speedup = 1 + (travelDistance - 1) * this.transitionConfig.distanceSpeedupFactor

        return Math.max(
            this.transitionConfig.minDurationMs,
            Math.round(this.transitionConfig.durationMs / speedup),
        )
    }

    private clearAnimationTimer(): void {
        if (this.animationTimer === null)
            return

        clearTimeout(this.animationTimer)
        this.animationTimer = null
    }

    private interruptTapeSnapAnimation(): void {
        if (this.tapeSnapAnimationTimer !== null) {
            clearTimeout(this.tapeSnapAnimationTimer)
            this.tapeSnapAnimationTimer = null
        }

        if (this.scrollPortalNode)
            select(this.scrollPortalNode).interrupt()

        this.tapeSnapAnimating = false
    }

    private releaseTapePointer(): void {
        if (
            this.tapePointerId !== null
            && this.tapePointerCaptured
        ) {
            const pointerId = this.tapePointerId
            const node = this.group.node() as Element & {
                hasPointerCapture?: (candidatePointerId: number) => boolean
                releasePointerCapture?: (candidatePointerId: number) => void
            }

            if (node.hasPointerCapture?.(pointerId))
                node.releasePointerCapture?.(pointerId)
        }

        this.tapePointerId = null
        this.tapePointerCaptured = false
    }

    private interruptTransitions(): void {
        this.parent.interrupt()
        this.group.interrupt()
        this.viewportClip.interrupt()
        this.viewportHit.interrupt()
        this.track.interrupt()
        this.indicator.interrupt()
        this.indicatorInset.interrupt()
        this.optionsGroup.interrupt()
        this.openShadow.interrupt()
        this.chevronIcon.interrupt()
    }

    private setTapePosition(offset: number): void {
        this.track.attr('y', offset)
        this.optionsGroup.attr('transform', `translate(0, ${offset})`)
    }

    private animateTapePosition(
        offset: number,
        duration: number,
        fill?: string,
    ): void {
        const trackTransition = this.track
            .interrupt()
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .attr('y', offset)

        if (fill !== undefined)
            trackTransition.attr('fill', fill)

        this.optionsGroup
            .interrupt()
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .attr('transform', `translate(0, ${offset})`)
    }

    private hasOpenShadow(): boolean {
        return this.styles.openShadow.opacity > 0
    }

    private openShadowOverflowPadding(): number {
        if (!this.hasOpenShadow())
            return 0

        const blurOverflow = this.styles.openShadow.blurRadius * 1.5
        const offsetOverflow = Math.max(
            Math.abs(this.styles.openShadow.offsetX),
            Math.abs(this.styles.openShadow.offsetY),
        )

        return Math.ceil(this.styles.openShadow.spreadRadius + blurOverflow + offsetOverflow)
    }

    private surfaceOuterWidth(): number {
        return this.width + this.visualOverflowPadding.left + this.visualOverflowPadding.right
    }

    private maximumIndicatorBorderWidth(): number {
        return Math.max(this.styles.indicator.closedBorderWidth, this.styles.indicator.openBorderWidth)
    }

    private chevronOuterWidth(): number {
        return Math.max(
            CHEVRON_GAP + CHEVRON_SIZE,
            -PADDING
                + this.maximumIndicatorBorderWidth() / 2
                + CHEVRON_GAP
                + CHEVRON_SIZE,
        )
    }

    private outerWidth(): number {
        return this.surfaceOuterWidth() + this.chevronOuterWidth()
    }

    private outerHeight(contentHeight: number): number {
        return contentHeight + this.visualOverflowPadding.top + this.visualOverflowPadding.bottom
    }

    private closedOuterHeight(): number {
        return this.outerHeight(this.height)
    }

    private updateOwnedHostLayout(): void {
        const outerWidth = this.outerWidth()
        this.hostSelection
            ?.style('position', 'relative')
            .style('align-self', 'flex-start')
            .style('justify-self', 'start')
            .style('height', `${this.closedOuterHeight()}px`)
            .style('min-width', '0')
            .style('overflow', 'visible')
            .style('z-index', this.hostStyleSnapshot?.zIndex || null)
            .style('box-sizing', 'border-box')

        if (!this.portaled)
            this.hostSelection?.style('width', `${outerWidth}px`)
    }

    private portalSvg(): void {
        if (
            this.portaled
            || !this.svgNode
            || typeof document === 'undefined'
        )
            return

        const hostRect = this.hostNode?.getBoundingClientRect()
        this.portalScaleX = hostRect
            && hostRect.width > 0
            ? hostRect.width / this.outerWidth()
            : 1
        this.portalScaleY = hostRect
            && hostRect.height > 0
            ? hostRect.height / this.closedOuterHeight()
            : 1

        const portalStyle = {
            position: 'fixed',
            overflowX: 'hidden',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            pointerEvents: 'auto',
            scrollbarWidth: 'none',
            zIndex: String(OPEN_Z_INDEX),
        }
        const spacerStyle = {
            width: '1px',
            pointerEvents: 'none',
        }
        this.scrollPortalSpacerNode = html`<div
                className="sliding-dropdown-scroll-spacer"
                style=${spacerStyle}
            ></div>` as HTMLDivElement
        this.scrollPortalNode = html`
            <div
                className="sliding-dropdown-scroll-portal"
                data=${{ slidingDropdownScrollPortal: 'true' }}
                style=${portalStyle}
            >
                ${this.scrollPortalSpacerNode}
            </div>
        ` as HTMLDivElement
        this.scrollPortalNode.addEventListener('scroll', this.handleScrollPortalScroll)
        this.scrollPortalNode.addEventListener('scrollend', this.handleScrollPortalEnd)
        document.body.append(this.scrollPortalNode)
        this.scrollPortalNode.append(this.svgNode)
        this.portaled = true
        this.portalChevron()
        this.updateScrollPortalGeometry()
        this.syncScrollPortalToTape()
    }

    private portalChevron(): void {
        if (
            this.chevronPortalSvg
            || typeof document === 'undefined'
        )
            return

        const chevronControlNode = this.chevronControl.node?.()

        if (!chevronControlNode)
            return

        this.chevronPortalSvg = select(document.body)
            .append('svg')
            .attr('class', 'sliding-dropdown-chevron-portal')
            .attr('data-sliding-dropdown-open', 'true')
            .attr('aria-hidden', 'true')
            .attr('viewBox', `0 0 ${CHEVRON_SIZE} ${CHEVRON_SIZE}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
        const portalNode = this.chevronPortalSvg.node() as SVGSVGElement
        applyStyle(
            portalNode,
            {
                position: 'fixed',
                overflow: 'visible',
                pointerEvents: 'auto',
                zIndex: String(OPEN_Z_INDEX),
            },
        )
        portalNode.append(chevronControlNode)
        this.updateChevronPortalGeometry()
    }

    private updateChevronPortalGeometry(): void {
        if (!this.chevronPortalSvg)
            return

        const hostRect = this.hostNode?.getBoundingClientRect()

        if (
            !hostRect
            || hostRect.width <= 0
            || hostRect.height <= 0
        )
            return

        const scaleX = this.portalScaleX
        const scaleY = this.portalScaleY
        const centerX = hostRect.left + (
                    this.x
                    + this.visualOverflowPadding.left
                    + this.chevronCenterX()
                ) * scaleX
        const centerY = hostRect.top + (this.y + this.height / 2) * scaleY
        const portalWidth = CHEVRON_SIZE * scaleX
        const portalHeight = CHEVRON_SIZE * scaleY
        const portalNode = this.chevronPortalSvg.node() as SVGSVGElement
        applyStyle(
            portalNode,
            {
                left: `${centerX - portalWidth / 2}px`,
                top: `${centerY - portalHeight / 2}px`,
                width: `${portalWidth}px`,
                height: `${portalHeight}px`,
            },
        )
        this.chevronPortalSvg
            .attr('width', portalWidth)
            .attr('height', portalHeight)
        this.chevronControl.attr('transform', `translate(${CHEVRON_SIZE / 2}, ${CHEVRON_SIZE / 2})`)
    }

    private restoreChevronPortal(): void {
        if (!this.chevronPortalSvg)
            return

        const groupNode = this.group.node?.()
        const chevronControlNode = this.chevronControl.node?.()

        if (
            groupNode
            && chevronControlNode
        )
            groupNode.append(chevronControlNode)

        this.chevronPortalSvg.remove()
        this.chevronPortalSvg = null
    }

    private restoreSvgPortal(): void {
        if (
            !this.portaled
            || !this.svgNode
            || !this.svgParentNode
        )
            return

        this.interruptTapeSnapAnimation()
        this.scrollPortalNode?.removeEventListener('scroll', this.handleScrollPortalScroll)
        this.scrollPortalNode?.removeEventListener('scrollend', this.handleScrollPortalEnd)
        const nextSibling = this.svgNextSibling?.parentNode === this.svgParentNode
            ? this.svgNextSibling
            : null
        this.restoreChevronPortal()
        this.svgParentNode.insertBefore(this.svgNode, nextSibling)
        this.scrollPortalNode?.remove()
        this.scrollPortalNode = null
        this.scrollPortalSpacerNode = null
        this.portalScaleX = 1
        this.portalScaleY = 1
        this.scrollScaleY = 1
        this.scrollMaximumTop = 0
        this.portaled = false
    }

    private updateScrollPortalGeometry(): void {
        if (
            !this.scrollPortalNode
            || !this.scrollPortalSpacerNode
        )
            return

        const hostRect = this.hostNode?.getBoundingClientRect()

        if (
            !hostRect
            || hostRect.width <= 0
            || hostRect.height <= 0
        )
            return

        const scaleX = this.portalScaleX
        const scaleY = this.portalScaleY
        const maximumScrollTop = (this.options.length - 1) * this.height * scaleY
        const fullTapeHeight = this.outerHeight(this.options.length * this.height) * scaleY
        const shadowPadding = this.openShadowOverflowPadding()
        const shadowPaddingX = shadowPadding * scaleX
        const shadowPaddingY = shadowPadding * scaleY
        const portalHeight = fullTapeHeight + maximumScrollTop + shadowPaddingY * 2
        this.scrollScaleY = scaleY
        this.scrollMaximumTop = maximumScrollTop
        applyStyle(
            this.scrollPortalNode,
            {
                top: `${hostRect.top - this.visualOverflowPadding.top * scaleY - maximumScrollTop - shadowPaddingY}px`,
                left: `${hostRect.left - shadowPaddingX}px`,
                width: `${this.outerWidth() * scaleX + shadowPaddingX * 2}px`,
                height: `${portalHeight}px`,
            },
        )
        applyStyle(
            this.scrollPortalSpacerNode,
            {
                height: `${portalHeight + maximumScrollTop}px`,
            },
        )
    }

    private syncScrollPortalToTape(): void {
        if (!this.scrollPortalNode)
            return

        const targetScrollTop = -this.tapeOffset * this.scrollScaleY

        if (Math.abs(this.scrollPortalNode.scrollTop - targetScrollTop) < 0.5)
            return

        this.syncingScrollPosition = true
        this.scrollPortalNode.scrollTop = targetScrollTop
        this.syncingScrollPosition = false
    }

    private updateHostSvgGeometry(
        contentHeight: number,
        top: number,
    ): void {
        if (!this.svgNode)
            return

        const outerWidth = this.outerWidth()
        const outerHeight = this.outerHeight(contentHeight)
        const topOffset = top - this.visualOverflowPadding.top
        const overlayOpen = this.open || this.animating
        this.updateOwnedHostLayout()
        const scaleX = this.portaled ? this.portalScaleX : 1
        const scaleY = this.portaled ? this.portalScaleY : 1
        const shadowPadding = this.openShadowOverflowPadding()
        const shadowPaddingX = this.portaled
            ? shadowPadding * scaleX
            : 0
        const shadowPaddingY = this.portaled
            ? shadowPadding * scaleY
            : 0
        const position = 'absolute'
        const left = shadowPaddingX
        const positionedTop = this.portaled
            && this.scrollPortalNode
            ? top * scaleY + this.scrollMaximumTop + this.scrollPortalNode.scrollTop + shadowPaddingY
            : topOffset
        const screenWidth = outerWidth * scaleX
        const screenHeight = outerHeight * scaleY
        this.parent
            .interrupt()
            .attr(
                'data-sliding-dropdown-open',
                String(overlayOpen),
            )
            .style('display', 'block')
            .style('position', position)
            .style('left', `${left}px`)
            .style('top', `${positionedTop}px`)
            .style('width', `${screenWidth}px`)
            .style('height', `${screenHeight}px`)
            .style('min-width', `${screenWidth}px`)
            .style('max-width', this.portaled ? 'none' : '100%')
            .style('overflow', 'visible')
            .style('pointer-events', this.portaled ? 'auto' : this.svgStyleSnapshot?.pointerEvents || null)
            .style('z-index', overlayOpen ? String(OPEN_Z_INDEX) : this.svgStyleSnapshot?.zIndex || null)
            .attr('width', screenWidth)
            .attr('height', screenHeight)
            .attr('viewBox', `0 0 ${this.surfaceOuterWidth()} ${outerHeight}`)
            .attr('preserveAspectRatio', 'xMinYMin meet')
    }

    private bindResizeObserver(): void {
        if (
            !this.observeParentResize
            || typeof ResizeObserver === 'undefined'
        )
            return

        this.resizeObserver = new ResizeObserver(() => this.scheduleObservedResize())
        this.updateResizeObserverTargets()
        this.scheduleObservedResize()
    }

    private getResizeMeasureElement(): Element | null {
        return this.hostNode?.parentElement ?? this.hostNode
    }

    private getResizeObserverTargets(): Element[] {
        const targets: Element[] = []
        let target = this.getResizeMeasureElement()

        while (
            target
            && targets.length < 3
        ) {
            targets.push(target)
            target = target.parentElement
        }

        return targets
    }

    private updateResizeObserverTargets(): void {
        if (!this.resizeObserver)
            return

        const nextTargets = new Set(
            this.getResizeObserverTargets(),
        )

        for (const target of this.observedResizeTargets) {
            if (nextTargets.has(target))
                continue

            this.resizeObserver.unobserve(target)
            this.observedResizeTargets.delete(target)
        }

        for (const target of nextTargets) {
            if (this.observedResizeTargets.has(target))
                continue

            this.resizeObserver.observe(target)
            this.observedResizeTargets.add(target)
        }
    }

    private scheduleObservedResize(): void {
        if (this.destroyed)
            return

        if (typeof requestAnimationFrame === 'undefined') {
            this.resizeToObservedWidth()

            return
        }

        if (this.resizeAnimationFrame !== null)
            return

        this.resizeAnimationFrame = requestAnimationFrame(() => {
            this.resizeAnimationFrame = null
            this.resizeToObservedWidth()
        })
    }

    private resizeToObservedWidth(): void {
        if (this.destroyed)
            return

        this.updateResizeObserverTargets()
        const measureElement = this.getResizeMeasureElement()
        const clientWidth = measureElement
            && 'clientWidth' in measureElement
            ? Number(measureElement.clientWidth)
            : 0
        const containerWidth = clientWidth > 0
            ? clientWidth
            : measureElement?.getBoundingClientRect().width ?? 0

        if (
            !Number.isFinite(containerWidth)
            || containerWidth <= 0
        )
            return

        const horizontalPadding = this.visualOverflowPadding.left + this.visualOverflowPadding.right
        const chevronWidth = this.chevronOuterWidth()
        const nextAvailableWidth = Math.max(1, containerWidth - horizontalPadding - chevronWidth)

        if (Math.abs(nextAvailableWidth - this.availableWidth) < 0.5)
            return

        this.availableWidth = nextAvailableWidth

        if (!this.animating) {
            this.measureOptionContentRightEdges()
            this.renderInternal()
        }
    }

    private indexOf(value: Value): number {
        return this.options.findIndex(option => option.value === value)
    }

    private createOptionState(
        option: SlidingDropdownOption<Value>,
        sourceIndex: number,
    ): SlidingDropdownOptionRenderState<Value> {
        const selectedValue = this.pendingValue ?? this.currentValue
        const selected = option.value === selectedValue
        const hovered = this.hoveredValue === option.value
        const disabled = option.disabled ?? false
        const color = disabled
            ? this.styles.option.disabledTextColor
            : selected
                || hovered
                ? this.styles.option.activeTextColor
                : this.styles.option.textColor

        return {
            id: `${this.id}:${option.value}`,
            option,
            index: sourceIndex,
            x: PADDING,
            y: sourceIndex * this.height + PADDING,
            width: this.width - PADDING * 2,
            height: this.height - PADDING * 2,
            selected,
            hovered,
            disabled,
            closable: false,
            color,
            onClose: () => undefined,
        }
    }

    private createOptionView(
        option: SlidingDropdownOption<Value>,
        sourceIndex: number,
    ): SlidingDropdownOptionView<Value> {
        const group = this.optionsGroup
            .append('g')
            .attr('class', 'sliding-dropdown-option-group')
            .attr('data-value', option.value)

        const hit = group
            .append('rect')
            .attr('class', 'sliding-dropdown-hit')
            .attr('fill', 'transparent')
            .attr('pointer-events', 'all')
        const content = group
            .append('g')
            .attr('class', 'sliding-dropdown-option-content')
            .attr('pointer-events', 'none')

        const state = this.createOptionState(option, sourceIndex)
        const customRenderer = this.renderOption?.(content, state) ?? null
        const view: SlidingDropdownOptionView<Value> = {
            option,
            sourceIndex,
            group,
            hit,
            content,
            label: null,
            customRenderer,
        }

        if (!customRenderer) {
            view.label = content
                .append('text')
                .attr('class', 'sliding-dropdown-option')
                .attr('text-anchor', 'start')
                .attr('dominant-baseline', 'central')
                .attr('font-size', this.styles.option.fontSize)
                .attr('font-weight', this.styles.option.fontWeight)
                .attr('pointer-events', 'none')
                .text(option.label)
        }

        group
            .on('click', (event: Event) => this.activateOption(option, event))
            .on('keydown', (event: KeyboardEvent) => this.handleOptionKeydown(option, event))
            .on('mouseenter', () => {
                this.hoveredValue = option.value
                this.renderOptionViews()
            })
            .on('mouseleave', () => {
                if (this.hoveredValue === option.value)
                    this.hoveredValue = null

                this.renderOptionViews()
            })

        return view
    }

    private fallbackOptionContentWidth(option: SlidingDropdownOption<Value>): number {
        return option.label.length * this.styles.option.fontSize * FALLBACK_CHARACTER_WIDTH_RATIO
    }

    private fallbackOptionContentRightEdge(option: SlidingDropdownOption<Value>): number {
        return PADDING
            + this.maximumIndicatorBorderWidth() / 2
            + this.optionHorizontalPadding
            + this.fallbackOptionContentWidth(option)
    }

    private measureOptionContentRightEdge(view: SlidingDropdownOptionView<Value>): number {
        const contentNode = view.content.node?.() as SVGGElement | undefined

        try {
            const bounds = contentNode?.getBBox?.()
            const rightEdge = bounds
                && bounds.width > 0
                ? bounds.x + bounds.width
                : 0

            if (
                Number.isFinite(rightEdge)
                && rightEdge > 0
            )
                return rightEdge
        } catch {
            // Detached and non-rendering SVG environments cannot expose geometry.
        }

        const labelNode = view.label?.node?.() as SVGTextElement | undefined

        try {
            const width = labelNode?.getComputedTextLength?.() ?? 0
            const x = Number(view.label?.attr('x'))
            const rightEdge = width > 0 ? x + width : 0

            if (
                Number.isFinite(rightEdge)
                && rightEdge > 0
            )
                return rightEdge
        } catch {
            // Text metrics are optional in lightweight DOM environments.
        }

        return this.fallbackOptionContentRightEdge(view.option)
    }

    private measureOptionContentRightEdges(): void {
        for (const view of this.optionViews) {
            const display = view.group.attr('display')
            view.group.attr('display', null)
            const measuredRightEdge = this.measureOptionContentRightEdge(view)
            this.optionContentRightEdges.set(view.option.value, measuredRightEdge)
            view.group.attr('display', display)
        }
    }

    private preferredSurfaceWidth(value: Value): number {
        const option = this.options[this.indexOf(value)] ?? this.options[0]!
        const contentRightEdge = this.optionContentRightEdges.get(value)
            ?? this.fallbackOptionContentRightEdge(option)

        return Math.ceil(
            contentRightEdge
                + this.optionHorizontalPadding
                + PADDING
                + this.maximumIndicatorBorderWidth() / 2,
        )
    }

    private createOptionLayoutState(state: SlidingDropdownOptionRenderState<Value>): SlidingDropdownOptionRenderState<Value> {
        const borderWidth = this.maximumIndicatorBorderWidth()
        const surfaceWidth = this.preferredSurfaceWidth(state.option.value)

        return {
            ...state,
            x: PADDING + borderWidth / 2,
            width: Math.max(1, surfaceWidth - PADDING * 2 - borderWidth),
        }
    }

    private clampSurfaceWidth(width: number): number {
        return Math.max(
            PADDING * 2 + 1,
            Math.min(width, this.availableWidth),
        )
    }

    private closedSurfaceWidth(value: Value): number {
        return this.clampSurfaceWidth(
            this.preferredSurfaceWidth(value),
        )
    }

    private openSurfaceWidth(): number {
        const longestOptionWidth = Math.max(...this.options.map(option => this.preferredSurfaceWidth(option.value)))
        const hasMeasuredEveryOption = this.options.every(
            option => (
                this.optionContentRightEdges.has(option.value)
            ),
        )

        return this.clampSurfaceWidth(
            hasMeasuredEveryOption
                ? longestOptionWidth
                : Math.max(this.requestedWidth, longestOptionWidth),
        )
    }

    private renderOptionView(view: SlidingDropdownOptionView<Value>): void {
        const state = this.createOptionState(view.option, view.sourceIndex)
        const layoutState = this.createOptionLayoutState(state)
        const visible = this.open
            || this.animating
            || state.selected

        view.group
            .attr('display', visible ? null : 'none')
            .attr('role', 'option')
            .attr('tabindex', visible
                && !state.disabled
                ? 0
                : null)
            .attr('aria-label', state.option.ariaLabel ?? state.option.label)
            .attr(
                'aria-disabled',
                String(state.disabled),
            )
            .attr(
                'aria-selected',
                String(state.selected),
            )
            .attr(
                'aria-hidden',
                String(!visible),
            )
            .style('cursor', state.disabled ? 'not-allowed' : 'pointer')

        view.hit
            .attr('x', state.x)
            .attr('y', state.y)
            .attr('width', state.width)
            .attr('height', state.height)
            .attr('rx', state.height / 2)
            .attr('ry', state.height / 2)

        if (view.customRenderer) {
            view.customRenderer.resize?.(
                layoutState.x,
                layoutState.y,
                layoutState.width,
                layoutState.height,
            )
            view.customRenderer.render?.(layoutState)

            return
        }

        view.label
            ?.attr('x', layoutState.x + this.optionHorizontalPadding)
            .attr('y', layoutState.y + layoutState.height / 2)
            .attr('fill', state.color)
            .attr('font-weight', state.selected ? this.styles.option.selectedFontWeight : this.styles.option.fontWeight)
            .text(state.option.label)
    }

    private renderOptionViews(): void {
        if (this.destroyed)
            return

        for (const view of this.optionViews) this.renderOptionView(view)
    }

    private renderIndicator(y: number): void {
        const indicatorHeight = this.height - PADDING * 2
        const indicatorWidth = this.width - PADDING * 2
        const borderColor = this.open
            ? this.styles.indicator.openBorderColor
            : this.styles.indicator.closedBorderColor
        const borderWidth = this.open
            ? this.styles.indicator.openBorderWidth
            : this.styles.indicator.closedBorderWidth

        this.indicator
            .attr('x', PADDING)
            .attr('y', y)
            .attr('width', indicatorWidth)
            .attr('height', indicatorHeight)
            .attr('rx', indicatorHeight / 2)
            .attr('ry', indicatorHeight / 2)
            .attr('fill', this.styles.indicator.backgroundColor)
            .attr('stroke', 'none')
            .attr('stroke-width', 0)
            .style('filter', this.indicatorBoxShadow === 'none' ? null : `drop-shadow(${this.indicatorBoxShadow})`)

        if (this.indicatorInsetShadow) {
            this.indicatorInsetGradient.selectAll('*').remove()
            this.indicatorInsetGradient
                .append('stop')
                .attr('offset', '0%')
                .attr('stop-color', this.indicatorInsetShadow.topColor)
            this.indicatorInsetGradient
                .append('stop')
                .attr('offset', '38%')
                .attr('stop-color', 'rgba(255, 255, 255, 0)')
            this.indicatorInsetGradient
                .append('stop')
                .attr('offset', '72%')
                .attr('stop-color', 'rgba(0, 0, 0, 0)')
            this.indicatorInsetGradient
                .append('stop')
                .attr('offset', '100%')
                .attr('stop-color', this.indicatorInsetShadow.bottomColor)
        }

        this.indicatorInset
            .attr('x', PADDING)
            .attr('y', y)
            .attr('width', indicatorWidth)
            .attr('height', indicatorHeight)
            .attr('rx', indicatorHeight / 2)
            .attr('ry', indicatorHeight / 2)
            .attr('fill', this.indicatorInsetShadow ? `url(#${this.indicatorInsetGradientId})` : 'transparent')
            .attr('stroke', borderColor)
            .attr('stroke-width', borderWidth)
    }

    private chevronTransform(rotationDegrees = this.chevronRotationDegrees): string {
        return `rotate(${rotationDegrees})`
    }

    private chevronCenterX(): number {
        return this.width
            - PADDING
            + this.maximumIndicatorBorderWidth() / 2
            + CHEVRON_GAP
            + CHEVRON_SIZE / 2
    }

    private positionChevron(indicatorY: number): void {
        if (this.chevronPortalSvg)
            return

        const centerY = indicatorY + (this.height - PADDING * 2) / 2
        this.chevronControl.attr('transform', `translate(${this.chevronCenterX()}, ${centerY})`)
    }

    private renderChevron(
        indicatorY: number,
        rotationDegrees: number,
    ): void {
        this.positionChevron(indicatorY)
        this.chevronRotationDegrees = rotationDegrees
        this.chevronIcon
            .interrupt()
            .attr(
                'transform',
                this.chevronTransform(),
            )
    }

    private animateChevronRotation(
        rotationDegrees: number,
        duration: number,
    ): void {
        this.chevronRotationDegrees = rotationDegrees
        this.chevronIcon
            .interrupt()
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .attr(
                'transform',
                this.chevronTransform(),
            )
    }

    private applySurfaceWidth(
        width: number,
        contentHeight: number,
        top: number,
        indicatorY: number,
    ): void {
        this.width = width
        const indicatorWidth = Math.max(1, width - PADDING * 2)
        this.viewportHit.attr('width', width)
        this.viewportClip.attr('width', width)
        this.track.attr('width', width)
        this.openShadow.attr('width', width)
        this.indicator.attr('width', indicatorWidth)
        this.indicatorInset.attr('width', indicatorWidth)
        this.renderOptionViews()
        this.updateHostSvgGeometry(contentHeight, top)

        if (this.portaled) {
            this.updateScrollPortalGeometry()
            this.updateChevronPortalGeometry()

            return
        }

        this.positionChevron(indicatorY)
    }

    private animateSurfaceWidth(
        targetWidth: number,
        contentHeight: number,
        top: number,
        indicatorY: number,
        duration: number,
    ): void {
        const startWidth = this.width

        if (
            Math.abs(targetWidth - startWidth) < 0.5
            || duration === 0
        ) {
            this.applySurfaceWidth(
                targetWidth,
                contentHeight,
                top,
                indicatorY,
            )

            return
        }

        this.group
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .tween(
                'sliding-dropdown-width',
                () => (progress: number) => {
                    const width = startWidth + (targetWidth - startWidth) * progress
                    this.applySurfaceWidth(
                        width,
                        contentHeight,
                        top,
                        indicatorY,
                    )
                },
            )
    }

    private selectedIndex(): number {
        return Math.max(
            0,
            this.indexOf(this.currentValue),
        )
    }

    private optionsOffset(index: number): number {
        return -index * this.height
    }

    private clampTapeOffset(offset: number): number {
        return Math.max(
            this.optionsOffset(this.options.length - 1),
            Math.min(0, offset),
        )
    }

    private nearestTapeIndex(): number {
        const index = Math.round(-this.tapeOffset / this.height)

        return Math.max(
            0,
            Math.min(this.options.length - 1, index),
        )
    }

    private nearestEnabledIndex(index: number): number {
        if (!this.options[index]?.disabled)
            return index

        for (let distance = 1; distance < this.options.length; distance += 1) {
            const before = index - distance

            if (
                before >= 0
                && !this.options[before]?.disabled
            )
                return before

            const after = index + distance

            if (
                after < this.options.length
                && !this.options[after]?.disabled
            )
                return after
        }

        return this.selectedIndex()
    }

    private refreshOpenViewport(): void {
        this.openViewportTop = this.tapeOffset
        this.openViewportHeight = this.options.length * this.height
    }

    private renderedTapeOffset(): number {
        return this.tapeOffset - this.openViewportTop
    }

    private openIndicatorY(): number {
        return -this.openViewportTop + PADDING
    }

    private updateTapePreview(): void {
        const index = this.nearestEnabledIndex(
            this.nearestTapeIndex(),
        )
        this.pendingValue = this.options[index]!.value
        this.renderOptionViews()
    }

    private moveTapeFromInput(
        offset: number,
        syncScrollPortal = true,
    ): void {
        this.interruptTransitions()
        this.tapeOffset = this.clampTapeOffset(offset)
        this.refreshOpenViewport()
        this.setTapePosition(
            this.renderedTapeOffset(),
        )
        this.indicator.attr(
            'y',
            this.openIndicatorY(),
        )
        this.indicatorInset.attr(
            'y',
            this.openIndicatorY(),
        )
        this.positionChevron(
            this.openIndicatorY(),
        )

        if (syncScrollPortal)
            this.syncScrollPortalToTape()

        this.updateHostSvgGeometry(this.openViewportHeight, this.openViewportTop)
        this.updateTapePreview()
    }

    private readonly handleScrollPortalScroll = (): void => {
        if (
            !this.scrollPortalNode
            || this.syncingScrollPosition
            || !this.open
            || this.animating
        )
            return

        this.moveTapeFromInput(-this.scrollPortalNode.scrollTop / this.scrollScaleY, false)
    }

    private readonly handleScrollPortalEnd = (): void => {
        if (
            !this.open
            || this.animating
            || this.tapeSnapAnimating
            || this.tapePointerId !== null
        )
            return

        this.snapTapeToPreview()
    }

    private animateScrollPortalToOffset(
        offset: number,
        duration: number,
    ): void {
        const portal = this.scrollPortalNode

        if (!portal) {
            this.moveTapeFromInput(offset)

            return
        }

        this.interruptTapeSnapAnimation()
        const startScrollTop = portal.scrollTop
        const targetScrollTop = -offset * this.scrollScaleY

        if (Math.abs(startScrollTop - targetScrollTop) < 0.5) {
            this.moveTapeFromInput(offset, false)

            return
        }

        this.tapeSnapAnimating = true
        select(portal)
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .tween(
                'sliding-dropdown-scroll',
                () => (progress: number) => {
                    const scrollTop = startScrollTop + (targetScrollTop - startScrollTop) * progress
                    portal.scrollTop = scrollTop
                    this.moveTapeFromInput(-scrollTop / this.scrollScaleY, false)
                },
            )
        this.tapeSnapAnimationTimer = setTimeout(
            () => {
                this.tapeSnapAnimationTimer = null

                if (
                    this.destroyed
                    || !this.open
                )
                    return

                portal.scrollTop = targetScrollTop
                this.moveTapeFromInput(offset, false)
                this.tapeSnapAnimating = false
            },
            duration,
        )
    }

    private snapTapeToPreview(): void {
        if (
            this.destroyed
            || !this.open
            || this.animating
        )
            return

        const targetIndex = this.nearestEnabledIndex(
            this.nearestTapeIndex(),
        )
        const targetOffset = this.optionsOffset(targetIndex)
        this.pendingValue = this.options[targetIndex]!.value

        if (targetOffset === this.tapeOffset) {
            this.renderOptionViews()

            return
        }

        this.renderOptionViews()
        this.animateScrollPortalToOffset(targetOffset, this.transitionConfig.snapDurationMs)
    }

    private readonly handleWheel = (event: WheelEvent): void => {
        if (!this.open)
            return

        event.stopPropagation()

        if (this.animating) {
            event.preventDefault()

            return
        }

        if (event.deltaY !== 0)
            this.interruptTapeSnapAnimation()
    }

    private readonly handleTapePointerDown = (event: PointerEvent): void => {
        if (
            !this.open
            || this.animating
            || event.button !== 0
        )
            return

        event.stopPropagation()
        this.interruptTapeSnapAnimation()
        this.interruptTransitions()
        this.tapePointerId = event.pointerId
        this.tapePointerCaptured = false
        this.tapePointerStartY = event.clientY
        this.tapePointerStartOffset = this.tapeOffset
    }

    private readonly handleTapePointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.tapePointerId)
            return

        const distance = event.clientY - this.tapePointerStartY

        if (
            !this.tapePointerCaptured
            && Math.abs(distance) > POINTER_DRAG_THRESHOLD_PX
        ) {
            const node = this.group.node() as Element & {
                setPointerCapture?: (pointerId: number) => void
            }
            node.setPointerCapture?.(event.pointerId)
            this.tapePointerCaptured = true
        }

        if (!this.tapePointerCaptured)
            return

        event.preventDefault()
        event.stopPropagation()
        this.moveTapeFromInput(this.tapePointerStartOffset + distance)
    }

    private readonly handleTapePointerEnd = (event: PointerEvent): void => {
        if (event.pointerId !== this.tapePointerId)
            return

        const dragged = this.tapePointerCaptured

        if (dragged) {
            event.preventDefault()
            event.stopPropagation()
            this.suppressClickUntil = Date.now() + this.transitionConfig.durationMs
        }

        this.releaseTapePointer()

        if (dragged)
            this.snapTapeToPreview()
    }

    private renderInternal(): void {
        if (this.destroyed)
            return

        if (
            !this.open
            && !this.animating
        )
            this.restoreSvgPortal()

        this.interruptTransitions()
        this.clearAnimationTimer()
        this.animating = false

        if (this.open)
            this.refreshOpenViewport()
        else {
            this.pendingValue = null
            this.tapeOffset = this.optionsOffset(
                this.selectedIndex(),
            )
            this.openViewportTop = 0
            this.openViewportHeight = this.height
        }

        this.width = this.open
            ? this.openSurfaceWidth()
            : this.closedSurfaceWidth(this.currentValue)
        const contentHeight = this.open ? this.openViewportHeight : this.height
        const top = this.open ? this.openViewportTop : 0
        const tapePosition = this.open ? this.renderedTapeOffset() : this.tapeOffset
        const indicatorY = this.open ? this.openIndicatorY() : PADDING

        this.group
            .attr('transform', `translate(${this.x + this.visualOverflowPadding.left}, ${this.y + this.visualOverflowPadding.top})`)
            .attr(
                'aria-expanded',
                String(this.open),
            )
            .style('touch-action', this.open ? 'none' : 'manipulation')
        this.viewportHit
            .attr('x', 0)
            .attr('width', this.width)
        this.viewportClip
            .attr('x', 0)
            .attr('width', this.width)
            .attr('rx', this.height / 2)
            .attr('ry', this.height / 2)
        this.setViewportGeometry(0, contentHeight)
        this.setTapePosition(tapePosition)
        this.track
            .attr('x', 0)
            .attr('width', this.width)
            .attr('height', this.options.length * this.height)
            .attr('rx', this.height / 2)
            .attr('ry', this.height / 2)
            .attr(
                'fill',
                this.open
                    ? this.styles.surface.openBackgroundColor
                    : this.styles.surface.closedBackgroundColor,
            )
        this.openShadow
            .attr('x', 0)
            .attr('width', this.width)
            .attr('rx', this.height / 2)
            .attr('ry', this.height / 2)
            .attr('fill', '#000000')
            .attr('display', this.open
                && this.hasOpenShadow()
                ? null
                : 'none')
            .attr('filter', this.hasOpenShadow() ? `url(#${this.openShadowFilterId})` : null)
        this.renderIndicator(indicatorY)
        this.renderChevron(indicatorY, this.open ? 90 : 0)
        this.renderOptionViews()
        this.updateHostSvgGeometry(contentHeight, top)

        if (
            this.open
            && this.portaled
        ) {
            this.updateScrollPortalGeometry()
            this.syncScrollPortalToTape()
        }

        if (this.portaled)
            this.updateChevronPortalGeometry()

        this.syncDocumentListener()
    }

    private setViewportGeometry(
        y: number,
        height: number,
    ): void {
        this.viewportClip
            .attr('y', y)
            .attr('height', height)
        this.viewportHit
            .attr('y', y)
            .attr('height', height)
        this.openShadow
            .attr('y', y)
            .attr('height', height)
    }

    private animateTapeViewport(
        viewportY: number,
        viewportHeight: number,
        tapePosition: number,
        trackFill: string,
        duration: number,
    ): void {
        this.viewportClip
            .interrupt()
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .attr('y', viewportY)
            .attr('height', viewportHeight)
        this.viewportHit
            .interrupt()
            .transition()
            .duration(duration)
            .ease(easePupOut)
            .attr('y', viewportY)
            .attr('height', viewportHeight)

        if (
            this.open
            && this.hasOpenShadow()
        ) {
            this.openShadow
                .interrupt()
                .transition()
                .duration(duration)
                .ease(easePupOut)
                .attr('y', viewportY)
                .attr('height', viewportHeight)
        }

        this.animateTapePosition(
            tapePosition,
            duration,
            trackFill,
        )
    }

    private openDropdown(): void {
        if (
            this.destroyed
            || this.open
            || this.animating
            || this.options.length < 2
        )
            return

        const selectedIndex = this.selectedIndex()
        const duration = this.transitionConfig.durationMs
        this.measureOptionContentRightEdges()
        const targetWidth = this.openSurfaceWidth()
        this.releaseTapePointer()
        this.interruptTapeSnapAnimation()
        this.pendingValue = null
        this.tapeOffset = this.optionsOffset(selectedIndex)
        this.portalSvg()
        this.refreshOpenViewport()
        this.open = true
        this.animating = true
        this.openShadow
            .attr('display', this.hasOpenShadow() ? null : 'none')
        this.group.attr('aria-expanded', 'true')
            .style('touch-action', 'none')
        this.parent.attr('data-sliding-dropdown-open', 'true')
        this.renderOptionViews()
        const selectedFrameY = -this.openViewportTop
        this.setViewportGeometry(selectedFrameY, this.height)
        this.setTapePosition(
            this.renderedTapeOffset(),
        )
        this.renderIndicator(selectedFrameY + PADDING)
        this.renderChevron(selectedFrameY + PADDING, 0)
        this.animateChevronRotation(90, duration)
        this.track.attr('fill', this.styles.surface.closedBackgroundColor)
        this.updateHostSvgGeometry(this.openViewportHeight, this.openViewportTop)
        this.syncDocumentListener()
        this.onOpenChange?.(true, this.id)
        this.animateTapeViewport(
            0,
            this.openViewportHeight,
            this.renderedTapeOffset(),
            this.styles.surface.openBackgroundColor,
            duration,
        )
        this.animateSurfaceWidth(
            targetWidth,
            this.openViewportHeight,
            this.openViewportTop,
            selectedFrameY + PADDING,
            duration,
        )
        this.animationTimer = setTimeout(
            () => {
                this.animationTimer = null

                if (
                    this.destroyed
                    || !this.open
                )
                    return

                this.animating = false
                this.renderInternal()
            },
            duration,
        )
    }

    private closeDropdown(notify: boolean): void {
        if (
            this.destroyed
            || !this.open
        )
            return

        const targetIndex = this.nearestEnabledIndex(
            this.nearestTapeIndex(),
        )
        this.selectOption(this.options[targetIndex]!, notify)
    }

    private selectOption(
        option: SlidingDropdownOption<Value>,
        notify = true,
    ): void {
        if (
            option.disabled
            || !this.open
        )
            return

        const currentIndex = this.nearestTapeIndex()
        const targetIndex = this.indexOf(option.value)

        if (targetIndex < 0)
            return

        const startOffset = this.tapeOffset
        const targetOffset = this.optionsOffset(targetIndex)
        const closeDuration = this.transitionConfig.minDurationMs
        const slideDuration = currentIndex === targetIndex
            ? closeDuration
            : this.transitionDuration(currentIndex, targetIndex)
        const duration = Math.max(slideDuration, closeDuration) * CLICK_TRANSITION_DURATION_MULTIPLIER
        const valueChanged = option.value !== this.currentValue
        this.interruptTapeSnapAnimation()
        this.clearAnimationTimer()
        this.interruptTransitions()
        this.pendingValue = option.value
        this.tapeOffset = targetOffset
        this.animating = true
        this.hoveredValue = null
        this.renderOptionViews()
        this.measureOptionContentRightEdges()
        const targetWidth = this.closedSurfaceWidth(option.value)
        this.open = false
        this.openShadow
            .interrupt()
            .attr('display', 'none')
        this.group.attr('aria-expanded', 'false')
        this.syncDocumentListener()

        if (notify)
            this.onOpenChange?.(false, this.id)

        const selectedFrameY = -startOffset
        this.renderIndicator(selectedFrameY + PADDING)
        this.renderChevron(selectedFrameY + PADDING, 90)
        this.animateChevronRotation(0, duration)
        this.updateHostSvgGeometry(this.openViewportHeight, startOffset)
        this.animateTapeViewport(
            selectedFrameY,
            this.height,
            targetOffset - startOffset,
            this.styles.surface.closedBackgroundColor,
            duration,
        )
        this.animateSurfaceWidth(
            targetWidth,
            this.openViewportHeight,
            startOffset,
            selectedFrameY + PADDING,
            duration,
        )

        this.animationTimer = setTimeout(
            () => {
                this.animationTimer = null

                if (this.destroyed)
                    return

                this.currentValue = option.value
                this.pendingValue = null
                this.animating = false
                this.renderInternal()

                if (valueChanged)
                    this.onChange?.(option.value, this.id)
            },
            duration,
        )
    }

    private activateOption(
        option: SlidingDropdownOption<Value>,
        event: Event,
    ): void {
        if (
            event.defaultPrevented
            || option.disabled
        )
            return

        event.preventDefault()
        event.stopPropagation()

        if (Date.now() < this.suppressClickUntil)
            return

        if (!this.open) {
            if (option.value === this.currentValue)
                this.openDropdown()

            return
        }

        this.selectOption(option, true)
    }

    private readonly handleChevronClick = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()

        if (this.animating)
            return

        if (this.open) {
            this.closeDropdown(true)

            return
        }

        this.openDropdown()
    }

    private focusTapeOption(option: SlidingDropdownOption<Value>): void {
        const targetIndex = this.indexOf(option.value)

        if (
            targetIndex < 0
            || option.disabled
        )
            return

        const duration = this.transitionDuration(
            this.nearestTapeIndex(),
            targetIndex,
        )
        const targetOffset = this.optionsOffset(targetIndex)
        this.pendingValue = option.value
        this.renderOptionViews()
        this.animateScrollPortalToOffset(targetOffset, duration)
        this.optionViews.find(view => view.option.value === option.value)
            ?.group.node()
            ?.focus({ preventScroll: true })
    }

    private focusOptionByOffset(
        option: SlidingDropdownOption<Value>,
        offset: number,
    ): void {
        const startIndex = this.indexOf(option.value)

        for (let step = 1; step <= this.options.length; step += 1) {
            const index = (startIndex + offset * step + this.options.length) % this.options.length
            const candidate = this.options[index]!

            if (candidate.disabled)
                continue

            this.focusTapeOption(candidate)

            return
        }
    }

    private focusBoundaryOption(position: 'first' | 'last'): void {
        const enabledOptions = this.options.filter(option => !option.disabled)
        const option = position === 'first' ? enabledOptions[0] : enabledOptions.at(-1)

        if (!option)
            return

        this.focusTapeOption(option)
    }

    private handleOptionKeydown(
        option: SlidingDropdownOption<Value>,
        event: KeyboardEvent,
    ): void {
        if (
            event.key === 'Escape'
            && (this.open || this.animating)
        ) {
            event.preventDefault()
            event.stopPropagation()
            this.closeDropdown(true)

            return
        }

        if (
            event.key === 'Enter'
            || event.key === ' '
        ) {
            const previewOption = this.pendingValue === null
                ? option
                : this.options.find(candidate => candidate.value === this.pendingValue) ?? option
            this.activateOption(previewOption, event)

            return
        }

        if (
            event.key === 'ArrowDown'
            || event.key === 'ArrowUp'
        ) {
            event.preventDefault()
            event.stopPropagation()

            if (!this.open) {
                this.openDropdown()

                return
            }

            if (this.animating)
                return

            this.focusOptionByOffset(option, event.key === 'ArrowDown' ? 1 : -1)

            return
        }

        if (!this.open)
            return

        if (
            event.key === 'Home'
            || event.key === 'End'
        ) {
            event.preventDefault()
            event.stopPropagation()

            if (this.animating)
                return

            this.focusBoundaryOption(event.key === 'Home' ? 'first' : 'last')
        }
    }

    private readonly handleDocumentMouseDown = (event: MouseEvent): void => {
        const groupNode = this.group.node?.()

        if (groupNode?.contains(event.target as Node))
            return

        const chevronPortalNode = this.chevronPortalSvg?.node?.()

        if (chevronPortalNode?.contains(event.target as Node))
            return

        this.closeDropdown(true)
    }

    private readonly handleViewportChange = (event?: Event): void => {
        if (event?.target === this.scrollPortalNode)
            return

        if (
            !this.open
            || this.animating
        )
            return

        this.renderInternal()
    }

    private syncDocumentListener(): void {
        if (typeof document === 'undefined')
            return

        document.removeEventListener(
            'mousedown',
            this.handleDocumentMouseDown,
            true,
        )
        window.removeEventListener('resize', this.handleViewportChange)
        window.removeEventListener(
            'scroll',
            this.handleViewportChange,
            true,
        )

        if (this.open)
            document.addEventListener(
                'mousedown',
                this.handleDocumentMouseDown,
                true,
            )

        if (this.open)
            window.addEventListener('resize', this.handleViewportChange)

        if (this.open)
            window.addEventListener(
                'scroll',
                this.handleViewportChange,
                true,
            )
    }

    render = (): void => {
        if (this.animating)
            return

        this.measureOptionContentRightEdges()
        this.renderInternal()
    }

    resize(
        x: number,
        y: number,
        width: number,
        height: number = this.height,
    ): void {
        const tapePosition = this.height > 0
            ? -this.tapeOffset / this.height
            : this.selectedIndex()
        this.x = x
        this.y = y
        this.requestedWidth = width
        this.height = height
        this.tapeOffset = this.open
            ? this.clampTapeOffset(-tapePosition * this.height)
            : this.optionsOffset(
                this.selectedIndex(),
            )

        if (this.animating)
            return

        this.renderInternal()
    }

    setValue(value: Value): void {
        const index = this.indexOf(value)

        if (
            index < 0
            || this.options[index]?.disabled
        )
            return

        if (value === this.currentValue) {
            if (!this.animating) {
                this.measureOptionContentRightEdges()
                this.renderInternal()
            }

            return
        }

        this.interruptTapeSnapAnimation()
        this.clearAnimationTimer()
        this.releaseTapePointer()
        this.interruptTransitions()
        this.currentValue = value
        this.pendingValue = null
        this.open = false
        this.animating = false
        this.hoveredValue = null
        this.renderInternal()
        this.measureOptionContentRightEdges()
        this.renderInternal()
    }

    getValue(): Value {
        return this.currentValue
    }

    setOpen(open: boolean): void {
        if (open) {
            this.openDropdown()

            return
        }

        this.closeDropdown(true)
    }

    isOpen(): boolean {
        return this.open
    }

    getOuterHeight(): number {
        return this.closedOuterHeight()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.clearAnimationTimer()
        this.releaseTapePointer()
        this.interruptTransitions()

        if (
            this.resizeAnimationFrame !== null
            && typeof cancelAnimationFrame !== 'undefined'
        ) {
            cancelAnimationFrame(this.resizeAnimationFrame)
            this.resizeAnimationFrame = null
        }

        this.resizeObserver?.disconnect()
        this.observedResizeTargets.clear()
        this.interruptTapeSnapAnimation()

        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'mousedown',
                this.handleDocumentMouseDown,
                true,
            )
            window.removeEventListener('resize', this.handleViewportChange)
            window.removeEventListener(
                'scroll',
                this.handleViewportChange,
                true,
            )
        }

        for (const view of this.optionViews) view.customRenderer?.destroy?.()

        this.restoreSvgPortal()
        this.group.remove()
        this.restoreOwnedLayout()
    }
}

export const createSlidingDropdown = <Value extends string = string>(
    parent: any,
    config: SlidingDropdownConfig<Value>,
): SlidingDropdownInstance<Value> => new SlidingDropdown(parent, config)
