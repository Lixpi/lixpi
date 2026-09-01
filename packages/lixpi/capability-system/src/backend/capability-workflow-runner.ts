import { v4 as uuid } from 'uuid'

import {
    type CanvasGeometryUpdate,
    type CapabilityCondition,
    type CapabilityJsonValue,
    type CapabilityRun,
    type CapabilityRunEvent,
    type CapabilityRunOrigin,
    type CapabilityReasoningModelVariant,
    type CapabilityValueBinding,
    type CapabilityWorkflowStep,
    type ExecutionTrace,
} from '@lixpi/constants'

import {
    type CapabilityActionAuthorizationContext,
    type CapabilityActionDefinition,
    type CapabilityActionRegistry,
} from './capability-action-registry.ts'
import { validateCapabilityManifest } from '../shared/capability-validation.ts'
import {
    CapabilityError,
    isCapabilityError,
} from '../shared/capability-errors.ts'
import { validateJsonSchemaValue } from '../shared/capability-json-schema.ts'
import {
    type SealedResolvedCapabilityPlan,
} from './capability-resolver.ts'
import { CapabilityDagRunner } from './capability-dag-runner.ts'
import { createCapabilityTraceRecorder } from './capability-trace-recorder.ts'

export type CapabilityRunPersistence = {
    createRun: (run: CapabilityRun) => Promise<void>
    updateRun: (run: CapabilityRun) => Promise<void>
    appendEvent: (event: CapabilityRunEvent) => Promise<void>
}

export type CapabilityWorkflowRunnerOptions = {
    registry: CapabilityActionRegistry
    persistence: CapabilityRunPersistence
    now?: () => number
    createRunId?: () => string
    createEventStreamName?: (run: CapabilityRun) => string
}

export type CapabilityWorkflowRunRequest = {
    plan: SealedResolvedCapabilityPlan
    rootCapabilityId: string
    input: Readonly<Record<string, CapabilityJsonValue>>
    userId: string
    workspaceId: string
    organizationId?: string
    conversationAssetId?: string
    origin: CapabilityRunOrigin
    invocationGenerationRequestId?: string
    signal?: AbortSignal
    onRunCreated?: (run: Readonly<CapabilityRun>) => void | Promise<void>
    onEvent?: (event: Readonly<CapabilityRunEvent>) => void | Promise<void>
    variant?: { axis: 'request'; variantKey: 'request' } | CapabilityReasoningModelVariant
}

export type CapabilityWorkflowRunResult = {
    run: CapabilityRun
    output: Record<string, CapabilityJsonValue>
    stepOutputs: Readonly<Record<string, unknown>>
    events: readonly Readonly<CapabilityRunEvent>[]
}

type StepExecutionResult = {
    step: CapabilityWorkflowStep
    status: 'completed' | 'failed' | 'cancelled'
    output?: unknown
    outputAssetIds: string[]
    canvasGeometry?: CanvasGeometryUpdate
    safeInputSummary: string
    safeOutputSummary?: string
    trace?: ExecutionTrace
    error?: unknown
}

type BindingContext = {
    input: Readonly<Record<string, CapabilityJsonValue>>
    stepOutputs: ReadonlyMap<string, unknown>
    plan: SealedResolvedCapabilityPlan
    rootCapabilityId: string
}

export class CapabilityWorkflowRunner {
    private readonly now: () => number
    private readonly createRunId: () => string
    private readonly createEventStreamName: (run: CapabilityRun) => string

    constructor(private readonly options: CapabilityWorkflowRunnerOptions) {
        this.now = options.now ?? Date.now
        this.createRunId = options.createRunId ?? uuid
        this.createEventStreamName = options.createEventStreamName
            ?? (run => `capability-run-${run.workspaceId}-${run.runId}`)
    }

