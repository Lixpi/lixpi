import {
    claudeIcon,
    geminiIcon,
    geminiColorIcon,
    gptAvatarIcon,
    stabilityIcon,
    bytedanceIcon,
} from '$src/svgIcons/index.ts'

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

export function getAiModelIcon(iconName: string | null | undefined): string | null {
    if (!iconName) return null
    return AI_MODEL_ICONS[iconName] ?? null
}

export function getAiProviderIcon(provider: string | null | undefined): string | null {
    switch (String(provider ?? '').trim().toLowerCase()) {
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

export function getAiProviderColorIcon(provider: string | null | undefined): string | null {
    switch (String(provider ?? '').trim().toLowerCase()) {
        case 'google':
            return geminiColorIcon
        default:
            return getAiProviderIcon(provider)
    }
}

export function getAiProviderClassSuffix(provider: string | null | undefined): string {
    return (provider || 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}
