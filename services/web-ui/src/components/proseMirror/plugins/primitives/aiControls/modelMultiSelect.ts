import { chevronDownIcon, checkMarkIcon } from '$src/svgIcons/index.ts'
import { createInfoBubble, type InfoBubbleInstance } from '$src/components/infoBubble/index.ts'
import { html } from '$src/utils/domTemplates.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { settings } from '$src/settings.ts'
import {
    transformModelsToOptions,
    type AiModelDropdownOption,
} from '$src/components/proseMirror/plugins/primitives/aiControls/aiControls.ts'

export type AiModelMultiSelectControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
    getCurrentAiModels?: () => string[]
    setAiModels?: (aiModels: string[]) => void
}

type ModelMultiSelectInstance = {
    dom: HTMLElement
    destroy: () => void
    update: () => void
}

type ModelMultiSelectConfig = {
    id: string
    controls: AiModelMultiSelectControls
    placeholderTitle: string
    requireSelection: boolean
    autoSelectFirst: boolean
    filterModels: (models: any[]) => any[]
}

function modelHasGenerationModality(model: any, modality: 'image_generation' | 'video_generation'): boolean {
    return model.modalities?.some((mod: any) => (mod.modality || mod) === modality) ?? false
}

function filterReasoningModels(models: any[]): any[] {
    return models.filter((model: any) =>
        !modelHasGenerationModality(model, 'image_generation') && !modelHasGenerationModality(model, 'video_generation')
    )
}

function filterImageModels(models: any[]): any[] {
    return models.filter((model: any) => modelHasGenerationModality(model, 'image_generation'))
}

function filterVideoModels(models: any[]): any[] {
    return models.filter((model: any) => modelHasGenerationModality(model, 'video_generation'))
}

function uniqueModelIds(modelIds: string[]): string[] {
    return Array.from(new Set(modelIds.filter((modelId) => modelId.trim().length > 0)))
}

function sameModelIds(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    return a.every((modelId, index) => modelId === b[index])
}

class ModelMultiSelect implements ModelMultiSelectInstance {
    readonly dom: HTMLElement

    private readonly button: HTMLButtonElement
    private readonly titleEl: HTMLElement
    private readonly iconEl: HTMLElement
    private readonly dotsMenu: HTMLElement
    private readonly optionsList: HTMLUListElement
    private readonly infoBubble: InfoBubbleInstance
    private readonly unsubscribe: () => void
    private options: AiModelDropdownOption[] = []
    private selectedModelIds: string[] = []