    async run(request: CapabilityWorkflowRunRequest): Promise<CapabilityWorkflowRunResult> {
        const resolved = request.plan.getManifest(request.rootCapabilityId)
        if (!resolved || resolved.kind !== 'tool' || !resolved.manifest.tool) {
            throw new CapabilityError(
                'CAPABILITY_WORKFLOW_INVALID',
                `Capability ${request.rootCapabilityId} is not an executable Tool`,
            )
        }
        const validation = validateCapabilityManifest(resolved.manifest, {
            allowedActions: this.options.registry.allowedActionKeys(),
        })
        if (!validation.valid) {
            throw new CapabilityError(
                'CAPABILITY_WORKFLOW_INVALID',
                `Capability ${request.rootCapabilityId} workflow is invalid`,
                { issues: validation.issues },
            )
        }
        const inputSchema = readJsonResource(
            request.plan,
            request.rootCapabilityId,
            resolved.manifest.tool.inputSchema.resourceId,
        )
        const inputValidation = validateJsonSchemaValue(inputSchema, request.input)
        if (!inputValidation.valid) {
            throw new CapabilityError(
                'CAPABILITY_ACTION_INPUT_INVALID',
                `Capability ${request.rootCapabilityId} input does not match its schema`,
                { errors: inputValidation.errors },
            )
        }

        const runId = this.createRunId()
        const createdAt = this.now()
        let run: CapabilityRun = {
            runId,
            rootCapabilityId: request.rootCapabilityId,
            resolvedManifests: request.plan.serializable.resolvedManifests.map(item => ({ ...item })),
            workspaceId: request.workspaceId,
            conversationAssetId: request.conversationAssetId,
            origin: request.origin,
            variant: request.variant ?? { axis: 'request', variantKey: 'request' },
            status: 'pending',
            currentStepIds: [],
            outputAssetIds: [],
            eventStreamName: '',
            createdAt,
            updatedAt: createdAt,
        }
        run.eventStreamName = this.createEventStreamName(run)
        await this.options.persistence.createRun(structuredClone(run))
        await request.onRunCreated?.(Object.freeze(structuredClone(run)))

        let sequence = 0
        const runEvents: CapabilityRunEvent[] = []
        const emit = async (event: Omit<CapabilityRunEvent, 'runId' | 'sequence' | 'timestamp'>): Promise<void> => {
            sequence += 1
            const persistedEvent: CapabilityRunEvent = {
                ...event,
                runId,
                sequence,
                timestamp: this.now(),
            }
            runEvents.push(structuredClone(persistedEvent))
            await this.options.persistence.appendEvent(persistedEvent)
            await request.onEvent?.(Object.freeze(structuredClone(persistedEvent)))
        }
        const persistRun = async (patch: Partial<CapabilityRun>): Promise<void> => {
            run = {
                ...run,
                ...patch,
                resolvedManifests: run.resolvedManifests,
                updatedAt: this.now(),
            }
            await this.options.persistence.updateRun(structuredClone(run))
        }

        await persistRun({ status: 'running' })
        await emit({ eventType: 'RUN_STARTED', runStatus: 'running' })

        const workflow = resolved.manifest.tool.workflow
        const dag = new CapabilityDagRunner(workflow.steps.map(step => ({
            nodeId: step.stepId,
            dependsOn: step.dependsOn,
            step,
        })))
        const stepOutputs = new Map<string, unknown>()
        const bindingContext: BindingContext = {
            input: request.input,
            stepOutputs,
            plan: request.plan,
            rootCapabilityId: request.rootCapabilityId,
        }

        try {
            while (dag.hasPending()) {
                if (request.signal?.aborted) {
                    await this.cancelPendingSteps(dag, emit)
                    throw cancelledError(request.signal)
                }

                const ready = dag.getReadyNodes().map(node => node.step)
                if (ready.length === 0) {
                    throw new CapabilityError(
                        'CAPABILITY_WORKFLOW_INVALID',
                        'Capability workflow has pending steps that can never become ready',
                    )
                }

                const executable: CapabilityWorkflowStep[] = []
                for (const step of ready) {
                    if (step.condition && !evaluateCondition(step.condition, bindingContext)) {
                        dag.setStatus(step.stepId, 'skipped')
                        await emit({
                            eventType: 'STEP_SKIPPED',
                            runStatus: 'running',
                            stepId: step.stepId,
                            stepTitle: step.title,
                            stepStatus: 'skipped',
                        })
                        continue
                    }
                    dag.setStatus(step.stepId, 'running')
                    executable.push(step)
                }

                if (executable.length === 0) continue
                await persistRun({ currentStepIds: executable.map(step => step.stepId) })
                const executions = executable.map(step =>
                    this.executeStep({
                        step,
                        run,
                        request,
                        bindingContext,
                        emit,
                        getRunEvents: () => Object.freeze(runEvents.map(event => Object.freeze(structuredClone(event)))),
                    })
                )
                const results = await Promise.all(executions)
                let firstFailure: StepExecutionResult | undefined

                for (const result of results) {
                    dag.setStatus(result.step.stepId, result.status)
                    if (result.status === 'completed') {
                        stepOutputs.set(result.step.stepId, result.output)
                        run.outputAssetIds = deduplicateStrings([...run.outputAssetIds, ...result.outputAssetIds])
                        await emit({
                            eventType: 'STEP_COMPLETED',
                            runStatus: 'running',
                            stepId: result.step.stepId,
                            stepTitle: result.step.title,
                            stepStatus: 'completed',
                            safeInputSummary: result.safeInputSummary,
                            safeOutputSummary: result.safeOutputSummary,
                            ...(result.trace ? { trace: result.trace } : {}),
                            outputAssetIds: result.outputAssetIds,
                            ...(result.canvasGeometry ? { canvasGeometry: result.canvasGeometry } : {}),
                        })
                    } else if (result.status === 'cancelled') {
                        await emit({
                            eventType: 'STEP_CANCELLED',
                            runStatus: 'running',
                            stepId: result.step.stepId,
                            stepTitle: result.step.title,
                            stepStatus: 'cancelled',
                            safeInputSummary: result.safeInputSummary,
                            ...(result.trace ? { trace: result.trace } : {}),
                        })
                        firstFailure ??= result
                    } else {
                        const error = normalizeActionError(result.error, result.step.action)
                        await emit({
                            eventType: 'STEP_FAILED',
                            runStatus: 'running',
                            stepId: result.step.stepId,
                            stepTitle: result.step.title,
                            stepStatus: 'failed',
                            safeInputSummary: result.safeInputSummary,
                            ...(result.trace ? { trace: result.trace } : {}),
                            errorCode: error.code,
                            errorMessage: error.message,
                        })
                        firstFailure ??= result
                    }
                }

                await persistRun({
                    currentStepIds: [],
                    outputAssetIds: run.outputAssetIds,
                })
                if (firstFailure) {
                    await this.cancelPendingSteps(dag, emit)
                    if (firstFailure.status === 'cancelled') throw cancelledError(request.signal)
                    throw normalizeActionError(firstFailure.error, firstFailure.step.action)
                }
            }

            const output = resolveOutputBindings(workflow.outputs, bindingContext)
            const outputSchema = readJsonResource(
                request.plan,
                request.rootCapabilityId,
                resolved.manifest.tool.outputSchema.resourceId,
            )
            const outputValidation = validateJsonSchemaValue(outputSchema, output)
            if (!outputValidation.valid) {
                throw new CapabilityError(
                    'CAPABILITY_ACTION_OUTPUT_INVALID',
                    `Capability ${request.rootCapabilityId} output does not match its schema`,
                    { errors: outputValidation.errors },
                )
            }

            await persistRun({ status: 'completed', currentStepIds: [] })
            await emit({
                eventType: 'RUN_COMPLETED',
                runStatus: 'completed',
                outputAssetIds: run.outputAssetIds,
                safeOutputSummary: summarizeValue(output),
            })
            return {
                run,
                output,
                stepOutputs: Object.freeze(Object.fromEntries(stepOutputs)),
                events: Object.freeze(runEvents.map(event => Object.freeze(structuredClone(event)))),
            }
        } catch (error) {
            if (isCancellation(error, request.signal)) {
                await persistRun({ status: 'cancelled', currentStepIds: [] })
                await emit({
                    eventType: 'RUN_CANCELLED',
                    runStatus: 'cancelled',
                    errorCode: 'CAPABILITY_RUN_CANCELLED',
                    errorMessage: 'Capability run was cancelled',
                })
                throw cancelledError(request.signal)
            }
            const normalized = isCapabilityError(error)
                ? error
                : new CapabilityError('CAPABILITY_ACTION_FAILED', 'Capability run failed', {}, { cause: error })
            await persistRun({ status: 'failed', currentStepIds: [] })
            await emit({
                eventType: 'RUN_FAILED',
                runStatus: 'failed',
                errorCode: normalized.code,
                errorMessage: normalized.message,
            })
            throw normalized
        }
    }

