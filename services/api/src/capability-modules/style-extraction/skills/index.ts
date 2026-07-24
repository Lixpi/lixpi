'use strict'

import type { SkillModule } from '@lixpi/capability-system/backend'
import { createStyleExtractionAxesSkillModule } from './axes/index.ts'
import { createStyleExtractionRouterSkillModule } from './router/index.ts'
import { createStyleExtractionSynthesisSkillModule } from './synthesis/index.ts'

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

export function createStyleExtractionSkillModules(): SkillModule[] {
    return [
        createStyleExtractionRouterSkillModule(),
        createStyleExtractionAxesSkillModule(),
        createStyleExtractionSynthesisSkillModule(),
    ]
}
