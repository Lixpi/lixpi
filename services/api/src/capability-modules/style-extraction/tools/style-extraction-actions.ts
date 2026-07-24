'use strict'

import {
    extractStyleReferenceImagesFromMessages,
    mergeStyleExtractionState,
} from './pipeline/style-extraction-state.ts'
import { runRouter } from './pipeline/stage1-router.ts'
import { runExtractorAxis, selectApplicableExtractors } from './pipeline/stage2-extractors.ts'
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
import {
    CapabilityError,
    CapabilityActionRegistry,
    type CapabilityActionValidationResult,
} from '@lixpi/capability-system/backend'
import { resolveStyleExtractionInput } from './style-extraction-input-resolver.ts'
import {
    STYLE_EXTRACTION_AXES,
    STYLE_EXTRACTION_CAPABILITY_IDS,
} from './style-extraction-definition.ts'

export type StyleExtractionActionDependencies = StyleExtractionDependencies & {
    createLogger?: (state: StyleExtractionState) => StageLogger
    runRouter?: typeof runRouter
    runExtractorAxis?: typeof runExtractorAxis
    materializeSourceCrops?: typeof materializeSourceCrops
    synthesizeStyle?: typeof synthesizeStyle
    generateSamples?: typeof generateSamples
    persistStyle?: typeof persistStyle
    extractorConcurrency?: number
    initializeInput?: typeof resolveStyleExtractionInput
}