    private async executeStep(args: {
        step: CapabilityWorkflowStep
        run: CapabilityRun
        request: CapabilityWorkflowRunRequest
        bindingContext: BindingContext
        emit: (event: Omit<CapabilityRunEvent, 'runId' | 'sequence' | 'timestamp'>) => Promise<void>
        getRunEvents: () => readonly Readonly<CapabilityRunEvent>[]
    }): Promise<StepExecutionResult> {
        const action = this.options.registry.get(args.step.action)
        const input = resolveInputBindings(args.step.input, args.bindingContext)
        const safeInputSummary = action.summarizeInput?.(input) ?? summarizeValue(input)
        const trace = createCapabilityTraceRecorder()
        trace.addHandles(...action.collectInputHandles?.(input) ?? [])
        const settleTrace = (settled: {
            outputSummary?: string
            errorMessage?: string
        } = {}): ExecutionTrace | undefined => trace.snapshot({ inputSummary: safeInputSummary, ...settled })
        const startedTrace = settleTrace()
        await args.emit({
            eventType: 'STEP_STARTED',
            runStatus: 'running',
            stepId: args.step.stepId,
            stepTitle: args.step.title,
            stepStatus: 'running',
            safeInputSummary,
            ...(startedTrace ? { trace: startedTrace } : {}),
        })

        const validation = action.validateInput(input)
        if (!validation.valid) {
            return {
                step: args.step,
                status: 'failed',
                outputAssetIds: [],
                safeInputSummary,
                trace: settleTrace({ errorMessage: `Action ${action.key} input is invalid: ${validation.message}` }),
                error: new CapabilityError(
                    'CAPABILITY_ACTION_INPUT_INVALID',
                    `Action ${action.key} input is invalid: ${validation.message}`,
                ),
            }
        }
        const authorizationContext: CapabilityActionAuthorizationContext = {
            userId: args.request.userId,
            workspaceId: args.request.workspaceId,
            organizationId: args.request.organizationId,
            conversationAssetId: args.request.conversationAssetId,
            rootCapabilityId: args.request.rootCapabilityId,
            runId: args.run.runId,
            origin: args.request.origin,
            ...(args.request.invocationGenerationRequestId
                ? { invocationGenerationRequestId: args.request.invocationGenerationRequestId }
                : {}),
            variant: args.request.variant ?? { axis: 'request', variantKey: 'request' },
        }
        if (!await action.authorize(authorizationContext, input)) {
            return {
                step: args.step,
                status: 'failed',
                outputAssetIds: [],
                safeInputSummary,
                trace: settleTrace({ errorMessage: `Action ${action.key} is not authorized for this run` }),
                error: new CapabilityError(
                    'CAPABILITY_ACTION_NOT_ALLOWED',
                    `Action ${action.key} is not authorized for this run`,
                ),
            }
        }

        const maxAttempts = args.step.retry?.maxAttempts ?? 1
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const output = await executeWithTimeout(action, input, {
                    ...authorizationContext,
                    stepId: args.step.stepId,
                    attempt,
                    signal: args.request.signal,
                    plan: args.request.plan,
                    getResource: (capabilityId, resourceId) => args.request.plan.getResource(capabilityId, resourceId),
                    getRunEvents: args.getRunEvents,
                    trace,
                })
                const outputValidation = action.validateOutput(output)
                if (!outputValidation.valid) {
                    throw new CapabilityError(
                        'CAPABILITY_ACTION_OUTPUT_INVALID',
                        `Action ${action.key} output is invalid: ${outputValidation.message}`,
                    )
                }
                return {
                    step: args.step,
                    status: 'completed',
                    output,
                    outputAssetIds: deduplicateStrings(action.collectOutputAssetIds?.(output) ?? []),
                    canvasGeometry: action.collectCanvasGeometry?.(output),
                    safeInputSummary,
                    safeOutputSummary: action.summarizeOutput?.(output) ?? summarizeValue(output),
                    trace: this.settleCompletedStepTrace(action, output, settleTrace),
                }
            } catch (error) {
                if (isCancellation(error, args.request.signal)) {
                    return {
                        step: args.step,
                        status: 'cancelled',
                        outputAssetIds: [],
                        safeInputSummary,
                        trace: settleTrace(),
                        error,
                    }
                }
                const mayRetry = attempt < maxAttempts
                    && !isCapabilityError(error)
                    && action.classifyRetry(error) === 'retryable'
                if (!mayRetry) {
                    return {
                        step: args.step,
                        status: 'failed',
                        outputAssetIds: [],
                        safeInputSummary,
                        trace: settleTrace({ errorMessage: errorMessageOf(error) }),
                        error,
                    }
                }
                await abortableDelay(args.step.retry?.backoffMs ?? 0, args.request.signal)
            }
        }

        return {
            step: args.step,
            status: 'failed',
            outputAssetIds: [],
            safeInputSummary,
            trace: settleTrace({ errorMessage: `Action ${action.key} exhausted retries` }),
            error: new CapabilityError('CAPABILITY_ACTION_FAILED', `Action ${action.key} exhausted retries`),
        }
    }

    private settleCompletedStepTrace(
        action: Readonly<CapabilityActionDefinition>,
        output: unknown,
        settleTrace: (settled?: { outputSummary?: string; errorMessage?: string }) => ExecutionTrace | undefined,
    ): ExecutionTrace | undefined {
        const outputHandles = action.collectOutputHandles?.(output) ?? []
        const settled = settleTrace({
            outputSummary: action.summarizeOutput?.(output) ?? summarizeValue(output),
        })
        if (!settled || outputHandles.length === 0) return settled
        return {
            ...settled,
            handles: [...settled.handles ?? [], ...outputHandles],
        }
    }

    private async cancelPendingSteps(
        dag: CapabilityDagRunner<{ nodeId: string; dependsOn: string[]; step: CapabilityWorkflowStep }>,
        emit: (event: Omit<CapabilityRunEvent, 'runId' | 'sequence' | 'timestamp'>) => Promise<void>,
    ): Promise<void> {
        for (const node of dag.cancelPending()) {
            const step = node.step
            await emit({
                eventType: 'STEP_CANCELLED',
                runStatus: 'running',
                stepId: step.stepId,
                stepTitle: step.title,
                stepStatus: 'cancelled',
            })
        }
    }
}

