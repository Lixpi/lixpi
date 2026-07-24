'use strict'

import { createInstructionSkillModule } from '@lixpi/capability-system/backend'

import { capabilityInstructionSkillStorage } from '../../../../capability-system/instruction-skill.ts'

export const STYLE_EXTRACTION_ROUTER_SKILL_ID = 'global.style-extraction-router'
export const STYLE_EXTRACTION_ROUTER_RESOURCE_ID = 'style-router-instructions'

export function createStyleExtractionRouterSkillModule() {
    return createInstructionSkillModule({
        moduleId: 'style-extraction-router',
        capabilityId: STYLE_EXTRACTION_ROUTER_SKILL_ID,
        name: 'Style Extraction Router',
        description: 'Media-neutral scene routing, subject localization, and axis dominance scoring.',
        summary: 'Routes visual references without imposing a default medium or style category.',
        tags: ['style-extraction', 'router', 'global'],
        catalogVisibility: 'internal',
        exportName: 'router',
        resourceId: STYLE_EXTRACTION_ROUTER_RESOURCE_ID,
        resourceName: 'Style Extraction Router',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, capabilityInstructionSkillStorage)
}
