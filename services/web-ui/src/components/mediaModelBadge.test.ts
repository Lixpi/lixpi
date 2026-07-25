import { describe, it, expect, afterEach } from 'vitest'
import {
    getMediaModelBadgeMeta,
    createMediaModelBadge,
    renderMediaModelBadge,
    applyMediaModelBadgeStyleProperties,
} from '$src/components/mediaModelBadge.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { settings } from '$src/settings.ts'
import {
    geminiIcon,
    gptAvatarIcon,
    stabilityIcon,
} from '$src/svgIcons/index.ts'

function setMockModels(models: Array<{ provider?: string; model?: string; title?: string; providerTitle?: string; colorIconName?: string }>): void {
    aiModelsStore.setAiModels(models as any)
}

function createHost(): HTMLElement {
    return document.createElement('div')
}

afterEach(() => {
    aiModelsStore.resetStore()
    document.body.innerHTML = ''
})

describe('getMediaModelBadgeMeta', () => {
    it('finds provider/model metadata and builds a normalized label', () => {
        setMockModels([
            {
                provider: 'openai',
                model: 'gpt-4o-mini',
                title: 'GPT-4o mini',
                providerTitle: 'OpenAI',
                colorIconName: 'gptAvatarIcon',
            },
        ])

        const meta = getMediaModelBadgeMeta({ modelId: 'openai:gpt-4o-mini' })

        expect(meta.providerTitle).toBe('OpenAI')
        expect(meta.modelTitle).toBe('GPT-4o mini')
        expect(meta.label).toBe(`OpenAI${settings.mediaNode.generatedMediaChrome.modelBadgeSeparator}GPT-4o mini`)
        expect(meta.icon).toContain('<svg')
    })

    it('normalizes model/provider casing when resolving catalog entries', () => {
        setMockModels([
            {
                provider: 'OpenAI',
                model: 'gpt-4o-mini',
                title: 'Case Fold',
            },
        ])

        const meta = getMediaModelBadgeMeta({ modelId: 'OPENAI:GPT-4O-MINI', modelProvider: 'OpenAI' })

        expect(meta.providerTitle).toBe('OPENAI')
        expect(meta.modelTitle).toBe('Case Fold')
        expect(meta.label).toContain('OPENAI')
        expect(meta.label).toContain('Case Fold')
    })

    it('falls back to provider-based labels and icons when no catalog match exists', () => {
        const meta = getMediaModelBadgeMeta({ modelId: 'not-in-catalog-model', modelProvider: 'Anthropic' })

        expect(meta.providerTitle).toBe('Anthropic')
        expect(meta.modelTitle).toBe('not-in-catalog-model')
        expect(meta.label).toContain('Anthropic')
        expect(meta.icon).toContain('<svg')
    })

    it('returns empty values when model and provider cannot be resolved', () => {
        const meta = getMediaModelBadgeMeta({ modelId: '', modelProvider: '' })

        expect(meta.providerTitle).toBe('')
        expect(meta.modelTitle).toBe('')
        expect(meta.label).toBe('')
        expect(meta.icon).toBeNull()
    })

    it('uses a model-specific icon before falling back to provider icons', () => {
        setMockModels([
            {
                provider: 'openai',
                model: 'gpt-4o-mini',
                title: 'GPT-4o mini',
                providerTitle: 'OpenAI',
                colorIconName: 'stabilityIcon',
            },
        ])

        const meta = getMediaModelBadgeMeta({ modelId: 'openai:gpt-4o-mini', modelProvider: 'Anthropic' })

        expect(meta.providerTitle).toBe('OpenAI')
        expect(meta.modelTitle).toBe('GPT-4o mini')
        expect(meta.label).toBe(`OpenAI${settings.mediaNode.generatedMediaChrome.modelBadgeSeparator}GPT-4o mini`)
        expect(meta.icon).toBe(stabilityIcon)
    })

    it('does not fall back to modelProvider when modelId includes an explicit provider', () => {
        setMockModels([
            {
                provider: 'google',
                model: 'gemini-pro',
                title: 'Gemini Pro',
                providerTitle: 'Google',
                colorIconName: 'gptAvatarIcon',
            },
        ])

        const meta = getMediaModelBadgeMeta({ modelId: 'openai:gemini-pro', modelProvider: 'google' })

        expect(meta.providerTitle).toBe('openai')
        expect(meta.modelTitle).toBe('gemini-pro')
        expect(meta.icon).toBe(gptAvatarIcon)
    })

    it('matches models where the model segment contains colon characters', () => {
        setMockModels([
            {
                provider: 'google',
                model: 'gemini:2.5',
                title: 'Gemini 2.5',
                providerTitle: 'Google',
                colorIconName: 'geminiIcon',
            },
        ])

        const meta = getMediaModelBadgeMeta({ modelId: 'google:gemini:2.5', modelProvider: '' })

        expect(meta.providerTitle).toBe('Google')
        expect(meta.modelTitle).toBe('Gemini 2.5')
        expect(meta.label).toBe(`Google${settings.mediaNode.generatedMediaChrome.modelBadgeSeparator}Gemini 2.5`)
    })

    it('uses provider iconography for monochrome mode even when a model icon exists', () => {
        setMockModels([
            {
                provider: 'openai',
                model: 'gpt-4o',
                title: 'GPT-4o',
                providerTitle: 'OpenAI',
                colorIconName: 'geminiIcon',
            },
        ])

        const meta = getMediaModelBadgeMeta({ modelId: 'openai:gpt-4o', monochromeIcon: true })

        expect(meta.icon).toBe(gptAvatarIcon)
        expect(meta.icon).not.toBe(geminiIcon)
        expect(meta.providerTitle).toBe('OpenAI')
        expect(meta.modelTitle).toBe('GPT-4o')
    })
})