export function registerStyleExtractionActions(
    registry: CapabilityActionRegistry,
    dependencies: StyleExtractionActionDependencies,
): void {
    const runtimeDependencies: StyleExtractionActionDependencies = {
        ...dependencies,
        getAllowedActions: () => registry.allowedActionKeys(),
    }
    const stages = resolveStages(dependencies)
    const extractorLimiter = new ActionConcurrencyLimiter(dependencies.extractorConcurrency ?? 4)
    registerIfMissing(registry, {
        key: 'style.initialize',
        timeoutMs: 1_000,
        validateInput: validateObject,
        validateOutput: validateStateOutput,
        authorize: authorizeStyleExtraction,
        execute: async (input, context) => {
            const styleExtractionInput = await (dependencies.initializeInput ?? resolveStyleExtractionInput)(input, context)
            const references = extractStyleReferenceImagesFromMessages(
                styleExtractionInput.messages,
                styleExtractionInput.sourceAssetIds,
            )
            return {
                state: {
                    input: styleExtractionInput,
                    references,
                    axisExtractions: {},
                    failedAxes: [],
                    sourceCrops: [],
                    samples: [],
                } satisfies StyleExtractionState,
            }
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `sourceAssets=${arrayLength(input.sourceAssetIds)}`,
        summarizeOutput: output => `references=${arrayLength(asRecord(asRecord(output)?.state)?.references)}`,
    })
    registerIfMissing(registry, {
        key: 'style.route',
        timeoutMs: 180_000,
        validateInput: validateStateInput,
        validateOutput: validateStateOutput,
        authorize: authorizeStyleExtraction,
        execute: async input => {
            const state = readState(input.state)
            requireInstructions(input.instructions, 'router instructions')
            const routedState = mergeCopy(
                state,
                await stages.runRouter(state, loggerFor(dependencies, state), dependencies),
            )
            const selectedAxes = new Set(selectApplicableExtractors(routedState).map(extractor => extractor.axis))
            return {
                state: routedState,
                applicableAxes: Object.fromEntries(
                    STYLE_EXTRACTION_AXES.map(axis => [axis, selectedAxes.has(axis)]),
                ),
            }
        },
        classifyRetry: classifyProviderRetry,
        summarizeInput: input => `references=${arrayLength(asRecord(input.state)?.references)}`,
        summarizeOutput: output => `scene=${String(Boolean(asRecord(asRecord(output)?.state)?.sceneAssessment))}`,
    })
    registerIfMissing(registry, {
        key: 'style.extract-axis',
        timeoutMs: 180_000,
        validateInput: validateAxisInput,
        validateOutput: validateAxisOutput,
        authorize: authorizeStyleExtraction,
        execute: async (input, context) => {
            const state = readState(input.state)
            requireInstructions(input.instructions, 'axis extraction instructions')
            return await extractorLimiter.run(
                context.signal,
                async () => await stages.runExtractorAxis(
                    state,
                    readString(input.axis, 'axis'),
                    loggerFor(dependencies, state),
                    dependencies,
                ),
            )
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `axis=${String(input.axis ?? '')}`,
        summarizeOutput: output => `extracted=${Object.keys(asRecord(output)?.axisExtractions ?? {}).length} failed=${arrayLength(asRecord(output)?.failedAxes)}`,
    })
    registerIfMissing(registry, {
        key: 'style.materialize-crops',
        timeoutMs: 180_000,
        validateInput: validateStateInput,
        validateOutput: validateCropsOutput,
        authorize: authorizeStyleExtraction,
        execute: async input => {
            const state = readState(input.state)
            return await stages.materializeSourceCrops(state, loggerFor(dependencies, state), dependencies)
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `references=${arrayLength(asRecord(input.state)?.references)}`,
        summarizeOutput: output => `crops=${arrayLength(asRecord(output)?.sourceCrops)}`,
    })
    registerIfMissing(registry, {
        key: 'style.merge-analysis',
        timeoutMs: 1_000,
        validateInput: validateMergeInput,
        validateOutput: validateStateOutput,
        authorize: authorizeStyleExtraction,
        execute: input => {
            const state = structuredClone(readState(input.state))
            const crops = asRecord(input.crops)
            if (crops) mergeStyleExtractionState(state, crops as Partial<StyleExtractionState>)
            const axes = Object.entries(input)
                .filter(([key]) => key.startsWith('axis'))
                .map(([, value]) => value)
            for (const axis of axes) {
                const update = asRecord(axis)
                if (!update) continue
                const axisExtractions = asRecord(update.axisExtractions)
                if (axisExtractions) Object.assign(state.axisExtractions, axisExtractions)
                if (Array.isArray(update.failedAxes)) state.failedAxes.push(...update.failedAxes)
            }
            return { state }
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `axes=${Object.keys(input).filter(key => key.startsWith('axis')).length} crops=${arrayLength(asRecord(input.crops)?.sourceCrops)}`,
        summarizeOutput: output => {
            const state = asRecord(asRecord(output)?.state)
            return `extracted=${Object.keys(state?.axisExtractions ?? {}).length} failed=${arrayLength(state?.failedAxes)} crops=${arrayLength(state?.sourceCrops)}`
        },
    })
    registerIfMissing(registry, {
        key: 'style.synthesize',
        timeoutMs: 180_000,
        validateInput: validateStateInput,
        validateOutput: validateStateOutput,
        authorize: authorizeStyleExtraction,
        execute: async input => {
            const state = readState(input.state)
            requireInstructions(input.instructions, 'synthesis instructions')
            return { state: mergeCopy(state, await stages.synthesizeStyle(state, loggerFor(dependencies, state), dependencies)) }
        },
        classifyRetry: classifyProviderRetry,
        summarizeInput: input => `axes=${Object.keys(asRecord(input.state)?.axisExtractions ?? {}).length}`,
        summarizeOutput: output => `draft=${String(asRecord(asRecord(output)?.state)?.draft !== undefined)}`,
    })
    registerIfMissing(registry, {
        key: 'style.generate-samples',
        timeoutMs: 300_000,
        validateInput: validateStateInput,
        validateOutput: validateStateOutput,
        authorize: authorizeStyleExtraction,
        execute: async input => {
            const state = readState(input.state)
            return { state: mergeCopy(state, await stages.generateSamples(state, loggerFor(dependencies, state), dependencies)) }
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `recommended=${arrayLength(asRecord(asRecord(input.state)?.draft)?.recommendedSampleSubjects)}`,
        summarizeOutput: output => `samples=${arrayLength(asRecord(asRecord(output)?.state)?.samples)}`,
    })
    registerIfMissing(registry, {
        key: 'style.persist',
        timeoutMs: 120_000,
        validateInput: validateStateInput,
        validateOutput: validatePersistOutput,
        authorize: authorizeStyleExtraction,
        execute: async input => {
            const state = readState(input.state)
            const finalState = mergeCopy(
                state,
                await stages.persistStyle(state, loggerFor(dependencies, state), runtimeDependencies),
            )
            return {
                state: finalState,
                capabilityId: finalState.capabilityId,
                success: !finalState.error,
                error: finalState.error,
            }
        },
        classifyRetry: error => isRetryablePersistenceError(error) ? 'retryable' : 'terminal',
        summarizeInput: input => `draft=${String(asRecord(asRecord(input.state)?.draft)?.name ?? 'none')}`,
        summarizeOutput: output => `capabilityId=${String(asRecord(output)?.capabilityId ?? '')}`,
    })
    registerIfMissing(registry, {
        key: 'visual-style.apply',
        timeoutMs: 5_000,
        validateInput: validateVisualStyleInput,
        validateOutput: validateVisualStyleOutput,
        authorize: context => context.rootCapabilityId.startsWith('visual-style.'),
        execute: (input, context) => {
            const root = context.plan.getManifest(context.rootCapabilityId)
            if (root?.manifest.tool?.toolType !== 'visual-style') {
                throw new CapabilityError(
                    'CAPABILITY_ACTION_NOT_ALLOWED',
                    'visual-style.apply requires a visual-style Tool manifest',
                )
            }
            const instructions = readResource(input.instructions, 'visual style instructions')
            const configuration = readResource(input.configuration, 'visual style configuration')
            const samples = Object.entries(input)
                .filter(([key]) => key.startsWith('sample'))
                .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
                .map(([, value]) => readResource(value, 'visual style sample'))
            const manifestBlobHash = root.manifestBlobHash
            return {
                mediaGenerationMode: 'visual-style',
                preserveUserPrompt: false,
                visualInstructions: [
                    new TextDecoder().decode(instructions.bytes),
                    'Structured visual configuration:',
                    new TextDecoder().decode(configuration.bytes),
                ].join('\n\n'),
                referenceImages: samples.map(sample =>
                    `data:${sample.ref.mediaType};base64,${Buffer.from(sample.bytes).toString('base64')}`),
                referenceImageTraceUrls: samples.map(sample =>
                    `/api/capabilities/${encodeURIComponent(context.rootCapabilityId)}/resources/${encodeURIComponent(sample.ref.resourceId)}?manifestBlobHash=${encodeURIComponent(manifestBlobHash)}`),
            }
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `samples=${Object.keys(input).filter(key => key.startsWith('sample')).length}`,
        summarizeOutput: output => `references=${arrayLength(asRecord(output)?.referenceImages)}`,
    })
}

class ActionConcurrencyLimiter {
    private active = 0
    private readonly waiting: Array<() => void> = []

    constructor(private readonly limit: number) {
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Style extractor concurrency must be positive')
    }

    async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
        await this.acquire(signal)
        try {
            return await operation()
        } finally {
            this.active -= 1
            this.waiting.shift()?.()
        }
    }

    private async acquire(signal: AbortSignal): Promise<void> {
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
        if (this.active < this.limit) {
            this.active += 1
            return
        }
        await new Promise<void>((resolve, reject) => {
            const enter = (): void => {
                signal.removeEventListener('abort', abort)
                this.active += 1
                resolve()
            }
            const abort = (): void => {
                const index = this.waiting.indexOf(enter)
                if (index >= 0) this.waiting.splice(index, 1)
                reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            }
            this.waiting.push(enter)
            signal.addEventListener('abort', abort, { once: true })
        })
    }
}

function resolveStages(dependencies: StyleExtractionActionDependencies) {
    return {
        runRouter: dependencies.runRouter ?? runRouter,
        runExtractorAxis: dependencies.runExtractorAxis ?? runExtractorAxis,
        materializeSourceCrops: dependencies.materializeSourceCrops ?? materializeSourceCrops,
        synthesizeStyle: dependencies.synthesizeStyle ?? synthesizeStyle,
        generateSamples: dependencies.generateSamples ?? generateSamples,
        persistStyle: dependencies.persistStyle ?? persistStyle,
    }
}

function loggerFor(dependencies: StyleExtractionActionDependencies, state: StyleExtractionState): StageLogger {
    if (dependencies.createLogger) return dependencies.createLogger(state)
    return createStageLogger({
        styleExtractionRunId: state.input.styleExtractionRunId,
    })
}

function authorizeStyleExtraction(context: { rootCapabilityId: string }): boolean {
    return context.rootCapabilityId === STYLE_EXTRACTION_CAPABILITY_IDS.tool
}

function mergeCopy(state: StyleExtractionState, update: Partial<StyleExtractionState>): StyleExtractionState {
    const copy = structuredClone(state)
    mergeStyleExtractionState(copy, update)
    return copy
}

function readState(value: unknown): StyleExtractionState {
    const state = asRecord(value)
    if (!state || !asRecord(state.input) || !Array.isArray(state.references)) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Style Extraction state is invalid')
    }
    return value as StyleExtractionState
}

function requireInstructions(value: unknown, label: string): void {
    const resource = asRecord(value)
    if (!(resource?.bytes instanceof Uint8Array) || resource.bytes.byteLength === 0) {
        throw new CapabilityError('CAPABILITY_RESOURCE_INVALID', `${label} are missing`)
    }
}

function readResource(value: unknown, label: string): {
    bytes: Uint8Array
    ref: { resourceId: string; mediaType: string }
} {
    const resource = asRecord(value)
    const ref = asRecord(resource?.ref)
    if (!(resource?.bytes instanceof Uint8Array)
        || typeof ref?.resourceId !== 'string'
        || typeof ref.mediaType !== 'string') {
        throw new CapabilityError('CAPABILITY_RESOURCE_INVALID', `${label} are missing`)
    }
    return { bytes: resource.bytes, ref: ref as { resourceId: string; mediaType: string } }
}

function readString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${label} is required`)
    }
    return value
}

function validateObject(value: unknown): CapabilityActionValidationResult {
    return asRecord(value) ? { valid: true } : { valid: false, message: 'Value must be an object' }
}

function validateStateInput(value: Readonly<Record<string, unknown>>): CapabilityActionValidationResult {
    return asRecord(value.state) ? { valid: true } : { valid: false, message: 'state must be an object' }
}

function validateStateOutput(value: unknown): CapabilityActionValidationResult {
    return asRecord(asRecord(value)?.state) ? { valid: true } : { valid: false, message: 'output.state must be an object' }
}

function validateAxisInput(value: Readonly<Record<string, unknown>>): CapabilityActionValidationResult {
    return asRecord(value.state) && typeof value.axis === 'string'
        ? { valid: true }
        : { valid: false, message: 'state and axis are required' }
}

function validateAxisOutput(value: unknown): CapabilityActionValidationResult {
    const output = asRecord(value)
    return output && asRecord(output.axisExtractions) && Array.isArray(output.failedAxes)
        ? { valid: true }
        : { valid: false, message: 'axis extraction output is invalid' }
}

function validateCropsOutput(value: unknown): CapabilityActionValidationResult {
    return Array.isArray(asRecord(value)?.sourceCrops)
        ? { valid: true }
        : { valid: false, message: 'sourceCrops must be an array' }
}

function validateVisualStyleInput(value: Readonly<Record<string, unknown>>): CapabilityActionValidationResult {
    return asRecord(value.instructions) && asRecord(value.configuration)
        ? { valid: true }
        : { valid: false, message: 'visual style instructions and configuration are required' }
}

function validateVisualStyleOutput(value: unknown): CapabilityActionValidationResult {
    const output = asRecord(value)
    return output?.mediaGenerationMode === 'visual-style'
        && output.preserveUserPrompt === false
        && typeof output.visualInstructions === 'string'
        && Array.isArray(output.referenceImages)
        && Array.isArray(output.referenceImageTraceUrls)
        ? { valid: true }
        : { valid: false, message: 'visual style output is invalid' }
}

function validateMergeInput(value: Readonly<Record<string, unknown>>): CapabilityActionValidationResult {
    return asRecord(value.state) && asRecord(value.crops)
        ? { valid: true }
        : { valid: false, message: 'state and crops are required' }
}

function validatePersistOutput(value: unknown): CapabilityActionValidationResult {
    const output = asRecord(value)
    return output && asRecord(output.state) && typeof output.success === 'boolean'
        ? { valid: true }
        : { valid: false, message: 'persist output is invalid' }
}

function registerIfMissing(
    registry: CapabilityActionRegistry,
    definition: Parameters<CapabilityActionRegistry['register']>[0],
): void {
    if (!registry.has(definition.key)) registry.register(definition)
}

function classifyProviderRetry(error: unknown): 'retryable' | 'terminal' {
    const message = error instanceof Error ? error.message : String(error)
    return /timeout|rate.?limit|connection|temporar|unavailable|429|502|503|504/i.test(message)
        ? 'retryable'
        : 'terminal'
}

function isRetryablePersistenceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /throttl|timeout|conflict|temporar|unavailable/i.test(message)
}

function arrayLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0
}

function asRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined
}
