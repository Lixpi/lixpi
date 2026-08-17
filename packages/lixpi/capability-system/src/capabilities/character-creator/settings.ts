'use strict'

// Character Creator capability settings. Every tunable this capability owns
// lives here, in the capability itself. Same shape as
// the consuming frontend and backend settings.
export type CharacterCreatorSettings = {
    actionTimeoutsMs: {
        validateRequest: number
        buildRenderPlan: number
    }
}

export const characterCreatorSettings: CharacterCreatorSettings = {
    actionTimeoutsMs: {
        validateRequest: 1000,
        buildRenderPlan: 1000,
    },
}
