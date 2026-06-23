import { settings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { getAiModelIcon, getAiProviderColorIcon, getAiProviderIcon } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'
import { html } from '$src/utils/domTemplates.ts'

type MediaModelCatalogEntry = {
    provider?: string
    model?: string
    title?: string
    providerTitle?: string
    colorIconName?: string
}

export type MediaModelBadgeConfig = {
    modelId?: string | null
    modelProvider?: string | null
    iconOnly?: boolean
    // Use the monochrome provider glyph instead of the brand-colored icon. Useful
    // where the badge sits inline next to muted text (e.g. lineage attribution).
    monochromeIcon?: boolean
}

export type MediaModelBadgeStyleOptions = {
    scale?: number
}

type MediaModelParts = {
    provider: string
    model: string
}

export type MediaModelBadgeMeta = {
    providerTitle: string
    modelTitle: string
    icon: string | null
    label: string
}

function normalize(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase()
}

function splitMediaModelId(modelId: string): MediaModelParts {
    const [provider, ...modelParts] = modelId.split(':')
    if (modelParts.length === 0) return { provider: '', model: provider || '' }
    return { provider: provider || '', model: modelParts.join(':') }
}

function normalizeScale(scale: number | null | undefined): number {
    return Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) : 1
}

function scaleCssLength(value: string, scale: number): string {
    const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]+)$/i)
    if (!match) return value
    return `${Number(match[1]) * scale}${match[2]}`
}

function findMediaModelMeta(modelId: string, modelProvider: string): MediaModelCatalogEntry | null {
    const { provider, model } = splitMediaModelId(modelId)
    const normalizedProvider = normalize(provider || modelProvider)
    const normalizedModel = normalize(model)
    const normalizedModelId = normalize(modelId)
    const models = (aiModelsStore.getData() ?? []) as MediaModelCatalogEntry[]

    return models.find((candidate) => {
        const candidateProvider = normalize(candidate.provider)
        const candidateModel = normalize(candidate.model)
        const candidateModelId = normalize(`${candidate.provider ?? ''}:${candidate.model ?? ''}`)

        if (normalizedProvider) {
            return candidateProvider === normalizedProvider && candidateModel === normalizedModel
        }

        return candidateModel === normalizedModel || candidateModelId === normalizedModelId
    }) ?? null
}

export function getMediaModelBadgeMeta(config: MediaModelBadgeConfig): MediaModelBadgeMeta {
    const modelId = String(config.modelId ?? '')
    const modelProvider = String(config.modelProvider ?? '')
    const { provider, model } = splitMediaModelId(modelId)
    const providerKey = provider || modelProvider
    const modelMeta = findMediaModelMeta(modelId, providerKey)
    const providerTitle = modelMeta?.providerTitle ?? providerKey
    const modelTitle = modelMeta?.title ?? model
    const label = providerTitle && modelTitle
        ? `${providerTitle}${settings.mediaNode.generatedMediaChrome.modelBadgeSeparator}${modelTitle}`
        : providerTitle || modelTitle
    const icon = config.monochromeIcon
        ? (getAiProviderIcon(providerTitle) ?? getAiProviderIcon(providerKey))
        : (getAiModelIcon(modelMeta?.colorIconName)
            ?? getAiProviderColorIcon(providerTitle)
            ?? getAiProviderColorIcon(providerKey)
            ?? getAiProviderIcon(providerTitle)
            ?? getAiProviderIcon(providerKey))

    return {
        providerTitle,
        modelTitle,
        icon,
        label,
    }
}

export function createMediaModelBadge(config: MediaModelBadgeConfig): HTMLElement | null {
    const { providerTitle, modelTitle, icon, label } = getMediaModelBadgeMeta(config)
    const visibleLabel = config.iconOnly ? '' : label
    if (!icon && !visibleLabel) return null

    const separator = providerTitle && modelTitle
        ? settings.mediaNode.generatedMediaChrome.modelBadgeSeparator
        : ''

    return html`
        <div className=${`media-model-badge${config.iconOnly ? ' media-model-badge-icon-only' : ''}`} title=${label}>
            ${icon ? html`<span className="media-model-badge-icon" innerHTML=${icon}></span>` : null}
            ${visibleLabel ? html`<span className="media-model-badge-name">${
                providerTitle ? html`<span className="media-model-badge-provider">${providerTitle}</span>` : null
            }${separator}${
                modelTitle ? html`<span className="media-model-badge-model">${modelTitle}</span>` : null
            }</span>` : null}
        </div>
    ` as HTMLElement
}

export function renderMediaModelBadge(host: HTMLElement, config: MediaModelBadgeConfig): void {
    const modelBadge = createMediaModelBadge(config)
    host.replaceChildren()
    if (modelBadge) {
        host.appendChild(modelBadge)
    }
    host.hidden = !modelBadge
}

export function applyMediaModelBadgeStyleProperties(host: HTMLElement, options: MediaModelBadgeStyleOptions = {}): void {
    const generatedMediaChromeStyles = settings.mediaNode.generatedMediaChrome.styles
    const scale = normalizeScale(options.scale)
    host.style.setProperty('--workspace-generated-media-chrome-icon-size', `${settings.mediaNode.generatedMediaChrome.iconSize * scale}px`)
    host.style.setProperty('--workspace-generated-media-chrome-top-gap', `${settings.mediaNode.generatedMediaChrome.topGap * scale}px`)
    host.style.setProperty('--workspace-media-model-badge-icon-gap', scaleCssLength(generatedMediaChromeStyles.modelBadgeIconGap, scale))
    host.style.setProperty('--workspace-media-model-badge-provider-color', generatedMediaChromeStyles.modelBadgeProviderColor)
    host.style.setProperty('--workspace-media-model-badge-model-color', generatedMediaChromeStyles.modelBadgeModelColor)
    host.style.setProperty('--workspace-media-model-badge-name-font-size', scaleCssLength(generatedMediaChromeStyles.modelBadgeNameFontSize, scale))
    host.style.setProperty('--workspace-media-model-badge-name-font-weight', String(generatedMediaChromeStyles.modelBadgeNameFontWeight))
    host.style.setProperty('--workspace-media-model-badge-name-line-height', String(generatedMediaChromeStyles.modelBadgeNameLineHeight))
    host.style.setProperty('--workspace-media-info-button-color', generatedMediaChromeStyles.infoButtonColor)
    host.style.setProperty('--workspace-media-info-button-hover-color', generatedMediaChromeStyles.infoButtonHoverColor)
}
