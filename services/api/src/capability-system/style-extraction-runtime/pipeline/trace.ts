'use strict'

import { createHash } from 'node:crypto'
import { info } from '@lixpi/debug-tools'
import type {
    StageLogger,
    StageTraceEvent,
} from './types.ts'

export const hashPrompt = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

export const previewPrompt = (text: string, maxChars = 800): string => text.length > maxChars ? `${text.slice(0, maxChars)}…` : text

export const createStageLogger = (args: {
    styleExtractionRunId: string
    onTrace?: (event: StageTraceEvent) => void
    onChunk?: (text: string) => void
}): StageLogger => {
    const { styleExtractionRunId } = args

    const emit = (event: StageTraceEvent): void => {
        info(`[style-extraction:${styleExtractionRunId}] stage=${event.stage} model=${event.modelName ?? '-'} status=${event.status} duration=${event.durationMs}ms ${event.outputSummary ?? ''}`)
        args.onTrace?.(event)
    }

    const chunk = (text: string): void => {
        if (!text) return
        args.onChunk?.(text)
    }

    const span: StageLogger['span'] = async (stage, modelName, body, opts) => {
        const startedAt = Date.now()
        // Emit an in-flight marker before the terminal stage event.
        emit({
            styleExtractionRunId,
            stage,
            modelName,
            promptHash: opts?.promptPreview ? hashPrompt(opts.promptPreview) : undefined,
            promptPreview: opts?.promptPreview ? previewPrompt(opts.promptPreview) : undefined,
            startedAt,
            finishedAt: 0,
            durationMs: 0,
            status: 'running',
            inputSummary: opts?.inputSummary,
        })
        try {
            const result = await body()
            const finishedAt = Date.now()
            emit({
                styleExtractionRunId,
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
                styleExtractionRunId,
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

    return { styleExtractionRunId, emit, chunk, span }
}
