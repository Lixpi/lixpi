import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { html } from '$src/utils/domTemplates.ts'
import { BubbleMenu, type BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'
import { createToggleSwitch } from '$src/components/toggleSwitch/index.ts'
import { createTagPill, type TagPillInstance } from '$src/components/tagPill/index.ts'
import { atomIcon } from '$src/svgIcons/index.ts'
import { settings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    applyAiModelMenuStyleSettings,
    createAiModelMenuContent,
    createMediaGenerationConfigMatrixView,
    transformModelsToOptions,
    type AiModelDropdownOption,
    type AiModelMenuContentView,
} from '$src/components/aiModelControls/index.ts'
import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'
import {
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    normalizeAiModelSelectionAttr,
    normalizeMediaGenerationConfigSelectionAttr,
    parseAiModelSelectionAttr,
    parseBooleanAttr,
    parseMediaGenerationConfigSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror'

export {
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    normalizeAiModelSelectionAttr,
    normalizeMediaGenerationConfigSelectionAttr,
    parseAiModelSelectionAttr,
    parseBooleanAttr,
    parseMediaGenerationConfigSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
}

type AiModelControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
    getCurrentAiModels?: () => string[]
    setAiModels?: (aiModels: string[]) => void
}

type MultipleModelModeControls = {
    getUseMultipleModels: () => boolean
    setUseMultipleModels: (useMultipleModels: boolean) => void
}

type SelectedModelTagsControls = {
    getUseMultipleModels: () => boolean
    getSelectedModelIds: () => string[]
    setSelectedModelIds: (modelIds: string[]) => void
}

type SubmitControls = {
    onSubmit: () => void
}

type ImageSizeControls = {
    getImageGenerationSize: () => string
    setImageGenerationSize: (size: string) => void
    getProvider?: () => string
    getCurrentImageModel?: () => string
}

type ImageModelControls = {
    getCurrentImageModel: () => string
    setImageModel: (aiModel: string) => void
    getCurrentImageModels?: () => string[]
    setImageModels?: (aiModels: string[]) => void
}

type VideoModelControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
    getCurrentVideoModels?: () => string[]
    setVideoModels?: (aiModels: string[]) => void
}

type VideoOptionControls = {
    getValue: () => string
    setValue: (value: string) => void
    getCurrentVideoModel?: () => string
}

type DropdownView = {
    dom: HTMLElement
    destroy?: () => void
    update: () => void
    getControlLabel?: () => string
}

type AiPromptInputNodeViewOptions = {
    onSubmit: () => void
    placeholderText?: string
    createContextTray?: () => HTMLElement | null
    createModelDropdown: (controls: AiModelControls, dropdownId: string) => DropdownView
    createModelMultiSelect?: (controls: AiModelControls, dropdownId: string) => DropdownView
    createImageModelDropdown: (controls: ImageModelControls, dropdownId: string) => DropdownView
    createImageModelMultiSelect?: (controls: ImageModelControls, dropdownId: string) => DropdownView
    createImageSizeDropdown: (controls: ImageSizeControls, dropdownId: string) => DropdownView
    createVideoModelDropdown: (controls: VideoModelControls, dropdownId: string) => DropdownView
    createVideoModelMultiSelect?: (controls: VideoModelControls, dropdownId: string) => DropdownView
    createVideoAspectDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createVideoResolutionDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createVideoDurationDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createSubmitButton: (controls: SubmitControls) => HTMLElement
}

const modelMenuToggleDimensions = {
    width: 30,
    height: 18,
    svgWidth: 34,
    svgHeight: 22,
}

function uniqueNonEmptyValues(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function setNodeAttrs(view: EditorView, getPos: () => number | undefined, attrs: Record<string, unknown>): void {
    const pos = getNodeViewPos(getPos)
    if (pos === undefined) return
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== aiPromptInputNodeType) return

    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        ...attrs,
    })
    view.dispatch(tr)
}

function getNodeAttr(view: EditorView, getPos: () => number | undefined, attrName: string): any {
    const pos = getNodeViewPos(getPos)
    if (pos === undefined) return undefined
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== aiPromptInputNodeType) return undefined
    return node.attrs?.[attrName]
}

