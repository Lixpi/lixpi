import {
    type EditorView,
} from 'prosemirror-view'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { html } from '@lixpi/ui-primitives/dom'
import {
    BubbleMenu,
    type BubbleMenuItem,
} from '@lixpi/ui-kit/components/bubble-menu'
import {
    createSlidingSwitch,
    type SlidingSwitchOptionRenderInstance,
    type SlidingSwitchOptionRenderState,
} from '@lixpi/ui-kit/components/sliding-switch'
import {
    clockIcon,
    imageIcon,
    plusIcon,
    videoIcon,
} from '@lixpi/ui-kit/svg'
import { appendSvgPathIcon } from '@lixpi/ui-primitives/svg'
import { settings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    applyAiModelMenuStyleSettings,
    createAiModelMenuContent,
    createMediaGenerationConfigMatrixView,
    getModelOptionsForCapability,
    transformModelsToOptions,
    type AiModelMenuContentView,
} from '$src/components/aiModelControls/index.ts'
import {
    type CapabilityJsonValue,
    type DefaultAiModelCapability,
    type MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'
import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    PROMPT_REFERENCE_NODE_TYPE,
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    normalizeAiModelSelectionAttr,
    normalizeMediaGenerationConfigSelectionAttr,
    parseAiModelSelectionAttr,
    parseBooleanAttr,
    parseCapabilityInputsAttr,
    parseMediaGenerationConfigSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeCapabilityInputsAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror'

export {
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    normalizeAiModelSelectionAttr,
    normalizeMediaGenerationConfigSelectionAttr,
    parseAiModelSelectionAttr,
    parseBooleanAttr,
    parseCapabilityInputsAttr,
    parseMediaGenerationConfigSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeCapabilityInputsAttr,
    serializeMediaGenerationConfigSelectionAttr,
}

type AiModelControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
    getUnavailableAiModels?: () => string[]
    getCurrentAiModels?: () => string[]
    setAiModels?: (aiModels: string[]) => void
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
    getUnavailableImageModels?: () => string[]
    getCurrentImageModels?: () => string[]
    setImageModels?: (aiModels: string[]) => void
}

type VideoModelControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
    getUnavailableVideoModels?: () => string[]
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
    mountMediaModeSwitch?: (switchElement: HTMLElement) => void
    mountModelMenuControl?: (controlElement: HTMLElement) => void
    createModelDropdown: (
        controls: AiModelControls,
        dropdownId: string,
    ) => DropdownView
    createModelMultiSelect?: (
        controls: AiModelControls,
        dropdownId: string,
    ) => DropdownView
    createImageModelDropdown: (
        controls: ImageModelControls,
        dropdownId: string,
    ) => DropdownView
    createImageModelMultiSelect?: (
        controls: ImageModelControls,
        dropdownId: string,
    ) => DropdownView
    createImageSizeDropdown: (
        controls: ImageSizeControls,
        dropdownId: string,
    ) => DropdownView
    createVideoModelDropdown: (
        controls: VideoModelControls,
        dropdownId: string,
    ) => DropdownView
    createVideoModelMultiSelect?: (
        controls: VideoModelControls,
        dropdownId: string,
    ) => DropdownView
    createVideoAspectDropdown: (
        controls: VideoOptionControls,
        dropdownId: string,
    ) => DropdownView
    createVideoResolutionDropdown: (
        controls: VideoOptionControls,
        dropdownId: string,
    ) => DropdownView
    createVideoDurationDropdown: (
        controls: VideoOptionControls,
        dropdownId: string,
    ) => DropdownView
    createSubmitButton: (controls: SubmitControls) => HTMLElement
    createCapabilityControls?: (host: CapabilityControlsHost) => CapabilityControlsView
}

export type CapabilityControlsHost = {
    container: HTMLElement
    getModuleIds: () => string[]
    getPromptText: () => string
    getCapabilityInputs: () => Record<string, Record<string, CapabilityJsonValue>>
    setCapabilityInputs: (inputs: Record<string, Record<string, CapabilityJsonValue>>) => void
    setValidity: (
        toolId: string,
        valid: boolean,
        message?: string,
    ) => void
}

export type CapabilityControlsView = {
    update: () => void
    destroy: () => void
}

const modelMenuTargetGap = 8
const modelMenuViewportInset = 8
const mediaModeSwitchHeight = 40
const mediaModeSwitchInset = 2
const mediaModeOptionDiameter = mediaModeSwitchHeight - mediaModeSwitchInset * 2
const mediaModeSwitchWidth = mediaModeOptionDiameter * 2 + mediaModeSwitchInset * 2
const mediaModeIconSize = 20

type MediaGenerationMode = 'image' | 'video'

