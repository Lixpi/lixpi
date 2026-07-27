'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const STYLE_EXTRACTION_SYNTHESIS_SKILL_ID = 'global.style-extraction-synthesis'
export const STYLE_EXTRACTION_SYNTHESIS_RESOURCE_ID = 'style-synthesis-instructions'

export function createStyleExtractionSynthesisSkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: STYLE_EXTRACTION_SYNTHESIS_SKILL_ID,
        name: 'Style Extraction Synthesis',
        description: 'Dominance-weighted synthesis, negative constraints, and sample recommendations.',
        summary: 'Synthesizes grounded axis results into reusable visual instructions.',
        tags: ['style-extraction', 'synthesis', 'global'],
        exportName: 'synthesis',
        resourceId: STYLE_EXTRACTION_SYNTHESIS_RESOURCE_ID,
        resourceName: 'Style Extraction Synthesis',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