function getNodeViewPos(getPos: () => number | undefined): number | undefined {
    try {
        return getPos()
    } catch {
        return undefined
    }
}

function createModelMenuTrigger(onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const handleMouseDown = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
    }

    return html`
        <button
            type="button"
            className="ai-prompt-model-menu-trigger"
            title="Model settings"
            aria-label="Model settings"
            aria-expanded="false"
            contenteditable="false"
            onmousedown=${handleMouseDown}
            onclick=${onClick}
        >
            <span className="ai-prompt-model-menu-trigger-icon" innerHTML=${atomIcon}></span>
        </button>
    ` as HTMLButtonElement
}

class ModeAwareModelSelector implements DropdownView {
    readonly dom: HTMLElement

    private activeDropdown: DropdownView | null = null
    private activeMultipleMode: boolean | null = null

    constructor(
        private readonly controls: MultipleModelModeControls,
        private readonly createSingleDropdown: () => DropdownView,
        private readonly createMultiDropdown: () => DropdownView
    ) {
        this.dom = html`<span className="ai-prompt-model-selector-host" contenteditable="false"></span>` as HTMLElement
        this.mountDropdown()
    }

    private mountDropdown(): void {
        const useMultipleModels = this.controls.getUseMultipleModels()
        this.activeDropdown?.destroy?.()
        this.activeDropdown = useMultipleModels
            ? this.createMultiDropdown()
            : this.createSingleDropdown()
        this.activeMultipleMode = useMultipleModels
        this.dom.replaceChildren(this.activeDropdown.dom)
    }

    update(): void {
        if (this.activeMultipleMode !== this.controls.getUseMultipleModels()) {
            this.mountDropdown()
            return
        }

        this.activeDropdown?.update()
    }

    destroy(): void {
        this.activeDropdown?.destroy?.()
    }
}

function createModeAwareModelSelector(
    controls: MultipleModelModeControls,
    createSingleDropdown: () => DropdownView,
    createMultiDropdown: () => DropdownView
): DropdownView {
    return new ModeAwareModelSelector(controls, createSingleDropdown, createMultiDropdown)
}

function createUseMultipleModelsToggle(
    controls: MultipleModelModeControls,
    toggleId: string,
    ariaLabel: string
): DropdownView {
    const handleMouseDown = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
    }
    const svgHostStyle = {
        width: `${modelMenuToggleDimensions.svgWidth}px`,
        height: `${modelMenuToggleDimensions.svgHeight}px`,
        flexBasis: `${modelMenuToggleDimensions.svgWidth}px`,
    }
    const svgHost = html`<span className="ai-prompt-model-menu-toggle-svg-host" aria-hidden="true" style=${svgHostStyle}></span>` as HTMLElement
    const svgEl = select(svgHost)
        .append('svg')
        .attr('class', 'ai-prompt-model-menu-toggle-svg')
        .attr('width', modelMenuToggleDimensions.svgWidth)
        .attr('height', modelMenuToggleDimensions.svgHeight)
        .attr('viewBox', `0 0 ${modelMenuToggleDimensions.svgWidth} ${modelMenuToggleDimensions.svgHeight}`)
        .node() as SVGSVGElement
    const button = html`
        <button
            type="button"
            className="ai-prompt-model-menu-toggle"
            aria-label=${ariaLabel}
            aria-pressed=${String(controls.getUseMultipleModels())}
            contenteditable="false"
            onmousedown=${handleMouseDown}
        >
            <span className="ai-prompt-model-menu-toggle-text">Use multiple models</span>
            ${svgHost}
        </button>
    ` as HTMLButtonElement

    let toggleSwitch: ReturnType<typeof createToggleSwitch>
    const syncButtonState = (): void => {
        const checked = controls.getUseMultipleModels()
        button.setAttribute('aria-pressed', String(checked))
        if (toggleSwitch.getChecked() !== checked) {
            toggleSwitch.setChecked(checked)
        }
    }
    const setMode = (checked: boolean): void => {
        controls.setUseMultipleModels(checked)
        button.setAttribute('aria-pressed', String(checked))
    }

    toggleSwitch = createToggleSwitch(select(svgEl), {
        id: toggleId,
        x: 2,
        y: 2,
        width: modelMenuToggleDimensions.width,
        height: modelMenuToggleDimensions.height,
        checked: controls.getUseMultipleModels(),
        onChange: (checked) => setMode(checked),
    })

    button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const checked = !controls.getUseMultipleModels()
        setMode(checked)
        toggleSwitch.setChecked(checked)
    })

    return {
        dom: button,
        destroy: () => toggleSwitch.destroy(),
        update: syncButtonState,
    }
}

