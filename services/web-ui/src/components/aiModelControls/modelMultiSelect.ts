import {
    chevronDownIcon,
    checkMarkIcon,
} from '@lixpi/ui-kit/svg'
import {
    createInfoBubble,
    type InfoBubbleInstance,
} from '@lixpi/ui-kit/components/info-bubble'
import { html } from '@lixpi/ui-primitives/dom'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { settings } from '$src/settings.ts'
import {
    transformModelsToOptions,
    type AiModelDropdownOption,
} from '$src/components/aiModelControls/aiModelControls.ts'

import type { DefaultAiModelCapability } from '@lixpi/constants'

export type AiModelMultiSelectControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
    getCurrentAiModels?: () => string[]
    setAiModels?: (aiModels: string[]) => void
}

export type ImageModelMultiSelectControls = {
    getCurrentImageModel: () => string
    setImageModel: (aiModel: string) => void
    getCurrentImageModels?: () => string[]
    setImageModels?: (aiModels: string[]) => void
}

export type VideoModelMultiSelectControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
    getCurrentVideoModels?: () => string[]
    setVideoModels?: (aiModels: string[]) => void
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
    emptySelectionErrorTitle: string
    requireSelection: boolean
    autoSelectFirst: boolean
    filterModels: (models: any[]) => any[]
    // Capability whose API-configured default model should be auto-selected
    // (instead of the first option) when nothing is selected yet.
    defaultCapability?: DefaultAiModelCapability
}

function modelHasGenerationModality(model: any, modality: 'image_generation' | 'video_generation'): boolean {
    return model.modalities?.some((mod: any) => (mod.modality || mod) === modality) ?? false
}