type ModelMenuTriggerSummaryItem = {
    label: string
    icon?: string
    trailingIcons?: string[]
    iconVariant?: 'clock'
    aspectRatio?: string
}

const mediaModeIcons: Record<MediaGenerationMode, string> = {
    image: imageIcon,
    video: videoIcon,
}

const createModelMenuTriggerSummaryAspectRatioIcon = (value: string): HTMLElement | null => {
    const [widthValue, heightValue] = value.split(':').map(Number)

    if (
        !widthValue
        || !heightValue
    )
        return null

    const glyphStyles = settings.aiModelControls.styles.dimensionsGlyph
    const summaryScale = 0.85
    const ratio = widthValue / heightValue
    const width = Math.sqrt(glyphStyles.targetArea * ratio)
    const height = width / ratio
    const scale = Math.min(1, glyphStyles.maxDimension / Math.max(width, height))
    const aspectRatioIconStyle = {
        width: `${width * scale * summaryScale}px`,
        height: `${height * scale * summaryScale}px`,
        borderRadius: `${glyphStyles.cornerRadius * summaryScale}px`,
        borderWidth: `${glyphStyles.strokeWidth * summaryScale}px`,
    }

    return html`
        <span
            className="ai-prompt-model-menu-trigger-summary-aspect-ratio-icon"
            style=${aspectRatioIconStyle}
            aria-hidden="true"
        ></span>
    ` as HTMLSpanElement
}

const createModelMenuTriggerSummaryItem = (item: ModelMenuTriggerSummaryItem): HTMLElement => {
    const trailingIconNodes = item.trailingIcons?.map(
        icon =>
            html`
                <span
                    className="ai-prompt-model-menu-trigger-summary-icon"
                    innerHTML=${icon}
                    aria-hidden="true"
                ></span>
            ` as HTMLSpanElement,
    ) ?? []

    return html`
        <span className="ai-prompt-model-menu-trigger-summary-item">
            ${item.icon
                ? html`
                    <span
                          className=${`ai-prompt-model-menu-trigger-summary-icon${item.iconVariant === 'clock' ? ' ai-prompt-model-menu-trigger-summary-clock-icon' : ''}`}
                          innerHTML=${item.icon}
                          aria-hidden="true"
                      ></span>
                `
                : null}
                ${item.aspectRatio ? createModelMenuTriggerSummaryAspectRatioIcon(item.aspectRatio) : null}
                <span className="ai-prompt-model-menu-trigger-summary-label">${item.label}</span>
                ${trailingIconNodes}
            </span>
    ` as HTMLSpanElement
}

class MediaModeSwitchOptionView implements SlidingSwitchOptionRenderInstance<MediaGenerationMode> {
    private readonly iconGroup: any
    private optionHeight = 0

    constructor(
        parent: any,
        state: SlidingSwitchOptionRenderState<MediaGenerationMode>,
    ) {
        this.iconGroup = parent
            .append('g')
            .attr('class', 'ai-prompt-media-mode-switch-icon')
            .attr('pointer-events', 'none')
            .attr('aria-hidden', 'true')
        appendSvgPathIcon(
            this.iconGroup,
            mediaModeIcons[state.option.value],
            {
                x: 0,
                y: 0,
                size: mediaModeIconSize,
                fill: state.color,
            },
        )
        this.render(state)
    }

    resize(
        x: number,
        y: number,
        width: number,
        height = this.optionHeight,
    ): void {
        this.optionHeight = height
        this.iconGroup.attr('transform', `translate(${x + (width - mediaModeIconSize) / 2}, ${y + (height - mediaModeIconSize) / 2})`)
    }

    render(state: SlidingSwitchOptionRenderState<MediaGenerationMode>): void {
        this.iconGroup.selectAll('path').attr('fill', state.color)
        this.resize(
            state.x,
            state.y,
            state.width,
            state.height,
        )
    }

    destroy(): void {
        this.iconGroup.remove()
    }
}

const uniqueNonEmptyValues = (values: string[]): string[] => {
    return Array.from(
        new Set(
            values.filter(value => value.trim().length > 0),
        ),
    )
}

export const hasAiPromptInputContent = (node: ProseMirrorNode): boolean => {
    if (
        node.isText
        && node.text?.trim()
    )
        return true

    if (
        node.type.name === PROMPT_REFERENCE_NODE_TYPE
        || node.type.name === LEGACY_CAPABILITY_REFERENCE_NODE_TYPE
    )
        return true

    let found = false
    node.forEach(child => {
        if (
            !found
            && hasAiPromptInputContent(child)
        )
            found = true
    })

    return found
}

