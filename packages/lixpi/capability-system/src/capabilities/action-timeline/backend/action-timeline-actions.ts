'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'

import {
    type CapabilityActionExecutionContext,
    CapabilityActionRegistry,
    type CapabilityActionValidationResult,
} from '../../../backend/capability-action-registry.ts'
import { CapabilityError } from '../../../shared/capability-errors.ts'
import type {
    CapabilityResolvedModelInput,
    CapabilityStructuredModelPort,
} from '../../../backend/capability-model-input.ts'
import {
    ACTION_TIMELINE_TOOL_ID,
    assertActionTimelineRuns,
    assertGeneratedSegments,
    buildActionTimelineDocument,
    createActionTimelineGrid,
    type ActionTimelineGeneratedSegment,
    type ActionTimelineGridSlot,
    type ActionTimelineInput,
    type ActionTimelineRun,
} from '../shared/action-timeline.ts'

export type ActionTimelinePersistRequest = {
    input: ActionTimelineInput
    document: object
    referencedAssetIds: string[]
    context: CapabilityActionExecutionContext
}

export type ActionTimelinePersistResult = {
    assetId: string
}

export type ActionTimelineBackendDependencies = {
    resolveModelInputs: (request: {
        assetIds: string[]
        context: CapabilityActionExecutionContext
    }) => Promise<CapabilityResolvedModelInput[]>
    model: CapabilityStructuredModelPort
    persistArtifact: (request: ActionTimelinePersistRequest) => Promise<ActionTimelinePersistResult>
}

type ValidatedTimelineRequest = {
    input: ActionTimelineInput
    grid: ActionTimelineGridSlot[]
    modelInputs: CapabilityResolvedModelInput[]
}

type TimelineBatchResponse = {
    segments: ActionTimelineGeneratedSegment[]
    continuity: string
}

const TIMELINE_BATCH_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['segments', 'continuity'],
    properties: {
        segments: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['slotIndex', 'runs'],
                properties: {
                    slotIndex: { type: 'integer', minimum: 0 },
                    runs: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            oneOf: [
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['text'],
                                    properties: { text: { type: 'string' } },
                                },
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['assetId'],
                                    properties: { assetId: { type: 'string', minLength: 1 } },
                                },
                            ],
                        },
                    },
                },
            },
        },
        continuity: { type: 'string' },
    },
} satisfies Record<string, CapabilityJsonValue>

