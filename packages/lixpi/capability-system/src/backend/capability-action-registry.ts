'use strict'

import type {
    CanvasGeometryUpdate,
    CapabilityJsonValue,
    CapabilityReasoningModelVariant,
    CapabilityRunEvent,
    ExecutionTraceHandle,
} from '@lixpi/constants'

import { CapabilityError } from '../shared/capability-errors.ts'
import type { CapabilityTraceRecorder } from './capability-trace-recorder.ts'
import type {
    LoadedCapabilityResource,
    SealedResolvedCapabilityPlan,
} from './capability-resolver.ts'

export type CapabilityActionAuthorizationContext = {
    userId: string
    workspaceId: string
    organizationId?: string
    conversationAssetId?: string
    rootCapabilityId: string
    runId: string
    origin: 'prompt' | 'model' | 'panel'
    invocationGenerationRequestId?: string
    variant: { axis: 'request'; variantKey: 'request' } | CapabilityReasoningModelVariant
}

export type CapabilityActionExecutionContext = CapabilityActionAuthorizationContext & {
    stepId: string
    attempt: number
    signal: AbortSignal
    plan: SealedResolvedCapabilityPlan
    getResource: (capabilityId: string, resourceId: string) => LoadedCapabilityResource | undefined
    getRunEvents: () => readonly Readonly<CapabilityRunEvent>[]
    // Records the step's own account of what it ran: model calls with their
    // params, the Assets and Capabilities it passed to each of them, and its
    // reasoning. Emitted with the step's run events.
    trace: CapabilityTraceRecorder
}

export type CapabilityActionValidationResult =
    | { valid: true }
    | { valid: false; message: string }

export type CapabilityActionRetryClassification = 'retryable' | 'terminal'

export type CapabilityActionDefinition = {
    key: string
    timeoutMs: number
    validateInput: (input: Readonly<Record<string, unknown>>) => CapabilityActionValidationResult
    validateOutput: (output: unknown) => CapabilityActionValidationResult
    authorize: (
        context: CapabilityActionAuthorizationContext,
        input: Readonly<Record<string, unknown>>,
    ) => boolean | Promise<boolean>
    execute: (
        input: Readonly<Record<string, unknown>>,
        context: CapabilityActionExecutionContext,
    ) => unknown | Promise<unknown>
    classifyRetry: (error: unknown) => CapabilityActionRetryClassification
    summarizeInput?: (input: Readonly<Record<string, unknown>>) => string
    summarizeOutput?: (output: unknown) => string
    // Names the Assets, Capabilities, Tools, and Skills a step was handed, so a
    // running step already shows what it is working with before it produces
    // anything.
    collectInputHandles?: (input: Readonly<Record<string, unknown>>) => ExecutionTraceHandle[]
    collectOutputHandles?: (output: unknown) => ExecutionTraceHandle[]
    collectOutputAssetIds?: (output: unknown) => string[]
    collectCanvasGeometry?: (output: unknown) => CanvasGeometryUpdate | undefined
}

const ACTION_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/

export class CapabilityActionRegistry {
    private readonly actions = new Map<string, Readonly<CapabilityActionDefinition>>()

    register(definition: CapabilityActionDefinition): void {
        if (!ACTION_KEY_PATTERN.test(definition.key)) {
            throw new CapabilityError(
                'CAPABILITY_WORKFLOW_INVALID',
                `Capability action key ${definition.key} is invalid`,
            )
        }
        if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0) {
            throw new CapabilityError(
                'CAPABILITY_WORKFLOW_INVALID',
                `Capability action ${definition.key} must have a positive integer timeout`,
            )
        }
        if (this.actions.has(definition.key)) {
            throw new CapabilityError(
                'CAPABILITY_WORKFLOW_INVALID',
                `Capability action ${definition.key} is already registered`,
            )
        }
        this.actions.set(definition.key, Object.freeze({ ...definition }))
    }

    get(key: string): Readonly<CapabilityActionDefinition> {
        const action = this.actions.get(key)
        if (!action) {
            throw new CapabilityError(
                'CAPABILITY_ACTION_NOT_ALLOWED',
                `Capability action ${key} is not registered`,
            )
        }
        return action
    }

    has(key: string): boolean {
        return this.actions.has(key)
    }

    allowedActionKeys(): ReadonlySet<string> {
        return new Set(this.actions.keys())
    }
}

export function acceptCapabilityJsonValue(value: unknown): CapabilityActionValidationResult {
    return isCapabilityJsonValue(value)
        ? { valid: true }
        : { valid: false, message: 'Value must be JSON-compatible' }
}

function isCapabilityJsonValue(value: unknown): value is CapabilityJsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(isCapabilityJsonValue)
    if (!value || typeof value !== 'object') return false
    return Object.entries(value).every(([key, child]) => isSafeProperty(key) && isCapabilityJsonValue(child))
}

function isSafeProperty(key: string): boolean {
    return key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
}