function filterReasoningModels(models: any[]): any[] {
    return models.filter((model: any) => !modelHasGenerationModality(model, 'image_generation') && !modelHasGenerationModality(model, 'video_generation'))
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

function adaptImageModelControls(controls: ImageModelMultiSelectControls): AiModelMultiSelectControls {
    const adaptedControls: AiModelMultiSelectControls = {
        getCurrentAiModel: controls.getCurrentImageModel,
        setAiModel: controls.setImageModel,
    }

    if (controls.getCurrentImageModels) adaptedControls.getCurrentAiModels = controls.getCurrentImageModels
    if (controls.setImageModels) adaptedControls.setAiModels = controls.setImageModels

    return adaptedControls
}

function adaptVideoModelControls(controls: VideoModelMultiSelectControls): AiModelMultiSelectControls {
    const adaptedControls: AiModelMultiSelectControls = {
        getCurrentAiModel: controls.getCurrentVideoModel,
        setAiModel: controls.setVideoModel,
    }

    if (controls.getCurrentVideoModels) adaptedControls.getCurrentAiModels = controls.getCurrentVideoModels
    if (controls.setVideoModels) adaptedControls.setAiModels = controls.setVideoModels

    return adaptedControls
}

class ModelMultiSelect implements ModelMultiSelectInstance {
    readonly dom: HTMLElement

    private readonly button: HTMLButtonElement
    private readonly titleEl: HTMLElement
    private readonly dotsMenu: HTMLElement
    private readonly optionsList: HTMLUListElement
    private readonly infoBubble: InfoBubbleInstance
    private readonly unsubscribe: () => void
    private readonly handleDocumentMouseDown: (event: MouseEvent) => void
    private options: AiModelDropdownOption[] = []
    private selectedModelIds: string[] = []
    private renderedOptionIds: string[] = []
    private renderedSelectionSignature = ''
    private renderedOptionSelectionSignature = ''

    constructor(private readonly config: ModelMultiSelectConfig) {
        this.options = this.buildOptions()
        this.selectedModelIds = this.getNormalizedControlSelection()
        this.dom = this.render()
        this.button = this.dom.querySelector('button') as HTMLButtonElement
        this.titleEl = this.dom.querySelector('.title') as HTMLElement
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
            className: 'dropdown-menu-popover ai-model-multi-select-popover ai-prompt-model-selector-popover',
            disableAutoPositioning: false,
            onOpen: () => {
                this.dom.classList.add('dropdown-open')
                this.dotsMenu.classList.add('is-active')
            },
            onClose: () => {
                this.dom.classList.remove('dropdown-open')
                this.dotsMenu.classList.remove('is-active')
            },
        })
        this.infoBubble.dom.style.setProperty('--dropdown-popover-box-shadow', settings.dropdown.styles.popoverBoxShadow)
        document.body.appendChild(this.infoBubble.dom)
        this.handleDocumentMouseDown = (event: MouseEvent): void => {
            if (!this.infoBubble.isOpen?.()) return

            const path = event.composedPath()
            if (path.includes(this.dom) || path.includes(this.infoBubble.dom)) return

            this.infoBubble.close()
        }

        this.renderSelection()
        this.renderOptions()
        document.addEventListener('mousedown', this.handleDocumentMouseDown, true)

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
                        className="dropdown-trigger-button"
                        onmousedown=${this.preventProseMirrorEdit}
                        contenteditable="false"
                    >
                        <span className="title"></span>
                        <span className="state-indicator dropdown-trigger-state-indicator" innerHTML=${chevronDownIcon}></span>
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

    // The option to auto-select when nothing is selected. The API owns the
    // default model per capability; the UI only renders it (no UI-side fallback).
    // When no capability is configured, the first option is used as before.
    private getAutoSelectOption(): AiModelDropdownOption | undefined {
        if (this.config.defaultCapability) {
            const defaultModelId = aiModelsStore.getDefaultModelId(this.config.defaultCapability)
            return this.options.find((option) => option.aiModel === defaultModelId)
        }
        return this.options[0]
    }

    private getControlSelection(): string[] {
        const multiSelection = this.config.controls.getCurrentAiModels?.()
        if (multiSelection) return uniqueModelIds(multiSelection)

        const scalarSelection = this.config.controls.getCurrentAiModel()
        return scalarSelection ? [scalarSelection] : []
    }

    private getNormalizedControlSelection(): string[] {
        const controlSelection = this.getControlSelection()
        if (this.options.length === 0) return controlSelection

        const availableModelIds = new Set(this.options.map((option) => option.aiModel))
        return controlSelection.filter((modelId) => availableModelIds.has(modelId))
    }

    private writeSelection(modelIds: string[]): void {
        this.config.controls.setAiModels?.(modelIds)
        if (!this.config.controls.setAiModels) {
            this.config.controls.setAiModel(modelIds[0] ?? '')
        }
    }

    private syncSelection(commitChanges: boolean): void {
        if (this.options.length === 0) {
            this.selectedModelIds = this.getControlSelection()
            this.renderSelection()
            this.renderOptions()
            return
        }

        const controlSelection = this.getNormalizedControlSelection()
        const autoSelectOption = this.getAutoSelectOption()
        const shouldAutoSelectFirst = commitChanges && this.config.requireSelection && autoSelectOption
        const nextSelection = controlSelection.length > 0
            ? controlSelection
            : shouldAutoSelectFirst
            ? [autoSelectOption.aiModel]
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

        const showEmptySelectionError = this.options.length > 0 && selectedOptions.length === 0
        const nextTitle = showEmptySelectionError
            ? this.config.emptySelectionErrorTitle || settings.dropdown.errorState.fallbackTitle
            : selectedOptions.length === 0
            ? this.config.placeholderTitle
            : `${selectedOptions.length} ${selectedOptions.length === 1 ? 'model' : 'models'}`
        const nextColor = showEmptySelectionError ? settings.dropdown.errorState.textColor : ''
        const nextSelectionSignature = [
            showEmptySelectionError,
            nextTitle,
            nextColor,
        ].join('\u0000')

        if (this.renderedSelectionSignature === nextSelectionSignature) return
        this.renderedSelectionSignature = nextSelectionSignature

        this.dom.classList.toggle('dropdown-error-state', showEmptySelectionError)
        this.titleEl.textContent = nextTitle
        this.titleEl.style.color = nextColor
    }

    private renderOptions(): void {
        const selectedModelIds = new Set(this.selectedModelIds)
        const optionIds = this.options.map((option) => option.aiModel)
        const optionItemsMatch = sameModelIds(this.renderedOptionIds, optionIds)

        if (optionItemsMatch) {
            this.updateRenderedOptionSelection(selectedModelIds)
            return
        }

        const optionItems = this.options.map((option) => {
            const isSelected = selectedModelIds.has(option.aiModel)
            const handleClick = (event: MouseEvent): void => {
                event.preventDefault()
                event.stopPropagation()
                this.toggleModel(option)
            }

            return html`
                <li
                    className="dropdown-option-item ai-model-multi-select-option"
                    role="button"
                    tabindex="0"
                    data-selected=${isSelected ? 'true' : 'false'}
                    data-model-id=${option.aiModel}
                    onclick=${handleClick}
                >
                    ${option.icon ? html`<span className="dropdown-option-icon ai-model-multi-select-icon" innerHTML=${option.icon}></span>` : null}
                    <span className="ai-model-multi-select-title">${option.title}</span>
                    <span className="dropdown-option-icon ai-model-multi-select-check" innerHTML=${isSelected ? checkMarkIcon : ''}></span>
                </li>
            ` as HTMLLIElement
        })

        this.optionsList.replaceChildren(...optionItems)
        this.renderedOptionIds = optionIds
        this.renderedOptionSelectionSignature = this.getOptionSelectionSignature(selectedModelIds)
    }

    private updateRenderedOptionSelection(selectedModelIds: Set<string>): void {
        const nextSelectionSignature = this.getOptionSelectionSignature(selectedModelIds)
        if (this.renderedOptionSelectionSignature === nextSelectionSignature) return
        this.renderedOptionSelectionSignature = nextSelectionSignature

        const optionItems = Array.from(this.optionsList.children) as HTMLLIElement[]
        for (const [index, option] of this.options.entries()) {
            const optionItem = optionItems[index]
            if (!optionItem) continue

            const isSelected = selectedModelIds.has(option.aiModel)
            const nextSelected = isSelected ? 'true' : 'false'
            if (optionItem.dataset.selected !== nextSelected) {
                optionItem.dataset.selected = nextSelected
            }

            const checkEl = optionItem.querySelector('.ai-model-multi-select-check') as HTMLElement | null
            const nextCheckIcon = isSelected ? checkMarkIcon : ''
            if (checkEl && checkEl.innerHTML !== nextCheckIcon) {
                checkEl.innerHTML = nextCheckIcon
            }
        }
    }

    private getOptionSelectionSignature(selectedModelIds: Set<string>): string {
        return this.options
            .map((option) => selectedModelIds.has(option.aiModel) ? '1' : '0')
            .join('')
    }

    update(): void {
        // A restored/remote prompt document can replace attrs after the control
        // first mounts. Required selectors must re-commit the API-owned default
        // instead of leaving the visible control and submitted attrs divergent.
        this.syncSelection(true)
    }

    destroy(): void {
        document.removeEventListener('mousedown', this.handleDocumentMouseDown, true)
        this.unsubscribe()
        this.infoBubble.destroy()
    }
}

