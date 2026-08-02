'use strict'

// Character Creator capability settings. Every tunable this capability owns
// lives here, in the capability itself. Same shape as
// the consuming frontend and backend settings.
export type CharacterCreatorSettings = {
    actionTimeoutsMs: {
        validateRequest: number
        resolveReferences: number
        buildPrompt: number
        generateImage: number
        validateSheet: number
        buildCorrectionPrompt: number
        persistSheet: number
    }
}

export const characterCreatorSettings: CharacterCreatorSettings = {
    // Wall-clock budget for each registered action, keyed by the action it caps.
    // The capability runner aborts the action and fails its run when the budget
    // is exceeded, so a budget that is too tight turns a slow provider into a
    // failed character sheet, and one that is too loose leaves a stuck run
    // holding its slot. In-process steps get a short budget because they only do
    // local work; provider-calling steps get a budget sized to the slowest
    // acceptable response from that provider.
    actionTimeoutsMs: {
        // `character.validate-request`: shape-checks the incoming prompt and
        // reference Asset ids. Pure local validation, no I/O.
        validateRequest: 1000,
        // `asset.resolve-references`: loads and authorizes every reference Asset
        // the user attached. Storage reads for several Assets, so it needs more
        // room than a local step but is not a model call.
        resolveReferences: 30000,
        // `character.build-prompt`: assembles the image prompt from the user
        // prompt, the packaged layout example, and the skill instructions. Local
        // string and hashing work only.
        buildPrompt: 1000,
        // `image.generate`: the character sheet image generation call to the
        // provider. This is the longest step in the run and the budget must cover
        // a slow provider queue, not just its typical latency.
        generateImage: 180000,
        // `character-sheet.validate`: the vision-model pass that assesses whether
        // the generated sheet satisfies the layout and reference-fidelity rules.
        validateSheet: 90000,
        // `character.build-correction-prompt`: rewrites the prompt from the
        // validation issues before a corrective regeneration. Local work only.
        buildCorrectionPrompt: 1000,
        // `character-sheet.persist`: selects the winning sheet, uploads the image
        // bytes, and writes the Asset record. Blob upload plus database writes.
        persistSheet: 60000,
    },
}