const setNodeAttrs = (
    view: EditorView,
    getPos: () => number | undefined,
    attrs: Record<string, unknown>,
): void => {
    const pos = getNodeViewPos(getPos)

    if (pos === undefined)
        return

    const node = view.state.doc.nodeAt(pos)

    if (
        !node
        || node.type.name !== aiPromptInputNodeType
    )
        return

    const tr = view.state.tr.setNodeMarkup(
        pos,
        undefined,
        {
            ...node.attrs,
            ...attrs,
        },
    )
    view.dispatch(tr)
}

const getNodeAttr = (
    view: EditorView,
    getPos: () => number | undefined,
    attrName: string,
): any => {
    const pos = getNodeViewPos(getPos)

    if (pos === undefined)
        return undefined

    const node = view.state.doc.nodeAt(pos)

    if (
        !node
        || node.type.name !== aiPromptInputNodeType
    )
        return undefined

    return node.attrs?.[attrName]
}

function getNodeViewPos(getPos: () => number | undefined): number | undefined {
    try {
        return getPos()
    } catch {
        return undefined
    }
}

const createModelMenuTrigger = (onClick: (event: MouseEvent) => void): HTMLButtonElement => {
    const handleMouseDown = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
    }

    return html`
        <button
            type="button"
            className="ai-prompt-model-menu-trigger"
            aria-label="Generation settings"
            data-help-tooltip="aria-label"
            aria-expanded="false"
            contenteditable="false"
            onmousedown=${handleMouseDown}
            onclick=${onClick}
        >
            <span className="ai-prompt-model-menu-trigger-summary"></span>
        </button>
    ` as HTMLButtonElement
}

type AddModelButtonControls = {
    capability: DefaultAiModelCapability
    getSelectedModelIds: () => string[]
    setSelectedModelIds: (modelIds: string[]) => void
}

class AddModelButton implements DropdownView {
    readonly dom: HTMLButtonElement

    private readonly unsubscribe: () => void

    constructor(private readonly controls: AddModelButtonControls) {
        const handleClick = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            const selectedModelIds = uniqueNonEmptyValues(
                this.controls.getSelectedModelIds(),
            )
            const selectedModelIdSet = new Set(selectedModelIds)
            const nextModel = getModelOptionsForCapability(
                aiModelsStore.getData(),
                this.controls.capability,
            ).find(option => !selectedModelIdSet.has(option.aiModel))

            if (!nextModel)
                return

            this.controls.setSelectedModelIds([...selectedModelIds, nextModel.aiModel])
        }
        this.dom = html`
            <button
                type="button"
                className="ai-model-config-add"
                aria-label="Add model"
                data-help-tooltip="aria-label"
                contenteditable="false"
                onclick=${handleClick}
            >
                <span className="ai-model-config-add-label">Add model</span>
                <span
                    className="ai-model-config-add-icon"
                    innerHTML=${plusIcon}
                ></span>
                </button>
        ` as HTMLButtonElement
        this.unsubscribe = aiModelsStore.subscribe(() => this.update())
        this.update()
    }

    update(): void {
        const selectedModelIdSet = new Set(
            uniqueNonEmptyValues(
                this.controls.getSelectedModelIds(),
            ),
        )
        const hasAvailableModel = getModelOptionsForCapability(
            aiModelsStore.getData(),
            this.controls.capability,
        ).some(option => !selectedModelIdSet.has(option.aiModel))
        this.dom.disabled = !hasAvailableModel
        this.dom.ariaLabel = hasAvailableModel ? 'Add model' : 'All available models are selected'
    }

    destroy(): void {
        this.unsubscribe()
        this.dom.remove()
    }
}