export function createGenericAiModelMultiSelect(
    controls: AiModelMultiSelectControls,
    dropdownId: string,
): ModelMultiSelectInstance {
    return new ModelMultiSelect({
        id: dropdownId,
        controls,
        placeholderTitle: 'Select models',
        emptySelectionErrorTitle: 'Select at least 1 model',
        requireSelection: true,
        autoSelectFirst: true,
        filterModels: filterReasoningModels,
        defaultCapability: 'reasoning',
    })
}

export function createGenericImageModelMultiSelect(
    controls: ImageModelMultiSelectControls,
    dropdownId: string,
): ModelMultiSelectInstance {
    return new ModelMultiSelect({
        id: dropdownId,
        controls: adaptImageModelControls(controls),
        placeholderTitle: 'Image models',
        emptySelectionErrorTitle: 'Select at least 1 model',
        requireSelection: true,
        autoSelectFirst: true,
        filterModels: filterImageModels,
        defaultCapability: 'image',
    })
}

export function createGenericVideoModelMultiSelect(
    controls: VideoModelMultiSelectControls,
    dropdownId: string,
): ModelMultiSelectInstance {
    return new ModelMultiSelect({
        id: dropdownId,
        controls: adaptVideoModelControls(controls),
        placeholderTitle: 'Video models',
        emptySelectionErrorTitle: 'Select at least 1 model',
        requireSelection: true,
        autoSelectFirst: true,
        filterModels: filterVideoModels,
        defaultCapability: 'video',
    })
}
