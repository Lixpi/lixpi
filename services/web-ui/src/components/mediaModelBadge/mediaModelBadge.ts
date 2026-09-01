import { settings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    getAiModelIcon,
    getAiProviderColorIcon,
    getAiProviderIcon,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'
import {
    applyMediaModelBadgeStyleProperties as applySharedMediaModelBadgeStyleProperties,
    type MediaModelBadgeConfig as SharedMediaModelBadgeConfig,
} from '@lixpi/ui-kit/components/media-model-badge'

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
    const colonIndex = modelId.indexOf(':')
    if (colonIndex > 0) {
        return {
            provider: modelId.slice(0, colonIndex),
            model: modelId.slice(colonIndex + 1),
        }
    }

    const slashIndex = modelId.indexOf('/')
    if (slashIndex > 0) {
        return {
            provider: modelId.slice(0, slashIndex),
            model: modelId.slice(slashIndex + 1),
        }
    }

    return { provider: '', model: modelId }
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

export function resolveMediaModelBadgeConfig(config: MediaModelBadgeConfig): SharedMediaModelBadgeConfig {
    const { providerTitle, modelTitle, icon, label } = getMediaModelBadgeMeta(config)
    return {
        providerTitle,
        modelTitle,
        icon,
        label,
        separator: settings.mediaNode.generatedMediaChrome.modelBadgeSeparator,
        iconOnly: config.iconOnly,
    }
}

export function applyMediaModelBadgeStyleProperties(host: HTMLElement, options: MediaModelBadgeStyleOptions = {}): void {
    const generatedMediaChromeStyles = settings.mediaNode.generatedMediaChrome.styles
    const scale = normalizeScale(options.scale)
    applySharedMediaModelBadgeStyleProperties(host, {
        iconSize: `${settings.mediaNode.generatedMediaChrome.iconSize * scale}px`,
        topGap: `${settings.mediaNode.generatedMediaChrome.gap * scale}px`,
        iconGap: scaleCssLength(generatedMediaChromeStyles.modelBadgeIconGap, scale),
        providerColor: generatedMediaChromeStyles.modelBadgeProviderColor,
        modelColor: generatedMediaChromeStyles.modelBadgeModelColor,
        nameFontSize: scaleCssLength(generatedMediaChromeStyles.modelBadgeNameFontSize, scale),
        nameFontWeight: String(generatedMediaChromeStyles.modelBadgeNameFontWeight),
        nameLineHeight: String(generatedMediaChromeStyles.modelBadgeNameLineHeight),
    })
    host.style.setProperty('--canvas-node-footer-color', generatedMediaChromeStyles.infoButtonColor)
    host.style.setProperty('--canvas-node-footer-hover-color', generatedMediaChromeStyles.infoButtonHoverColor)
}
