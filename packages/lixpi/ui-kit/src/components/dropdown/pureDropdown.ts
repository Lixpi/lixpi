import { html } from '../../dom/domTemplates.ts'
import { chevronDownIcon } from '../../svg/svgIcons.ts'
import { uiKitSettings } from '../../runtime-settings.ts'
import { createInfoBubble, type InfoBubbleInstance } from '../infoBubble/index.ts'

// Inject fill color utility (same as original dropdown)
function injectFillColor(svg: string, color?: string): string {
    if (!svg || !color) {
        return svg || ''
    }
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
    ignoreColorValuesForOptions?: boolean
    ignoreColorValuesForSelectedValue?: boolean
    renderIconForSelectedValue?: boolean
    renderIconForOptions?: boolean
    renderTitleForSelectedValue?: boolean
    enableTagFilter?: boolean
    availableTags?: string[]
    mountToBody?: boolean
    disableAutoPositioning?: boolean
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

export function createPureDropdown<Option extends DropdownOption>(
    config: PureDropdownConfig<Option>,
): PureDropdownInstance<Option> {
    const {
        id,
        selectedValue,
        options,
        theme = 'dark',
        buttonIcon = chevronDownIcon,
        ignoreColorValuesForOptions = false,
        ignoreColorValuesForSelectedValue = false,
        renderIconForSelectedValue = true,
        renderIconForOptions = true,
        renderTitleForSelectedValue = true,
        enableTagFilter = false,
        mountToBody = false,
        disableAutoPositioning = false,
        disableTriggerHover = false,
        errorState,
        onSelect
    } = config

    let availableTags = config.availableTags || []
    let currentSelectedValue: DropdownOption = selectedValue
    let currentErrorState: DropdownErrorState | undefined = errorState
    let activeFilterTags: Set<string> = new Set()
    let allOptions = [...options]
    let infoBubble: InfoBubbleInstance | null = null
    let selectedDisplaySignature = ''

    const modalityFilterEnabled = Boolean(
        enableTagFilter
        && uiKitSettings.modelSelectorDropdown.useModalityFilter
    )

    // Prevent ProseMirror from handling mousedown on dropdown
    const preventProseMirrorEdit = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
    }

    // Handle option click
    const optionClickHandler = (e: Event, option: Option) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()

        // Update local state
        currentSelectedValue = option

        // Close dropdown via infoBubble
        infoBubble?.close()

        // Notify parent
        onSelect(option)

        // Update visual
        updateSelectedDisplay()
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
        if (!infoBubble?.isOpen?.()) return

        const path = e.composedPath()
        if (path.includes(dom) || path.includes(infoBubble.dom)) return

        infoBubble.close()
    }

    // Filter options based on active tags
    const getFilteredOptions = () => {
        if (!modalityFilterEnabled || activeFilterTags.size === 0) {
            return allOptions
        }
        return allOptions.filter(option => {
            if (!option.tags || option.tags.length === 0) return false
            return Array.from(activeFilterTags).every(filterTag => option.tags.includes(filterTag))
        })
    }

    // Handle tag filter click
    const handleTagFilterClick = (e: Event, tag: string) => {
        if (!modalityFilterEnabled) return
        e.preventDefault()
        e.stopPropagation()

        // Visual click feedback
        const target = e.currentTarget as HTMLElement
        if (target) {
            target.classList.add('click-feedback')
            setTimeout(() => target.classList.remove('click-feedback'), 150)
        }

        if (activeFilterTags.has(tag)) {
            activeFilterTags.delete(tag)
        } else {
            activeFilterTags.add(tag)
        }

        // Re-render options list
        renderOptionsList()

        // Update tag filter UI
        updateTagFilterUI()
    }

    // Render options list based on current filter (single source of truth)
    const renderOptionsList = () => {
        const submenuList = infoBubble?.dom.querySelector<HTMLElement>('.submenu')
        if (!submenuList) return

        const filteredOptions = getFilteredOptions()

        submenuList.innerHTML = ''
        filteredOptions.forEach(option => {
            const isSelected =
                option === currentSelectedValue
                || option.title === currentSelectedValue?.title

            const li = html`
                <li
                    class="dropdown-option-item"
                    role="button"
                    tabindex="0"
                    data-selected=${isSelected ? 'true' : 'false'}
                    onclick=${(e: Event) => optionClickHandler(e, option)}
                >
                    ${renderIconForOptions && option.icon ? html`<span class="dropdown-option-icon" innerHTML=${ignoreColorValuesForOptions ? option.icon : injectFillColor(option.icon, option.color)}></span>` : ''}
                    ${option.title}
                </li>
            ` as HTMLElement
            submenuList.appendChild(li)
        })
    }

    // Update tag filter UI to show active state
    const updateTagFilterUI = () => {
        const tagFilterElements = infoBubble?.dom.querySelectorAll<HTMLElement>('.tag-filter-item')
        if (!tagFilterElements) return

        tagFilterElements.forEach(el => {
            const tag = el.getAttribute('data-tag')
            if (tag && activeFilterTags.has(tag)) {
                el.classList.add('active')
            } else {
                el.classList.remove('active')
            }
        })
    }

    // Build header content (if tag filter enabled)
    const headerContent = modalityFilterEnabled && availableTags.length > 0 ? html`
        <div class="tag-filter" onmousedown=${preventProseMirrorEdit}>
            <div class="tag-filter-title">Filter by modality:</div>
            <div class="tag-filter-list">
                ${availableTags.map(tag => html`
                    <span
                        class="tag-filter-item"
                        role="button"
                        tabindex="0"
                        data-tag="${tag}"
                        onclick=${(e: Event) => handleTagFilterClick(e, tag)}
                    >${tag}</span>
                `)}
            </div>
        </div>
    ` : null

    // Only absorb wheel events when the dropdown can actually scroll in that direction.
    // At scroll boundaries or when content doesn't overflow, let the event propagate
    // so the canvas can pan normally. Always block browser zoom (pinch / ctrlKey).
    const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault()
            return
        }

        const el = e.currentTarget as HTMLElement
        const hasOverflow = el.scrollHeight > el.clientHeight
        if (!hasOverflow) return

        const atTop = el.scrollTop <= 0
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight
        const scrollingDown = e.deltaY > 0
        const scrollingUp = e.deltaY < 0

        if ((scrollingDown && !atBottom) || (scrollingUp && !atTop)) {
            e.stopPropagation()
        }
    }

    // Build body content (dropdown items)
    const bodyContent = html`<ul class="submenu" onwheel=${handleWheel}></ul>`

    // Build dropdown wrapper with button first
    const dom = html`
        <div class="dropdown-menu-tag-pill-wrapper theme-${theme}${disableTriggerHover ? ' no-trigger-hover' : ''}" data-dropdown-id="${id}" data-arrow-side="top" data-side-panel-no-drag="true" contenteditable="false">
            <span class="dots-dropdown-menu">
                <button
                    class="dropdown-trigger-button"
                    onmousedown=${preventProseMirrorEdit}
                    contenteditable="false"
                >
                    <span class="selected-option-icon dropdown-trigger-selected-icon"></span>
                    <span class="title"></span>
                    <span class="state-indicator dropdown-trigger-state-indicator" innerHTML=${buttonIcon}></span>
                </button>
            </span>
        </div>
    ` as HTMLElement
    // Get button reference to use as anchor
    const button = dom.querySelector('button') as HTMLElement
    const dotsMenu = dom.querySelector('.dots-dropdown-menu') as HTMLElement

    // Create info bubble with button as anchor
    const positioningAnchor = dom.querySelector('.state-indicator') as HTMLElement
    infoBubble = createInfoBubble({
        id: `dropdown-${id}`,
        anchor: button,
        positioningAnchor,
        theme,
        arrowSide: 'top',
        headerContent,
        bodyContent,
        visible: false,
        className: 'dropdown-menu-popover',
        disableAutoPositioning,
        onOpen: () => {
            dom.classList.add('dropdown-open')
            dotsMenu?.classList.add('is-active')
        },
        onClose: () => {
            dom.classList.remove('dropdown-open')
            dotsMenu?.classList.remove('is-active')
        }
    })
    infoBubble.dom.setAttribute('data-side-panel-no-drag', 'true')

    // Apply theme shadow
    infoBubble.dom.style.setProperty('--dropdown-popover-box-shadow', uiKitSettings.dropdown.styles.popoverBoxShadow)

    // Append info bubble to dropdown or body
    if (mountToBody) {
        document.body.appendChild(infoBubble.dom)
    } else {
        const dropdownMenu = dom.querySelector<HTMLElement>('.dots-dropdown-menu')
        dropdownMenu?.appendChild(infoBubble.dom)
    }

    // Update selected value display
    const updateSelectedDisplay = () => {
        const titleEl = dom.querySelector<HTMLElement>('.title')
        const iconWrap = dom.querySelector<HTMLElement>('.selected-option-icon')
        const activeErrorState = currentErrorState && currentErrorState.enabled !== false
            ? currentErrorState
            : null
        const nextTitle = activeErrorState
            ? activeErrorState.title || uiKitSettings.dropdown.errorState.fallbackTitle
            : renderTitleForSelectedValue ? (currentSelectedValue?.title || '') : ''
        const nextTitleColor = activeErrorState
            ? activeErrorState.textColor || uiKitSettings.dropdown.errorState.textColor
            : ''
        const nextIcon = renderIconForSelectedValue && currentSelectedValue?.icon
            ? ignoreColorValuesForSelectedValue
                ? currentSelectedValue.icon
                : injectFillColor(currentSelectedValue.icon, currentSelectedValue.color)
            : ''
        const nextDisplaySignature = [
            Boolean(activeErrorState),
            nextTitle,
            nextTitleColor,
            nextIcon,
        ].join('\u0000')

        if (selectedDisplaySignature === nextDisplaySignature) return
        selectedDisplaySignature = nextDisplaySignature

        dom.classList.toggle('dropdown-error-state', Boolean(activeErrorState))

        if (titleEl) {
            titleEl.textContent = nextTitle
            titleEl.style.color = nextTitleColor
        }

        if (iconWrap) {
            if (nextIcon) {
                iconWrap.innerHTML = ''
                const span = document.createElement('span')
                span.innerHTML = nextIcon
                iconWrap.appendChild(span)
            } else {
                iconWrap.innerHTML = ''
            }
        }
    }

    // Initialize display
    updateSelectedDisplay()
    renderOptionsList()
    document.addEventListener('mousedown', handleDocumentMouseDown, true)

    return {
        dom,
        update: (newSelectedValue: DropdownOption) => {
            currentSelectedValue = newSelectedValue
            updateSelectedDisplay()
        },
        setOptions: ({ options: newOptions, availableTags: newTags, selectedValue: newSelectedValue }) => {
            allOptions = [...newOptions]

            if (newTags) {
                availableTags = [...newTags]
            }

            if (newSelectedValue) {
                currentSelectedValue = newSelectedValue
            }

            renderOptionsList()
            updateSelectedDisplay()
        },
        rerender: () => {
            renderOptionsList()
            updateSelectedDisplay()
        },
        destroy: () => {
            document.removeEventListener('mousedown', handleDocumentMouseDown, true)
            infoBubble?.destroy()
        },
        setErrorState: (newErrorState?: DropdownErrorState) => {
            currentErrorState = newErrorState
            updateSelectedDisplay()
        }
    }
}
