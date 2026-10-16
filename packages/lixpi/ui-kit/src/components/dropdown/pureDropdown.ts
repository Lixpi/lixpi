import { html } from '@lixpi/ui-primitives/dom'
import { chevronDownIcon } from '../../svg/svgIcons.ts'
import { uiKitSettings } from '../../runtime-settings.ts'
import {
    createInfoBubble,
    type InfoBubbleInstance,
} from '../infoBubble/index.ts'

// Inject fill color utility (same as original dropdown)
const injectFillColor = (
    svg: string,
    color?: string,
): string => {
    if (
        !svg
        || !color
    )
        return svg || ''

    return svg.replace(/<svg([\s\S]*?)>/, `<svg$1 style="fill: ${color}">`)
}

export type DropdownOption = {
    title: string
    icon?: string
    color?: string
    tags?: string[]
    [key: string]: unknown
}

export type DropdownErrorState = {
    enabled?: boolean
    title?: string
    textColor?: string
}

export type PureDropdownConfig<Option extends DropdownOption = DropdownOption> = {
    id: string
    selectedValue: DropdownOption
    options: Option[]
    theme?: string
    buttonIcon?: string
    triggerContent?: HTMLElement
    triggerLabel?: string
    ignoreColorValuesForOptions?: boolean
    ignoreColorValuesForSelectedValue?: boolean
    renderIconForSelectedValue?: boolean
    renderIconForOptions?: boolean
    renderTitleForSelectedValue?: boolean
    enableTagFilter?: boolean
    availableTags?: string[]
    mountToBody?: boolean
    disableAutoPositioning?: boolean
    popoverClassName?: string
    disableTriggerHover?: boolean
    errorState?: DropdownErrorState
    onSelect: (option: Option) => void
}

export type PureDropdownInstance<Option extends DropdownOption = DropdownOption> = {
    readonly dom: HTMLElement
    update(newSelectedValue: DropdownOption): void
    setOptions(options: {
        options: Option[]
        availableTags?: string[]
        selectedValue?: DropdownOption
    }): void
    rerender(): void
    destroy(): void
    setErrorState(errorState?: DropdownErrorState): void
}

class PureDropdown<Option extends DropdownOption> implements PureDropdownInstance<Option> {
    readonly dom: HTMLElement
    private readonly button: HTMLButtonElement
    private readonly dotsMenu: HTMLElement
    private readonly bodyContent: HTMLElement
    private readonly infoBubble: InfoBubbleInstance
    private readonly modalityFilterEnabled: boolean
    private availableTags: string[]
    private currentSelectedValue: DropdownOption
    private currentErrorState: DropdownErrorState | undefined
    private readonly activeFilterTags = new Set<string>()
    private allOptions: Option[]
    private selectedDisplaySignature = ''
    private readonly ignoreColorValuesForOptions: boolean
    private readonly ignoreColorValuesForSelectedValue: boolean
    private readonly renderIconForSelectedValue: boolean
    private readonly renderIconForOptions: boolean
    private readonly renderTitleForSelectedValue: boolean
    private readonly triggerContent: HTMLElement | undefined
    private readonly triggerLabel: string | undefined
    private readonly onSelect: (option: Option) => void