describe('createMediaModelBadge', () => {
    it('returns null when there is no icon and no label', () => {
        expect(createMediaModelBadge({ modelId: '', modelProvider: '' })).toBeNull()
    })

    it('renders provider and model labels with icon when metadata exists', () => {
        setMockModels([
            {
                provider: 'google',
                model: 'gemini-pro',
                title: 'Gemini Pro',
            },
        ])

        const badge = createMediaModelBadge({ modelId: 'google:gemini-pro', modelProvider: 'google' })

        expect(badge).not.toBeNull()
        expect(badge?.className).toContain('media-model-badge')
        expect(badge?.title).toBe(`google${settings.mediaNode.generatedMediaChrome.modelBadgeSeparator}Gemini Pro`)
        expect(badge?.querySelector('.media-model-badge-provider')?.textContent).toBe('google')
        expect(badge?.querySelector('.media-model-badge-model')?.textContent).toBe('Gemini Pro')
        expect(badge?.querySelector('.media-model-badge-icon')).not.toBeNull()
    })

    it('hides text when iconOnly is true but preserves icon and title label semantics', () => {
        setMockModels([
            {
                provider: 'openai',
                model: 'gpt-4o',
                title: 'GPT-4o',
                providerTitle: 'OpenAI',
                colorIconName: 'gptAvatarIcon',
            },
        ])

        const badge = createMediaModelBadge({ modelId: 'openai:gpt-4o', iconOnly: true })

        expect(badge?.className).toContain('media-model-badge-icon-only')
        expect(badge?.querySelector('.media-model-badge-icon')).not.toBeNull()
        expect(badge?.querySelector('.media-model-badge-name')).toBeNull()
        expect(badge?.title).toBe(`OpenAI${settings.mediaNode.generatedMediaChrome.modelBadgeSeparator}GPT-4o`)
    })

    it('keeps only provider text for provider-only metadata and no model value', () => {
        const badge = createMediaModelBadge({ modelId: '', modelProvider: 'Anthropic' })

        expect(badge).not.toBeNull()
        expect(badge?.querySelector('.media-model-badge-provider')?.textContent).toBe('Anthropic')
        expect(badge?.querySelector('.media-model-badge-model')).toBeNull()
        expect(badge?.querySelector('.media-model-badge-name')?.textContent).toBe('Anthropic')
    })

    it('prefers provider icon when monochrome mode is requested', () => {
        setMockModels([
            {
                provider: 'openai',
                model: 'gpt-4o-mini',
                title: 'GPT-4o Mini',
                providerTitle: 'OpenAI',
                colorIconName: 'geminiIcon',
            },
        ])

        const badge = createMediaModelBadge({ modelId: 'openai:gpt-4o-mini', iconOnly: true, monochromeIcon: true })
        const expectedIconContainer = document.createElement('div')
        expectedIconContainer.innerHTML = gptAvatarIcon
        const expectedIconPath = expectedIconContainer.querySelector('path')?.getAttribute('d')
        const badgeIconPath = badge?.querySelector('.media-model-badge-icon')?.querySelector('path')?.getAttribute('d')

        expect(badge?.querySelector('.media-model-badge-icon')).not.toBeNull()
        expect(badgeIconPath).toBe(expectedIconPath)
        expect(badge?.title).toContain('OpenAI')
    })

    it('returns null for resolved providers that resolve to no label and no icon', () => {
        const badge = createMediaModelBadge({ modelId: '', modelProvider: '' })

        expect(badge).toBeNull()
    })
})

