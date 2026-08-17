'use strict'

import {
    type CapabilityModuleDefinition,
    type CapabilityToolPackageInstaller,
} from '../../../backend/capability-module.ts'
import {
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'
import { createActionTimelineReferenceFidelitySkillPackage } from '../skills/reference-fidelity/index.ts'
import { createActionTimelineSegmentWritingSkillPackage } from '../skills/segment-writing/index.ts'
import { createActionTimelineTimingGridSkillPackage } from '../skills/timing-grid/index.ts'
import {
    ACTION_TIMELINE_MODULE_ID,
    ACTION_TIMELINE_TOOL_ID,
    isActionTimelineCreationIntent,
    parseActionTimelineTiming,
} from '../shared/action-timeline.ts'
import {
    registerActionTimelineActions,
    type ActionTimelineBackendDependencies,
} from './action-timeline-actions.ts'
import {
    seedActionTimelineTool,
    type ActionTimelineCapabilityStorage,
} from './action-timeline-definition.ts'

export type ActionTimelineModuleDependencies = ActionTimelineBackendDependencies & {
    capabilityStorage: ActionTimelineCapabilityStorage & InstructionSkillStorage
}

export function createActionTimelineModule(
    dependencies: ActionTimelineModuleDependencies,
): CapabilityModuleDefinition {
    return {
        moduleId: ACTION_TIMELINE_MODULE_ID,
        name: 'Action Timeline',
        normalizedName: 'action timeline',
        summary: 'Creates reusable, editable timed action and shot plans.',
        tags: ['timeline', 'shot-plan', 'storyboard', 'artifact'],
        descriptionSheet: {
            purpose: 'Creates a reusable Artifact that breaks an action or shot into timed prompt segments.',
            expectedInputs: [
                {
                    name: 'Action prompt',
                    requirement: 'required',
                    accepts: ['prompt'],
                    description: 'Describe the action, shot progression, and important beats.',
                },
                {
                    name: 'Reference Assets',
                    requirement: 'optional',
                    accepts: ['image', 'video', 'artifact'],
                    description: 'Attach source Assets that should inform subjects, staging, or visual continuity.',
                },
                {
                    name: 'Duration',
                    requirement: 'required',
                    accepts: ['parameters'],
                    description: 'Set the total timeline duration.',
                },
                {
                    name: 'Precision',
                    requirement: 'required',
                    accepts: ['parameters'],
                    description: 'Set the timing increment used to divide and align action segments.',
                },
            ],
            bestResults: [
                'Write explicit action beats in the order they should happen.',
                'Give concrete timing or pacing constraints for important transitions.',
            ],
            limitations: [
                'The result is an editable Artifact plan, not generated image or video media.',
                'Timing describes intended beats and does not guarantee a media model will reproduce them exactly.',
            ],
            executionCharacteristics: {
                cost: 'low',
                latency: 'low',
                summary: 'Produces structured timeline data with one selected reasoning model and no media generation.',
            },
        },
        entry: { capabilityId: ACTION_TIMELINE_TOOL_ID, kind: 'tool' },
        tools: [createActionTimelineToolPackage(dependencies)],
        skills: createActionTimelineSkillPackages(dependencies.capabilityStorage),
        routing: {
            resolve: prompt => {
                if (!isActionTimelineCreationIntent(prompt)) return undefined
                const timing = parseActionTimelineTiming(prompt)
                return {
                    capabilityId: ACTION_TIMELINE_TOOL_ID,
                    kind: 'tool',
                    input: timing,
                    missingInputFields: [
                        ...(!timing.durationMs ? ['durationMs'] : []),
                        ...(!timing.precisionMs ? ['precisionMs'] : []),
                    ],
                }
            },
        },
    }
}

function createActionTimelineToolPackage(
    dependencies: ActionTimelineModuleDependencies,
): CapabilityToolPackageInstaller {
    return {
        kind: 'tool',
        capabilityId: ACTION_TIMELINE_TOOL_ID,
        registerActions: registry => registerActionTimelineActions(registry, dependencies),
        seed: async context => await seedActionTimelineTool(context, dependencies.capabilityStorage),
    }
}

function createActionTimelineSkillPackages(storage: InstructionSkillStorage) {
    return [
        createActionTimelineTimingGridSkillPackage(storage),
        createActionTimelineSegmentWritingSkillPackage(storage),
        createActionTimelineReferenceFidelitySkillPackage(storage),
    ]
}

export * from './action-timeline-actions.ts'
export * from './action-timeline-definition.ts'