class SelectedModelTagsRow implements DropdownView {
    readonly dom: HTMLElement

    private readonly tagPills: TagPillInstance[] = []
    private readonly unsubscribe: () => void
    private modelLabelsById = new Map<string, string>()
    private modelIconsById = new Map<string, string>()
    private currentSignature = ''
    private builtConnected = false

    constructor(private readonly controls: SelectedModelTagsControls) {
        this.dom = html`<div className="ai-prompt-selected-model-tags-row" data-visible="false" contenteditable="false"></div>` as HTMLElement
        this.syncModelLabels(aiModelsStore.getData())
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            this.syncModelLabels(storeState.data)
            this.currentSignature = ''
            this.update()
        })
        this.update()
    }

    private syncModelLabels(models: any[]): void {
        const options = transformModelsToOptions(models)
        this.modelLabelsById = new Map(options.map((option: AiModelDropdownOption) => [option.aiModel, option.title]))
        this.modelIconsById = new Map(options.map((option: AiModelDropdownOption) => [option.aiModel, option.icon]))
    }

    private getModelLabel(modelId: string): string {
        return this.modelLabelsById.get(modelId) ?? modelId.split(':').at(-1) ?? modelId
    }

    private getModelIcon(modelId: string): string {
        return this.modelIconsById.get(modelId) ?? ''
    }

    private destroyTagPills(): void {
        for (const tagPill of this.tagPills) {
            tagPill.destroy()
        }
        this.tagPills.length = 0
    }

    private createTagHost(): HTMLElement {
        return html`<span className="ai-prompt-selected-model-tag"></span>` as HTMLElement
    }

    private createTagPill(tagHost: HTMLElement, modelId: string, label: string): void {
        const svgEl = select(tagHost)
            .append('svg')
            .attr('class', 'ai-prompt-selected-model-tag-svg')
            .node() as SVGSVGElement

        const tagSvg = select(svgEl)
        const tagStyles = settings.aiPromptInput.modelMenu.styles
        const tagPill = createTagPill(tagSvg, {
            id: modelId,
            x: 0,
            y: 0,
            label,
            icon: this.getModelIcon(modelId),
            iconColor: tagStyles.selectedModelTagIconColor,
            textColor: tagStyles.selectedModelTagTextColor,
            selected: true,
            closable: true,
            className: 'ai-prompt-selected-model-tag-pill',
            closeAriaLabel: `Remove ${label}`,
            onClose: () => {
                const nextModelIds = this.controls.getSelectedModelIds()
                    .filter((selectedModelId) => selectedModelId !== modelId)
                this.controls.setSelectedModelIds(nextModelIds)
            },
        })
        this.tagPills.push(tagPill)
    }

    update(): void {
        const modelIds = this.controls.getUseMultipleModels()
            ? uniqueNonEmptyValues(this.controls.getSelectedModelIds())
            : []
        const labels = modelIds.map((modelId) => this.getModelLabel(modelId))
        const nextSignature = JSON.stringify({ modelIds, labels })
        const connected = this.dom.isConnected
        // Rebuild when the selection changes, or when an earlier build happened while
        // the row was detached. Auto-sized pills measure the rendered label, which
        // only reports a real width once the row is attached to the document.
        if (nextSignature === this.currentSignature && (this.builtConnected || !connected)) return
        this.currentSignature = nextSignature
        this.builtConnected = connected || modelIds.length === 0

        this.destroyTagPills()
        if (modelIds.length === 0) {
            this.dom.setAttribute('data-visible', 'false')
            this.dom.replaceChildren()
            return
        }

        const tagHosts = modelIds.map(() => this.createTagHost())
        this.dom.setAttribute('data-visible', 'true')
        this.dom.replaceChildren(...tagHosts)
        for (const [index, modelId] of modelIds.entries()) {
            this.createTagPill(tagHosts[index]!, modelId, labels[index] ?? modelId)
        }
    }

    destroy(): void {
        this.unsubscribe()
        this.destroyTagPills()
        this.dom.remove()
    }
}