export const createAiPromptInputNodeView = (options: AiPromptInputNodeViewOptions) => {
    return (
        node: ProseMirrorNode,
        view: EditorView,
        getPos: () => number | undefined,
    ) => {
        const dom = html`<div className="ai-prompt-input-wrapper"></div>` as HTMLDivElement
        const contextTrayEl = options.createContextTray?.() ?? null
        const contentDOM = html`<div className="ai-prompt-input-content"></div>` as HTMLDivElement
        const controlsEl = html`<div className="ai-prompt-input-controls"></div>` as HTMLDivElement
        const mediaModeSwitchHost = html`<div
                className="ai-prompt-media-mode-switch"
                contenteditable="false"
            ></div>` as HTMLDivElement
        const mediaModeSwitchSvg = select(mediaModeSwitchHost)
            .append('svg')
            .attr('class', 'ai-prompt-media-mode-switch-svg')
            .attr('width', mediaModeSwitchWidth)
            .attr('height', mediaModeSwitchHeight)
            .attr('viewBox', `0 0 ${mediaModeSwitchWidth} ${mediaModeSwitchHeight}`)
            .node() as SVGSVGElement
        contentDOM.dataset.placeholder = options.placeholderText ?? ''
        applyAiModelMenuStyleSettings(dom)

        // Build controls adapters that read/write ProseMirror node attrs. Each
        // section's selection is a single ordered model-id array attr.
        const getSelectedModelIds = (selectionAttrName: string): string[] => parseAiModelSelectionAttr(
            getNodeAttr(
                view,
                getPos,
                selectionAttrName,
            ),
        )
        const getMediaGenerationMode = (): MediaGenerationMode => (
            getNodeAttr(
                view,
                getPos,
                'mediaGenerationMode',
            ) === 'video' ? 'video' : 'image'
        )

        const getConfigSelectionGroups = (attrName: 'reasoningGenerationConfigGroups' | 'imageGenerationConfigGroups' | 'videoGenerationConfigGroups'): MediaGenerationConfigSelectionGroup[] => parseMediaGenerationConfigSelectionAttr(
            getNodeAttr(
                view,
                getPos,
                attrName,
            ),
        )

        const setSelectedModelIds = (
            selectionAttrName: 'aiReasoningModels' | 'aiImageModels' | 'aiVideoModels',
            modelIds: string[],
        ): void => {
            const normalizedModelIds = uniqueNonEmptyValues(modelIds)
            const multipleModeAttrName = {
                aiReasoningModels: 'useMultipleReasoningModels',
                aiImageModels: 'useMultipleImageModels',
                aiVideoModels: 'useMultipleVideoModels',
            }[selectionAttrName]
            setNodeAttrs(
                view,
                getPos,
                {
                    [selectionAttrName]: serializeAiModelSelectionAttr(normalizedModelIds),
                    [multipleModeAttrName]: normalizedModelIds.length > 1,
                },
            )
        }

        const replaceSelectedModelAt = (
            selectionAttrName: 'aiReasoningModels' | 'aiImageModels' | 'aiVideoModels',
            modelIndex: number,
            modelId: string,
        ): void => {
            const nextModelIds = [...getSelectedModelIds(selectionAttrName)]
            nextModelIds[modelIndex] = modelId
            setSelectedModelIds(selectionAttrName, nextModelIds)
        }

        const getUnavailableModelIds = (
            selectionAttrName: 'aiReasoningModels' | 'aiImageModels' | 'aiVideoModels',
            modelIndex: number,
        ): string[] => getSelectedModelIds(selectionAttrName).filter((_, index) => index !== modelIndex)

        const setImageConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            const firstImageModel = getSelectedModelIds('aiImageModels')[0]
            const firstImageGroup = groups.find(group => firstImageModel && group.modelIds.includes(firstImageModel))
            setNodeAttrs(
                view,
                getPos,
                {
                    imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                    ...(firstImageGroup?.values.imageSize ? { imageGenerationSize: firstImageGroup.values.imageSize } : {}),
                },
            )
        }

        const setReasoningConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            setNodeAttrs(
                view,
                getPos,
                {
                    reasoningGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                },
            )
        }

        const setVideoConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            const firstVideoModel = getSelectedModelIds('aiVideoModels')[0]
            const firstVideoGroup = groups.find(group => firstVideoModel && group.modelIds.includes(firstVideoModel))
            setNodeAttrs(
                view,
                getPos,
                {
                    videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                    ...(firstVideoGroup?.values.aspectRatio ? { videoAspectRatio: firstVideoGroup.values.aspectRatio } : {}),
                    ...(firstVideoGroup?.values.resolution ? { videoResolution: firstVideoGroup.values.resolution } : {}),
                    ...(firstVideoGroup?.values.duration ? { videoDuration: firstVideoGroup.values.duration } : {}),
                },
            )
        }

        const submitControls: SubmitControls = {
            onSubmit: () => {
                // Reconcile API-owned defaults into ProseMirror attrs immediately
                // before either the button handler or submit plugin reads them.
                updateModelDropdowns()
                options.onSubmit()
            },
        }

        const reasoningConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'reasoning',
            getSelectedModelIds: () => getSelectedModelIds('aiReasoningModels'),
            setSelectedModelIds: modelIds => setSelectedModelIds('aiReasoningModels', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('reasoningGenerationConfigGroups'),
            setConfigGroups: setReasoningConfigSelectionGroups,
            createModelDropdown: modelIndex =>
                options.createModelDropdown(
                    {
                        getCurrentAiModel: () => getSelectedModelIds('aiReasoningModels')[modelIndex] ?? '',
                        setAiModel: modelId => replaceSelectedModelAt(
                            'aiReasoningModels',
                            modelIndex,
                            modelId,
                        ),
                        getUnavailableAiModels: () => getUnavailableModelIds('aiReasoningModels', modelIndex),
                    },
                    `ai-reasoning-model-${modelIndex}`,
                ),
        })
        const imageConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'image',
            getSelectedModelIds: () => getSelectedModelIds('aiImageModels'),
            setSelectedModelIds: modelIds => setSelectedModelIds('aiImageModels', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('imageGenerationConfigGroups'),
            setConfigGroups: setImageConfigSelectionGroups,
            createModelDropdown: modelIndex =>
                options.createImageModelDropdown(
                    {
                        getCurrentImageModel: () => getSelectedModelIds('aiImageModels')[modelIndex] ?? '',
                        setImageModel: modelId => replaceSelectedModelAt(
                            'aiImageModels',
                            modelIndex,
                            modelId,
                        ),
                        getUnavailableImageModels: () => getUnavailableModelIds('aiImageModels', modelIndex),
                    },
                    `ai-image-model-${modelIndex}`,
                ),
        })
        const videoConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'video',
            getSelectedModelIds: () => getSelectedModelIds('aiVideoModels'),
            setSelectedModelIds: modelIds => setSelectedModelIds('aiVideoModels', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('videoGenerationConfigGroups'),
            setConfigGroups: setVideoConfigSelectionGroups,
            createModelDropdown: modelIndex =>
                options.createVideoModelDropdown(
                    {
                        getCurrentVideoModel: () => getSelectedModelIds('aiVideoModels')[modelIndex] ?? '',
                        setVideoModel: modelId => replaceSelectedModelAt(
                            'aiVideoModels',
                            modelIndex,
                            modelId,
                        ),
                        getUnavailableVideoModels: () => getUnavailableModelIds('aiVideoModels', modelIndex),
                    },
                    `ai-video-model-${modelIndex}`,
                ),
        })
        const reasoningAddModel = new AddModelButton({
            capability: 'reasoning',
            getSelectedModelIds: () => getSelectedModelIds('aiReasoningModels'),
            setSelectedModelIds: modelIds => setSelectedModelIds('aiReasoningModels', modelIds),
        })
        const imageAddModel = new AddModelButton({
            capability: 'image',
            getSelectedModelIds: () => getSelectedModelIds('aiImageModels'),
            setSelectedModelIds: modelIds => setSelectedModelIds('aiImageModels', modelIds),
        })
        const videoAddModel = new AddModelButton({
            capability: 'video',
            getSelectedModelIds: () => getSelectedModelIds('aiVideoModels'),
            setSelectedModelIds: modelIds => setSelectedModelIds('aiVideoModels', modelIds),
        })
        const submitButton = options.createSubmitButton(submitControls)
        submitButton.dataset.helpTooltip = 'aria-description'
        const mediaModeSwitch = createSlidingSwitch<MediaGenerationMode>(
            select(mediaModeSwitchSvg),
            {
                id: 'ai-prompt-media-generation-mode',
                x: 0,
                y: 0,
                width: mediaModeSwitchWidth,
                height: mediaModeSwitchHeight,
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
                selectedValue: getMediaGenerationMode(),
                className: 'ai-prompt-media-mode-sliding-switch',
                renderOption: (parent, state) => new MediaModeSwitchOptionView(parent, state),
                visualOverflowPadding: {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
                trackBackgroundColor: settings.aiPromptInput.mediaModeSwitch.styles.trackBackgroundColor,
                indicatorBackgroundColor: settings.aiPromptInput.mediaModeSwitch.styles.indicatorBackgroundColor,
                unselectedOptionColor: settings.aiPromptInput.mediaModeSwitch.styles.unselectedOptionColor,
                hoveredOptionColor: settings.aiPromptInput.mediaModeSwitch.styles.hoveredOptionColor,
                selectedOptionColor: settings.aiPromptInput.mediaModeSwitch.styles.selectedOptionColor,
                indicatorBoxShadow: settings.aiPromptInput.mediaModeSwitch.styles.indicatorBoxShadow,
                reshuffleItemsOnValueChange: {
                    enable: true,
                    selectedElementPosition: 'right',
                },
                onChange: value => setNodeAttrs(
                    view,
                    getPos,
                    { mediaGenerationMode: value },
                ),
            },
        )
        const capabilityControlsEl = html`<div className="ai-prompt-capability-controls"></div>` as HTMLDivElement
        const capabilityValidity = new Map<string, {
            valid: boolean
            message?: string
        }>()
        const syncSubmitValidity = (): void => {
            const invalid = [...capabilityValidity.values()].find(value => !value.valid)

            if (submitButton instanceof HTMLButtonElement)
                submitButton.disabled = Boolean(invalid)

            submitButton.ariaDisabled = String(
                Boolean(invalid),
            )
            submitButton.ariaDescription = invalid?.message ?? null
        }
        const getModuleIds = (): string[] => {
            const moduleIds: string[] = []
            const seen = new Set<string>()
            node.descendants(child => {
                if (
                    child.type.name !== PROMPT_REFERENCE_NODE_TYPE
                    || child.attrs.referenceType !== 'capability-module'
                    || typeof child.attrs.moduleId !== 'string'
                    || seen.has(child.attrs.moduleId)
                )
                    return

                seen.add(child.attrs.moduleId)
                moduleIds.push(child.attrs.moduleId)
            })

            return moduleIds
        }
        const capabilityControls = options.createCapabilityControls?.({
            container: capabilityControlsEl,
            getModuleIds,
            getPromptText: () => node.textContent,
            getCapabilityInputs: () => parseCapabilityInputsAttr(
                getNodeAttr(
                    view,
                    getPos,
                    'capabilityInputs',
                ),
            ),
            setCapabilityInputs: inputs =>
                setNodeAttrs(
                    view,
                    getPos,
                    {
                        capabilityInputs: serializeCapabilityInputsAttr(inputs),
                    },
                ),
            setValidity: (
                toolId,
                valid,
                message,
            ) => {
                capabilityValidity.set(
                    toolId,
                    {
                        valid,
                        ...(message ? { message } : {}),
                    },
                )
                syncSubmitValidity()
            },
        })
        const modelDropdowns = [
            reasoningAddModel,
            imageAddModel,
            videoAddModel,
        ]
        const mediaConfigMatrices = [reasoningConfigMatrix, imageConfigMatrix, videoConfigMatrix]
        let modelMenu: BubbleMenu | null = null
        let modelMenuTrigger: HTMLButtonElement | null = null
        let modelMenuContent: AiModelMenuContentView
        const getModelOption = (modelId: string) => transformModelsToOptions(
            aiModelsStore.getData(),
        ).find(option => option.aiModel === modelId)
        const getModelTitle = (modelId: string): string => {
            const model = getModelOption(modelId)

            return model?.title ?? modelId.split(':').at(-1) ?? modelId
        }
        const formatSummaryValue = (
            key: string,
            value: string,
            label: string,
        ): string => {
            if (key === 'duration')
                return value === '-1' ? 'Smart length' : label

            return label
        }
        const updateModelMenuTriggerSummary = (): void => {
            if (!modelMenuTrigger)
                return

            const mediaMode = getMediaGenerationMode()
            const selectedModelIds = getSelectedModelIds(mediaMode === 'image' ? 'aiImageModels' : 'aiVideoModels')
            const primaryModelId = selectedModelIds[0]
            const primaryModelOption = primaryModelId ? getModelOption(primaryModelId) : undefined
            const usesMultipleModels = selectedModelIds.length > 1
            const modelSummary = usesMultipleModels
                ? 'Using multiple models'
                : selectedModelIds[0]
                    ? getModelTitle(selectedModelIds[0])
                    : 'Select model'
            const selectedModelIcons = usesMultipleModels
                ? selectedModelIds.flatMap(modelId => getModelOption(modelId)?.icon ?? [])
                : undefined
            const matrix = aiModelsStore.getMediaGenerationConfigMatrix()
            const configGroups = getConfigSelectionGroups(mediaMode === 'image' ? 'imageGenerationConfigGroups' : 'videoGenerationConfigGroups')
            const matrixGroup = matrix.groups.find(
                group => (
                    group.mediaType === mediaMode && primaryModelId && group.modelIds.includes(primaryModelId)
                ),
            )
            const selectionGroup = configGroups.find(
                group => (
                    group.groupId === matrixGroup?.groupId
                    && Boolean(primaryModelId)
                    && group.modelIds.includes(primaryModelId)
                ),
            )
            const summaryControlOrder = mediaMode === 'image'
                ? ['imageSize']
                : ['aspectRatio', 'resolution', 'duration']
            const controlSummary = summaryControlOrder.flatMap((controlKey): ModelMenuTriggerSummaryItem[] => {
                const control = matrixGroup?.controls.find(candidate => candidate.key === controlKey)

                if (!control)
                    return []

                const value = selectionGroup?.values[control.key]
                    ?? control.defaultValue
                    ?? control.options[0]?.value

                if (!value)
                    return []

                const label = control.options.find(option => option.value === value)?.label ?? value

                return [{
                    label: formatSummaryValue(
                        control.key,
                        value,
                        label,
                    ),
                    icon: control.key === 'duration' ? clockIcon : undefined,
                    iconVariant: control.key === 'duration' ? 'clock' : undefined,
                    aspectRatio: (control.key === 'aspectRatio' || control.key === 'imageSize')
                        && /^\d+:\d+$/.test(value)
                        ? value
                        : undefined,
                }]
            })
            const summaryEl = modelMenuTrigger.querySelector('.ai-prompt-model-menu-trigger-summary')

            if (!summaryEl)
                return

            const summaryItems: ModelMenuTriggerSummaryItem[] = [
                {
                    label: modelSummary,
                    icon: usesMultipleModels ? undefined : primaryModelOption?.icon,
                    trailingIcons: selectedModelIcons,
                },
                ...(usesMultipleModels ? [] : controlSummary),
            ]
            const summaryNodes: HTMLElement[] = []

            for (const [index, item] of summaryItems.entries()) {
                if (index === 1) {
                    summaryNodes.push(
                        html`
                            <span
                                className="canvas-node-footer-separator ai-prompt-model-menu-trigger-summary-separator"
                                aria-hidden="true"
                            ></span>
                        ` as HTMLSpanElement,
                    )
                } else if (index > 1) {
                    summaryNodes.push(
                        html`
                            <span
                                className="ai-prompt-model-menu-trigger-summary-dot-separator"
                                aria-hidden="true"
                            >·</span>
                        ` as HTMLSpanElement,
                    )
                }

                summaryNodes.push(
                    createModelMenuTriggerSummaryItem(item),
                )
            }

            summaryEl.replaceChildren(...summaryNodes)
        }
        const getModelMenuPosition = () => {
            if (!modelMenuTrigger)
                return null

            const targetRect = modelMenuTrigger.getBoundingClientRect()

            if (modelMenu) {
                const viewportTop = window.visualViewport?.offsetTop ?? 0
                const scale = modelMenu.getScale()
                const availableHeight = Math.max(0, (targetRect.top - viewportTop - modelMenuViewportInset) / scale - modelMenuTargetGap)
                modelMenu.element.style.setProperty('--ai-prompt-model-menu-info-bubble-max-height', `${availableHeight}px`)
            }

            return {
                targetRect,
                placement: 'above' as const,
                horizontalAlignment: 'end' as const,
                clampToParent: false,
            }
        }
        const scheduleModelMenuReposition = (): void => {
            if (!modelMenu?.isVisible)
                return

            const reposition = (): void => {
                if (!modelMenu?.isVisible)
                    return

                const position = getModelMenuPosition()

                if (!position)
                    return

                modelMenu.reposition(position)
            }

            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(reposition)

                return
            }

            reposition()
        }

        const updateModelMenuRows = (): void => void modelMenuContent.update()

        const updateModelMenuControls = (): void => {
            for (const dropdown of modelDropdowns) {
                dropdown.update()
            }

            for (const mediaConfigMatrix of mediaConfigMatrices) {
                mediaConfigMatrix.update()
            }
        }

        function updateModelDropdowns(): void {
            mediaModeSwitch.setValue(
                getMediaGenerationMode(),
            )
            updateModelMenuRows()
            updateModelMenuControls()
            updateModelMenuTriggerSummary()
            scheduleModelMenuReposition()
        }
        modelMenuContent = createAiModelMenuContent([
            {
                title: 'Reasoning model',
                helpText: 'Reasoning model works on your prompt, resolves the most relevant items on canvas, crafts a detailed prompt for media model and passed it to the media model with the reference items included.',
                headingControl: reasoningAddModel.dom,
                controls: [
                    {
                        label: '',
                        control: reasoningConfigMatrix.dom,
                    },
                ],
            },
            {
                title: 'Image model',
                getVisible: () => getMediaGenerationMode() === 'image',
                helpText: 'In this section you can configure image generation options. The model choice decides which image generator will draw it. The second option controls the shape or exact size of the image, depending on what that model supports.',
                headingControl: imageAddModel.dom,
                controls: [
                    {
                        label: '',
                        control: imageConfigMatrix.dom,
                    },
                ],
            },
            {
                title: 'Video model',
                getVisible: () => getMediaGenerationMode() === 'video',
                helpText: 'In this section you can configure video generation options. These options choose the video generator, the frame shape, the output quality, and how long the clip should be.',
                headingControl: videoAddModel.dom,
                controls: [
                    {
                        label: '',
                        control: videoConfigMatrix.dom,
                    },
                ],
            },
        ])

        const toggleModelMenu = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()

            if (!modelMenu)
                return

            if (modelMenu.isVisible) {
                modelMenu.hide()

                return
            }

            updateModelDropdowns()
            const position = getModelMenuPosition()

            if (!position)
                return

            modelMenu.show('modelSettings', position)
        }

        const handleModelMenuWheel = (event: WheelEvent): void => {
            if (event.ctrlKey)
                event.preventDefault()

            event.stopPropagation()
        }

        modelMenuTrigger = createModelMenuTrigger(toggleModelMenu)
        applyAiModelMenuStyleSettings(modelMenuTrigger)
        const unsubscribeModelMenuTriggerSummary = aiModelsStore.subscribe(() => {
            updateModelMenuTriggerSummary()
            scheduleModelMenuReposition()
        })

        if (options.mountModelMenuControl)
            options.mountModelMenuControl(modelMenuTrigger)
        else
            controlsEl.appendChild(modelMenuTrigger)

        controlsEl.appendChild(submitButton)

        if (options.mountMediaModeSwitch)
            options.mountMediaModeSwitch(mediaModeSwitchHost)
        else
            dom.appendChild(mediaModeSwitchHost)

        if (contextTrayEl)
            dom.appendChild(contextTrayEl)

        dom.appendChild(contentDOM)

        if (capabilityControls)
            dom.appendChild(capabilityControlsEl)

        dom.appendChild(controlsEl)

        const modelMenuItems: BubbleMenuItem[] = [
            {
                element: modelMenuContent.dom,
                context: ['modelSettings'],
                update: updateModelMenuRows,
            },
        ]

        modelMenu = new BubbleMenu({
            parentEl: dom,
            items: modelMenuItems,
            onShow: () => {
                modelMenuTrigger.classList.add('is-active')
                modelMenuTrigger.ariaExpanded = 'true'
                updateModelMenuControls()
            },
            onHide: () => {
                modelMenuTrigger.classList.remove('is-active')
                modelMenuTrigger.ariaExpanded = 'false'
            },
        })
        modelMenu.element.classList.add(
            'ai-prompt-model-menu-info-bubble',
            'nopan',
            'nowheel',
        )
        modelMenu.element.ariaLabel = 'Model settings'
        modelMenu.element.addEventListener(
            'wheel',
            handleModelMenuWheel,
            { passive: false },
        )

        const handleDocumentMouseDown = (event: MouseEvent): void => {
            const target = event.target as Node

            if (controlsEl.contains(target))
                return

            if (modelMenuTrigger?.contains(target))
                return

            if (modelMenu?.element.contains(target))
                return

            if (
                target instanceof Element
                && target.closest(
                    '.ai-prompt-model-selector-popover, ' + '.sliding-dropdown-scroll-portal, ' + '[data-sliding-dropdown-open="true"], ' + '.sliding-dropdown-group',
                )
            )
                return

            modelMenu?.hide()
        }
        document.addEventListener(
            'mousedown',
            handleDocumentMouseDown,
            true,
        )

        const syncEmptyState = (n: ProseMirrorNode) => {
            const empty = !hasAiPromptInputContent(n)
            dom.dataset.empty = String(empty)
        }

        syncEmptyState(node)
        capabilityControls?.update()

        return {
            dom,
            contentDOM,
            ignoreMutation: (mutation: MutationRecord) => {
                if (
                    contextTrayEl
                    && (mutation.target === contextTrayEl || contextTrayEl.contains(mutation.target as Node))
                )
                    return true

                if (
                    mutation.target === controlsEl
                    || controlsEl.contains(mutation.target as Node)
                )
                    return true

                if (modelMenu?.element.contains(mutation.target as Node))
                    return true

                if (
                    mutation.target === mediaModeSwitchHost
                    || mediaModeSwitchHost.contains(mutation.target as Node)
                )
                    return true

                return false
            },
            update: (updatedNode: ProseMirrorNode) => {
                if (updatedNode.type.name !== aiPromptInputNodeType)
                    return false

                node = updatedNode
                syncEmptyState(updatedNode)
                updateModelDropdowns()
                capabilityControls?.update()

                return true
            },
            destroy: () => {
                document.removeEventListener(
                    'mousedown',
                    handleDocumentMouseDown,
                    true,
                )
                modelMenu?.element.removeEventListener('wheel', handleModelMenuWheel)
                modelMenuContent.destroy()
                modelMenu?.destroy()
                reasoningAddModel.destroy()
                imageAddModel.destroy()
                videoAddModel.destroy()
                reasoningConfigMatrix.destroy?.()
                imageConfigMatrix.destroy?.()
                videoConfigMatrix.destroy?.()
                unsubscribeModelMenuTriggerSummary()
                mediaModeSwitch.destroy()
                mediaModeSwitchHost.remove()
                modelMenuTrigger?.remove()
                capabilityControls?.destroy()
            },
            stopEvent: (e: Event) => {
                // Prevent ProseMirror from stealing focus/clicks from controls
                const target = e.target as Node
                const isControl = controlsEl.contains(target)
                const isModelMenu = modelMenu?.element.contains(target) ?? false
                const isMediaModeSwitch = mediaModeSwitchHost.contains(target)
                const isContextTray = Boolean(contextTrayEl?.contains(target))

                if (isControl)
                    return true

                if (isModelMenu)
                    return true

                if (isMediaModeSwitch)
                    return true

                if (isContextTray)
                    return true

                return false
            },
        }
    }
}
