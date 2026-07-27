'use strict'

import type { CapabilityModuleDefinition } from '../../../backend/capability-module.ts'
import type { InstructionSkillStorage } from '../../../backend/instruction-skill.ts'

import { createStyleExtractionSkillPackages } from '../skills/index.ts'
import {
    createStyleExtractionToolPackage,
    STYLE_EXTRACTION_CAPABILITY_IDS,
    type StyleExtractionActionDependencies,
    type StyleExtractionCapabilityStorage,
} from '../tools/index.ts'

export type StyleExtractionModuleDependencies = StyleExtractionActionDependencies & {
    capabilityStorage: StyleExtractionCapabilityStorage & InstructionSkillStorage
}

export function createStyleExtractionModule(
    dependencies: StyleExtractionModuleDependencies,
): CapabilityModuleDefinition {
    return {
        moduleId: 'style-extraction',
        name: 'Style Extraction',
        normalizedName: 'style extraction',
        summary: 'Extracts reusable visual traits through routed specialist analysis.',
        tags: ['style', 'visual-analysis', 'extraction'],
        entry: { capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool, kind: 'tool' },
        tools: [createStyleExtractionToolPackage(dependencies, dependencies.capabilityStorage)],
        skills: createStyleExtractionSkillPackages(dependencies.capabilityStorage),
    }
}

export * from '../tools/index.ts'
