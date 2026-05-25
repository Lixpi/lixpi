'use strict'

import { info, err } from '@lixpi/debug-tools'
import type NatsService from '@lixpi/nats-service'

import ExtractionRun from '../../models/extraction-run.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'

import { createStageLogger } from './trace.ts'
import { runRouter } from './stage1-router.ts'
import { runExtractors } from './stage2-extractors.ts'
import { materializeSourceCrops } from './stage3-crops.ts'
import { synthesizeFeature } from './stage4-synthesis.ts'
import { generateSamples } from './stage5-samples.ts'
import { persistFeature } from './stage6-persist.ts'

import type { ExtractionDeps, ExtractionInput, ExtractionState, ReferenceImage } from './types.ts'

// Side-effect imports register extractors with the registry. Adding a new axis
// is one new file in extractors/ plus an import line here; everything else is
// generic and walks the registry.
import './extractors/palette-extractor.ts'
import './extractors/medium-signature-extractor.ts'
import './extractors/character-design-extractor.ts'
import './extractors/lighting-extractor.ts'
import './extractors/composition-extractor.ts'
import './extractors/mood-extractor.ts'
import './extractors/background-treatment-extractor.ts'
import './extractors/edge-treatment-extractor.ts'
import './extractors/line-quality-extractor.ts'
import './extractors/surface-texture-extractor.ts'

export type ExtractionResult = {
    state: ExtractionState
    success: boolean
    error?: string
}

// Pulls every image_url out of input messages and turns them into ReferenceImages
// the pipeline can route to extractors and sharp. The router stage and crop stage
// reference these by imageRef (input-0, input-1, ...).
const extractReferenceImagesFromMessages = (messages: ExtractionInput['messages']): ReferenceImage[] => {
    const refs: ReferenceImage[] = []
    let idx = 0
    for (const message of messages) {
        const content = message.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
            if (!block || typeof block !== 'object') continue
            if ((block as any).type !== 'input_image') continue
            const url = (block as any).image_url
            if (typeof url === 'string' && url) {
                refs.push({ imageRef: `input-${idx++}`, url })
            }
        }
    }
    return refs
}

export class ExtractionOrchestrator {
    constructor(
        private readonly natsService: NatsService,
        private readonly deps: ExtractionDeps,
    ) {}

    async run(input: ExtractionInput): Promise<ExtractionResult> {
        const publisher = new StreamPublisher(
            this.natsService,
            input.workspaceId,
            input.extractionRunId,
            input.analysisProvider,
        )
        const logger = createStageLogger({
            extractionRunId: input.extractionRunId,
            workspaceId: input.workspaceId,
            publisher,
        })

        const references = extractReferenceImagesFromMessages(input.messages)
        const initial: ExtractionState = {
            input,
            references,
            axisExtractions: {},
            failedAxes: [],
            sourceCrops: [],
            samples: [],
        }

        try {
            publisher.start()
            info(`[extraction:${input.extractionRunId}] orchestrator start — references=${references.length} intent=${JSON.stringify(input.intent ?? '')}`)

            // Stage 1 — router (sequential, blocking; everything else depends on this)
            await ExtractionRun.updateStatus({ extractionRunId: input.extractionRunId, workspaceId: input.workspaceId, status: 'routing' })
            const stage1 = await runRouter(initial, logger, this.deps)
            mergeInto(initial, stage1)

            // Stages 2 + 3 — parallel: extractors and source crops both depend on stage 1 but are independent of each other
            await ExtractionRun.updateStatus({ extractionRunId: input.extractionRunId, workspaceId: input.workspaceId, status: 'extracting_axes' })
            const [stage2, stage3] = await Promise.all([
                runExtractors(initial, logger, this.deps),
                materializeSourceCrops(initial, logger, this.deps),
            ])
            mergeInto(initial, stage2)
            mergeInto(initial, stage3)

            // Stage 4 — synthesis (depends on stage 1 + 2 + 3)
            await ExtractionRun.updateStatus({ extractionRunId: input.extractionRunId, workspaceId: input.workspaceId, status: 'synthesizing' })
            const stage4 = await synthesizeFeature(initial, logger, this.deps)
            mergeInto(initial, stage4)

            // Stage 5 — samples (depends on stage 4)
            await ExtractionRun.updateStatus({ extractionRunId: input.extractionRunId, workspaceId: input.workspaceId, status: 'generating_samples' })
            const stage5 = await generateSamples(initial, logger, this.deps)
            mergeInto(initial, stage5)

            // Stage 6 — persist (depends on everything)
            await ExtractionRun.updateStatus({ extractionRunId: input.extractionRunId, workspaceId: input.workspaceId, status: 'saving' })
            const stage6 = await persistFeature(initial, logger, this.deps)
            mergeInto(initial, stage6)

            publisher.end()
            info(`[extraction:${input.extractionRunId}] orchestrator finished — featureId=${initial.featureId ?? '<stub>'}`)
            return { state: initial, success: !initial.error, error: initial.error }
        } catch (e: any) {
            const message = e?.message ?? String(e)
            err(`[extraction:${input.extractionRunId}] orchestrator failed: ${message}`)
            try { publisher.error(message) } catch {}
            try { publisher.end() } catch {}
            await ExtractionRun.markFailed({ extractionRunId: input.extractionRunId, workspaceId: input.workspaceId, error: message }).catch(() => {})
            return { state: initial, success: false, error: message }
        }
    }
}

const mergeInto = (state: ExtractionState, update: Partial<ExtractionState>): void => {
    for (const [key, value] of Object.entries(update)) {
        if (value !== undefined) (state as any)[key] = value
    }
}
