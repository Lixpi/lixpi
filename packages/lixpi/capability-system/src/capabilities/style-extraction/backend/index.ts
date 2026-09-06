import {
    type CapabilityModuleDefinition,
} from '../../../backend/capability-module.ts'
import {
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'

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

export const createStyleExtractionModule = (dependencies: StyleExtractionModuleDependencies): CapabilityModuleDefinition => {
    return {
        moduleId: 'style-extraction',
        name: 'Style Extraction',
        normalizedName: 'style extraction',
        summary: 'Extracts reusable visual traits through routed specialist analysis.',
        tags: ['style', 'visual-analysis', 'extraction'],
        descriptionSheet: {
            purpose: 'Extracts reusable visual-style traits and illustrative samples from supplied media.',
            expectedInputs: [
                {
                    name: 'Extraction prompt',
                    requirement: 'required',
                    accepts: ['prompt'],
                    description: 'State what style should be analyzed or which visual traits matter most.',
                },
                {
                    name: 'Source Assets',
                    requirement: 'required',
                    accepts: ['image', 'video', 'document'],
                    description: 'Supply at least one representative source Asset for visual analysis.',
                },
                {
                    name: 'Analysis model',
                    requirement: 'required',
                    accepts: ['parameters'],
                    description: 'Select the reasoning model used for structured visual analysis.',
                },
                {
                    name: 'Intent or image model',
                    requirement: 'optional',
                    accepts: ['parameters'],
                    description: 'Optionally provide generation intent or an image model for illustrative samples.',
                },
            ],
            bestResults: [
                'Use coherent, representative references that share the style you want to extract.',
                'Name the traits that matter when the sources contain several competing visual directions.',
            ],
            limitations: [
                'Mixed or conflicting media can produce a broader, less specific style profile.',
                'Generated output samples illustrate the extracted profile and are not exact source reproductions.',
            ],
            executionCharacteristics: {
                cost: 'medium',
                latency: 'medium',
                summary: 'Runs several analysis specialists and may generate sample images when an image model is selected.',
            },
        },
        entry: {
            capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
            kind: 'tool',
        },
        tools: [createStyleExtractionToolPackage(dependencies, dependencies.capabilityStorage)],
        skills: createStyleExtractionSkillPackages(dependencies.capabilityStorage),
    }
}

export * from '../tools/index.ts'
