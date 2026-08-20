import { describe, expect, it } from 'vitest'
import {
    claudeIcon,
    geminiIcon,
    gptAvatarIcon,
    geminiColorIcon,
    stabilityIcon,
    bytedanceIcon,
} from '@lixpi/ui-kit/svg'
import {
    getAiModelIcon,
    getAiProviderClassSuffix,
    getAiProviderIcon,
    getAiProviderColorIcon,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'

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

describe('getAiProviderColorIcon', () => {
    it('returns the color variant for google and falls back to monochrome provider icon otherwise', () => {
        expect(getAiProviderColorIcon('google')).toBe(geminiColorIcon)
        expect(getAiProviderColorIcon('google')).not.toBe(getAiProviderIcon('google'))
        expect(getAiProviderColorIcon('Stability')).toBe(stabilityIcon)
        expect(getAiProviderColorIcon('openai')).toBe(gptAvatarIcon)
    })
})

describe('getAiProviderClassSuffix', () => {
    it('normalizes providers into deterministic class suffixes', () => {
        expect(getAiProviderClassSuffix('OpenAI')).toBe('openai')
        expect(getAiProviderClassSuffix('Some Model Provider')).toBe('some-model-provider')
        expect(getAiProviderClassSuffix('co@mp/lex')).toBe('co-mp-lex')
        expect(getAiProviderClassSuffix('Weird!Name++')).toBe('weird-name-')
        expect(getAiProviderClassSuffix(null)).toBe('unknown')
    })
})
