import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
    type CapabilityManifest,
    type CapabilityResourceRef,
    type CapabilityRun,
    type CapabilityRunEvent,
    type ResolvedCapabilityPlan,
} from '@lixpi/constants'

import {
    acceptCapabilityJsonValue,
    CapabilityActionRegistry,
    type CapabilityActionDefinition,
} from './capability-action-registry.ts'
import { CapabilityError } from '../shared/capability-errors.ts'
import {
    type LoadedCapabilityResource,
    SealedResolvedCapabilityPlan,
} from './capability-resolver.ts'
import {
    CapabilityWorkflowRunner,
    type CapabilityRunPersistence,
} from './capability-workflow-runner.ts'

function bytes(value: string): Uint8Array {
    return new TextEncoder().encode(value)
}

function hash(value: Uint8Array): string {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function schemaResource(resourceId: string, schema: unknown): { ref: CapabilityResourceRef; loaded: LoadedCapabilityResource } {
    const schemaBytes = bytes(JSON.stringify(schema))
    const ref: CapabilityResourceRef = {
        resourceId,
        blobHash: hash(schemaBytes),
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    return {
        ref,
        loaded: { capabilityId: 'tool', ref, bytes: schemaBytes },
    }
}

function makePlan(manifest: CapabilityManifest, resources: LoadedCapabilityResource[]): SealedResolvedCapabilityPlan {
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: [manifest.capabilityId],
        capabilities: [{
            capabilityId: manifest.capabilityId,
            kind: manifest.kind,
            manifestBlobHash: 'sha256:manifest',
            manifest,
        }],
        resolvedManifests: [{
            capabilityId: manifest.capabilityId,
            manifestBlobHash: 'sha256:manifest',
        }],
    }
    return new SealedResolvedCapabilityPlan(serializable, resources)
}

function makeToolManifest(): { manifest: CapabilityManifest; resources: LoadedCapabilityResource[] } {
    const input = schemaResource('input', {
        type: 'object',
        required: ['prompt'],
        properties: { prompt: { type: 'string', minLength: 1 } },
        additionalProperties: false,
    })
    const output = schemaResource('output', {
        type: 'object',
        required: ['result'],
        properties: { result: { type: 'string' } },
        additionalProperties: false,
    })
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: 'tool',
        kind: 'tool',
        name: 'Tool',
        description: 'Test Tool',
        references: [],
        resources: [input.ref, output.ref],
        tool: {
            toolType: 'test-tool',
            inputSchema: input.ref,
            outputSchema: output.ref,
            executionPolicy: 'model-choice',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'first-selected',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: {
                steps: [
                    {
                        stepId: 'first',
                        title: 'First',
                        action: 'test.first',
                        dependsOn: [],
                        input: { prompt: { source: 'input', path: ['prompt'] } },
                        progress: { group: 'parallel' },
                    },
                    {
                        stepId: 'second',
                        title: 'Second',
                        action: 'test.second',
                        dependsOn: [],
                        input: { prompt: { source: 'input', path: ['prompt'] } },
                        retry: { maxAttempts: 2, backoffMs: 0 },
                        progress: { group: 'parallel' },
                    },
                    {
                        stepId: 'conditional',
                        title: 'Conditional',
                        action: 'test.conditional',
                        dependsOn: ['first', 'second'],
                        input: { value: { source: 'step', stepId: 'first', path: ['value'] } },
                        condition: {
                            type: 'compare',
                            left: { source: 'step', stepId: 'first', path: ['value'] },
                            operator: 'equals',
                            right: { source: 'literal', value: 'done' },
                        },
                        progress: {},
                    },
                ],
                outputs: {
                    result: { source: 'step', stepId: 'conditional', path: ['result'] },
                },
            },
        },
    }
    return { manifest, resources: [input.loaded, output.loaded] }
}

function action(
    key: string,
    execute: CapabilityActionDefinition['execute'],
    overrides: Partial<CapabilityActionDefinition> = {},
): CapabilityActionDefinition {
    return {
        key,
        timeoutMs: 1_000,
        validateInput: () => ({ valid: true }),
        validateOutput: acceptCapabilityJsonValue,
        authorize: () => true,
        execute,
        classifyRetry: () => 'terminal',
        ...overrides,
    }
}