    constructor(config: PureDropdownConfig<Option>) {
        const {
            id,
            selectedValue,
            options,
            theme = 'dark',
            buttonIcon = chevronDownIcon,
            triggerContent,
            triggerLabel,
            ignoreColorValuesForOptions = false,
            ignoreColorValuesForSelectedValue = false,
            renderIconForSelectedValue = true,
            renderIconForOptions = true,
            renderTitleForSelectedValue = true,
            enableTagFilter = false,
            mountToBody = false,
            disableAutoPositioning = false,
            popoverClassName = '',
            disableTriggerHover = false,
            errorState,
            onSelect,
        } = config

        this.ignoreColorValuesForOptions = ignoreColorValuesForOptions
        this.ignoreColorValuesForSelectedValue = ignoreColorValuesForSelectedValue
        this.renderIconForSelectedValue = renderIconForSelectedValue
        this.renderIconForOptions = renderIconForOptions
        this.renderTitleForSelectedValue = renderTitleForSelectedValue
        this.triggerContent = triggerContent
        this.triggerLabel = triggerLabel
        this.onSelect = onSelect
        this.availableTags = config.availableTags || []
        this.currentSelectedValue = selectedValue
        this.currentErrorState = errorState
        this.allOptions = [...options]
        this.modalityFilterEnabled = Boolean(enableTagFilter && uiKitSettings.modelSelectorDropdown.useModalityFilter)
        // Build header content (if tag filter enabled)
        const headerContent = this.modalityFilterEnabled
            && this.availableTags.length > 0
            ? html`
                <div
                    class="tag-filter"
                    onmousedown=${this.preventProseMirrorEdit}
                >
                    <div class="tag-filter-title">Filter by modality:</div>
                    <div class="tag-filter-list">
                        ${
                            this.availableTags.map(
                                tag =>
                                    html`
                                        <span
                                            class="tag-filter-item"
                                            role="button"
                                            tabindex="0"
                                            data-tag="${tag}"
                                            onclick=${(e: Event) => this.handleTagFilterClick(e, tag)}
                                        >${tag}</span>
                                    `,
                            )
                        }
                    </div>
                </div>
            `
            : null

        // Build body content (dropdown items)
        this.bodyContent = html`
            <ul
                id=${`dropdown-menu-${id}`}
                class="submenu"
                role="menu"
                aria-label=${triggerLabel || 'Options'}
                onwheel=${this.handleWheel}
            ></ul>
        `

        // Build the trigger before creating its anchored popover.
        this.dom = html`
            <div
                class="dropdown-menu-tag-pill-wrapper theme-${theme}${disableTriggerHover ? ' no-trigger-hover' : ''}${this.triggerContent ? ' custom-trigger' : ''}"
                data-dropdown-id="${id}"
                data-arrow-side="top"
                data-side-panel-no-drag="true"
                contenteditable="false"
            >
                <span class="dots-dropdown-menu">
                    <button
                        type="button"
                        class="dropdown-trigger-button"
                        aria-label=${triggerLabel || selectedValue.title || 'Options'}
                        aria-haspopup="menu"
                        aria-controls=${`dropdown-menu-${id}`}
                        aria-expanded="false"
                        onmousedown=${this.preventProseMirrorEdit}
                        contenteditable="false"
                    >
                        <span class="selected-option-icon dropdown-trigger-selected-icon"></span>
                        <span class="title"></span>
                        <span
                            class="state-indicator dropdown-trigger-state-indicator"
                            innerHTML=${buttonIcon}
                        ></span>
                    </button>
                </span>
            </div>
        ` as HTMLElement
        this.button = this.dom.querySelector('button') as HTMLButtonElement
        this.dotsMenu = this.dom.querySelector('.dots-dropdown-menu') as HTMLElement

        if (this.triggerContent)
            this.button.replaceChildren(this.triggerContent, html`
                <span
                    class="title"
                    role="status"
                ></span>
            `)

        const positioningAnchor = this.triggerContent ? this.button : (this.dom.querySelector('.state-indicator') as HTMLElement)
        this.infoBubble = createInfoBubble({
            id: `dropdown-${id}`,
            anchor: this.button,
            positioningAnchor,
            theme,
            arrowSide: 'top',
            headerContent,
            bodyContent: this.bodyContent,
            visible: false,
            className: `dropdown-menu-popover${popoverClassName ? ` ${popoverClassName}` : ''}`,
            disableAutoPositioning,
            onOpen: () => {
                this.button.setAttribute('aria-expanded', 'true')
                this.dom.classList.add('dropdown-open')
                this.dotsMenu?.classList.add('is-active')
            },
            onClose: () => {
                this.button.setAttribute('aria-expanded', 'false')

                if (this.infoBubble?.dom.contains(document.activeElement))
                    this.button.focus()

                this.dom.classList.remove('dropdown-open')
                this.dotsMenu?.classList.remove('is-active')
            },
        })
        this.infoBubble.dom.setAttribute('data-side-panel-no-drag', 'true')

        // Apply theme shadow
        this.infoBubble.dom.style.setProperty('--dropdown-popover-box-shadow', uiKitSettings.dropdown.styles.popoverBoxShadow)

        // Append info bubble to dropdown or body
        if (mountToBody)
            document.body.appendChild(this.infoBubble.dom)
        else {
            const dropdownMenu = this.dom.querySelector<HTMLElement>('.dots-dropdown-menu')
            dropdownMenu?.appendChild(this.infoBubble.dom)
        }

        this.updateSelectedDisplay()
        this.renderOptionsList()
        this.button.addEventListener('keydown', this.handleKeyDown)
        this.bodyContent.addEventListener('keydown', this.handleKeyDown)
        document.addEventListener(
            'mousedown',
            this.handleDocumentMouseDown,
            true,
        )
    }
    // Prevent ProseMirror from handling mousedown on dropdown
    private preventProseMirrorEdit = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
    }

    // Handle option click
    private optionClickHandler = (
        e: Event,
        option: Option,
    ) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()

        // Update local state
        this.currentSelectedValue = option

        // Close before dispatching the selected action.
        this.infoBubble?.close()

        // Notify parent
        this.onSelect(option)

        // Update visual
        this.updateSelectedDisplay()
    }

    private handleDocumentMouseDown = (e: MouseEvent) => {
        if (!this.infoBubble?.isOpen?.())
            return

        const path = e.composedPath()

        if (
            path.includes(this.dom)
            || path.includes(this.infoBubble.dom)
        )
            return

        this.infoBubble.close()
    }

    // Filter options based on active tags
    private getFilteredOptions = () => {
        if (
            !this.modalityFilterEnabled
            || this.activeFilterTags.size === 0
        )
            return this.allOptions

        return this.allOptions.filter(option => {
            if (
                !option.tags
                || option.tags.length === 0
            )
                return false

            return Array.from(this.activeFilterTags).every(filterTag => option.tags.includes(filterTag))
        })
    }

    // Handle tag filter click
    private handleTagFilterClick = (
        e: Event,
        tag: string,
    ) => {
        if (!this.modalityFilterEnabled)
            return

        e.preventDefault()
        e.stopPropagation()

        // Visual click feedback
        const target = e.currentTarget as HTMLElement

        if (target) {
            target.classList.add('click-feedback')
            setTimeout(() => target.classList.remove('click-feedback'), 150)
        }

        if (this.activeFilterTags.has(tag))
            this.activeFilterTags.delete(tag)
        else
            this.activeFilterTags.add(tag)

        // Re-render options list
        this.renderOptionsList()

        // Update tag filter UI
        this.updateTagFilterUI()
    }

    // Render options list based on current filter (single source of truth)
    private renderOptionsList = () => {
        const submenuList = this.infoBubble?.dom.querySelector<HTMLElement>('.submenu')

        if (!submenuList)
            return

        const filteredOptions = this.getFilteredOptions()

        submenuList.innerHTML = ''
        filteredOptions.forEach(option => {
            const isSelected = option === this.currentSelectedValue
                || option.title === this.currentSelectedValue?.title

            const li = html`
                <li
                    class="dropdown-option-item"
                    role="menuitem"
                    tabindex="-1"
                    data-selected=${isSelected ? 'true' : 'false'}
                    onclick=${(e: Event) => this.optionClickHandler(e, option)}
                >
                    ${this.renderIconForOptions
                        && option.icon
                        ? html`
                            <span
                                class="dropdown-option-icon"
                                innerHTML=${this.ignoreColorValuesForOptions ? option.icon : injectFillColor(option.icon, option.color)}
                            ></span>
                        `
                        : ''}
                    ${option.title}
                </li>
            ` as HTMLElement
            submenuList.appendChild(li)
        })
    }

    // Update tag filter UI to show active state
    private updateTagFilterUI = () => {
        const tagFilterElements = this.infoBubble?.dom.querySelectorAll<HTMLElement>('.tag-filter-item')

        if (!tagFilterElements)
            return

        tagFilterElements.forEach(el => {
            const tag = el.getAttribute('data-tag')

            if (
                tag
                && this.activeFilterTags.has(tag)
            )
                el.classList.add('active')
            else
                el.classList.remove('active')
        })
    }

    // Only absorb wheel events when the dropdown can actually scroll in that direction.
    // At scroll boundaries or when content doesn't overflow, let the event propagate
    // so the canvas can pan normally. Always block browser zoom (pinch / ctrlKey).
    private handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault()

            return
        }

        const el = e.currentTarget as HTMLElement
        const hasOverflow = el.scrollHeight > el.clientHeight

        if (!hasOverflow)
            return

        const atTop = el.scrollTop <= 0
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight
        const scrollingDown = e.deltaY > 0
        const scrollingUp = e.deltaY < 0

        if (
            (scrollingDown && !atBottom)
            || (scrollingUp && !atTop)
        )
            e.stopPropagation()
    }

    // Update selected value display
    private updateSelectedDisplay = () => {
        const titleEl = this.dom.querySelector<HTMLElement>('.title')
        const iconWrap = this.dom.querySelector<HTMLElement>('.selected-option-icon')
        const activeErrorState = this.currentErrorState
            && this.currentErrorState.enabled !== false
            ? this.currentErrorState
            : null
        const nextTitle = activeErrorState
            ? activeErrorState.title || uiKitSettings.dropdown.errorState.fallbackTitle
            : this.renderTitleForSelectedValue
                && !this.triggerContent
                ? (this.currentSelectedValue?.title || '')
                : ''
        const nextTitleColor = activeErrorState
            ? activeErrorState.textColor || uiKitSettings.dropdown.errorState.textColor
            : ''
        const nextIcon = this.renderIconForSelectedValue
            && this.currentSelectedValue?.icon
            ? this.ignoreColorValuesForSelectedValue
                ? this.currentSelectedValue.icon
                : injectFillColor(this.currentSelectedValue.icon, this.currentSelectedValue.color)
            : ''
        const nextDisplaySignature = [
            Boolean(activeErrorState),
            nextTitle,
            nextTitleColor,
            nextIcon,
        ].join('\u0000')

        if (this.selectedDisplaySignature === nextDisplaySignature)
            return

        this.selectedDisplaySignature = nextDisplaySignature
        this.button.setAttribute('aria-label', this.triggerLabel || nextTitle || 'Options')

        this.dom.classList.toggle(
            'dropdown-error-state',
            Boolean(activeErrorState),
        )

        if (titleEl) {
            titleEl.textContent = nextTitle
            titleEl.style.color = nextTitleColor
        }

        if (iconWrap) {
            if (nextIcon) {
                iconWrap.innerHTML = ''
                iconWrap.appendChild(html`<span innerHTML=${nextIcon}></span>`)
            } else
                iconWrap.innerHTML = ''
        }
    }

    private handleKeyDown = (event: KeyboardEvent): void => {
        const fromTrigger = event.currentTarget === this.button
        const items = Array.from(
            this.bodyContent.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        )
        const currentIndex = items.indexOf(document.activeElement as HTMLElement)

        if (
            event.key === 'Escape'
            || event.key === 'Tab'
        ) {
            if (!this.infoBubble?.isOpen())
                return

            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
            }

            this.infoBubble.close()

            return
        }

        if (
            event.key === 'Enter'
            || event.key === ' '
        ) {
            event.preventDefault()
            event.stopPropagation()

            if (fromTrigger) {
                this.infoBubble?.open()
                items[0]?.focus()
            } else
                items[currentIndex]?.click()

            return
        }

        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
            return

        event.preventDefault()
        event.stopPropagation()
        this.infoBubble?.open()

        if (event.key === 'Home')
            items[0]?.focus()
        else if (
            event.key === 'End'
            || (fromTrigger && event.key === 'ArrowUp')
        )
            items.at(-1)?.focus()
        else {
            const direction = event.key === 'ArrowUp' ? -1 : 1
            items[(currentIndex + direction + items.length) % items.length]?.focus()
        }
    }

    update = (newSelectedValue: DropdownOption): void => {
        this.currentSelectedValue = newSelectedValue
        this.updateSelectedDisplay()
    }

    setOptions = ({
        options,
        availableTags,
        selectedValue,
    }: Parameters<PureDropdownInstance<Option>['setOptions']>[0]): void => {
        this.allOptions = [...options]

        if (availableTags)
            this.availableTags = [...availableTags]

        if (selectedValue)
            this.currentSelectedValue = selectedValue

        this.renderOptionsList()
        this.updateSelectedDisplay()
    }

    rerender = (): void => {
        this.renderOptionsList()
        this.updateSelectedDisplay()
    }

    destroy = (): void => {
        this.button.removeEventListener('keydown', this.handleKeyDown)
        this.bodyContent.removeEventListener('keydown', this.handleKeyDown)
        document.removeEventListener(
            'mousedown',
            this.handleDocumentMouseDown,
            true,
        )
        this.infoBubble.destroy()
    }

    setErrorState = (errorState?: DropdownErrorState): void => {
        this.currentErrorState = errorState
        this.updateSelectedDisplay()
    }
}

export const createPureDropdown = <Option extends DropdownOption>(config: PureDropdownConfig<Option>): PureDropdownInstance<Option> =>
    new PureDropdown(config)
