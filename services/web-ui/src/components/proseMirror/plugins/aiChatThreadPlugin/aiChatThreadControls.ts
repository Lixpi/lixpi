 import {
    sendIcon,
    pauseIcon,
    gptAvatarIcon,
    claudeIcon,
    chevronDownIcon,
    imageIcon
} from '$src/svgIcons/index.ts'

import { html } from '$src/utils/domTemplates.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { createPureDropdown } from '$src/components/proseMirror/plugins/primitives/dropdown/index.ts'

import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import { STOP_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import {
    dispatchSendAiChatFromUserInput,
    isThreadReceiving
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadSend.ts'
import {
    findThreadFromDescendantPos
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPositionUtils.ts'

type AiModelDropdownOption = {
    title: string
    icon: string
    color: string
    aiModel: string
    provider: string
    model: string
    tags: string[]
}

function getThreadInfo(view: EditorView, descendantPos: number): { threadPos: number; threadNode: ProseMirrorNode; threadId: string } | null {
    return findThreadFromDescendantPos(view.state, descendantPos)
}

export function createAiModelSelectorDropdown(view: EditorView, getPos: () => number | undefined, threadId: string) {
    const dropdownId = `ai-model-dropdown-${threadId}`

    const aiAvatarIcons: Record<string, string> = {
        gptAvatarIcon,
        claudeIcon,
    }

    let aiModelsData: any[] = aiModelsStore.getData()

    const getCurrentAiModel = (): string => {
        const inputPos = getPos()
        if (typeof inputPos !== 'number') return ''
        const threadInfo = getThreadInfo(view, inputPos)
        if (!threadInfo) return ''
        return threadInfo.threadNode.attrs?.aiModel || ''
    }

    const currentAiModel = getCurrentAiModel()

    const transformModelsToOptions = (models: any[]): AiModelDropdownOption[] => {
        return models.map((aiModel: any) => ({
            title: aiModel.shortTitle,
            icon: aiAvatarIcons[aiModel.iconName],
            color: aiModel.color,
            aiModel: `${aiModel.provider}:${aiModel.model}`,
            provider: aiModel.provider,
            model: aiModel.model,
            tags: aiModel.modalities?.map((m: any) => m.shortTitle) || []
        }))
    }

    const extractAvailableTags = (models: any[]) => {
        const allTags = new Set<string>()
        models.forEach(aiModel => {
            aiModel.modalities?.forEach((m: any) => allTags.add(m.shortTitle))
        })
        return Array.from(allTags).sort()
    }

    const buildDropdownData = (models: any[]) => ({
        options: transformModelsToOptions(models),
        tags: extractAvailableTags(models)
    })

    let { options: aiModelsSelectorDropdownOptions, tags: availableTags } = buildDropdownData(aiModelsData)

    const placeholderValue: AiModelDropdownOption = {
        title: 'Select Model',
        icon: '',
        color: '',
        aiModel: '',
        provider: '',
        model: '',
        tags: []
    }

    const selectedValue: AiModelDropdownOption =
        aiModelsSelectorDropdownOptions.find(model => model.aiModel === currentAiModel)
        || aiModelsSelectorDropdownOptions[0]
        || placeholderValue

    const dropdown = createPureDropdown({
        id: dropdownId,
        selectedValue,
        options: aiModelsSelectorDropdownOptions,
        theme: 'dark',

        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: false,
        renderIconForSelectedValue: false,
        renderIconForOptions: true,
        enableTagFilter: true,
        availableTags,
        onSelect: (option: any) => {
            const selected = option as AiModelDropdownOption
            const inputPos = getPos()
            if (typeof inputPos !== 'number') return

            const threadInfo = getThreadInfo(view, inputPos)
            if (!threadInfo) return

            const { threadPos, threadNode } = threadInfo
            const newAttrs = { ...threadNode.attrs, aiModel: selected.aiModel }
            const tr = view.state.tr.setNodeMarkup(threadPos, undefined, newAttrs)
            view.dispatch(tr)
        }
    })

    // If no model is set on the thread but we have options, auto-select the first one
    if (!currentAiModel && selectedValue.aiModel) {
        // Use setTimeout to avoid dispatching during view construction
        setTimeout(() => {
            const inputPos = getPos()
            if (typeof inputPos !== 'number') return

            const threadInfo = getThreadInfo(view, inputPos)
            if (!threadInfo) return

            const { threadPos, threadNode } = threadInfo
            // Double-check the model is still not set
            if (!threadNode.attrs.aiModel) {
                const tr = view.state.tr.setNodeMarkup(threadPos, undefined, {
                    ...threadNode.attrs,
                    aiModel: selectedValue.aiModel,
                })
                view.dispatch(tr)
            }
        }, 0)
    }

    let lastProcessedCount = aiModelsData.length
    const unsubscribe = aiModelsStore.subscribe((storeState: any) => {
        const newModelsData = storeState.data

        if (newModelsData.length === 0 || newModelsData.length === lastProcessedCount) return

        lastProcessedCount = newModelsData.length
        aiModelsData = newModelsData

        const { options, tags } = buildDropdownData(aiModelsData)

        dropdown.setOptions({
            options,
            availableTags: tags,
        })

        const inputPos = getPos()
        if (typeof inputPos !== 'number') return

        const threadInfo = getThreadInfo(view, inputPos)
        if (!threadInfo) return

        const { threadPos, threadNode } = threadInfo

        if (!threadNode.attrs.aiModel && options.length > 0) {
            const first = options[0]
            const tr = view.state.tr.setNodeMarkup(threadPos, undefined, {
                ...threadNode.attrs,
                aiModel: first.aiModel,
            })
            view.dispatch(tr)
            dropdown.update(first)
            return
        }

        const matchedSelectedValue = options.find((opt: any) => opt.aiModel === threadNode.attrs.aiModel)
        if (matchedSelectedValue) {
            dropdown.update(matchedSelectedValue)
        }
    })

    return { dropdown, unsubscribe }
}

export function createAiSubmitButton(view: EditorView, getPos: () => number | undefined) {
    const handleClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const inputPos = getPos()
        if (typeof inputPos !== 'number') return

        const threadInfo = getThreadInfo(view, inputPos)
        if (!threadInfo?.threadId) return

        if (isThreadReceiving(view, threadInfo.threadId)) {
            const tr = view.state.tr.setMeta(STOP_AI_CHAT_META, { threadId: threadInfo.threadId })
            view.dispatch(tr)
            return
        }

        dispatchSendAiChatFromUserInput(view, inputPos)
    }

    return html`
        <div
            className="ai-submit-button"
            onclick=${handleClick}
            style=${{ pointerEvents: 'auto', cursor: 'pointer' }}
        >
            <div className="button-default">
                <span className="send-icon" innerHTML=${sendIcon}></span>
            </div>
            <div className="button-hover">
                <span className="send-icon" innerHTML=${sendIcon}></span>
            </div>
            <div className="button-receiving">
                <span className="stop-icon" innerHTML=${pauseIcon}></span>
            </div>
        </div>
    `
}

export function createImageGenerationToggle(view: EditorView, getPos: () => number | undefined) {
    const IMAGE_SIZES = [
        { value: '1024x1024', label: '1:1' },
        { value: '1536x1024', label: '3:2' },
        { value: '1024x1536', label: '2:3' },
        { value: 'auto', label: 'Auto' }
    ]

    const container = document.createElement('div')
    container.className = 'image-generation-toggle'

    const toggleButton = document.createElement('button')
    toggleButton.className = 'image-toggle-btn'
    toggleButton.innerHTML = imageIcon

    const sizeSelector = document.createElement('select')
    sizeSelector.className = 'image-size-selector'
    IMAGE_SIZES.forEach(size => {
        const option = document.createElement('option')
        option.value = size.value
        option.textContent = size.label
        sizeSelector.appendChild(option)
    })

    const syncFromThread = () => {
        const inputPos = getPos()
        if (typeof inputPos !== 'number') return

        const threadInfo = getThreadInfo(view, inputPos)
        if (!threadInfo) return

        const { threadNode } = threadInfo
        const enabled = Boolean(threadNode.attrs.imageGenerationEnabled)
        const size = threadNode.attrs.imageGenerationSize || '1024x1024'

        container.setAttribute('data-enabled', String(enabled))
        toggleButton.title = enabled ? 'Image generation enabled' : 'Enable image generation'
        sizeSelector.value = size
    }

    toggleButton.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()

        const inputPos = getPos()
        if (typeof inputPos !== 'number') return

        const threadInfo = getThreadInfo(view, inputPos)
        if (!threadInfo) return

        const { threadPos, threadNode } = threadInfo

        const enabled = !Boolean(threadNode.attrs.imageGenerationEnabled)
        const tr = view.state.tr.setNodeMarkup(threadPos, undefined, {
            ...threadNode.attrs,
            imageGenerationEnabled: enabled,
        })
        view.dispatch(tr)

        syncFromThread()
    })

    sizeSelector.addEventListener('change', (e) => {
        e.preventDefault()
        e.stopPropagation()

        const inputPos = getPos()
        if (typeof inputPos !== 'number') return

        const threadInfo = getThreadInfo(view, inputPos)
        if (!threadInfo) return

        const { threadPos, threadNode } = threadInfo

        const newSize = (e.target as HTMLSelectElement).value
        const tr = view.state.tr.setNodeMarkup(threadPos, undefined, {
            ...threadNode.attrs,
            imageGenerationSize: newSize,
        })
        view.dispatch(tr)

        syncFromThread()
    })

    container.appendChild(toggleButton)
    container.appendChild(sizeSelector)

    syncFromThread()

    return {
        dom: container,
        update: () => syncFromThread(),
    }
}