async function executeWithTimeout(
    action: Readonly<CapabilityActionDefinition>,
    input: Readonly<Record<string, unknown>>,
    context: Omit<Parameters<CapabilityActionDefinition['execute']>[1], 'signal'> & { signal?: AbortSignal },
): Promise<unknown> {
    const timeoutController = new AbortController()
    const timeout = setTimeout(
        () => timeoutController.abort(new Error(`Action ${action.key} timed out after ${action.timeoutMs}ms`)),
        action.timeoutMs,
    )
    const signals = context.signal ? [context.signal, timeoutController.signal] : [timeoutController.signal]
    const signal = AbortSignal.any(signals)
    const abortPromise = new Promise<never>((_resolve, reject) => {
        const rejectForAbort = (): void => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        if (signal.aborted) rejectForAbort()
        else signal.addEventListener('abort', rejectForAbort, { once: true })
    })
    try {
        return await Promise.race([
            Promise.resolve(action.execute(input, { ...context, signal })),
            abortPromise,
        ])
    } finally {
        clearTimeout(timeout)
    }
}

function resolveInputBindings(
    bindings: Record<string, CapabilityValueBinding>,
    context: BindingContext,
): Readonly<Record<string, unknown>> {
    const input: Record<string, unknown> = Object.create(null)
    for (const [key, binding] of Object.entries(bindings)) {
        assertSafePathPart(key)
        input[key] = resolveBinding(binding, context)
    }
    return Object.freeze(input)
}

