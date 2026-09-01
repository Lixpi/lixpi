import {
    type CapabilitySkillPackageInstaller,
} from '../../../backend/capability-module.ts'
import {
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'
import { createStyleExtractionAxesSkillPackage } from './axes/index.ts'
import { createStyleExtractionRouterSkillPackage } from './router/index.ts'
import { createStyleExtractionSynthesisSkillPackage } from './synthesis/index.ts'

export {
    STYLE_EXTRACTION_AXES_RESOURCE_ID,
    STYLE_EXTRACTION_AXES_SKILL_ID,
} from './axes/index.ts'
export {
    STYLE_EXTRACTION_ROUTER_RESOURCE_ID,
    STYLE_EXTRACTION_ROUTER_SKILL_ID,
} from './router/index.ts'
export {
    STYLE_EXTRACTION_SYNTHESIS_RESOURCE_ID,
    STYLE_EXTRACTION_SYNTHESIS_SKILL_ID,
} from './synthesis/index.ts'

export function createStyleExtractionSkillPackages(storage: InstructionSkillStorage): CapabilitySkillPackageInstaller[] {
    return [
        createStyleExtractionRouterSkillPackage(storage),
        createStyleExtractionAxesSkillPackage(storage),
        createStyleExtractionSynthesisSkillPackage(storage),
    ]
}
