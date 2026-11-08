import { select } from 'd3-selection'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { appendSvgPathIcon } from '@lixpi/ui-primitives/svg'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
    type SlidingSwitchOptionRenderInstance,
    type SlidingSwitchOptionRenderState,
} from '@lixpi/ui-kit/components/sliding-switch'
import {
    type SlidingDropdownConfig,
    type SlidingDropdownOptionRenderInstance,
    type SlidingDropdownOptionRenderState,
} from '@lixpi/ui-kit/components/sliding-dropdown'
import {
    imageIcon,
    videoIcon,
    sendIcon,
} from '@lixpi/ui-kit/svg'
import {
    bindCanvasTheme,
    type CanvasThemeSource,
} from '@lixpi/canvas-components/theme'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export type PromptMediaMode = 'image' | 'video'
export type PromptMediaModeAppearance = {
    trackBackgroundColor: string
    indicatorBackgroundColor: string
    unselectedOptionColor: string
    hoveredOptionColor: string
    selectedOptionColor: string
    indicatorBoxShadow: string
}
export type PromptMediaModeSwitchConfig = {
    document: Document
    value: PromptMediaMode
    onChange: (value: PromptMediaMode) => void
    appearance?: Partial<PromptMediaModeAppearance>
    theme?: CanvasThemeSource
}

const switchHeight = 40
const switchInset = 2
const iconSize = 20
const icons = {
    image: imageIcon,
    video: videoIcon,
}

class PromptMediaModeOption implements SlidingSwitchOptionRenderInstance<PromptMediaMode> {
    private readonly icon: any
    private height = switchHeight - switchInset * 2

    constructor(
        parent: any,
        state: SlidingSwitchOptionRenderState<PromptMediaMode>,
    ) {
        this.icon = parent
            .append('g')
            .attr('class', 'ai-prompt-media-mode-switch-icon')
            .attr('pointer-events', 'none')
            .attr('aria-hidden', 'true')
        appendSvgPathIcon(
            this.icon,
            icons[state.option.value],
            {
                x: 0,
                y: 0,
                size: iconSize,
                fill: state.color,
            },
        )
        this.render(state)
    }

    resize(
        x: number,
        y: number,
        width: number,
        height = this.height,
    ): void {
        this.height = height
        const scale = height / (switchHeight - switchInset * 2)
        const size = iconSize * scale
        this.icon.attr('transform', `translate(${x + (width - size) / 2}, ${y + (height - size) / 2}) scale(${scale})`)
    }

    render(state: SlidingSwitchOptionRenderState<PromptMediaMode>): void {
        this.icon.selectAll('path').attr('fill', state.color)
        this.resize(
            state.x,
            state.y,
            state.width,
            state.height,
        )
    }

    destroy(): void {
        this.icon.remove()
    }
}

export class PromptMediaModeSwitch {
    readonly element: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private readonly control: SlidingSwitchInstance<PromptMediaMode>
    private height = switchHeight