function resolveOutputBindings(
    bindings: Record<string, CapabilityValueBinding>,
    context: BindingContext,
): Record<string, CapabilityJsonValue> {
    const output: Record<string, CapabilityJsonValue> = Object.create(null)
    for (const [key, binding] of Object.entries(bindings)) {
        assertSafePathPart(key)
        const value = resolveBinding(binding, context)
        if (!isCapabilityJsonValue(value)) {
            throw new CapabilityError(
                'CAPABILITY_ACTION_OUTPUT_INVALID',
                `Workflow output ${key} is not JSON-compatible`,
            )
        }
        output[key] = value
    }
    return output
}

function resolveBinding(binding: CapabilityValueBinding, context: BindingContext): unknown {
    if (binding.source === 'literal') return structuredClone(binding.value)
    if (binding.source === 'input') return readSafePath(context.input, binding.path)
    if (binding.source === 'step') return readSafePath(context.stepOutputs.get(binding.stepId), binding.path)
    const capabilityId = binding.capabilityId ?? context.rootCapabilityId
    const resource = context.plan.getResource(capabilityId, binding.resourceId)
    if (!resource) {
        throw new CapabilityError(
            'CAPABILITY_RESOURCE_INVALID',
            `Resource ${capabilityId}/${binding.resourceId} is not in the sealed plan`,
        )
    }
    return resource
}