export function registerActionTimelineActions(
    registry: CapabilityActionRegistry,
    dependencies: ActionTimelineBackendDependencies,
): void {
    registry.register({
        key: 'action-timeline.validate-request',
        timeoutMs: 60_000,
        validateInput: validateObject,
        validateOutput: validateObject,
        authorize: authorizeActionTimeline,
        execute: async (input, context) => {
            const normalized = normalizeInput(input)
            const grid = createActionTimelineGrid(normalized.durationMs, normalized.precisionMs)
            const modelInputs = await dependencies.resolveModelInputs({
                assetIds: normalized.referenceAssetIds,
                context,
            })
            if (modelInputs.length !== normalized.referenceAssetIds.length) {
                throw new CapabilityError(
                    'CAPABILITY_ACTION_INPUT_INVALID',
                    'Every Action Timeline reference Asset must resolve before generation',
                )
            }
            return { input: normalized, grid, modelInputs } satisfies ValidatedTimelineRequest
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `durationMs=${String(input.durationMs)} precisionMs=${String(input.precisionMs)} references=${arrayLength(input.referenceAssetIds)}`,
        summarizeOutput: output => `segments=${arrayLength(asRecord(output)?.grid)} references=${arrayLength(asRecord(output)?.modelInputs)}`,
    })
    registry.register({
        key: 'action-timeline.write-segments',
        timeoutMs: 15 * 60_000,
        validateInput: validatePreparedInput,
        validateOutput: validateWrittenOutput,
        authorize: authorizeActionTimeline,
        execute: async (input, context) => await writeSegments(
            readValidatedRequest(input.prepared),
            context,
            dependencies.model,
        ),
        classifyRetry: () => 'terminal',
        summarizeInput: input => `segments=${arrayLength(asRecord(input.prepared)?.grid)}`,
        summarizeOutput: output => `segments=${arrayLength(asRecord(output)?.segments)}`,
    })
    registry.register({
        key: 'action-timeline.persist-timeline',
        timeoutMs: 120_000,
        validateInput: validatePersistInput,
        validateOutput: validatePersistOutput,
        authorize: authorizeActionTimeline,
        execute: async (input, context) => {
            const prepared = readValidatedRequest(input.prepared)
            const written = readWrittenOutput(input.written)
            const document = buildActionTimelineDocument(prepared.input, written.segments)
            const persisted = await dependencies.persistArtifact({
                input: prepared.input,
                document,
                referencedAssetIds: collectReferencedAssetIds(written.segments),
                context,
            })
            return {
                outputKind: 'capabilityArtifact',
                assetId: persisted.assetId,
            }
        },
        classifyRetry: error => isRetryablePersistenceError(error) ? 'retryable' : 'terminal',
        summarizeInput: input => `segments=${arrayLength(asRecord(input.written)?.segments)}`,
        summarizeOutput: output => `assetId=${String(asRecord(output)?.assetId ?? '')}`,
        collectOutputAssetIds: output => {
            const assetId = asRecord(output)?.assetId
            return typeof assetId === 'string' ? [assetId] : []
        },
    })
}

export function planActionTimelineBatches(
    grid: readonly ActionTimelineGridSlot[],
    maxCompletionSize: number,
): ActionTimelineGridSlot[][] {
    const usableTokens = Math.max(256, maxCompletionSize - 768)
    const segmentBudget = 160
    const batchSize = Math.max(1, Math.floor(usableTokens / segmentBudget))
    const batches: ActionTimelineGridSlot[][] = []
    for (let index = 0; index < grid.length; index += batchSize) {
        batches.push(grid.slice(index, index + batchSize))
    }
    return batches
}

async function writeSegments(
    prepared: ValidatedTimelineRequest,
    context: CapabilityActionExecutionContext,
    model: CapabilityStructuredModelPort,
): Promise<{ input: ActionTimelineInput; segments: ActionTimelineGeneratedSegment[] }> {
    if (context.variant.axis !== 'reasoning-model') {
        throw new CapabilityError(
            'CAPABILITY_ACTION_INPUT_INVALID',
            'Action Timeline requires a sealed reasoning-model variant',
        )
    }
    model.assertSupportedInputs(context.variant, prepared.modelInputs)
    const authorizedAssetIds = new Set(prepared.input.referenceAssetIds)
    const batches = planActionTimelineBatches(prepared.grid, context.variant.maxCompletionSize)
    const merged: ActionTimelineGeneratedSegment[] = []
    let continuity = ''

    for (const batch of batches) {
        const requestPrompt = buildBatchPrompt(prepared.input, batch, continuity)
        const maxTokens = Math.max(256, Math.min(
            context.variant.maxCompletionSize,
            768 + batch.length * 160,
        ))
        await model.assessInputBudget({
            variant: context.variant,
            systemPrompt: ACTION_TIMELINE_SYSTEM_PROMPT,
            userPrompt: requestPrompt,
            inputs: prepared.modelInputs,
            schema: TIMELINE_BATCH_SCHEMA,
            maxTokens,
        })
        let accepted: TimelineBatchResponse | undefined
        let validationFeedback = ''
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const userPrompt = attempt === 0
                ? requestPrompt
                : `${requestPrompt}\n\nCorrection required. Return a complete replacement for this batch. Validation errors:\n${validationFeedback}`
            const result = await model.call<TimelineBatchResponse>({
                variant: context.variant,
                systemPrompt: ACTION_TIMELINE_SYSTEM_PROMPT,
                userPrompt,
                inputs: prepared.modelInputs,
                schema: TIMELINE_BATCH_SCHEMA,
                maxTokens,
                abortSignal: context.signal,
            })
            try {
                accepted = validateBatchResponse(result.parsed, batch, authorizedAssetIds)
                break
            } catch (error) {
                validationFeedback = error instanceof Error ? error.message : 'ACTION_TIMELINE_BATCH_INVALID'
            }
        }
        if (!accepted) {
            throw new CapabilityError(
                'CAPABILITY_ACTION_OUTPUT_INVALID',
                `Action Timeline batch failed validation after one correction attempt: ${validationFeedback}`,
            )
        }
        merged.push(...accepted.segments)
        continuity = accepted.continuity
    }

    assertGeneratedSegments(merged, prepared.grid, authorizedAssetIds)
    return { input: prepared.input, segments: merged.sort((left, right) => left.slotIndex - right.slotIndex) }
}

