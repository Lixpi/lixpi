'use strict'

import { v4 as uuid } from 'uuid'
import { info } from '@lixpi/debug-tools'

import Feature from '../../models/feature.ts'
import ExtractionRun from '../../models/extraction-run.ts'
import type { ExtractionDeps, ExtractionState, StageLogger } from './types.ts'

export const persistFeature = async (state: ExtractionState, logger: StageLogger, _deps: ExtractionDeps): Promise<Partial<ExtractionState>> => {
    return await logger.span('persist', undefined, async () => {
        const draft = state.draft
        if (!draft) {
            throw new Error('Cannot persist: synthesis stage produced no draft')
        }

        const organizationId = state.input.organizationId
        if (!organizationId) {
            throw new Error('Cannot persist feature: organization context is required')
        }

        const featureId = uuid()
        if (state.references.some((reference) => !reference.assetId)) {
            throw new Error('Cannot persist feature: every source image must resolve to an Asset')
        }
        // Sample order: source crops first (kind=source-crop), then synthesized samples
        // (palette boards, texture specimens, applied-medium probes). Stable idx assignment.
        const orderedSamples = [
            ...state.sourceCrops.map((s, i) => ({ ...s, idx: i })),
            ...state.samples.map((s, i) => ({ ...s, idx: state.sourceCrops.length + i })),
        ].map((sample) => ({
            ...sample,
            imageUrl: `/api/features/${featureId}/samples/${sample.idx}`,
        }))

        const feature = await Feature.createFeature({
            featureId,
            category: draft.category,
            name: draft.name,
            summary: draft.summary,
            tags: draft.tags,
            instructions: draft.instructions,
            parameters: draft.parameters,
            sampleImages: orderedSamples,
            ownerUserId: state.input.userId,
            workspaceId: state.input.workspaceId,
            organizationId,
            sourceContext: {
                extractionRunId: state.input.extractionRunId,
                sourceWorkspaceId: state.input.workspaceId,
                sourceImages: state.references.map((ref, idx) => ({
                    idx,
                    assetId: ref.assetId!,
                    role: 'source-reference' as const,
                })),
            },
        })

        if (!feature) {
            throw new Error('Feature.createFeature returned undefined')
        }

        await ExtractionRun.markComplete({
            extractionRunId: state.input.extractionRunId,
            workspaceId: state.input.workspaceId,
            featureId,
        })

        // Stream the feature as structured content so the extraction tab can render it.
        // Goes through logger.featureCard (not the token text stream) so it can't be
        // truncated by TagAwareStream's tail buffering.
        logger.featureCard({
            featureId: feature.featureId,
            name: feature.name,
            category: feature.category,
            scope: feature.scope,
            summary: feature.summary,
            tags: feature.tags,
            sampleImages: feature.sampleImages,
        })

        info(`Feature extraction complete: ${featureId} (${feature.name}) — ${orderedSamples.length} sample refs`)
        return { featureId, feature }
    }, {
        inputSummary: `draft=${state.draft?.name ?? 'none'} samples=${state.samples.length} sourceCrops=${state.sourceCrops.length}`,
        outputSummarizer: (result) => `featureId=${result.featureId} feature=${result.feature?.name}`,
    })
}