function evaluateCondition(condition: CapabilityCondition, context: BindingContext): boolean {
    if (condition.type === 'exists') return resolveBinding(condition.value, context) != null
    if (condition.type === 'not') return !evaluateCondition(condition.condition, context)
    if (condition.type === 'all') return condition.conditions.every(child => evaluateCondition(child, context))
    if (condition.type === 'any') return condition.conditions.some(child => evaluateCondition(child, context))

    const left = resolveBinding(condition.left, context)
    const right = resolveBinding(condition.right, context)
    if (condition.operator === 'equals') return deepEqual(left, right)
    if (condition.operator === 'not-equals') return !deepEqual(left, right)
    if (condition.operator === 'greater-than') return comparable(left, right, (a, b) => a > b)
    if (condition.operator === 'greater-than-or-equal') return comparable(left, right, (a, b) => a >= b)
    if (condition.operator === 'less-than') return comparable(left, right, (a, b) => a < b)
    if (condition.operator === 'less-than-or-equal') return comparable(left, right, (a, b) => a <= b)
    if (typeof left === 'string' && typeof right === 'string') return left.includes(right)
    if (Array.isArray(left)) return left.some(item => deepEqual(item, right))
    return isRecord(left) && typeof right === 'string' && Object.hasOwn(left, right)
}

