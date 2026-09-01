import { html } from '@lixpi/ui-primitives/dom'

export type MediaModelBadgeConfig = {
    providerTitle?: string | null
    modelTitle?: string | null
    icon?: string | null
    label?: string | null
    separator?: string
    iconOnly?: boolean
}

export type MediaModelBadgeStyleProperties = {
    iconSize: string
    topGap: string
    iconGap: string
    providerColor: string
    modelColor: string
    nameFontSize: string
    nameFontWeight: string
    nameLineHeight: string
}

const DEFAULT_SEPARATOR = ' : '

function normalizeLabelPart(value: string | null | undefined): string {
    return String(value ?? '').trim()
}

export function createMediaModelBadge(config: MediaModelBadgeConfig): HTMLElement | null {
    const providerTitle = normalizeLabelPart(config.providerTitle)
    const modelTitle = normalizeLabelPart(config.modelTitle)
    const separator = providerTitle && modelTitle ? (config.separator ?? DEFAULT_SEPARATOR) : ''
    const label = normalizeLabelPart(config.label) || `${providerTitle}${separator}${modelTitle}`
    const icon = config.icon || null
    const visibleLabel = config.iconOnly ? '' : label
    if (!icon && !visibleLabel) return null

    return html`
        <div
            className=${`media-model-badge${config.iconOnly ? ' media-model-badge-icon-only' : ''}`}
            role="img"
            aria-label=${label}
            data-help-tooltip="aria-label"
        >
            ${icon ? html`<span className="media-model-badge-icon" innerHTML=${icon}></span>` : null}
            ${visibleLabel ? html`<span className="media-model-badge-name">${providerTitle ? html`<span className="media-model-badge-provider">${providerTitle}</span>` : null}${separator}${modelTitle ? html`<span className="media-model-badge-model">${modelTitle}</span>` : null}</span>` : null}
        </div>
    ` as HTMLElement
}

export function renderMediaModelBadge(host: HTMLElement, config: MediaModelBadgeConfig): void {
    const modelBadge = createMediaModelBadge(config)
    host.replaceChildren()
    if (modelBadge) host.appendChild(modelBadge)
    host.hidden = !modelBadge
}

export function applyMediaModelBadgeStyleProperties(
    host: HTMLElement,
    properties: MediaModelBadgeStyleProperties,
): void {
    host.style.setProperty('--canvas-node-footer-icon-size', properties.iconSize)
    host.style.setProperty('--workspace-generated-media-chrome-top-gap', properties.topGap)
    host.style.setProperty('--workspace-media-model-badge-icon-gap', properties.iconGap)
    host.style.setProperty('--workspace-media-model-badge-provider-color', properties.providerColor)
    host.style.setProperty('--workspace-media-model-badge-model-color', properties.modelColor)
    host.style.setProperty('--workspace-media-model-badge-name-font-size', properties.nameFontSize)
    host.style.setProperty('--workspace-media-model-badge-name-font-weight', properties.nameFontWeight)
    host.style.setProperty('--workspace-media-model-badge-name-line-height', properties.nameLineHeight)
}
