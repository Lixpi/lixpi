import { isThemePreference } from '@lixpi/themes'
import {
    type AccountAgentPreferences,
    type AccountPreferences,
} from '@lixpi/constants'

const invalidPreferences = (): Error => new Error('INVALID_ACCOUNT_PREFERENCES')

const preferenceRecord = (value: unknown): Record<string, unknown> => {
    if (
        value === null
        || typeof value !== 'object'
        || Array.isArray(value)
    )
        throw invalidPreferences()

    return value as Record<string, unknown>
}

const parseAgentPreferences = (value: unknown): AccountAgentPreferences => {
    const agent = preferenceRecord(value)
    const {
        contextMode,
        midRunPolicy,
    } = agent

    if (
        Object.keys(agent).length !== 2
        || (contextMode !== 'explicit' && contextMode !== 'discovery' && contextMode !== 'mixed')
        || (midRunPolicy !== 'steer' && midRunPolicy !== 'stop-first' && midRunPolicy !== 'queue')
    )
        throw invalidPreferences()

    return {
        contextMode,
        midRunPolicy,
    }
}

export const parseAccountPreferences = (value: unknown): AccountPreferences => {
    const entries = Object.entries(
        preferenceRecord(value),
    )

    if (!entries.length)
        throw invalidPreferences()

    const preferences: AccountPreferences = {}

    for (const [key, preference] of entries) {
        if (
            key === 'appearance'
            && isThemePreference(preference)
        )
            preferences.appearance = preference
        else if (key === 'agent')
            preferences.agent = parseAgentPreferences(preference)
        else
            throw invalidPreferences()
    }

    return preferences
}
