import {
    claudeIcon,
    geminiIcon,
    geminiColorIcon,
    gptAvatarIcon,
    stabilityIcon,
    bytedanceIcon,
} from '@lixpi/ui-kit/svg'

// Resolves a model's iconName/colorIconName (synced from ai-models-synchronization)
// to its SVG markup. Keyed by the icon-name string, not by provider, so colored
// variants such as geminiColorIcon resolve directly.
const AI_MODEL_ICONS: Record<string, string> = {
    gptAvatarIcon,
    claudeIcon,
    geminiIcon,
    geminiColorIcon,
    stabilityIcon,
    bytedanceIcon,
}

export const getAiModelIcon = (iconName: string | null | undefined): string | null => {
    if (!iconName)
        return null

    return AI_MODEL_ICONS[iconName] ?? null
}

export const getAiProviderIcon = (provider: string | null | undefined): string | null => {
    switch (
        String(provider ?? '')
            .trim()
            .toLowerCase()
    ) {
        case 'anthropic':
            return claudeIcon
        case 'openai':
            return gptAvatarIcon
        case 'google':
            return geminiIcon
        case 'stability':
            return stabilityIcon
        case 'bytedance':
            return bytedanceIcon
        default:
            return null
    }
}

export const getAiProviderColorIcon = (provider: string | null | undefined): string | null => {
    switch (
        String(provider ?? '')
            .trim()
            .toLowerCase()
    ) {
        case 'google':
            return geminiColorIcon
        default:
            return getAiProviderIcon(provider)
    }
}

export const getAiProviderClassSuffix = (provider: string | null | undefined): string => (provider || 'unknown').toLowerCase().replace(
    /[^a-z0-9-]+/g,
    '-',
)
