'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const REFERENCE_FIDELITY_SKILL_ID = 'global.reference-fidelity'
export const REFERENCE_FIDELITY_RESOURCE_ID = 'reference-fidelity'

export function createReferenceFidelitySkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: REFERENCE_FIDELITY_SKILL_ID,
        name: 'Reference Fidelity',
        description: 'Identity and design consistency rules for authorized reference Assets.',
        summary: 'Preserves identity and construction while excluding reference composition leakage.',
        tags: ['character', 'identity', 'references'],
        exportName: 'reference-fidelity',
        resourceId: REFERENCE_FIDELITY_RESOURCE_ID,
        resourceName: 'Reference Fidelity',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