function comparable(left: unknown, right: unknown, compare: (left: number, right: number) => boolean): boolean {
    return typeof left === 'number' && Number.isFinite(left)
        && typeof right === 'number' && Number.isFinite(right)
        && compare(left, right)
}

function readSafePath(value: unknown, path: string[]): unknown {
    let cursor = value
    for (const part of path) {
        assertSafePathPart(part)
        if (Array.isArray(cursor)) {
            if (!/^(0|[1-9][0-9]*)$/.test(part)) return undefined
            cursor = cursor[Number(part)]
        } else if (isRecord(cursor) && Object.hasOwn(cursor, part)) {
            cursor = cursor[part]
        } else {
            return undefined
        }
    }
    return cursor
}

function assertSafePathPart(part: string): void {
    if (part === '__proto__' || part === 'prototype' || part === 'constructor') {
        throw new CapabilityError('CAPABILITY_WORKFLOW_INVALID', `Unsafe binding path segment ${part}`)
    }
}

function readJsonResource(plan: SealedResolvedCapabilityPlan, capabilityId: string, resourceId: string): unknown {
    const resource = plan.getResource(capabilityId, resourceId)
    if (!resource || resource.ref.mediaType !== 'application/schema+json') {
        throw new CapabilityError(
            'CAPABILITY_RESOURCE_INVALID',
            `Schema resource ${capabilityId}/${resourceId} is missing from the sealed plan`,
        )
    }
    try {
        return JSON.parse(new TextDecoder().decode(resource.bytes))
    } catch (error) {
        throw new CapabilityError(
            'CAPABILITY_RESOURCE_INVALID',
            `Schema resource ${capabilityId}/${resourceId} is invalid JSON`,
            {},
            { cause: error },
        )
    }
}

function summarizeValue(value: unknown): string {
    if (value == null) return String(value)
    if (Array.isArray(value)) return `array(${value.length})`
    if (value instanceof Uint8Array) return `bytes(${value.byteLength})`
    if (typeof value === 'object') return `object(${Object.keys(value).slice(0, 12).join(',')})`
    if (typeof value === 'string') return `string(${value.length})`
    return typeof value
}

function errorMessageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function normalizeActionError(error: unknown, actionKey: string): CapabilityError {
    if (isCapabilityError(error)) return error
    return new CapabilityError(
        'CAPABILITY_ACTION_FAILED',
        `Capability action ${actionKey} failed`,
        {},
        { cause: error },
    )
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true
        || (error instanceof DOMException && error.name === 'AbortError')
        || (isCapabilityError(error) && error.code === 'CAPABILITY_RUN_CANCELLED')
}

function cancelledError(signal: AbortSignal | undefined): CapabilityError {
    return new CapabilityError(
        'CAPABILITY_RUN_CANCELLED',
        'Capability run was cancelled',
        {},
        signal?.reason ? { cause: signal.reason } : undefined,
    )
}

async function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
    if (milliseconds <= 0) return
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, milliseconds)
        const abort = (): void => {
            clearTimeout(timeout)
            reject(cancelledError(signal))
        }
        if (signal?.aborted) {
            abort()
            return
        }
        signal?.addEventListener('abort', abort, { once: true })
        setTimeout(() => signal?.removeEventListener('abort', abort), milliseconds)
    })
}

function deduplicateStrings(values: string[]): string[] {
    return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))]
}

function isCapabilityJsonValue(value: unknown): value is CapabilityJsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(isCapabilityJsonValue)
    if (!isRecord(value)) return false
    return Object.entries(value).every(([key, child]) => {
        try {
            assertSafePathPart(key)
            return isCapabilityJsonValue(child)
        } catch {
            return false
        }
    })
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    }
    if (isRecord(left) && isRecord(right)) {
        const leftKeys = Object.keys(left).sort()
        const rightKeys = Object.keys(right).sort()
        return leftKeys.length === rightKeys.length
            && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]))
    }
    return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
