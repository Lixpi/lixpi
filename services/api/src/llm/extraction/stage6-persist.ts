'use strict'

import { v4 as uuid } from 'uuid'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { info, err } from '@lixpi/debug-tools'

import Feature from '../../models/feature.ts'
import ExtractionRun from '../../models/extraction-run.ts'
import { ensureFeatureSamplesForScope } from '../../services/feature-sample-storage.ts'
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
            ownerUserId: state.input.userId,
            workspaceId: state.input.workspaceId,
            organizationId,
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

        // Features are org-wide and outlive any single workspace, so copy sample bytes
        // from the origin workspace bucket into the durable per-owner features bucket.
        try {
            await ensureFeatureSamplesForScope({ feature, newScope: 'organization', newScopeOwnerId: organizationId })
        } catch (e) {
            err(`Failed to durably store feature samples for ${featureId}: ${e instanceof Error ? e.message : String(e)}`)
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
