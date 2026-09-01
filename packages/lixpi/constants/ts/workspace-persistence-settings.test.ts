'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    workspacePersistenceSettings,
    type WorkspacePersistenceSettings,
} from './workspace-persistence-settings.ts'

const expectedSettings: WorkspacePersistenceSettings = {
    debounceMs: 3000,
}

// =============================================================================
// WORKSPACE PERSISTENCE SETTINGS CONTRACT
// =============================================================================

describe('workspacePersistenceSettings', () => {
    it('exports a positive integer debounce interval used by the shared settings', () => {
        expect(workspacePersistenceSettings.debounceMs).toBe(3000)
        expect(workspacePersistenceSettings.debounceMs).toBeGreaterThan(0)
        expect(Number.isInteger(workspacePersistenceSettings.debounceMs)).toBe(true)
        expect(workspacePersistenceSettings).toMatchObject(expectedSettings)
    })

    it('matches the canonical workspace persistence settings contract', () => {
        expect(workspacePersistenceSettings).toEqual(expectedSettings)
    })
})
