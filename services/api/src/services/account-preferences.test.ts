import {
    describe,
    expect,
    it,
} from 'vitest'
import { themeNames } from '@lixpi/themes'
import { parseAccountPreferences } from './account-preferences.ts'

describe('account preferences', () => {
    it.each([...themeNames, 'system'])('accepts appearance preference %s independently', appearance => void expect(parseAccountPreferences({ appearance })).toEqual({ appearance }))

    it('accepts both agent controls independently of appearance', () => {
        const agent = {
            contextMode: 'mixed',
            midRunPolicy: 'queue',
        }
        expect(parseAccountPreferences({ agent })).toEqual({ agent })
    })

    it.each([
        {},
        { appearance: 'unknown' },
        {
            appearance: 'system',
            userId: 'other-user',
        },
        { agent: { contextMode: 'explicit' } },
        { agent: {
            contextMode: 'invalid',
            midRunPolicy: 'queue',
        } },
        { agent: {
            contextMode: 'mixed',
            midRunPolicy: 'steer',
            models: {},
        } },
    ])('rejects invalid or unrelated preferences', value => void expect(() => parseAccountPreferences(value)).toThrow('INVALID_ACCOUNT_PREFERENCES'))
})