describe('renderMediaModelBadge', () => {
    it('adds badge DOM to host and clears host.hidden when renderable', () => {
        setMockModels([
            {
                provider: 'stability',
                model: 'sdxl',
                title: 'Stable Diffusion XL',
            },
        ])

        const host = createHost()
        host.innerHTML = '<span>old</span>'

        renderMediaModelBadge(host, { modelId: 'stability:sdxl' })

        expect(host.hidden).toBe(false)
        expect(host.children).toHaveLength(1)
        expect(host.firstElementChild?.classList.contains('media-model-badge')).toBe(true)
        expect(host.querySelector('.media-model-badge-provider')?.textContent).toBe('stability')
    })

    it('removes content and hides host when no badge can be produced', () => {
        const host = createHost()
        host.innerHTML = '<span>old</span>'

        renderMediaModelBadge(host, { modelId: '', modelProvider: '' })

        expect(host.hidden).toBe(true)
        expect(host.children).toHaveLength(0)
    })

    it('adds icon-only badge without model text when iconOnly is requested', () => {
        setMockModels([
            {
                provider: 'stability',
                model: 'sdxl',
                title: 'Stable Diffusion XL',
            },
        ])

        const host = createHost()
        renderMediaModelBadge(host, { modelId: 'stability:sdxl', iconOnly: true })

        expect(host.hidden).toBe(false)
        expect(host.querySelector('.media-model-badge-icon')).not.toBeNull()
        expect(host.querySelector('.media-model-badge-name')).toBeNull()
    })

    it('replaces host contents when rerendering with new badge config', () => {
        setMockModels([
            {
                provider: 'openai',
                model: 'gpt-4o',
                title: 'GPT-4o',
            },
        ])
        const host = createHost()

        renderMediaModelBadge(host, { modelId: 'openai:gpt-4o' })
        expect(host.querySelector('.media-model-badge-provider')?.textContent).toBe('openai')

        host.innerHTML = '<span>old</span>'
        renderMediaModelBadge(host, { modelId: '', modelProvider: 'Anthropic', iconOnly: true })
        expect(host.hidden).toBe(false)
        expect(host.querySelector('.media-model-badge-provider')).toBeNull()
        expect(host.querySelector('.media-model-badge-name')).toBeNull()
        expect(host.querySelector('.media-model-badge-icon')).not.toBeNull()
        expect(host.querySelector('.media-model-badge')?.title).toBe('Anthropic')
    })
})

describe('applyMediaModelBadgeStyleProperties', () => {
    it('writes media badge CSS variables with default scaling', () => {
        const host = createHost()
        applyMediaModelBadgeStyleProperties(host)

        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-icon-size')).toBe(`${settings.mediaNode.generatedMediaChrome.iconSize}px`)
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-top-gap')).toBe(`${settings.mediaNode.generatedMediaChrome.gap}px`)
        expect(host.style.getPropertyValue('--workspace-media-model-badge-icon-gap')).toBe(settings.mediaNode.generatedMediaChrome.styles.modelBadgeIconGap)
        expect(host.style.getPropertyValue('--workspace-media-model-badge-provider-color')).toBe(settings.mediaNode.generatedMediaChrome.styles.modelBadgeProviderColor)
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-font-size')).toBe(settings.mediaNode.generatedMediaChrome.styles.modelBadgeNameFontSize)
    })

    it('scales pixel/font-size variables by the requested scale', () => {
        const host = createHost()
        applyMediaModelBadgeStyleProperties(host, { scale: 2 })

        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-icon-size')).toBe(`${settings.mediaNode.generatedMediaChrome.iconSize * 2}px`)
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-top-gap')).toBe(`${settings.mediaNode.generatedMediaChrome.gap * 2}px`)
        expect(host.style.getPropertyValue('--workspace-media-model-badge-icon-gap')).toBe('6px')
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-font-size')).toBe('30px')
    })

    it('falls back to scale 1 when scale is invalid', () => {
        const host = createHost()
        applyMediaModelBadgeStyleProperties(host, { scale: Number.NaN })

        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-icon-size')).toBe(`${settings.mediaNode.generatedMediaChrome.iconSize}px`)
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-top-gap')).toBe(`${settings.mediaNode.generatedMediaChrome.gap}px`)
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-font-size')).toBe(settings.mediaNode.generatedMediaChrome.styles.modelBadgeNameFontSize)
    })

    it('falls back to scale 1 when scale is zero or negative', () => {
        const host = createHost()
        applyMediaModelBadgeStyleProperties(host, { scale: 0 })
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-icon-size')).toBe(`${settings.mediaNode.generatedMediaChrome.iconSize}px`)
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-top-gap')).toBe(`${settings.mediaNode.generatedMediaChrome.gap}px`)
        applyMediaModelBadgeStyleProperties(host, { scale: -1 })
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-icon-size')).toBe(`${settings.mediaNode.generatedMediaChrome.iconSize}px`)
    })

    it('scales unitless values as a passthrough and scales css lengths by exact multiplier', () => {
        const host = createHost()
        applyMediaModelBadgeStyleProperties(host, { scale: 1.5 })

        expect(host.style.getPropertyValue('--workspace-media-model-badge-icon-gap')).toBe('4.5px')
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-font-size')).toBe('22.5px')
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-line-height')).toBe(String(settings.mediaNode.generatedMediaChrome.styles.modelBadgeNameLineHeight))
    })

    it('ignores non-finite scales and keeps unitless values stable', () => {
        const host = createHost()
        applyMediaModelBadgeStyleProperties(host, { scale: Number.POSITIVE_INFINITY })

        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-icon-size')).toBe(`${settings.mediaNode.generatedMediaChrome.iconSize}px`)
        expect(host.style.getPropertyValue('--workspace-generated-media-chrome-top-gap')).toBe(`${settings.mediaNode.generatedMediaChrome.gap}px`)
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-line-height')).toBe(String(settings.mediaNode.generatedMediaChrome.styles.modelBadgeNameLineHeight))
    })
})