export function createAiPromptInputNodeView(options: AiPromptInputNodeViewOptions) {
    return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => {
        const dom = html`<div className="ai-prompt-input-wrapper"></div>` as HTMLDivElement
        const contextTrayEl = options.createContextTray?.() ?? null
        const contentDOM = html`<div className="ai-prompt-input-content"></div>` as HTMLDivElement
        const controlsEl = html`<div className="ai-prompt-input-controls"></div>` as HTMLDivElement
        contentDOM.setAttribute('data-placeholder', options.placeholderText ?? '')
        applyAiModelMenuStyleSettings(dom)

        // Build controls adapters that read/write ProseMirror node attrs. Each
        // section's selection is a single ordered model-id array attr.
        const getSelectedModelIds = (selectionAttrName: string): string[] => {
            return parseAiModelSelectionAttr(getNodeAttr(view, getPos, selectionAttrName))
        }

        const getConfigSelectionGroups = (attrName: 'imageGenerationConfigGroups' | 'videoGenerationConfigGroups'): MediaGenerationConfigSelectionGroup[] => {
            return parseMediaGenerationConfigSelectionAttr(getNodeAttr(view, getPos, attrName))
        }

        const setSelectedModelIds = (
            selectionAttrName: 'aiReasoningModels' | 'aiImageModels' | 'aiVideoModels',
            modelIds: string[]
        ): void => {
            setNodeAttrs(view, getPos, {
                [selectionAttrName]: serializeAiModelSelectionAttr(uniqueNonEmptyValues(modelIds)),
            })
        }

        const setImageConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            const firstImageModel = getSelectedModelIds('aiImageModels')[0]
            const firstImageGroup = groups.find(group => firstImageModel && group.modelIds.includes(firstImageModel))
            setNodeAttrs(view, getPos, {
                imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                ...(firstImageGroup?.values.imageSize ? { imageGenerationSize: firstImageGroup.values.imageSize } : {}),
            })
        }

        const setVideoConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            const firstVideoModel = getSelectedModelIds('aiVideoModels')[0]
            const firstVideoGroup = groups.find(group => firstVideoModel && group.modelIds.includes(firstVideoModel))
            setNodeAttrs(view, getPos, {
                videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                ...(firstVideoGroup?.values.aspectRatio ? { videoAspectRatio: firstVideoGroup.values.aspectRatio } : {}),
                ...(firstVideoGroup?.values.resolution ? { videoResolution: firstVideoGroup.values.resolution } : {}),
                ...(firstVideoGroup?.values.duration ? { videoDuration: firstVideoGroup.values.duration } : {}),
            })
        }

        const createMultipleModelModeControls = (
            modeAttrName: 'useMultipleReasoningModels' | 'useMultipleImageModels' | 'useMultipleVideoModels',
            selectionAttrName: 'aiReasoningModels' | 'aiImageModels' | 'aiVideoModels',
            clearAttrsWhenDisabled: Record<string, unknown> = {},
        ): MultipleModelModeControls => {
            const getModeAttrs = (useMultipleModels: boolean) => {
                const useMultipleReasoningModels = modeAttrName === 'useMultipleReasoningModels'
                    ? useMultipleModels
                    : getUseMultipleReasoningModels()
                const useMultipleImageModels = modeAttrName === 'useMultipleImageModels'
                    ? useMultipleModels
                    : getUseMultipleImageModels()
                const useMultipleVideoModels = modeAttrName === 'useMultipleVideoModels'
                    ? useMultipleModels
                    : getUseMultipleVideoModels()
                return {
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                }
            }

            return {
                getUseMultipleModels: () => parseBooleanAttr(getNodeAttr(view, getPos, modeAttrName)),
                // Turning multi mode off is the safeguard: collapse the section's
                // selection down to its first model so a stale multi selection can
                // never be submitted as singular.
                setUseMultipleModels: (useMultipleModels: boolean) => setNodeAttrs(view, getPos, {
                    ...getModeAttrs(useMultipleModels),
                    [selectionAttrName]: useMultipleModels
                        ? serializeAiModelSelectionAttr(getSelectedModelIds(selectionAttrName))
                        : serializeAiModelSelectionAttr(getSelectedModelIds(selectionAttrName).slice(0, 1)),
                    ...(!useMultipleModels ? clearAttrsWhenDisabled : {}),
                }),
            }
        }

        const reasoningMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleReasoningModels',
            'aiReasoningModels',
        )
        const imageMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleImageModels',
            'aiImageModels',
            { imageGenerationConfigGroups: '' },
        )
        const videoMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleVideoModels',
            'aiVideoModels',
            { videoGenerationConfigGroups: '' },
        )

        const getUseMultipleReasoningModels = (): boolean => reasoningMultipleModelsControls.getUseMultipleModels()
        const getUseMultipleImageModels = (): boolean => imageMultipleModelsControls.getUseMultipleModels()
        const getUseMultipleVideoModels = (): boolean => videoMultipleModelsControls.getUseMultipleModels()

        const modelControls: AiModelControls = {
            getCurrentAiModel: () => getSelectedModelIds('aiReasoningModels')[0] ?? '',
            setAiModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiReasoningModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentAiModels: () => getSelectedModelIds('aiReasoningModels'),
            setAiModels: (aiModels: string[]) => setNodeAttrs(view, getPos, {
                aiReasoningModels: serializeAiModelSelectionAttr(aiModels),
                useMultipleReasoningModels: true,
            }),
        }

        const imageModelControls: ImageModelControls = {
            getCurrentImageModel: () => getSelectedModelIds('aiImageModels')[0] ?? '',
            setImageModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiImageModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentImageModels: () => getSelectedModelIds('aiImageModels'),
            setImageModels: (aiModels: string[]) => setNodeAttrs(view, getPos, {
                aiImageModels: serializeAiModelSelectionAttr(aiModels),
                useMultipleImageModels: true,
            }),
        }

        const videoModelControls: VideoModelControls = {
            getCurrentVideoModel: () => getSelectedModelIds('aiVideoModels')[0] ?? '',
            setVideoModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiVideoModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentVideoModels: () => getSelectedModelIds('aiVideoModels'),
            setVideoModels: (aiModels: string[]) => setNodeAttrs(view, getPos, {
                aiVideoModels: serializeAiModelSelectionAttr(aiModels),
                useMultipleVideoModels: true,
            }),
        }

        const imageControls: ImageSizeControls = {
            getImageGenerationSize: () => getNodeAttr(view, getPos, 'imageGenerationSize') || 'auto',
            setImageGenerationSize: (size: string) => setNodeAttrs(view, getPos, { imageGenerationSize: size }),
            getCurrentImageModel: imageModelControls.getCurrentImageModel,
        }
        const videoAspectControls: VideoOptionControls = {
            getValue: () => getNodeAttr(view, getPos, 'videoAspectRatio') || '',
            setValue: (value: string) => setNodeAttrs(view, getPos, { videoAspectRatio: value }),
            getCurrentVideoModel: videoModelControls.getCurrentVideoModel,
        }
        const videoResolutionControls: VideoOptionControls = {
            getValue: () => getNodeAttr(view, getPos, 'videoResolution') || '',
            setValue: (value: string) => setNodeAttrs(view, getPos, { videoResolution: value }),
            getCurrentVideoModel: videoModelControls.getCurrentVideoModel,
        }
        const videoDurationControls: VideoOptionControls = {
            getValue: () => getNodeAttr(view, getPos, 'videoDuration') || '',
            setValue: (value: string) => setNodeAttrs(view, getPos, { videoDuration: value }),
            getCurrentVideoModel: videoModelControls.getCurrentVideoModel,
        }

        const submitControls: SubmitControls = {
            onSubmit: options.onSubmit,
        }

        const reasoningMultipleModelsToggle = createUseMultipleModelsToggle(
            reasoningMultipleModelsControls,
            'ai-prompt-use-multiple-reasoning-models',
            'Use multiple reasoning models'
        )
        const imageMultipleModelsToggle = createUseMultipleModelsToggle(
            imageMultipleModelsControls,
            'ai-prompt-use-multiple-image-models',
            'Use multiple image models'
        )
        const videoMultipleModelsToggle = createUseMultipleModelsToggle(
            videoMultipleModelsControls,
            'ai-prompt-use-multiple-video-models',
            'Use multiple video models'
        )
        const modelDropdown = createModeAwareModelSelector(
            reasoningMultipleModelsControls,
            () => options.createModelDropdown(modelControls, 'ai-prompt-input'),
            () => options.createModelMultiSelect?.(modelControls, 'ai-prompt-input')
                ?? options.createModelDropdown(modelControls, 'ai-prompt-input')
        )
        const imageModelDropdown = createModeAwareModelSelector(
            imageMultipleModelsControls,
            () => options.createImageModelDropdown(imageModelControls, 'ai-image-model'),
            () => options.createImageModelMultiSelect?.(imageModelControls, 'ai-image-model')
                ?? options.createImageModelDropdown(imageModelControls, 'ai-image-model')
        )
        const imageSizeDropdown = options.createImageSizeDropdown(imageControls, 'ai-image-size')
        const imageConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'image',
            getUseMultipleModels: imageMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIds('aiImageModels'),
            setSelectedModelIds: (modelIds) => setSelectedModelIds('aiImageModels', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('imageGenerationConfigGroups'),
            setConfigGroups: setImageConfigSelectionGroups,
        })
        const videoModelDropdown = createModeAwareModelSelector(
            videoMultipleModelsControls,
            () => options.createVideoModelDropdown(videoModelControls, 'ai-video-model'),
            () => options.createVideoModelMultiSelect?.(videoModelControls, 'ai-video-model')
                ?? options.createVideoModelDropdown(videoModelControls, 'ai-video-model')
        )
        const videoAspectDropdown = options.createVideoAspectDropdown(videoAspectControls, 'ai-video-aspect')
        const videoResolutionDropdown = options.createVideoResolutionDropdown(videoResolutionControls, 'ai-video-resolution')
        const videoDurationDropdown = options.createVideoDurationDropdown(videoDurationControls, 'ai-video-duration')
        const videoConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'video',
            getUseMultipleModels: videoMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIds('aiVideoModels'),
            setSelectedModelIds: (modelIds) => setSelectedModelIds('aiVideoModels', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('videoGenerationConfigGroups'),
            setConfigGroups: setVideoConfigSelectionGroups,
        })
        const submitButton = options.createSubmitButton(submitControls)
        const reasoningSelectedModelTags = new SelectedModelTagsRow({
            getUseMultipleModels: reasoningMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIds('aiReasoningModels'),
            setSelectedModelIds: (modelIds) => setSelectedModelIds('aiReasoningModels', modelIds),
        })

        const modelDropdowns = [
            reasoningMultipleModelsToggle,
            imageMultipleModelsToggle,
            videoMultipleModelsToggle,
            reasoningSelectedModelTags,
            modelDropdown,
            imageModelDropdown,
            videoModelDropdown,
        ]
        const singleImageOptionDropdowns = [imageSizeDropdown]
        const singleVideoOptionDropdowns = [videoAspectDropdown, videoResolutionDropdown, videoDurationDropdown]
        const multiImageOptionDropdowns = [imageConfigMatrix]
        const multiVideoOptionDropdowns = [videoConfigMatrix]

        const modelLabelUpdaters: Array<() => void> = []
        const createModeAwareModelControlLabel = (controls: MultipleModelModeControls): HTMLElement => {
            const label = html`<span className="ai-prompt-model-menu-control-label"></span>` as HTMLElement
            const updateLabel = (): void => {
                const nextLabel = controls.getUseMultipleModels() ? 'Models' : 'Model'
                if (label.textContent === nextLabel) return
                label.textContent = nextLabel
            }
            updateLabel()
            modelLabelUpdaters.push(updateLabel)
            return label
        }

        const reasoningModelLabel = createModeAwareModelControlLabel(reasoningMultipleModelsControls)
        const imageModelLabel = createModeAwareModelControlLabel(imageMultipleModelsControls)
        const videoModelLabel = createModeAwareModelControlLabel(videoMultipleModelsControls)
        const imageSizeControlLabel = html`<span className="ai-prompt-model-menu-control-label"></span>` as HTMLElement
        const updateImageSizeControlLabel = (): void => {
            const nextLabel = imageSizeDropdown.getControlLabel?.() ?? 'Image option'
            if (imageSizeControlLabel.textContent === nextLabel) return
            imageSizeControlLabel.textContent = nextLabel
        }

        let modelMenu: BubbleMenu | null = null
        let modelMenuTrigger: HTMLButtonElement | null = null
        let modelMenuContent: AiModelMenuContentView
        let modelMenuLayoutSignature = ''
        const getModelMenuPosition = () => {
            if (!modelMenuTrigger) return null
            return {
                targetRect: modelMenuTrigger.getBoundingClientRect(),
                placement: 'above' as const,
                horizontalAlignment: 'end' as const,
                clampToParent: false,
            }
        }
        const scheduleModelMenuReposition = (): void => {
            if (!modelMenu?.isVisible) return
            const reposition = (): void => {
                if (!modelMenu?.isVisible) return
                const position = getModelMenuPosition()
                if (!position) return
                modelMenu.reposition(position)
            }
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(reposition)
                return
            }
            reposition()
        }

        const getModelMenuLayoutSignature = (): string => JSON.stringify({
            useMultipleReasoningModels: reasoningMultipleModelsControls.getUseMultipleModels(),
            useMultipleImageModels: imageMultipleModelsControls.getUseMultipleModels(),
            useMultipleVideoModels: videoMultipleModelsControls.getUseMultipleModels(),
            reasoningModelIds: getSelectedModelIds('aiReasoningModels'),
            imageModelIds: getSelectedModelIds('aiImageModels'),
            videoModelIds: getSelectedModelIds('aiVideoModels'),
        })

        const updateModelMenuRows = (): void => {
            for (const updateLabel of modelLabelUpdaters) {
                updateLabel()
            }
            updateImageSizeControlLabel()
            modelMenuContent.update()
        }

        const updateModelDropdowns = (): void => {
            for (const dropdown of modelDropdowns) {
                dropdown.update()
            }
            const singleImageMode = !imageMultipleModelsControls.getUseMultipleModels()
            const singleVideoMode = !videoMultipleModelsControls.getUseMultipleModels()
            for (const dropdown of singleImageMode ? singleImageOptionDropdowns : multiImageOptionDropdowns) {
                dropdown.update()
            }
            for (const dropdown of singleVideoMode ? singleVideoOptionDropdowns : multiVideoOptionDropdowns) {
                dropdown.update()
            }
            updateModelMenuRows()

            const nextLayoutSignature = getModelMenuLayoutSignature()
            if (nextLayoutSignature !== modelMenuLayoutSignature) {
                modelMenuLayoutSignature = nextLayoutSignature
                scheduleModelMenuReposition()
            }
        }
        updateImageSizeControlLabel()

        modelMenuContent = createAiModelMenuContent([
            {
                title: 'Reasoning model',
                helpText: 'Reasoning model works on your prompt, resolves the most relevant items on canvas, crafts a detailed prompt for media model and passed it to the media model with the reference items included.',
                headingControl: reasoningMultipleModelsToggle.dom,
                selectedModelTags: reasoningSelectedModelTags.dom,
                controls: [
                    { label: reasoningModelLabel, control: modelDropdown.dom },
                ],
            },
            {
                title: 'Image model',
                helpText: 'In this section you can configure image generation options. The model choice decides which image generator will draw it. The second option controls the shape or exact size of the image, depending on what that model supports.',
                headingControl: imageMultipleModelsToggle.dom,
                controls: [
                    { label: imageModelLabel, control: imageModelDropdown.dom },
                    {
                        label: imageSizeControlLabel,
                        control: imageSizeDropdown.dom,
                        getVisible: () => !imageMultipleModelsControls.getUseMultipleModels(),
                    },
                    {
                        label: '',
                        control: imageConfigMatrix.dom,
                        getVisible: imageMultipleModelsControls.getUseMultipleModels,
                    },
                ],
            },
            {
                title: 'Video model',
                helpText: 'In this section you can configure video generation options. These options choose the video generator, the frame shape, the output quality, and how long the clip should be.',
                headingControl: videoMultipleModelsToggle.dom,
                controls: [
                    { label: videoModelLabel, control: videoModelDropdown.dom },
                    {
                        label: 'Aspect ratio',
                        control: videoAspectDropdown.dom,
                        getVisible: () => !videoMultipleModelsControls.getUseMultipleModels(),
                    },
                    {
                        label: 'Resolution',
                        control: videoResolutionDropdown.dom,
                        getVisible: () => !videoMultipleModelsControls.getUseMultipleModels(),
                    },
                    {
                        label: 'Duration',
                        control: videoDurationDropdown.dom,
                        getVisible: () => !videoMultipleModelsControls.getUseMultipleModels(),
                    },
                    {
                        label: '',
                        control: videoConfigMatrix.dom,
                        getVisible: videoMultipleModelsControls.getUseMultipleModels,
                    },
                ],
            },
        ])

        const toggleModelMenu = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()

            if (!modelMenu) return

            if (modelMenu.isVisible) {
                modelMenu.hide()
                return
            }

            updateModelDropdowns()
            const position = getModelMenuPosition()
            if (!position) return
            modelMenu.show('modelSettings', position)
        }

        modelMenuTrigger = createModelMenuTrigger(toggleModelMenu)

        controlsEl.appendChild(modelMenuTrigger)
        controlsEl.appendChild(submitButton)

        if (contextTrayEl) dom.appendChild(contextTrayEl)
        dom.appendChild(contentDOM)
        dom.appendChild(controlsEl)

        const modelMenuItems: BubbleMenuItem[] = [
            {
                element: modelMenuContent.dom,
                context: ['modelSettings'],
                update: updateModelMenuRows,
            },
        ]

        modelMenu = new BubbleMenu({
            parentEl: controlsEl,
            items: modelMenuItems,
            onShow: () => {
                modelMenuTrigger.classList.add('is-active')
                modelMenuTrigger.setAttribute('aria-expanded', 'true')
            },
            onHide: () => {
                modelMenuTrigger.classList.remove('is-active')
                modelMenuTrigger.setAttribute('aria-expanded', 'false')
            },
        })
        modelMenu.element.classList.add('ai-prompt-model-menu-info-bubble')
        modelMenu.element.setAttribute('aria-label', 'Model settings')

        const handleDocumentMouseDown = (event: MouseEvent): void => {
            const target = event.target as Node
            if (controlsEl.contains(target)) return
            modelMenu?.hide()
        }
        document.addEventListener('mousedown', handleDocumentMouseDown, true)

        const syncEmptyState = (n: ProseMirrorNode) => {
            const empty = n.textContent.trim() === ''
            dom.setAttribute('data-empty', String(empty))
        }

        syncEmptyState(node)

        return {
            dom,
            contentDOM,
            ignoreMutation: (mutation: MutationRecord) => {
                if (contextTrayEl && (mutation.target === contextTrayEl || contextTrayEl.contains(mutation.target as Node))) {
                    return true
                }
                if (mutation.target === controlsEl || controlsEl.contains(mutation.target as Node)) {
                    return true
                }
                return false
            },
            update: (updatedNode: ProseMirrorNode) => {
                if (updatedNode.type.name !== aiPromptInputNodeType) return false
                node = updatedNode
                syncEmptyState(updatedNode)
                updateModelDropdowns()
                return true
            },
            destroy: () => {
                document.removeEventListener('mousedown', handleDocumentMouseDown, true)
                modelMenuContent.destroy()
                modelMenu?.destroy()
                reasoningMultipleModelsToggle.destroy?.()
                imageMultipleModelsToggle.destroy?.()
                videoMultipleModelsToggle.destroy?.()
                reasoningSelectedModelTags.destroy?.()
                modelDropdown.destroy?.()
                imageModelDropdown.destroy?.()
                imageSizeDropdown.destroy?.()
                imageConfigMatrix.destroy?.()
                videoModelDropdown.destroy?.()
                videoAspectDropdown.destroy?.()
                videoResolutionDropdown.destroy?.()
                videoDurationDropdown.destroy?.()
                videoConfigMatrix.destroy?.()
            },
            stopEvent: (e: Event) => {
                // Prevent ProseMirror from stealing focus/clicks from controls
                const target = e.target as Node
                const isControl = controlsEl.contains(target)
                const isContextTray = Boolean(contextTrayEl?.contains(target))
                if (isControl) {
                    return true
                }
                if (isContextTray) return true
                return false
            },
        }
    }
}
