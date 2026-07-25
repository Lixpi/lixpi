'use strict'

import { createInstructionSkillModule } from '@lixpi/capability-system/backend'

import { capabilityInstructionSkillStorage } from '../../../../capability-system/instruction-skill.ts'

export const STYLE_EXTRACTION_AXES_SKILL_ID = 'global.style-extraction-axes'
export const STYLE_EXTRACTION_AXES_RESOURCE_ID = 'style-axis-instructions'

export function createStyleExtractionAxesSkillModule() {
    return createInstructionSkillModule({
        moduleId: 'style-extraction-axes',
        capabilityId: STYLE_EXTRACTION_AXES_SKILL_ID,
        name: 'Style Extraction Axes',
        description: 'Specialist visual-axis extraction instructions and failure-isolation contract.',
        summary: 'Runs visual-analysis specialists independently with grounded evidence.',
        tags: ['style-extraction', 'analysis', 'global'],
        catalogVisibility: 'internal',
        exportName: 'axes',
        resourceId: STYLE_EXTRACTION_AXES_RESOURCE_ID,
        resourceName: 'Style Extraction Axes',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, capabilityInstructionSkillStorage)
}
