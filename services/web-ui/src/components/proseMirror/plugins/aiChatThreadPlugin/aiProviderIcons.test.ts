import { describe, expect, it } from 'vitest'
import {
    claudeIcon,
    geminiIcon,
    gptAvatarIcon,
    bytedanceIcon,
} from '$src/svgIcons/index.ts'
import { getAiModelIcon, getAiProviderClassSuffix, getAiProviderIcon } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'

describe('getAiModelIcon', () => {
    it('resolves known model icon names to SVG strings', () => {
        expect(getAiModelIcon('claudeIcon')).toBe(claudeIcon)
        expect(getAiModelIcon('geminiColorIcon')).toContain('<svg')
        expect(getAiModelIcon('gptAvatarIcon')).toBe(gptAvatarIcon)
    })

    it('returns null for unknown or missing icon keys', () => {
        expect(getAiModelIcon(undefined)).toBeNull()
        expect(getAiModelIcon('not-found')).toBeNull()
        expect(getAiModelIcon(null)).toBeNull()
    })
})

describe('getAiProviderIcon', () => {
    it('normalizes and resolves core provider icons', () => {
        expect(getAiProviderIcon('anthropic')).toBe(claudeIcon)
        expect(getAiProviderIcon('OpenAI')).toBe(gptAvatarIcon)
        expect(getAiProviderIcon(' google ')).toBe(geminiIcon)
        expect(getAiProviderIcon('BYTEDANCE')).toBe(bytedanceIcon)
    })

    it('returns null for unsupported providers', () => {
        expect(getAiProviderIcon('')).toBeNull()
        expect(getAiProviderIcon('mystery')).toBeNull()
        expect(getAiProviderIcon(undefined)).toBeNull()
    })
})

describe('getAiProviderClassSuffix', () => {
    it('normalizes providers into deterministic class suffixes', () => {
        expect(getAiProviderClassSuffix('OpenAI')).toBe('openai')
        expect(getAiProviderClassSuffix('Some Model Provider')).toBe('some-model-provider')
        expect(getAiProviderClassSuffix('co@mp/lex')).toBe('co-mp-lex')
        expect(getAiProviderClassSuffix(null)).toBe('unknown')
    })
})