function validateBatchResponse(
    input: unknown,
    batch: readonly ActionTimelineGridSlot[],
    authorizedAssetIds: ReadonlySet<string>,
): TimelineBatchResponse {
    const record = asRecord(input)
    if (!record || !Array.isArray(record.segments) || typeof record.continuity !== 'string') {
        throw new Error('ACTION_TIMELINE_BATCH_SCHEMA_INVALID')
    }
    const segments = record.segments.map(readGeneratedSegment)
    const expectedSlots = new Set(batch.map(slot => slot.slotIndex))
    if (segments.length !== batch.length
        || segments.some(segment => !expectedSlots.has(segment.slotIndex))
        || new Set(segments.map(segment => segment.slotIndex)).size !== segments.length) {
        throw new Error(`ACTION_TIMELINE_BATCH_SLOTS_INVALID:expected=${[...expectedSlots].join(',')}`)
    }
    assertActionTimelineRuns(segments, authorizedAssetIds)
    return { segments, continuity: record.continuity }
}

function buildBatchPrompt(
    input: ActionTimelineInput,
    batch: readonly ActionTimelineGridSlot[],
    continuity: string,
): string {
    const slots = batch.map(slot => `${slot.slotIndex}: ${slot.startMs}-${slot.endMs}ms`).join('\n')
    return [
        `Original request:\n${input.prompt}`,
        `Authorized reference Asset ids: ${input.referenceAssetIds.length > 0 ? input.referenceAssetIds.join(', ') : '(none)'}`,
        `Write content for exactly these server-calculated slots:\n${slots}`,
        continuity ? `Continuity from the last accepted batch:\n${continuity}` : 'This is the first batch.',
        'Use reference runs only for authorized Asset ids. Do not calculate or return timing fields.',
    ].join('\n\n')
}

const ACTION_TIMELINE_SYSTEM_PROMPT = [
    'You write concise, visually specific action-timeline beats for image and video generation.',
    'Return every assigned slot exactly once by slotIndex.',
    'Each segment is an ordered runs array containing text runs and optional Asset reference runs.',
    'Maintain subject identity, spatial continuity, cause and effect, and a clean handoff between segments.',
    'The server owns time boundaries. Never invent timing fields.',
].join('\n')

function normalizeInput(input: Readonly<Record<string, unknown>>): ActionTimelineInput {
    const prompt = readString(input.prompt, 'prompt').trim()
    if (!prompt) throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Action Timeline prompt is required')
    const durationMs = readPositiveInteger(input.durationMs, 'durationMs')
    const precisionMs = readPositiveInteger(input.precisionMs, 'precisionMs')
    const referenceAssetIds = [...new Set(readStringArray(input.referenceAssetIds, 'referenceAssetIds'))]
    createActionTimelineGrid(durationMs, precisionMs)
    return { prompt, referenceAssetIds, durationMs, precisionMs }
}

