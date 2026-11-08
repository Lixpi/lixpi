import { mediaGenerationLayoutSettings } from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createHelpTooltip } from '@lixpi/ui-kit/components/help-tooltip'
import {
    atomIcon,
    imageIcon,
    promptIcon,
    questionMarkCircleIcon,
    videoPlayGlyphIcon,
} from '@lixpi/ui-kit/svg'
import {
    getBranchMarkerPromptPreview,
    getBranchMarkerResponsePreview,
} from '../../shared/branch-tree-layout/marker-dimensions.ts'
import {
    getBranchMarkerPromptDisplayText,
    truncateBranchMarkerPromptParts,
    type BranchMarkerPromptPart,
} from '../../shared/branch-tree-layout/marker-prompt-parts.ts'
import {
    BranchMarkerPromptParts,
    type BranchPromptReferenceRenderer,
} from './branch-marker-prompt.ts'

export type BranchMarkerModelPresentation = {
    title: string
    icon: string | null
}
export type BranchMarkerMediaModelPresentation = BranchMarkerModelPresentation & {
    label: string
    glassImage: string
    textureImage: string
}
export type BranchMarkerContentOptions = {
    document: Document
    label: string
    headerHeight: number
    promptParts: readonly BranchMarkerPromptPart[]
    renderReference: BranchPromptReferenceRenderer
    reasoningModel: BranchMarkerModelPresentation | null
    mediaModels: readonly BranchMarkerMediaModelPresentation[]
    modelSummary: string
    responseText: string
    responsePhase: string
    responseIsReceiving: boolean
    showResponseLine: boolean
    pending: boolean
    active: boolean
    tooltipHideDelayMs: number
    progress?: {
        element: HTMLElement
        destroy: () => void
    } | null
    referenceResolution?: {
        element: HTMLElement
        destroy: () => void
    } | null
}

// Match the spinner animation's 800ms period across streaming replacements.
const SPINNER_PERIOD_MS = 800

export class BranchMarkerContent {
    readonly element: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private readonly html: ReturnType<typeof createDocumentHtml>

