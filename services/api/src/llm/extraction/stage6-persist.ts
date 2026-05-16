'use strict'

import { v4 as uuid } from 'uuid'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { info, err } from '@lixpi/debug-tools'

import Feature from '../../models/feature.ts'
import ExtractionRun from '../../models/extraction-run.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
import type { ExtractionDeps, ExtractionState, StageLogger } from './types.ts'

export const persistFeature = async (state: ExtractionState, logger: StageLogger, _deps: ExtractionDeps): Promise<Partial<ExtractionState>> => {
    return await logger.span('persist', undefined, async () => {
        const draft = state.draft
        if (!draft) {
            throw new Error('Cannot persist: synthesis stage produced no draft')
        }

        const featureId = uuid()
        // Sample order: source crops first (kind=source-crop), then synthesized samples
        // (palette boards, texture specimens, applied-medium probes). Stable idx assignment.
        const orderedSamples = [
            ...state.sourceCrops.map((s, i) => ({ ...s, idx: i })),
            ...state.samples.map((s, i) => ({ ...s, idx: state.sourceCrops.length + i })),
        ]

        const feature = await Feature.createFeature({
            featureId,
            category: draft.category,
            name: draft.name,
            summary: draft.summary,
            tags: draft.tags,
            instructions: draft.instructions,
            parameters: draft.parameters,
            sampleImages: orderedSamples,
            scope: 'workspace',
            ownerUserId: state.input.userId,
            workspaceId: state.input.workspaceId,
            sourceContext: {
                extractionRunId: state.input.extractionRunId,
                sourceWorkspaceId: state.input.workspaceId,
                sourceImages: state.references.map((ref, idx) => ({
                    idx,
                    imageUrl: ref.url,
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

        try {
            const nats = NATS_Service.getInstance()
            nats?.publish(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.CREATED, { type: 'created', feature })
        } catch (e) {
            err(`Failed to publish FEATURE_SUBJECTS.CREATE: ${e instanceof Error ? e.message : String(e)}`)
        }

        // Stream a feature_card block so the extraction tab can render the result.
        try {
            const publisher = new StreamPublisher(
                NATS_Service.getInstance()!,
                state.input.workspaceId,
                state.input.extractionRunId,
                state.input.analysisProvider,
            )
            publisher.chunk(JSON.stringify({
                type: 'feature_card',
                feature: {
                    featureId: feature.featureId,
                    name: feature.name,
                    category: feature.category,
                    scope: feature.scope,
                    summary: feature.summary,
                    tags: feature.tags,
                    sampleImages: feature.sampleImages,
                },
            }))
        } catch (e) {
            err(`Failed to stream feature_card: ${e instanceof Error ? e.message : String(e)}`)
        }

        info(`Feature extraction complete: ${featureId} (${feature.name}) — ${orderedSamples.length} sample refs`)
        return { featureId, feature }
    }, {
        inputSummary: `draft=${state.draft?.name ?? 'none'} samples=${state.samples.length} sourceCrops=${state.sourceCrops.length}`,
        outputSummarizer: (result) => `featureId=${result.featureId} feature=${result.feature?.name}`,
    })
}
