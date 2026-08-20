'use strict'

import { describe, expect, it } from 'vitest'

import { buildBedrockModelIdPattern } from './bedrock-inference.ts'

describe('Bedrock inference model-id matching', () => {
    it('matches current pinned dateless Anthropic model ids', () => {
        const pattern = buildBedrockModelIdPattern('anthropic', 'claude-sonnet-5')
        const match = pattern.exec('anthropic.claude-sonnet-5')

        expect(match).not.toBeNull()
        expect(match?.slice(1)).toEqual([undefined, undefined, undefined])
    })

    it('matches legacy dated and version-suffixed Anthropic model ids', () => {
        const pattern = buildBedrockModelIdPattern('anthropic', 'claude-haiku-4-5')
        const match = pattern.exec('anthropic.claude-haiku-4-5-20251001-v1:0')

        expect(match?.slice(1)).toEqual(['20251001', '1', '0'])
    })

    it('matches dateless model ids that retain a Bedrock version suffix', () => {
        const pattern = buildBedrockModelIdPattern('anthropic', 'claude-opus-4-6')
        const match = pattern.exec('anthropic.claude-opus-4-6-v1')

        expect(match?.slice(1)).toEqual([undefined, '1', undefined])
    })

    it('rejects a different model family', () => {
        const pattern = buildBedrockModelIdPattern('anthropic', 'claude-sonnet-5')

        expect(pattern.test('anthropic.claude-opus-4-8')).toBe(false)
    })
})
