import {
    claudeIcon,
    geminiIcon,
    gptAvatarIcon,
    stabilityIcon,
} from '$src/svgIcons/index.ts'

export function getAiProviderIcon(provider: string | null | undefined): string | null {
    switch (provider) {
        case 'Anthropic':
            return claudeIcon
        case 'OpenAI':
            return gptAvatarIcon
        case 'Google':
            return geminiIcon
        case 'Stability':
            return stabilityIcon
        default:
            return null
    }
}

export function getAiProviderClassSuffix(provider: string | null | undefined): string {
    return (provider || 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}
