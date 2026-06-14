'use strict'

import { randomUUID } from 'crypto'
import type {
    AiModelId,
    MediaGenerationRunMeta,
    MediaRunLineageAssignment,
    ProviderName,
} from '@lixpi/constants'

export type MediaGenerationRunEventMeta = Record<string, unknown>

type MediaRunType = NonNullable<MediaGenerationRunMeta['mediaType']>

export type BuildSingleReasoningRunInput = {
    existingRun?: MediaGenerationRunMeta
    eventMeta: MediaGenerationRunEventMeta
    provider: ProviderName
    modelName?: unknown
    modelVersion?: string
}

export type BuildProviderMediaRunInput = {
    generationRun?: MediaGenerationRunMeta
    mediaModelId: AiModelId
    mediaType: MediaRunType
    mediaIndex?: number
    mediaModelCount?: number
}

export type BuildMatrixReasoningRunInput = {
    generationRequestId: string
    reasoningRunId?: string
    reasoningModelId: AiModelId
    reasoningIndex: number
    lineageAssignment?: MediaRunLineageAssignment
}

// MediaGenerationRunPlanner is the API-owned run metadata layer shared by
// single media requests, media matrix fanout, image routers, and video routers.
// It has no provider execution logic; it only assigns stable reasoning/media
// run IDs and copies lineage assignments onto the concrete media run.
export class MediaGenerationRunPlanner {
    buildSingleReasoningRun(input: BuildSingleReasoningRunInput): MediaGenerationRunMeta {
        if (input.existingRun) return input.existingRun

        const generationRequestId = this.getEventMetaString(input.eventMeta.generationRequestId) ?? `media-${randomUUID()}`
        const reasoningIndex = typeof input.eventMeta.reasoningIndex === 'number' ? input.eventMeta.reasoningIndex : 0
        const reasoningRunId = this.getEventMetaString(input.eventMeta.reasoningRunId)
            ?? this.buildReasoningRunId(generationRequestId, reasoningIndex)

        return {
            requestKind: 'single-media',
            generationRequestId,
            reasoningRunId,
            reasoningModelId: this.buildReasoningModelId(input.provider, input.modelName, input.modelVersion),
            reasoningIndex,
        }
    }

    buildMatrixReasoningRun(input: BuildMatrixReasoningRunInput): MediaGenerationRunMeta {
        return {
            requestKind: 'media-generation-matrix',
            generationRequestId: input.generationRequestId,
            reasoningRunId: input.reasoningRunId ?? this.buildReasoningRunId(input.generationRequestId, input.reasoningIndex),
            reasoningModelId: input.reasoningModelId,
            reasoningIndex: input.reasoningIndex,
            ...(input.lineageAssignment ? { lineageAssignment: input.lineageAssignment } : {}),
        }
    }

    buildReasoningRunId(generationRequestId: string, reasoningIndex: number): string {
        return `${generationRequestId}:reasoning:${reasoningIndex}`
    }

    buildMediaModelId(provider: string, model: unknown, fallbackModel: string): AiModelId {
        const modelName = typeof model === 'string' && model.trim().length > 0 ? model.trim() : fallbackModel
        return `${provider}:${modelName}` as AiModelId
    }

    buildProviderMediaRun(input: BuildProviderMediaRunInput): MediaGenerationRunMeta | undefined {
        if (!input.generationRun) return undefined

        const mediaIndex = input.mediaIndex ?? input.generationRun.mediaIndex ?? 0
        const mediaRunId = input.generationRun.mediaRunId ?? `${input.generationRun.reasoningRunId}:${input.mediaType}:${mediaIndex}`
        const mediaModelCount = input.mediaModelCount ?? 1
        const variantIndex = input.generationRun.variantIndex ?? input.generationRun.reasoningIndex * mediaModelCount + mediaIndex
        const lineageAssignment = this.buildMediaRunLineageAssignment(
            input.generationRun.lineageAssignment,
            mediaRunId,
            input.mediaModelId,
            input.mediaType,
        )

        return {
            ...input.generationRun,
            mediaRunId,
            mediaModelId: input.mediaModelId,
            mediaType: input.mediaType,
            mediaIndex,
            variantIndex,
            ...(lineageAssignment ? { lineageAssignment } : {}),
        }
    }

    buildEventMeta(
        eventMeta: MediaGenerationRunEventMeta,
        generationRun: MediaGenerationRunMeta | undefined,
    ): MediaGenerationRunEventMeta {
        if (!generationRun) return eventMeta

        return {
            ...eventMeta,
            generationRequestId: generationRun.generationRequestId,
            reasoningRunId: generationRun.reasoningRunId,
            ...(generationRun.mediaRunId ? { mediaRunId: generationRun.mediaRunId } : {}),
            reasoningModelId: generationRun.reasoningModelId,
            ...(generationRun.mediaModelId ? { mediaModelId: generationRun.mediaModelId } : {}),
            ...(generationRun.mediaType ? { mediaType: generationRun.mediaType } : {}),
            reasoningIndex: generationRun.reasoningIndex,
            ...(generationRun.mediaIndex !== undefined ? { mediaIndex: generationRun.mediaIndex } : {}),
            ...(generationRun.variantIndex !== undefined ? { variantIndex: generationRun.variantIndex } : {}),
        }
    }

    private buildReasoningModelId(provider: ProviderName, modelName: unknown, modelVersion: string | undefined): AiModelId {
        const model = typeof modelName === 'string' && modelName.trim().length > 0
            ? modelName.trim()
            : modelVersion
        return `${provider}:${model ?? 'unknown'}` as AiModelId
    }

    private buildMediaRunLineageAssignment(
        assignment: MediaRunLineageAssignment | undefined,
        mediaRunId: string,
        mediaModelId: AiModelId,
        mediaType: MediaRunType,
    ): MediaRunLineageAssignment | undefined {
        if (!assignment) return undefined
        return {
            ...assignment,
            mediaRunId,
            mediaModelId,
            mediaType,
        }
    }

    private getEventMetaString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
    }
}
