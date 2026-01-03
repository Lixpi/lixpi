// @ts-nocheck
import { html } from '$src/utils/domTemplates.ts'
import { chevronDownIcon } from '$src/svgIcons/index.ts'
import { createInfoBubble } from '../infoBubble/pureInfoBubble.ts'

// Inject fill color utility (same as original dropdown)
function injectFillColor(svg: string, color: string): string {
    if (!svg || !color) {
        return svg || ''
    }
    return svg.replace(/<svg([\s\S]*?)>/, `<svg$1 style="fill: ${color}">`)
}

type DropdownOption = {
    title: string
    icon?: string
    color?: string
    tags?: string[]
    [key: string]: any
}

type PureDropdownConfig = {
    id: string
    selectedValue: DropdownOption
    options: DropdownOption[]
    theme?: string
    buttonIcon?: string
    ignoreColorValuesForOptions?: boolean
    ignoreColorValuesForSelectedValue?: boolean
    renderIconForSelectedValue?: boolean
    renderIconForOptions?: boolean
    renderTitleForSelectedValue?: boolean
    enableTagFilter?: boolean
    availableTags?: string[]
    onSelect: (option: DropdownOption) => void
}

export function createPureDropdown(config: PureDropdownConfig) {
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
        onSelect
    } = config

    let availableTags = config.availableTags || []
    let currentSelectedValue = selectedValue
    let activeFilterTags: Set<string> = new Set()
    let allOptions = [...options]
    let infoBubble: any = null // Will be initialized after button is created

    // Prevent ProseMirror from handling mousedown on dropdown
    const preventProseMirrorEdit = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
    }

    // Handle option click
    const optionClickHandler = (e: Event, option: DropdownOption) => {
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

    // Filter options based on active tags
    const getFilteredOptions = () => {
        if (!enableTagFilter || activeFilterTags.size === 0) {
            return allOptions
        }
        return allOptions.filter(option => {
            if (!option.tags || option.tags.length === 0) return false
            return Array.from(activeFilterTags).every(filterTag => option.tags.includes(filterTag))
        })
    }

    // Handle tag filter click
    const handleTagFilterClick = (e: Event, tag: string) => {
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
        const submenuList = dom.querySelector('.submenu')
        if (!submenuList) return

        const filteredOptions = getFilteredOptions()

        submenuList.innerHTML = ''
        filteredOptions.forEach(option => {
            const li = html`
                <li
                    class="flex justify-start items-center"
                    onclick=${(e: Event) => optionClickHandler(e, option)}
                >
                    ${renderIconForOptions && option.icon ? html`<span innerHTML=${ignoreColorValuesForOptions ? option.icon : injectFillColor(option.icon, option.color)}></span>` : ''}
                    ${option.title}
                </li>
            ` as HTMLElement
            submenuList.appendChild(li)
        })
    }

    // Update tag filter UI to show active state
    const updateTagFilterUI = () => {
        const tagFilterElements = dom.querySelectorAll('.tag-filter-item')
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
    const headerContent = enableTagFilter && availableTags.length > 0 ? html`
        <div class="tag-filter" onmousedown=${preventProseMirrorEdit}>
            <div class="tag-filter-title">Filter by modality:</div>
            <div class="tag-filter-list">
                ${availableTags.map(tag => html`
                    <span
                        class="tag-filter-item"
                        data-tag="${tag}"
                        onclick=${(e: Event) => handleTagFilterClick(e, tag)}
                    >${tag}</span>
                `)}
            </div>
        </div>
    ` : null

    // Build body content (dropdown items)
    const bodyContent = html`<ul class="submenu"></ul>`

    // Build dropdown wrapper with button first
    const dom = html`
        <div class="dropdown-menu-tag-pill-wrapper theme-${theme}" data-dropdown-id="${id}" data-arrow-side="top" contenteditable="false">
            <span class="dots-dropdown-menu">
                <button
                    class="flex justify-between items-center"
                    onmousedown=${preventProseMirrorEdit}
                    contenteditable="false"
                >
                    <span class="selected-option-icon flex items-center"></span>
                    <span class="title"></span>
                    <span class="state-indicator flex items-center" innerHTML=${buttonIcon}></span>
                </button>
            </span>
        </div>
    ` as HTMLElement

    // Get button reference to use as anchor
    const button = dom.querySelector('button') as HTMLElement

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
        onOpen: () => {
            dom.classList.add('dropdown-open')
        },
        onClose: () => {
            dom.classList.remove('dropdown-open')
        }
    })

    // Append info bubble to dropdown
    const dropdownMenu = dom.querySelector('.dots-dropdown-menu')
    dropdownMenu.appendChild(infoBubble.dom)

    // Update selected value display
    const updateSelectedDisplay = () => {
        const titleEl = dom.querySelector('.title')
        const iconWrap = dom.querySelector('.selected-option-icon')

        if (titleEl) {
            titleEl.textContent = renderTitleForSelectedValue ? (currentSelectedValue?.title || '') : ''
        }

        if (iconWrap) {
            if (renderIconForSelectedValue && currentSelectedValue?.icon) {
                iconWrap.innerHTML = ''
                const span = document.createElement('span')
                span.innerHTML = ignoreColorValuesForSelectedValue
                    ? currentSelectedValue.icon
                    : injectFillColor(currentSelectedValue.icon, currentSelectedValue.color)
                iconWrap.appendChild(span)
            } else {
                iconWrap.innerHTML = ''
            }
        }
    }

    // Initialize display
    updateSelectedDisplay()
    renderOptionsList()

    return {
        dom,
        update: (newSelectedValue: DropdownOption) => {
            currentSelectedValue = newSelectedValue
            updateSelectedDisplay()
        },
        setOptions: ({ options: newOptions, availableTags: newTags, selectedValue: newSelectedValue }: { options: DropdownOption[]; availableTags?: string[]; selectedValue?: DropdownOption }) => {
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
            infoBubble?.destroy()
        }
    }
}
