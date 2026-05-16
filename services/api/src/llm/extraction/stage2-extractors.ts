'use strict'

import { warn } from '@lixpi/debug-tools'
import type { AxisExtraction } from '@lixpi/constants'

import { getExtractors } from './extractors/registry.ts'
import type { ExtractionDeps, ExtractionState, StageLogger } from './types.ts'

const DEFAULT_DOMINANCE_FLOOR = 0.3

// Stage 2 — Parallel modular extractors.
// Selects every registered extractor whose dominance score from the router
// passes the floor AND that declares itself applicable to the scene, then
// fans them out via Promise.allSettled so failures are isolated per axis.
export const runExtractors = async (state: ExtractionState, logger: StageLogger, deps: ExtractionDeps): Promise<Partial<ExtractionState>> => {
    return await logger.span('extractors', undefined, async () => {
        const scene = state.sceneAssessment
        if (!scene) return { axisExtractions: {}, failedAxes: [] }

        const intent = state.input.intent
        const extractors = getExtractors()
        const selected = extractors.filter((ext) => {
            const dominance = scene.axisDominance[ext.axis] ?? 0
            if (dominance < (ext.minDominance ?? DEFAULT_DOMINANCE_FLOOR)) return false
            if (!ext.applicableTo(scene, intent)) return false
            return true
        })

        if (selected.length === 0) {
            return { axisExtractions: {}, failedAxes: [] }
        }

        const results = await Promise.allSettled(selected.map((ext) =>
            logger.span(`extractor:${ext.axis}`, state.input.analysisModel.modelVersion, () =>
                ext.extract({ scene, state, logger, deps })
            , {
                inputSummary: `axis=${ext.axis} dominance=${scene.axisDominance[ext.axis] ?? 0}`,
                outputSummarizer: (axis: AxisExtraction) => `axis=${axis.axis} fieldKeys=[${Object.keys(axis.fields ?? {}).slice(0, 6).join(',')}]`,
            }),
        ))

        const axisExtractions: Record<string, AxisExtraction> = {}
        const failedAxes: Array<{ axis: string; error: string }> = []
        results.forEach((result, idx) => {
            const ext = selected[idx]!
            if (result.status === 'fulfilled') {
                axisExtractions[ext.axis] = result.value
            } else {
                const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
                warn(`Extractor "${ext.axis}" failed: ${message}`)
                failedAxes.push({ axis: ext.axis, error: message })
            }
        })

        return { axisExtractions, failedAxes }
    }, {
        inputSummary: `dominanceKeys=${Object.keys(state.sceneAssessment?.axisDominance ?? {}).length}`,
        outputSummarizer: (result) => `extracted=${Object.keys(result.axisExtractions ?? {}).length} failed=${(result.failedAxes ?? []).length}`,
    })
}