    constructor(private readonly config: ModelMultiSelectConfig) {
        this.options = this.buildOptions()
        this.selectedModelIds = this.getNormalizedControlSelection()
        this.dom = this.render()
        this.button = this.dom.querySelector('button') as HTMLButtonElement
        this.titleEl = this.dom.querySelector('.title') as HTMLElement
        this.iconEl = this.dom.querySelector('.selected-option-icon') as HTMLElement
        this.dotsMenu = this.dom.querySelector('.dots-dropdown-menu') as HTMLElement
        this.optionsList = html`<ul className="submenu ai-model-multi-select-list" onwheel=${this.handleWheel}></ul>` as HTMLUListElement

        this.infoBubble = createInfoBubble({
            id: `model-multi-select-${config.id}`,
            anchor: this.button,
            positioningAnchor: this.dom.querySelector('.state-indicator') as HTMLElement,
            theme: 'dark',
            arrowSide: 'top',
            bodyContent: this.optionsList,
            visible: false,
            className: 'dropdown-menu-popover ai-model-multi-select-popover',
            disableAutoPositioning: true,
            onOpen: () => {
                this.dom.classList.add('dropdown-open')
                this.dotsMenu.classList.add('is-active')
            },
            onClose: () => {
                this.dom.classList.remove('dropdown-open')
                this.dotsMenu.classList.remove('is-active')
            },
        })
        this.infoBubble.dom.style.setProperty('--dropdown-popover-box-shadow', settings.dropdown.popoverBoxShadow)
        this.dotsMenu.appendChild(this.infoBubble.dom)

        this.renderSelection()
        this.renderOptions()

        let receivedInitialStoreValue = false
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            this.options = transformModelsToOptions(this.config.filterModels(storeState.data))
            this.syncSelection(receivedInitialStoreValue)
            receivedInitialStoreValue = true
        })

        if (this.config.autoSelectFirst) {
            setTimeout(() => this.syncSelection(true), 0)
        }
    }

    private buildOptions(): AiModelDropdownOption[] {
        return transformModelsToOptions(this.config.filterModels(aiModelsStore.getData()))
    }

    private render(): HTMLElement {
        return html`
            <div className="dropdown-menu-tag-pill-wrapper theme-dark ai-model-multi-select" data-dropdown-id=${this.config.id} data-arrow-side="top" contenteditable="false">
                <span className="dots-dropdown-menu">
                    <button
                        type="button"
                        className="flex justify-between items-center"
                        onmousedown=${this.preventProseMirrorEdit}
                        contenteditable="false"
                    >
                        <span className="selected-option-icon flex items-center"></span>
                        <span className="title"></span>
                        <span className="state-indicator flex items-center" innerHTML=${chevronDownIcon}></span>
                    </button>
                </span>
            </div>
        ` as HTMLElement
    }

    private preventProseMirrorEdit = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
    }

    private handleWheel = (event: WheelEvent): void => {
        if (event.ctrlKey) {
            event.preventDefault()
            return
        }

        const listEl = event.currentTarget as HTMLElement
        const hasOverflow = listEl.scrollHeight > listEl.clientHeight
        if (!hasOverflow) return

        const atTop = listEl.scrollTop <= 0
        const atBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight
        const scrollingDown = event.deltaY > 0
        const scrollingUp = event.deltaY < 0

        if ((scrollingDown && !atBottom) || (scrollingUp && !atTop)) {
            event.stopPropagation()
        }
    }

    private getControlSelection(): string[] {
        const multiSelection = this.config.controls.getCurrentAiModels?.() ?? []
        if (multiSelection.length > 0) return uniqueModelIds(multiSelection)

        const scalarSelection = this.config.controls.getCurrentAiModel()
        return scalarSelection ? [scalarSelection] : []
    }

    private getNormalizedControlSelection(): string[] {
        const availableModelIds = new Set(this.options.map((option) => option.aiModel))
        return this.getControlSelection().filter((modelId) => availableModelIds.has(modelId))
    }

    private writeSelection(modelIds: string[]): void {
        this.config.controls.setAiModels?.(modelIds)
        if (!this.config.controls.setAiModels) {
            this.config.controls.setAiModel(modelIds[0] ?? '')
        }
    }

    private syncSelection(commitChanges: boolean): void {
        const controlSelection = this.getNormalizedControlSelection()
        const nextSelection = controlSelection.length > 0
            ? controlSelection
            : this.config.requireSelection && this.options[0]
                ? [this.options[0].aiModel]
                : []

        const changed = !sameModelIds(this.getControlSelection(), nextSelection)
        this.selectedModelIds = nextSelection

        if (commitChanges && changed) {
            this.writeSelection(nextSelection)
        }

        this.renderSelection()
        this.renderOptions()
    }

    private toggleModel(option: AiModelDropdownOption): void {
        const isSelected = this.selectedModelIds.includes(option.aiModel)
        if (isSelected && this.config.requireSelection && this.selectedModelIds.length === 1) return

        const nextSelection = isSelected
            ? this.selectedModelIds.filter((modelId) => modelId !== option.aiModel)
            : [...this.selectedModelIds, option.aiModel]

        this.selectedModelIds = nextSelection
        this.writeSelection(nextSelection)
        this.renderSelection()
        this.renderOptions()
    }

    private renderSelection(): void {
        const selectedOptions = this.selectedModelIds
            .map((modelId) => this.options.find((option) => option.aiModel === modelId))
            .filter((option): option is AiModelDropdownOption => Boolean(option))

        const firstSelected = selectedOptions[0]
        this.titleEl.textContent = selectedOptions.length === 0
            ? this.config.placeholderTitle
            : selectedOptions.length === 1
                ? firstSelected.title
                : `${selectedOptions.length} models`

        this.iconEl.innerHTML = firstSelected?.icon ?? ''
    }

    private renderOptions(): void {
        const selectedModelIds = new Set(this.selectedModelIds)
        const optionItems = this.options.map((option) => {
            const isSelected = selectedModelIds.has(option.aiModel)
            const handleClick = (event: MouseEvent): void => {
                event.preventDefault()
                event.stopPropagation()
                this.toggleModel(option)
            }

            return html`
                <li
                    className="ai-model-multi-select-option flex justify-start items-center"
                    data-selected=${isSelected ? 'true' : 'false'}
                    onclick=${handleClick}
                >
                    <span className="ai-model-multi-select-check" innerHTML=${isSelected ? checkMarkIcon : ''}></span>
                    ${option.icon ? html`<span className="ai-model-multi-select-icon" innerHTML=${option.icon}></span>` : null}
                    <span className="ai-model-multi-select-title">${option.title}</span>
                </li>
            ` as HTMLLIElement
        })

        this.optionsList.replaceChildren(...optionItems)
    }

    update(): void {
        this.syncSelection(false)
    }

    destroy(): void {
        this.unsubscribe()
        this.infoBubble.destroy()
    }
}

export function createGenericAiModelMultiSelect(
    controls: AiModelMultiSelectControls,
    dropdownId: string
): ModelMultiSelectInstance {
    return new ModelMultiSelect({
        id: dropdownId,
        controls,
        placeholderTitle: 'Select models',
        requireSelection: true,
        autoSelectFirst: true,
        filterModels: filterReasoningModels,
    })
}

export function createGenericImageModelMultiSelect(
    controls: AiModelMultiSelectControls,
    dropdownId: string
): ModelMultiSelectInstance {
    return new ModelMultiSelect({
        id: dropdownId,
        controls,
        placeholderTitle: 'Image models',
        requireSelection: true,
        autoSelectFirst: true,
        filterModels: filterImageModels,
    })
}

export function createGenericVideoModelMultiSelect(
    controls: AiModelMultiSelectControls,
    dropdownId: string
): ModelMultiSelectInstance {
    return new ModelMultiSelect({
        id: dropdownId,
        controls,
        placeholderTitle: 'Video models',
        requireSelection: false,
        autoSelectFirst: false,
        filterModels: filterVideoModels,
    })
}