function makePersistence(): CapabilityRunPersistence & { runs: CapabilityRun[]; events: CapabilityRunEvent[] } {
    const runs: CapabilityRun[] = []
    const events: CapabilityRunEvent[] = []
    return {
        runs,
        events,
        createRun: vi.fn(async run => { runs.push(structuredClone(run)) }),
        updateRun: vi.fn(async run => { runs.push(structuredClone(run)) }),
        appendEvent: vi.fn(async event => { events.push(structuredClone(event)) }),
    }
}

// =============================================================================
// DAG SCHEDULING, RETRY, PROGRESS, AND PROVENANCE
// =============================================================================

describe('CapabilityWorkflowRunner', () => {
    it('runs ready steps concurrently, retries classified failures, evaluates conditions, and records provenance', async () => {
        const { manifest, resources } = makeToolManifest()
        const registry = new CapabilityActionRegistry()
        let active = 0
        let maximumActive = 0
        let secondAttempts = 0
        let actionTrace: readonly Readonly<CapabilityRunEvent>[] = []
        const authorize = vi.fn(() => true)
        registry.register(action('test.first', async () => {
            active += 1
            maximumActive = Math.max(maximumActive, active)
            await Promise.resolve()
            active -= 1
            return { value: 'done' }
        }))
        registry.register(action('test.second', async () => {
            active += 1
            maximumActive = Math.max(maximumActive, active)
            secondAttempts += 1
            active -= 1
            if (secondAttempts === 1) throw new Error('temporary')
            return { ok: true }
        }, { classifyRetry: () => 'retryable' }))
        const canvasGeometry = { generationRequestId: 'request-1', layoutRevision: 9, nodes: [] }
        registry.register(action('test.conditional', async (input, context) => {
            actionTrace = context.getRunEvents()
            return { result: `${input.value}-result`, canvasGeometry }
        }, {
            authorize,
            collectCanvasGeometry: output => (output as { canvasGeometry: typeof canvasGeometry }).canvasGeometry,
        }))
        const persistence = makePersistence()
        const runner = new CapabilityWorkflowRunner({
            registry,
            persistence,
            createRunId: () => 'run-1',
            now: (() => {
                let now = 100
                return () => ++now
            })(),
        })

        const result = await runner.run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: { prompt: 'hello' },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            conversationAssetId: 'conversation-1',
            origin: 'model',
            invocationGenerationRequestId: 'request-1',
        })

        expect(maximumActive).toBe(2)
        expect(secondAttempts).toBe(2)
        expect(authorize).toHaveBeenCalledWith(
            expect.objectContaining({
                conversationAssetId: 'conversation-1',
                invocationGenerationRequestId: 'request-1',
            }),
            expect.any(Object),
        )
        expect(result.output).toEqual({ result: 'done-result' })
        expect(result.run.status).toBe('completed')
        expect(actionTrace.at(-1)).toEqual(expect.objectContaining({
            eventType: 'STEP_STARTED',
            stepId: 'conditional',
        }))
        expect(actionTrace.every(event => !Object.hasOwn(event, 'input') && !Object.hasOwn(event, 'output'))).toBe(true)
        expect(result.run.resolvedManifests).toEqual([
            { capabilityId: 'tool', manifestBlobHash: 'sha256:manifest' },
        ])
        expect(persistence.events.map(event => event.eventType)).toEqual([
            'RUN_STARTED',
            'STEP_STARTED',
            'STEP_STARTED',
            'STEP_COMPLETED',
            'STEP_COMPLETED',
            'STEP_STARTED',
            'STEP_COMPLETED',
            'RUN_COMPLETED',
        ])
        expect(persistence.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(persistence.events.find(event => event.stepId === 'conditional' && event.eventType === 'STEP_COMPLETED'))
            .toEqual(expect.objectContaining({ canvasGeometry }))
    })

    it('skips a false conditional step and allows downstream dependencies to settle', async () => {
        const { manifest, resources } = makeToolManifest()
        manifest.tool!.workflow.steps[2]!.condition = {
            type: 'exists',
            value: { source: 'input', path: ['missing'] },
        }
        manifest.tool!.workflow.outputs = {
            result: { source: 'literal', value: 'skipped' },
        }
        const registry = new CapabilityActionRegistry()
        registry.register(action('test.first', async () => ({ value: 'done' })))
        registry.register(action('test.second', async () => ({ ok: true })))
        registry.register(action('test.conditional', async () => ({ result: 'unexpected' })))
        const persistence = makePersistence()

        const result = await new CapabilityWorkflowRunner({ registry, persistence }).run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: { prompt: 'hello' },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'prompt',
        })

        expect(result.output).toEqual({ result: 'skipped' })
        expect(persistence.events.some(event => event.eventType === 'STEP_SKIPPED')).toBe(true)
    })

    it('fails before creating a run when model arguments violate the Tool input schema', async () => {
        const { manifest, resources } = makeToolManifest()
        const registry = new CapabilityActionRegistry()
        registry.register(action('test.first', async () => ({})))
        registry.register(action('test.second', async () => ({})))
        registry.register(action('test.conditional', async () => ({})))
        const persistence = makePersistence()

        await expect(new CapabilityWorkflowRunner({ registry, persistence }).run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: {},
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'model',
        })).rejects.toMatchObject({ code: 'CAPABILITY_ACTION_INPUT_INVALID' })
        expect(persistence.createRun).not.toHaveBeenCalled()
    })

    it('fails closed on action authorization and cancels pending steps', async () => {
        const { manifest, resources } = makeToolManifest()
        const registry = new CapabilityActionRegistry()
        registry.register(action('test.first', async () => ({ value: 'done' }), { authorize: () => false }))
        registry.register(action('test.second', async () => ({ ok: true })))
        registry.register(action('test.conditional', async () => ({ result: 'done' })))
        const persistence = makePersistence()

        await expect(new CapabilityWorkflowRunner({ registry, persistence }).run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: { prompt: 'hello' },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'panel',
        })).rejects.toMatchObject({ code: 'CAPABILITY_ACTION_NOT_ALLOWED' })
        expect(persistence.events.some(event => event.eventType === 'STEP_FAILED')).toBe(true)
        expect(persistence.events.some(event => event.eventType === 'STEP_CANCELLED')).toBe(true)
        expect(persistence.events.at(-1)?.eventType).toBe('RUN_FAILED')
    })

    it('propagates cancellation to an active action and emits terminal cancellation events', async () => {
        const { manifest, resources } = makeToolManifest()
        const registry = new CapabilityActionRegistry()
        const controller = new AbortController()
        registry.register(action('test.first', async (_input, context) => {
            controller.abort(new Error('user stopped'))
            context.signal.throwIfAborted()
        }))
        registry.register(action('test.second', async (_input, context) => {
            context.signal.throwIfAborted()
        }))
        registry.register(action('test.conditional', async () => ({ result: 'done' })))
        const persistence = makePersistence()

        await expect(new CapabilityWorkflowRunner({ registry, persistence }).run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: { prompt: 'hello' },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'prompt',
            signal: controller.signal,
        })).rejects.toMatchObject({ code: 'CAPABILITY_RUN_CANCELLED' })
        expect(persistence.events.some(event => event.eventType === 'STEP_CANCELLED')).toBe(true)
        expect(persistence.events.at(-1)?.eventType).toBe('RUN_CANCELLED')
        expect(persistence.runs.at(-1)?.status).toBe('cancelled')
    })

    it('blocks prototype traversal in bindings', async () => {
        const { manifest, resources } = makeToolManifest()
        manifest.tool!.workflow.steps[0]!.input = {
            unsafe: { source: 'input', path: ['constructor'] },
        }
        const registry = new CapabilityActionRegistry()
        registry.register(action('test.first', async () => ({})))
        registry.register(action('test.second', async () => ({})))
        registry.register(action('test.conditional', async () => ({ result: 'done' })))

        await expect(new CapabilityWorkflowRunner({ registry, persistence: makePersistence() }).run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: { prompt: 'hello' },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'prompt',
        })).rejects.toBeInstanceOf(CapabilityError)
    })

    it('bounds actions that ignore their cancellation signal by the registered timeout', async () => {
        const { manifest, resources } = makeToolManifest()
        const registry = new CapabilityActionRegistry()
        registry.register(action('test.first', async () => await new Promise(() => {}), {
            timeoutMs: 5,
        }))
        registry.register(action('test.second', async () => ({ ok: true })))
        registry.register(action('test.conditional', async () => ({ result: 'done' })))
        const persistence = makePersistence()

        await expect(new CapabilityWorkflowRunner({ registry, persistence }).run({
            plan: makePlan(manifest, resources),
            rootCapabilityId: 'tool',
            input: { prompt: 'hello' },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'prompt',
        })).rejects.toMatchObject({ code: 'CAPABILITY_ACTION_FAILED' })
        expect(persistence.events.some(event => event.eventType === 'STEP_FAILED')).toBe(true)
        expect(persistence.events.at(-1)?.eventType).toBe('RUN_FAILED')
    })
})
