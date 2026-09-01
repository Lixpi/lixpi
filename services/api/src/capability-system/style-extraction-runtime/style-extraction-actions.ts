'use strict'

import type {
    StyleExtractionRuntimePort,
    StyleExtractionRuntimeState,
} from '@lixpi/capability-system/backend'

import { extractStyleReferenceImagesFromMessages } from './pipeline/style-extraction-state.ts'
import { runRouter } from './pipeline/stage1-router.ts'
import {
    runExtractorAxis,
    selectApplicableExtractors,
} from './pipeline/stage2-extractors.ts'
import { materializeSourceCrops } from './pipeline/stage3-crops.ts'
import { synthesizeStyle } from './pipeline/stage4-synthesis.ts'
import { generateSamples } from './pipeline/stage5-samples.ts'
import { persistStyle } from './pipeline/stage6-persist.ts'
import { createStageLogger } from './pipeline/trace.ts'
import type {
    StyleExtractionDependencies,
    StyleExtractionState,
    StageLogger,
} from './pipeline/types.ts'
import { resolveStyleExtractionInput } from './style-extraction-input-resolver.ts'

export type StyleExtractionRuntimeDependencies = StyleExtractionDependencies & {
    createLogger?: (state: StyleExtractionState) => StageLogger
    runRouter?: typeof runRouter
    runExtractorAxis?: typeof runExtractorAxis
    materializeSourceCrops?: typeof materializeSourceCrops
    synthesizeStyle?: typeof synthesizeStyle
    generateSamples?: typeof generateSamples
    persistStyle?: typeof persistStyle
    initializeInput?: typeof resolveStyleExtractionInput
}

export function createStyleExtractionRuntimePort(
    dependencies: StyleExtractionRuntimeDependencies,
): StyleExtractionRuntimePort {
    const stages = resolveStages(dependencies)
    return {
        initialize: async (input, context) => {
            const styleExtractionInput = await (dependencies.initializeInput ?? resolveStyleExtractionInput)(
                input,
                context,
            )
            return {
                input: styleExtractionInput,
                references: extractStyleReferenceImagesFromMessages(
                    styleExtractionInput.messages,
                    styleExtractionInput.sourceAssetIds,
                ),
                axisExtractions: {},
                failedAxes: [],
                sourceCrops: [],
                samples: [],
            } as unknown as StyleExtractionRuntimeState
        },
        route: async ({ state }) => {
            const runtimeState = asStyleExtractionState(state)
            const update = await stages.runRouter(
                runtimeState,
                loggerFor(dependencies, runtimeState),
                dependencies,
            )
            const routedState = { ...runtimeState, ...update }
            return {
                update: update as unknown as Partial<StyleExtractionRuntimeState>,
                applicableAxes: selectApplicableExtractors(routedState).map(extractor => extractor.axis),
            }
        },
        extractAxis: async ({ state, axis }) => {
            const runtimeState = asStyleExtractionState(state)
            return await stages.runExtractorAxis(
                runtimeState,
                axis,
                loggerFor(dependencies, runtimeState),
                dependencies,
            )
        },
        materializeSourceCrops: async ({ state }) => {
            const runtimeState = asStyleExtractionState(state)
            return await stages.materializeSourceCrops(
                runtimeState,
                loggerFor(dependencies, runtimeState),
                dependencies,
            ) as unknown as Partial<StyleExtractionRuntimeState>
        },
        synthesizeStyle: async ({ state }) => {
            const runtimeState = asStyleExtractionState(state)
            return await stages.synthesizeStyle(
                runtimeState,
                loggerFor(dependencies, runtimeState),
                dependencies,
            ) as unknown as Partial<StyleExtractionRuntimeState>
        },
        generateSamples: async ({ state }) => {
            const runtimeState = asStyleExtractionState(state)
            return await stages.generateSamples(
                runtimeState,
                loggerFor(dependencies, runtimeState),
                dependencies,
            ) as unknown as Partial<StyleExtractionRuntimeState>
        },
        persistStyle: async ({ state, allowedActionKeys }) => {
            const runtimeState = asStyleExtractionState(state)
            return await stages.persistStyle(
                runtimeState,
                loggerFor(dependencies, runtimeState),
                {
                    ...dependencies,
                    getAllowedActions: () => allowedActionKeys,
                },
            ) as unknown as Partial<StyleExtractionRuntimeState>
        },
    }
}

function resolveStages(dependencies: StyleExtractionRuntimeDependencies) {
    return {
        runRouter: dependencies.runRouter ?? runRouter,
        runExtractorAxis: dependencies.runExtractorAxis ?? runExtractorAxis,
        materializeSourceCrops: dependencies.materializeSourceCrops ?? materializeSourceCrops,
        synthesizeStyle: dependencies.synthesizeStyle ?? synthesizeStyle,
        generateSamples: dependencies.generateSamples ?? generateSamples,
        persistStyle: dependencies.persistStyle ?? persistStyle,
    }
}

function loggerFor(
    dependencies: StyleExtractionRuntimeDependencies,
    state: StyleExtractionState,
): StageLogger {
    if (dependencies.createLogger) return dependencies.createLogger(state)
    return createStageLogger({
        styleExtractionRunId: state.input.styleExtractionRunId,
    })
}

function asStyleExtractionState(state: StyleExtractionRuntimeState): StyleExtractionState {
    return state as unknown as StyleExtractionState
}