    constructor(config: PromptMediaModeSwitchConfig) {
        const html = createDocumentHtml(config.document)
        this.element = html`
            <div
                className="ai-prompt-media-mode-switch"
                contenteditable="false"
            ></div>
        ` as HTMLDivElement
        const svg = select(this.element).append('svg').attr('class', 'ai-prompt-media-mode-switch-svg')
        const appearance: PromptMediaModeAppearance = {
            trackBackgroundColor: 'rgba(95, 143, 207, 0.14)',
            indicatorBackgroundColor: 'rgba(95, 143, 207, 0.24)',
            unselectedOptionColor: 'rgba(66, 73, 79, 0.62)',
            hoveredOptionColor: '#42494f',
            selectedOptionColor: '#000000',
            indicatorBoxShadow: 'none',
            ...config.appearance,
        }
        this.control = createSlidingSwitch<PromptMediaMode>(
            svg,
            {
                id: 'ai-prompt-media-generation-mode',
                x: 0,
                y: 0,
                width: (switchHeight - switchInset * 2) * 2 + switchInset * 2,
                height: switchHeight,
                options: [
                    {
                        label: 'Image',
                        value: 'image',
                        ariaLabel: 'Generate an image',
                    },
                    {
                        label: 'Video',
                        value: 'video',
                        ariaLabel: 'Generate a video',
                    },
                ],
                selectedValue: config.value,
                className: 'ai-prompt-media-mode-sliding-switch',
                renderOption: (parent, state) => new PromptMediaModeOption(parent, state),
                visualOverflowPadding: {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
                trackBackgroundColor: `var(--canvas-surface-hover, ${appearance.trackBackgroundColor})`,
                indicatorBackgroundColor: `var(--canvas-surface, ${appearance.indicatorBackgroundColor})`,
                unselectedOptionColor: `var(--canvas-text-muted, ${appearance.unselectedOptionColor})`,
                hoveredOptionColor: `var(--canvas-text, ${appearance.hoveredOptionColor})`,
                selectedOptionColor: `var(--canvas-text, ${appearance.selectedOptionColor})`,
                indicatorBoxShadow: appearance.indicatorBoxShadow,
                reshuffleItemsOnValueChange: {
                    enable: true,
                    selectedElementPosition: 'right',
                },
                onChange: config.onChange,
            },
        )
        this.lifetime.own(() => this.element.remove())
        this.lifetime.own(() => this.control.destroy())
        const observer = new MutationObserver(this.refreshSize)
        this.lifetime.own(() => observer.disconnect())
        const observe = (): void => {
            observer.disconnect()
            let source: Element | null = this.element

            while (source) {
                observer.observe(source, { attributes: true })
                source = source.parentElement
            }

            this.refreshSize()
        }

        if (config.theme)
            this.lifetime.own(
                bindCanvasTheme(
                    this.element,
                    config.theme,
                    this.refreshSize,
                ),
            )

        observe()
        const frame = config.document.defaultView?.requestAnimationFrame(observe)
        this.lifetime.own(() => {
            if (frame !== undefined)
                config.document.defaultView?.cancelAnimationFrame(frame)
        })
    }

    private refreshSize = (): void => {
        if (this.lifetime.signal.aborted)
            return

        const computed = this.element.ownerDocument.defaultView?.getComputedStyle(this.element)
        const value = Number.parseFloat(computed?.getPropertyValue('--canvas-control-height') ?? '')
        const height = Number.isFinite(value)
            && value > 0
            ? value
            : switchHeight

        if (height === this.height)
            return

        this.height = height
        this.control.resize(
            0,
            0,
            (height - switchInset * 2) * 2 + switchInset * 2,
            height,
        )
    }

    setValue(value: PromptMediaMode): void {
        this.control.setValue(value)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

export const createPromptMediaModeSwitch = (config: PromptMediaModeSwitchConfig): PromptMediaModeSwitch => new PromptMediaModeSwitch(config)

export type PromptModelMenuTriggerConfig = {
    document: Document
    onClick: (event: MouseEvent) => void
    theme?: CanvasThemeSource
}

export class PromptModelMenuTrigger {
    readonly element: HTMLButtonElement
    readonly summary: HTMLSpanElement
    private readonly lifetime = new Lifetime()

    constructor(config: PromptModelMenuTriggerConfig) {
        const html = createDocumentHtml(config.document)
        this.summary = html`<span className="ai-prompt-model-menu-trigger-summary"></span>` as HTMLSpanElement
        this.element = html`
            <button
                type="button"
                className="ai-prompt-model-menu-trigger"
                aria-label="Generation settings"
                data-help-tooltip="aria-label"
                aria-expanded="false"
                contenteditable="false"
                onmousedown=${(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                }}
                onclick=${config.onClick}
            >${this.summary}</button>
        ` as HTMLButtonElement
        this.lifetime.own(() => this.element.remove())

        if (config.theme)
            this.lifetime.own(
                bindCanvasTheme(this.element, config.theme),
            )
    }

    setExpanded(open: boolean): void {
        this.element.classList.toggle('is-active', open)
        this.element.ariaExpanded = String(open)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

export const createPromptModelMenuTrigger = (config: PromptModelMenuTriggerConfig): PromptModelMenuTrigger => new PromptModelMenuTrigger(config)

export type PromptModelOption = {
    title: string
    providerTitle: string
    icon: string
}
export type PromptModelDropdownAppearance = {
    iconSize: number
    iconLabelGap: number
    horizontalPadding: number
    valueFontSize: number
    textColor: string
    activeTextColor: string
    disabledTextColor: string
    fontWeight: number
    selectedFontWeight: number
}

export const createPromptModelDropdownAppearance = (): PromptModelDropdownAppearance => ({
    iconSize: 14,
    iconLabelGap: 7,
    horizontalPadding: 7,
    valueFontSize: 12,
    textColor: 'rgba(49, 59, 78, 0.68)',
    activeTextColor: '#1a2744',
    disabledTextColor: 'rgba(49, 59, 78, 0.32)',
    fontWeight: 400,
    selectedFontWeight: 400,
})

export class PromptModelDropdownOptionView implements SlidingDropdownOptionRenderInstance<string> {
    private readonly group: any
    private readonly icon: any
    private readonly label: any
    private readonly provider: any
    private readonly model: any
    private height = 0

    constructor(
        parent: any,
        state: SlidingDropdownOptionRenderState<string>,
        private readonly option: PromptModelOption,
        private readonly appearance: PromptModelDropdownAppearance = createPromptModelDropdownAppearance(),
    ) {
        this.group = parent
            .append('g')
            .attr('class', 'ai-model-sliding-dropdown-option')
            .attr('pointer-events', 'none')
        this.icon = this.group.append('g').attr('class', 'ai-model-sliding-dropdown-option-icon')

        if (option.icon)
            appendSvgPathIcon(
                this.icon,
                option.icon,
                {
                    x: 0,
                    y: 0,
                    size: appearance.iconSize,
                    fill: appearance.textColor,
                },
            )

        this.label = this.group
            .append('text')
            .attr('class', 'ai-model-sliding-dropdown-option-label')
            .attr('font-size', appearance.valueFontSize)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'central')
        this.provider = this.label.append('tspan').attr('class', 'ai-model-sliding-dropdown-option-provider')
        this.model = this.label.append('tspan').attr('class', 'ai-model-sliding-dropdown-option-model')
        this.render(state)
    }

    resize(
        x: number,
        y: number,
        _width: number,
        height = this.height,
    ): void {
        this.height = height
        const xPosition = x + this.appearance.horizontalPadding
        const centerY = y + height / 2
        this.icon.attr('transform', `translate(${xPosition}, ${centerY - this.appearance.iconSize / 2})`)
        this.label
            .attr('x', xPosition + (this.option.icon ? this.appearance.iconSize + this.appearance.iconLabelGap : 0))
            .attr('y', centerY)
    }

    render(state: SlidingDropdownOptionRenderState<string>): void {
        const appearance = this.appearance
        const color = state.disabled
            ? appearance.disabledTextColor
            : state.selected
                || state.hovered
                ? appearance.activeTextColor
                : appearance.textColor
        this.icon
            .attr('display', this.option.icon ? null : 'none')
            .selectAll('path')
            .attr('fill', color)
        this.label.attr('font-weight', state.selected ? appearance.selectedFontWeight : appearance.fontWeight)
        this.provider
            .attr('display', this.option.providerTitle ? null : 'none')
            .attr('fill', state.disabled ? appearance.disabledTextColor : appearance.textColor)
            .text(this.option.providerTitle ? `${this.option.providerTitle}:` : '')
        this.model.attr('fill', state.disabled ? appearance.disabledTextColor : appearance.activeTextColor).text(
            `${this.option.providerTitle ? ' ' : ''}${this.option.title}`,
        )
        this.resize(
            state.x,
            state.y,
            state.width,
            state.height,
        )
    }

    destroy(): void {
        this.group.remove()
    }
}

export class PromptControlPortalScope {
    private owner: Element | null = null

    constructor(private readonly host: HTMLElement) {}

    source = (): Element => {
        this.owner = this.host.closest('[data-canvas-theme]') ?? this.owner

        return this.owner ?? this.host
    }

    attributes = (): Readonly<Record<string, string>> => {
        const name = this.source().getAttribute('data-canvas-theme')

        return name === null ? {} : { 'data-canvas-theme': name }
    }

    get options(): Pick<SlidingDropdownConfig, 'portalStyleSource' | 'portalScopeAttributes'> {
        return {
            portalStyleSource: this.source,
            portalScopeAttributes: this.attributes,
        }
    }
}

export class PromptSubmitButton {
    readonly element: HTMLButtonElement

    constructor(
        document: Document,
        onSubmit: () => void,
    ) {
        const html = createDocumentHtml(document)
        this.element = html`
            <button
                type="button"
                className="ai-submit-button"
                aria-label="Submit prompt"
                data-help-tooltip="aria-label"
                onclick=${(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onSubmit()
                }}
            ><span className="button-default"><span
                        className="send-icon"
                        innerHTML=${sendIcon}
                    ></span></span><span className="button-hover"><span
                        className="send-icon"
                        innerHTML=${sendIcon}
                    ></span></span></button>
        ` as HTMLButtonElement
    }

    destroy(): void {
        this.element.remove()
    }
}

export const createPromptSubmitButton = (
    document: Document,
    onSubmit: () => void,
): PromptSubmitButton => new PromptSubmitButton(document, onSubmit)
