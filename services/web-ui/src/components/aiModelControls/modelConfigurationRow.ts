import { xIcon } from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'

export type ModelConfigurationRowConfig = {
    modelDropdownHost: HTMLElement
    inlineControls?: HTMLElement[]
    controls?: HTMLElement[]
    canRemove: boolean
    onRemove: () => void
    className?: string
    data?: Record<string, string | number>
}

export type ModelConfigurationRowInstance = {
    dom: HTMLElement
    destroy: () => void
}

class ModelConfigurationRow implements ModelConfigurationRowInstance {
    readonly dom: HTMLElement

    constructor(config: ModelConfigurationRowConfig) {
        const handleRemove = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            config.onRemove()
        }
        const removeButton = config.canRemove
            ? html`
                <button
                    type="button"
                    className="ai-model-config-remove"
                    aria-label="Remove model"
                    data-help-tooltip="aria-label"
                    onclick=${handleRemove}
                >
                    <span
                        className="ai-model-config-remove-icon"
                        innerHTML=${xIcon}
                    ></span>
                </button>
            ` as HTMLButtonElement
            : undefined
        const className = ['ai-model-config-row', config.className].filter(Boolean)
            .join(' ')

        this.dom = html`
            <div
                className=${className}
                data=${config.data ?? {}}
            >
                <div className="ai-model-config-primary-row">
                    <div className="ai-model-config-model-column">
                        <div className="ai-model-config-field">
                            <span className="ai-prompt-model-menu-control-label">Model</span>
                            <span className="ai-model-config-dropdown">${config.modelDropdownHost}</span>
                        </div>
                    </div>
                    ${config.inlineControls?.map(
                        control =>
                            html`
                                <div className="ai-model-config-inline-control">
                                    ${control}
                                </div>
                            `,
                    )}
                    ${removeButton}
                </div>
                ${config.controls
                    && config.controls.length > 0
                    ? html`<div className="ai-model-config-controls">${config.controls}</div>`
                    : undefined}
            </div>
        ` as HTMLElement
    }

    destroy(): void {
        this.dom.remove()
    }
}

export const createModelConfigurationRow = (config: ModelConfigurationRowConfig): ModelConfigurationRowInstance => new ModelConfigurationRow(config)
