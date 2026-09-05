import {
    createHelpTooltip,
    type HelpTooltipInstance,
} from '@lixpi/ui-kit/components/help-tooltip'
import { questionMarkCircleIcon } from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'
import {
    settings,
    type AiPromptInputModelMenuSettings,
} from '$src/settings.ts'

export type AiModelMenuControlItem = {
    label: string | HTMLElement
    control: HTMLElement
    getVisible?: () => boolean
}

export type AiModelMenuSectionConfig = {
    title: string
    helpText: string
    getVisible?: () => boolean
    headingControl?: HTMLElement
    selectedModelTags?: HTMLElement
    controls: AiModelMenuControlItem[]
}

export type AiModelMenuSectionView = {
    dom: HTMLElement
    update: () => void
    destroy: () => void
}

export type AiModelMenuContentView = {
    dom: HTMLElement
    update: () => void
    destroy: () => void
}

type AiPromptInputModelMenuStyleSettings = AiPromptInputModelMenuSettings['styles']

const modelMenuCssVariables: Array<[string, keyof AiPromptInputModelMenuStyleSettings]> = [
    ['--ai-prompt-model-menu-trigger-color', 'triggerColor'],
    ['--ai-prompt-model-menu-trigger-active-color', 'triggerActiveColor'],
    ['--ai-prompt-model-menu-trigger-active-background', 'triggerActiveBackground'],
    ['--ai-prompt-model-menu-trigger-focus-outline', 'triggerFocusOutline'],
    ['--ai-prompt-model-menu-info-bubble-width', 'infoBubbleWidth'],
    ['--ai-prompt-model-menu-info-bubble-border-radius', 'infoBubbleBorderRadius'],
    ['--ai-prompt-model-menu-info-bubble-background', 'infoBubbleBackground'],
    ['--ai-prompt-model-menu-info-bubble-box-shadow', 'infoBubbleBoxShadow'],
    ['--ai-prompt-model-menu-info-bubble-color', 'infoBubbleColor'],
    ['--ai-prompt-model-menu-section-divider-height', 'sectionDividerHeight'],
    ['--ai-prompt-model-menu-section-divider-gradient', 'sectionDividerGradient'],
    ['--ai-prompt-model-menu-section-divider-border-radius', 'sectionDividerBorderRadius'],
    ['--ai-prompt-model-menu-section-title-color', 'sectionTitleColor'],
    ['--ai-prompt-model-menu-control-label-color', 'controlLabelColor'],
    ['--ai-prompt-model-menu-control-label-font-size', 'controlLabelFontSize'],
    ['--help-tooltip-trigger-border', 'helpTooltipTriggerBorder'],
    ['--help-tooltip-trigger-background', 'helpTooltipTriggerBackground'],
    ['--help-tooltip-trigger-color', 'helpTooltipTriggerColor'],
    ['--help-tooltip-trigger-hover-background', 'helpTooltipTriggerHoverBackground'],
    ['--help-tooltip-trigger-hover-color', 'helpTooltipTriggerHoverColor'],
    ['--help-tooltip-trigger-focus-outline', 'helpTooltipTriggerFocusOutline'],
    ['--help-tooltip-background', 'helpTooltipBackground'],
    ['--help-tooltip-border', 'helpTooltipBorder'],
    ['--help-tooltip-border-radius', 'helpTooltipBorderRadius'],
    ['--help-tooltip-box-shadow', 'helpTooltipBoxShadow'],
    ['--help-tooltip-color', 'helpTooltipColor'],
]

export const applyAiModelMenuStyleSettings = (element: HTMLElement): void => {
    const modelMenuStyleSettings = settings.aiPromptInput.modelMenu.styles

    for (const [propertyName, settingKey] of modelMenuCssVariables) {
        element.style.setProperty(propertyName, modelMenuStyleSettings[settingKey])
    }
}

type AiModelMenuControlView = {
    dom: HTMLElement
    update: () => void
}

class AiModelMenuSection implements AiModelMenuSectionView {
    readonly dom: HTMLElement

    private readonly controlViews: AiModelMenuControlView[]
    private readonly helpTooltip: HelpTooltipInstance

    constructor(private readonly section: AiModelMenuSectionConfig) {
        this.controlViews = section.controls.map(this.createControl)
        this.helpTooltip = createHelpTooltip({
            icon: questionMarkCircleIcon,
            hideDelayMs: settings.helpTooltip.interactiveHideDelayMs,
            label: `${section.title} help`,
            text: section.helpText,
            className: 'ai-prompt-model-menu-section-help',
        })

        this.dom = html`
            <section className="ai-prompt-model-menu-section">
                <div className="ai-prompt-model-menu-section-heading">
                    <div className="ai-prompt-model-menu-section-heading-main">
                        <div className="ai-prompt-model-menu-section-title">${section.title}</div>
                        ${this.helpTooltip.dom}
                    </div>
                    <div className="ai-prompt-model-menu-section-heading-action">${section.headingControl ?? null}</div>
                </div>
                <div className="ai-prompt-model-menu-section-controls">${this.controlViews.map(controlView => controlView.dom)}</div>
                ${section.selectedModelTags ?? null}
            </section>
        ` as HTMLElement
        this.dom.dataset.visible = String(section.getVisible?.() ?? true)
    }

    update(): void {
        this.dom.dataset.visible = String(this.section.getVisible?.() ?? true)

        for (const controlView of this.controlViews) {
            controlView.update()
        }
    }

    destroy(): void {
        this.helpTooltip.destroy()
    }

    private createControl = (item: AiModelMenuControlItem): AiModelMenuControlView => {
        const label = item.label === ''
            ? null
            : typeof item.label === 'string'
                ? html`<span className="ai-prompt-model-menu-control-label">${item.label}</span>` as HTMLElement
                : item.label

        const dom = html`
            <div className="ai-prompt-model-menu-control">
                ${label}
                <span className="ai-prompt-model-menu-control-field">${item.control}</span>
            </div>
        ` as HTMLElement
        const update = (): void => {
            const nextVisible = String(item.getVisible?.() ?? true)

            if (dom.dataset.visible === nextVisible)
                return

            dom.dataset.visible = nextVisible
        }
        update()

        return {
            dom,
            update,
        }
    }
}

class AiModelMenuContent implements AiModelMenuContentView {
    readonly dom: HTMLElement

    private readonly sectionViews: AiModelMenuSectionView[]

    constructor(sections: AiModelMenuSectionConfig[]) {
        this.sectionViews = sections.map(section => new AiModelMenuSection(section))
        this.dom = html`
            <div
                className="ai-prompt-model-menu-content"
                contenteditable="false"
            >${this.sectionViews.map(sectionView => sectionView.dom)}</div>
        ` as HTMLElement
    }

    update(): void {
        for (const sectionView of this.sectionViews) {
            sectionView.update()
        }
    }

    destroy(): void {
        for (const sectionView of this.sectionViews) {
            sectionView.destroy()
        }
    }
}

export const createAiModelMenuContent = (sections: AiModelMenuSectionConfig[]): AiModelMenuContentView => new AiModelMenuContent(sections)