function readValidatedRequest(input: unknown): ValidatedTimelineRequest {
    const record = asRecord(input)
    if (!record) throw new Error('ACTION_TIMELINE_PREPARED_INPUT_INVALID')
    const normalized = normalizeInput(asRecord(record.input) ?? {})
    if (!Array.isArray(record.grid) || !Array.isArray(record.modelInputs)) {
        throw new Error('ACTION_TIMELINE_PREPARED_INPUT_INVALID')
    }
    return {
        input: normalized,
        grid: record.grid as ActionTimelineGridSlot[],
        modelInputs: record.modelInputs as CapabilityResolvedModelInput[],
    }
}

function readWrittenOutput(input: unknown): { segments: ActionTimelineGeneratedSegment[] } {
    const record = asRecord(input)
    if (!record || !Array.isArray(record.segments)) throw new Error('ACTION_TIMELINE_WRITTEN_OUTPUT_INVALID')
    return { segments: record.segments.map(readGeneratedSegment) }
}

function readGeneratedSegment(input: unknown): ActionTimelineGeneratedSegment {
    const record = asRecord(input)
    if (!record || !Number.isSafeInteger(record.slotIndex) || !Array.isArray(record.runs)) {
        throw new Error('ACTION_TIMELINE_SEGMENT_SCHEMA_INVALID')
    }
    return {
        slotIndex: record.slotIndex as number,
        runs: record.runs.map(readRun),
    }
}

function readRun(input: unknown): ActionTimelineRun {
    const record = asRecord(input)
    if (!record) throw new Error('ACTION_TIMELINE_RUN_SCHEMA_INVALID')
    if (typeof record.text === 'string' && record.assetId === undefined) return { text: record.text }
    if (typeof record.assetId === 'string' && record.assetId.trim() && record.text === undefined) {
        return { assetId: record.assetId.trim() }
    }
    throw new Error('ACTION_TIMELINE_RUN_SCHEMA_INVALID')
}

function collectReferencedAssetIds(segments: readonly ActionTimelineGeneratedSegment[]): string[] {
    const seen = new Set<string>()
    const assetIds: string[] = []
    for (const segment of segments) {
        for (const run of segment.runs) {
            if (!('assetId' in run) || seen.has(run.assetId)) continue
            seen.add(run.assetId)
            assetIds.push(run.assetId)
        }
    }
    return assetIds
}

function authorizeActionTimeline(context: { rootCapabilityId: string }): boolean {
    return context.rootCapabilityId === ACTION_TIMELINE_TOOL_ID
}

function validateObject(value: unknown): CapabilityActionValidationResult {
    return asRecord(value) ? { valid: true } : { valid: false, message: 'Value must be an object' }
}

function validatePreparedInput(value: unknown): CapabilityActionValidationResult {
    const record = asRecord(value)
    return record && asRecord(record.prepared)
        ? { valid: true }
        : { valid: false, message: 'Prepared Action Timeline request is required' }
}

function validateWrittenOutput(value: unknown): CapabilityActionValidationResult {
    const record = asRecord(value)
    return record && Array.isArray(record.segments)
        ? { valid: true }
        : { valid: false, message: 'Written Action Timeline segments are required' }
}

function validatePersistInput(value: unknown): CapabilityActionValidationResult {
    const record = asRecord(value)
    return record && asRecord(record.prepared) && asRecord(record.written)
        ? { valid: true }
        : { valid: false, message: 'Prepared and written Action Timeline data is required' }
}

function validatePersistOutput(value: unknown): CapabilityActionValidationResult {
    const record = asRecord(value)
    return record?.outputKind === 'capabilityArtifact'
        && typeof record.assetId === 'string'
        ? { valid: true }
        : { valid: false, message: 'Persisted Action Timeline output is invalid' }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
}

function readString(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must be a string`)
    return value
}

function readPositiveInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must be a positive integer`)
    }
    return value as number
}

function readStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must be an array of non-empty strings`)
    }
    return value.map(item => String(item).trim())
}

function arrayLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0
}

function isRetryablePersistenceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /throttl|timeout|temporar|conflict/i.test(message)
}