    constructor(private readonly options: BranchMarkerContentOptions) {
        this.html = createDocumentHtml(options.document)

        if (options.progress)
            this.lifetime.own(() => options.progress!.destroy())

        if (options.referenceResolution)
            this.lifetime.own(() => options.referenceResolution!.destroy())

        try {
            this.element = this.render()
            this.lifetime.own(() => this.element.remove())
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private render(): HTMLDivElement {
        const {
            html,
            options,
        } = this
        const {
            reasoningModel,
            mediaModels,
            responsePhase,
            responseIsReceiving,
            pending,
            active,
        } = options
        const globalProgress = options.progress?.element
        const promptPreview = getBranchMarkerPromptPreview(
            getBranchMarkerPromptDisplayText(options.promptParts),
        )
        const prompt = new BranchMarkerPromptParts(
            truncateBranchMarkerPromptParts(options.promptParts, mediaGenerationLayoutSettings.marker.promptPreviewMaxChars),
            options.renderReference,
        )
        this.lifetime.own(() => prompt.destroy())
        const responsePreview = options.showResponseLine
            ? getBranchMarkerResponsePreview(options.responseText, { isReceiving: responseIsReceiving })
            : ''
        const showStandaloneResponseLine = options.showResponseLine && !globalProgress
        const responseDone = showStandaloneResponseLine
            && (!pending || responsePhase === 'done' || !responseIsReceiving)
        const accessibleLabel = [
            promptPreview,
            options.label,
            reasoningModel?.title ? `Reasoning: ${reasoningModel.title}` : '',
            responsePreview ? `Response: ${responsePreview}` : '',
            options.modelSummary,
        ].filter(Boolean).join(' · ')
        const contentClassName = `workspace-branch-marker-content${active ? ' has-stop-control' : ''}${globalProgress ? ' has-progress' : ''}`
        const messageClassName = `workspace-branch-marker-message${pending ? ' is-pending' : ''}`
        const responseClassName = `workspace-branch-marker-response${responseIsReceiving
            && responsePhase === 'enhancement'
            ? ' is-enhancing'
            : ''}`
        const clock = options.document.defaultView?.performance ?? performance
        const spinnerStyle = { animationDelay: `${-(clock.now() % SPINNER_PERIOD_MS)}ms` }
        const content = html`
            <div
                className=${contentClassName}
                aria-label=${accessibleLabel}
            >
                ${options.referenceResolution?.element}
                <div className="workspace-branch-marker-main">
                    <div className=${messageClassName}>
                        ${reasoningModel
                            && !globalProgress
                            ? this.reasoningTooltip(reasoningModel)
                            : null}
                        ${
                            pending
                                && !showStandaloneResponseLine
                                ? html`
                                    <span
                                        className="workspace-branch-marker-spinner workspace-branch-marker-message-progress"
                                        style=${spinnerStyle}
                                        aria-hidden="true"
                                    ></span>
                                `
                                : null
                        }
                        <span className="workspace-branch-marker-message-text">${prompt.items}</span>
                    </div>
                    ${
                        showStandaloneResponseLine
                            ? html`
                                <div className="workspace-branch-marker-separator"></div>
                                <div className=${responseClassName}>
                                    ${
                                        pending
                                            && responseIsReceiving
                                            ? html`
                                                <span
                                                    className="workspace-branch-marker-spinner workspace-branch-marker-response-spinner"
                                                    style=${spinnerStyle}
                                                    aria-hidden="true"
                                                ></span>
                                            `
                                            : responseDone
                                                ? html`
                                                    <span
                                                        className="workspace-branch-marker-response-icon"
                                                        innerHTML=${promptIcon}
                                                        aria-hidden="true"
                                                    ></span>
                                                `
                                                : null
                                    }
                                    <span className="workspace-branch-marker-response-text">${responsePreview}</span>
                                </div>
                            `
                            : null
                    }
                    ${globalProgress ? html`<div className="workspace-branch-marker-separator"></div>` : null}
                    ${globalProgress}
                </div>
                ${
                    mediaModels.length
                        ? html`
                            <div className="workspace-branch-marker-media-models">
                                ${mediaModels.map((model, index) => this.mediaTooltip(model, index))}
                            </div>
                        `
                        : null
                }
            </div>
        ` as HTMLDivElement

        if (globalProgress) {
            content.style.setProperty('--workspace-branch-marker-header-height', `${options.headerHeight}px`)
            content.style.setProperty('--workspace-branch-marker-header-center', `${options.headerHeight / 2}px`)
        }

        return content
    }

    private mediaTooltip(
        model: BranchMarkerMediaModelPresentation,
        index: number,
    ): HTMLElement {
        const { html } = this
        const circleStyle = model.glassImage ? { backgroundImage: model.glassImage } : {}
        const textureStyle = { backgroundImage: model.textureImage }
        const icon = model.icon ?? (model.label === 'Video' ? videoPlayGlyphIcon : imageIcon)
        const triggerContent = html`
            <span
                className="workspace-branch-marker-media-model-circle"
                style=${circleStyle}
                data=${{ mediaModelCircleIndex: String(index) }}
            >
                <span
                    className="workspace-branch-marker-media-model-texture"
                    style=${textureStyle}
                ></span>
                <span
                    className="workspace-branch-marker-message-icon workspace-branch-marker-media-model-icon"
                    innerHTML=${icon}
                    aria-hidden="true"
                ></span>
            </span>
        ` as HTMLElement
        const tooltip = createHelpTooltip({
            document: this.options.document,
            icon: questionMarkCircleIcon,
            hideDelayMs: this.options.tooltipHideDelayMs,
            label: `${model.label} model: ${model.title}`,
            text: `${model.label}: ${model.title}`,
            triggerContent,
            preferredPlacement: 'left',
            className: 'workspace-branch-marker-media-model-tooltip workspace-branch-marker-reasoning-tooltip nopan',
            triggerClassName: 'workspace-branch-marker-media-model-tooltip-trigger workspace-branch-marker-reasoning-tooltip-trigger',
            contentClassName: 'workspace-branch-marker-reasoning-tooltip-content',
        })
        this.lifetime.own(() => tooltip.destroy())

        return tooltip.dom
    }

    private reasoningTooltip(model: BranchMarkerModelPresentation): HTMLElement {
        const { html } = this
        const triggerContent = html`
            <span
                className="workspace-branch-marker-message-icon workspace-branch-marker-reasoning-icon"
                innerHTML=${model.icon ?? atomIcon}
                aria-hidden="true"
            ></span>
        ` as HTMLElement
        const tooltip = createHelpTooltip({
            document: this.options.document,
            icon: questionMarkCircleIcon,
            hideDelayMs: this.options.tooltipHideDelayMs,
            label: `Reasoning model: ${model.title}`,
            text: model.title,
            triggerContent,
            preferredPlacement: 'top',
            className: 'workspace-branch-marker-reasoning-tooltip nopan',
            triggerClassName: 'workspace-branch-marker-reasoning-tooltip-trigger',
            contentClassName: 'workspace-branch-marker-reasoning-tooltip-content',
        })
        this.lifetime.own(() => tooltip.destroy())

        return tooltip.dom
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
