'use strict'

import type { CapabilityModuleDefinition } from '@lixpi/capability-system/backend'

import { createStyleExtractionSkillPackages } from './skills/index.ts'
import {
    createStyleExtractionToolPackage,
    STYLE_EXTRACTION_CAPABILITY_IDS,
    type StyleExtractionActionDependencies,
} from './tools/index.ts'

export function createStyleExtractionModule(
    dependencies: StyleExtractionActionDependencies,
): CapabilityModuleDefinition {
    return {
        moduleId: 'style-extraction',
        name: 'Style Extraction',
        normalizedName: 'style extraction',
        summary: 'Extracts reusable visual traits through routed specialist analysis.',
        tags: ['style', 'visual-analysis', 'extraction'],
        entry: { capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool, kind: 'tool' },
        tools: [createStyleExtractionToolPackage(dependencies)],
        skills: createStyleExtractionSkillPackages(),
    }
}
