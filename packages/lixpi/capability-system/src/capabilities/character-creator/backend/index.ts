'use strict'

import type { CapabilityModuleDefinition } from '../../../backend/capability-module.ts'
import type { InstructionSkillStorage } from '../../../backend/instruction-skill.ts'

import {
    CHARACTER_CREATOR_TOOL_ID,
    resolveCharacterCreatorRouting,
} from '../shared/character-creator-routing.ts'
import { createCharacterCreatorSkillPackages } from '../skills/index.ts'
import { createCharacterCreatorToolPackage, type CharacterCreatorCapabilityStorage } from '../tools/index.ts'
import { CharacterSheetStrategy } from './runtime/character-sheet-strategy.ts'
import type { CharacterCreatorRuntimePorts } from './runtime/runtime-ports.ts'

export type CharacterCreatorModuleDependencies = {
    capabilityStorage: CharacterCreatorCapabilityStorage & InstructionSkillStorage
    runtime: CharacterCreatorRuntimePorts
}

export function createCharacterCreatorModule(
    dependencies: CharacterCreatorModuleDependencies,
): CapabilityModuleDefinition {
    return {
        moduleId: 'character-creator',
        name: 'Character Creator',
        normalizedName: 'character creator',
        summary: 'Creates configurable character sheets with explicit reference fidelity and user-controlled variants.',
        tags: ['character', 'image', 'turnaround'],
        descriptionSheet: {
            purpose: 'Creates a structured character design sheet from your prompt and any reference images you supply.',
            expectedInputs: [
                {
                    name: 'Character prompt',
                    requirement: 'required',
                    accepts: ['prompt'],
                    description: 'Describe the character and shot priorities in free form. The default is the required three-shot identity-and-turnaround plan; request any total from 3 to 10 when additional user-specified views are needed.',
                },
                {
                    name: 'Character references',
                    requirement: 'optional',
                    accepts: ['image'],
                    description: 'Supply 1 to 8 image Assets. The pipeline uses directly visible details as evidence and infers missing views.',
                },
            ],
            bestResults: [
                'Supply 3 to 5 high-resolution views spanning front, three-quarter, profile, and back.',
                'Include one clear frontal face occupying much of its source image and one unobstructed full body in the same outfit.',
                'Use coherent references of the same person, age, outfit, and rendering medium.',
            ],
            limitations: [
                'Facial and body fidelity is best effort, and exact identity is not guaranteed.',
                'Unseen angles, concealed clothing, body regions, footwear, and props are inferred.',
                'Conflicting references can reduce consistency even when the closest matching angle is preferred.',
                'Comparison issues are surfaced for review; the system never starts another paid attempt automatically.',
            ],
            executionCharacteristics: {
                cost: 'medium',
                latency: 'medium',
                summary: 'Generates three shots by default. Explicit 4-to-10-shot requests scale cost and latency, while every shot remains limited to one attempt.',
            },
        },
        entry: { capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' },
        tools: [createCharacterCreatorToolPackage(dependencies.capabilityStorage)],
        skills: createCharacterCreatorSkillPackages(dependencies.capabilityStorage),
        mediaStrategies: [new CharacterSheetStrategy(dependencies.runtime)],
        routing: {
            resolve: prompt => {
                const route = resolveCharacterCreatorRouting(prompt, undefined)
                return route.isCharacterCreator
                    ? {
                        capabilityId: CHARACTER_CREATOR_TOOL_ID,
                        kind: 'tool',
                        input: {},
                        missingInputFields: [],
                    }
                    : undefined
            },
        },
    }
}

export * from '../tools/index.ts'
export * from '../shared/character-creator-routing.ts'
export * from './runtime/index.ts'
