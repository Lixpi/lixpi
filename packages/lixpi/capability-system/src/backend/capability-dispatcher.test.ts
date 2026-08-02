import { describe, expect, it, vi } from 'vitest'

import type {
    CapabilityManifest,
    CapabilityResourceRef,
    CapabilityRun,
    CapabilityRunEvent,
    ResolvedCapabilityPlan,
} from '@lixpi/constants'

import { CapabilityActionRegistry } from './capability-action-registry.ts'
import { CapabilityDispatcher } from './capability-dispatcher.ts'
import { SealedResolvedCapabilityPlan } from './capability-resolver.ts'

function makePlan(): SealedResolvedCapabilityPlan {
    const inputRef: CapabilityResourceRef = {
        resourceId: 'input', blobHash: 'input', mediaType: 'application/schema+json', role: 'schema',
    }
    const outputRef: CapabilityResourceRef = {
        resourceId: 'output', blobHash: 'output', mediaType: 'application/schema+json', role: 'schema',
    }
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: 'detached-tool',
        kind: 'tool',
        name: 'Detached Tool',
        description: 'Detached Tool',
        references: [],
        resources: [inputRef, outputRef],
        tool: {
            toolType: 'test',
            inputSchema: inputRef,
            outputSchema: outputRef,
            executionPolicy: 'model-choice',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'first-selected',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: {
                steps: [{
                    stepId: 'wait',
                    title: 'Wait',
                    action: 'test.wait',
                    dependsOn: [],
                    input: {},
                    progress: {},
                }],
                outputs: { ok: { source: 'step', stepId: 'wait', path: ['ok'] } },
            },
        },
    }
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: ['detached-tool'],
        capabilities: [{ capabilityId: 'detached-tool', kind: 'tool', manifestBlobHash: 'hash', manifest }],
        resolvedManifests: [{ capabilityId: 'detached-tool', manifestBlobHash: 'hash' }],
    }
    return new SealedResolvedCapabilityPlan(serializable, [
        {
            capabilityId: 'detached-tool',
            ref: inputRef,
            bytes: new TextEncoder().encode(JSON.stringify({ type: 'object', additionalProperties: false })),
        },
        {
            capabilityId: 'detached-tool',
            ref: outputRef,
            bytes: new TextEncoder().encode(JSON.stringify({
                type: 'object',
                required: ['ok'],
                properties: { ok: { type: 'boolean' } },
                additionalProperties: false,
            })),
        },
    ])
}

describe('CapabilityDispatcher detached runs', () => {
    it('returns after durable creation and stops only the owning active run', async () => {
        const registry = new CapabilityActionRegistry()
        registry.register({
            key: 'test.wait',
            timeoutMs: 10000,
            validateInput: () => ({ valid: true }),
            validateOutput: () => ({ valid: true }),
            authorize: () => true,
            execute: async (_input, context) => await new Promise((_resolve, reject) => {
                context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
            }),
            classifyRetry: () => 'terminal',
        })
        const runs: CapabilityRun[] = []
        const events: CapabilityRunEvent[] = []
        let cancelled: (() => void) | undefined
        const cancellation = new Promise<void>(resolve => { cancelled = resolve })
        const dispatcher = new CapabilityDispatcher({
            store: {} as never,
            registry,
            search: async () => ({ items: [] }),
            createEventStreamName: run => `capability-run-${run.workspaceId}-${run.runId}`,
            createPersistence: () => ({
                createRun: async run => { runs.push(structuredClone(run)) },
                updateRun: async run => {
                    runs.push(structuredClone(run))
                },
                appendEvent: async event => {
                    events.push(structuredClone(event))
                    if (event.eventType === 'RUN_CANCELLED') cancelled?.()
                },
            }),
        })
        vi.spyOn(dispatcher, 'resolveToolPlan').mockResolvedValue(makePlan())

        const created = await dispatcher.startDetached({
            capabilityId: 'detached-tool',
            arguments: {},
            requester: { userId: 'user-1', workspaceId: 'workspace-1', organizationId: 'organization-1' },
            origin: 'panel',
        })

        expect(created.status).toBe('pending')
        expect(runs[0]?.status).toBe('pending')
        expect(dispatcher.stopDetached(created, 'other-user')).toBe(false)
        expect(dispatcher.stopDetached(created, 'user-1')).toBe(true)
        await cancellation
        expect(runs.at(-1)?.status).toBe('cancelled')
        expect(events.at(-1)?.eventType).toBe('RUN_CANCELLED')
    })
})
