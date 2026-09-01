import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    normalizeAiModelSelectionAttr,
    normalizeMediaGenerationConfigSelectionAttr,
    parseAiModelSelectionAttr,
    parseBooleanAttr,
    parseMediaGenerationConfigSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from './model-selection-attrs.ts'

describe('parseAiModelSelectionAttr', () => {
    it('dedupes via serialization, not parsing', () => {
        expect(parseAiModelSelectionAttr(['gpt-4', 'gpt-4', 'claude', ''])).toEqual(['gpt-4', 'gpt-4', 'claude'])
        expect(parseAiModelSelectionAttr(['  ', 'claude', null as unknown as string])).toEqual(['claude'])
    })

    it('parses valid JSON arrays of strings and drops invalid entries', () => {
        expect(parseAiModelSelectionAttr('["gpt-4", "claude", "", "gpt-4", "  "]')).toEqual(['gpt-4', 'claude', 'gpt-4'])
        expect(parseAiModelSelectionAttr('not-json')).toEqual([])
        expect(parseAiModelSelectionAttr({})).toEqual([])
        expect(parseAiModelSelectionAttr(null)).toEqual([])
    })
})

describe('serializeAiModelSelectionAttr', () => {
    it('removes whitespace-only and deduplicates while preserving order', () => {
        expect(serializeAiModelSelectionAttr(['gpt-4', 'claude', 'gpt-4', '  ', ''])).toBe('["gpt-4","claude"]')
        expect(serializeAiModelSelectionAttr([])).toBe('')
    })
})

describe('normalizeAiModelSelectionAttr', () => {
    it('returns a normalized stable canonical JSON string', () => {
        expect(normalizeAiModelSelectionAttr(['gpt-4', '  ', 'claude', 'gpt-4'])).toBe('["gpt-4","claude"]')
        expect(normalizeAiModelSelectionAttr({})).toBe('')
    })
})

describe('parseMediaGenerationConfigSelectionAttr', () => {
    it('parses valid groups and drops invalid modelIds', () => {
        expect(parseMediaGenerationConfigSelectionAttr('[{"groupId":"size","modelIds":["gpt-image","",null, "gpt-video"],"values":{"a":"1","b":"","c":5}}]')).toEqual([
            {
                groupId: 'size',
                modelIds: ['gpt-image', 'gpt-video'],
                values: { a: '1' },
            },
        ])
    })

    it('returns [] for malformed JSON or wrong top-level structure', () => {
        expect(parseMediaGenerationConfigSelectionAttr('not-json')).toEqual([])
        expect(parseMediaGenerationConfigSelectionAttr('[1,2,3]')).toEqual([])
        expect(parseMediaGenerationConfigSelectionAttr({})).toEqual([])
    })
})

describe('serializeMediaGenerationConfigSelectionAttr', () => {
    it('deduplicates modelIds and keeps only truthy value strings', () => {
        expect(serializeMediaGenerationConfigSelectionAttr([
            {
                groupId: 'size',
                modelIds: ['gpt-image', 'gpt-image', '', 'gpt-video'],
                values: {
                    a: '1',
                    b: '',
                    c: 'x',
                },
            },
        ])).toBe('[{"groupId":"size","modelIds":["gpt-image","gpt-video"],"values":{"a":"1","c":"x"}}]')
        expect(serializeMediaGenerationConfigSelectionAttr([
            { groupId: '', modelIds: ['gpt'], values: {} },
        ])).toBe('')
        expect(serializeMediaGenerationConfigSelectionAttr([])).toBe('')
    })
})

describe('normalizeMediaGenerationConfigSelectionAttr', () => {
    it('parses and serializes in one stable normalization step', () => {
        const raw = '[{"groupId":"size","modelIds":["gpt-image","gpt-image",""],"values":{"a":"1","b":""}}]'
        expect(normalizeMediaGenerationConfigSelectionAttr(raw)).toBe('[{"groupId":"size","modelIds":["gpt-image"],"values":{"a":"1"}}]')
        expect(normalizeMediaGenerationConfigSelectionAttr('not-json')).toBe('')
    })
})

describe('parseBooleanAttr', () => {
    it('accepts real booleans and "true" strings only', () => {
        expect(parseBooleanAttr(true)).toBe(true)
        expect(parseBooleanAttr('true')).toBe(true)
        expect(parseBooleanAttr('false')).toBe(false)
        expect(parseBooleanAttr(false)).toBe(false)
        expect(parseBooleanAttr(1 as unknown as string)).toBe(false)
    })
})
