'use strict'

import { createHash } from 'node:crypto'
import { info, err } from '@lixpi/debug-tools'
import type { StageTraceEvent } from '@lixpi/constants'

import { StreamPublisher } from '../graph/stream-publisher.ts'
import ExtractionRun from '../../models/extraction-run.ts'
import type { StageLogger } from './types.ts'

export const hashPrompt = (text: string): string =>
    createHash('sha256').update(text).digest('hex').slice(0, 16)

export const previewPrompt = (text: string, maxChars = 800): string =>
    text.length > maxChars ? `${text.slice(0, maxChars)}…` : text

export const createStageLogger = (args: {
    extractionRunId: string
    workspaceId: string
    publisher: StreamPublisher
}): StageLogger => {
    const { extractionRunId, workspaceId, publisher } = args

    const emit = (event: StageTraceEvent): void => {
        info(`[extraction:${extractionRunId}] stage=${event.stage} model=${event.modelName ?? '-'} status=${event.status} duration=${event.durationMs}ms ${event.outputSummary ?? ''}`)
        try { publisher.stageTrace(event) } catch (e) { err('stageTrace publish failed:', e) }
        // Persist async without blocking. The model is best-effort: trace is observability,
        // not the primary persistence path. Errors are logged inside appendTrace.
        void ExtractionRun.appendTrace({ extractionRunId, workspaceId, event })
    }

    const chunk = (text: string): void => {
        if (!text) return
        try { publisher.chunk(text) } catch (e) { err('chunk publish failed:', e) }
    }

    const span: StageLogger['span'] = async (stage, modelName, body, opts) => {
        const startedAt = Date.now()
        try {
            const result = await body()
            const finishedAt = Date.now()
            emit({
                extractionRunId,
                stage,
                modelName,
                promptHash: opts?.promptPreview ? hashPrompt(opts.promptPreview) : undefined,
                promptPreview: opts?.promptPreview ? previewPrompt(opts.promptPreview) : undefined,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
                status: 'ok',
                inputSummary: opts?.inputSummary,
                outputSummary: opts?.outputSummarizer ? opts.outputSummarizer(result) : undefined,
            })
            return result
        } catch (e: any) {
            const finishedAt = Date.now()
            const errorMessage = e?.message ?? String(e)
            emit({
                extractionRunId,
                stage,
                modelName,
                promptHash: opts?.promptPreview ? hashPrompt(opts.promptPreview) : undefined,
                promptPreview: opts?.promptPreview ? previewPrompt(opts.promptPreview) : undefined,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
                status: 'error',
                errorMessage,
                inputSummary: opts?.inputSummary,
            })
            throw e
        }
    }

    return { extractionRunId, emit, chunk, span }
}
