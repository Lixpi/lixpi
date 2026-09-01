import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    type CapabilityManifest,
    type CapabilityResourceRef,
    type CapabilityRun,
    type CapabilityRunEvent,
    type ResolvedCapabilityPlan,
} from '@lixpi/constants'

import {
    CapabilityActionRegistry,
    CapabilityWorkflowRunner,
    registerStyleExtractionActions,
    type CapabilityRunPersistence,
    type LoadedCapabilityResource,
    SealedResolvedCapabilityPlan,
} from '@lixpi/capability-system/backend'
import {
    STYLE_EXTRACTION_AXES,
    STYLE_EXTRACTION_CAPABILITY_IDS,
    buildStyleExtractionManifest,
} from '@lixpi/capability-system/backend'
import {
    createStyleExtractionRuntimePort,
    type StyleExtractionRuntimeDependencies,
} from './style-extraction-actions.ts'

function schemaResource(resourceId: string, schema: unknown): {
    ref: CapabilityResourceRef
    loaded: LoadedCapabilityResource
} {
    const ref: CapabilityResourceRef = {
        resourceId,
        blobHash: `${resourceId}-hash`,
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    return {
        ref,
        loaded: {
            capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
            ref,
            bytes: new TextEncoder().encode(JSON.stringify(schema)),
        },
    }
}

function instructionSkill(
    capabilityId: string,
    resourceId: string,
): { manifest: CapabilityManifest; resource: LoadedCapabilityResource } {
    const ref: CapabilityResourceRef = {
        resourceId,
        blobHash: `${resourceId}-hash`,
        mediaType: 'text/markdown',
        role: 'instructions',
    }
    return {
        manifest: {
            schemaVersion: 1,
            capabilityId,
            kind: 'skill',
            name: capabilityId,
            description: capabilityId,
            references: [],
            resources: [ref],
        },
        resource: {
            capabilityId,
            ref,
            bytes: new TextEncoder().encode(`# ${resourceId}`),
        },
    }
}

function makePlan(): SealedResolvedCapabilityPlan {
    const input = schemaResource('input', {
        type: 'object',
        required: ['prompt', 'sourceAssetIds', 'analysisModelId'],
        properties: {
            prompt: { type: 'string' },
            sourceAssetIds: { type: 'array', items: { type: 'string' } },
            analysisModelId: { type: 'string' },
        },
        additionalProperties: false,
    })
    const output = schemaResource('output', {
        type: 'object',
        required: ['state', 'success', 'capabilityId'],
        properties: {
            state: { type: 'object' },
            success: { type: 'boolean' },
            capabilityId: { type: 'string' },
        },
        additionalProperties: false,
    })
    const router = instructionSkill(STYLE_EXTRACTION_CAPABILITY_IDS.routerSkill, 'style-router-instructions')
    const axes = instructionSkill(STYLE_EXTRACTION_CAPABILITY_IDS.axesSkill, 'style-axis-instructions')
    const synthesis = instructionSkill(STYLE_EXTRACTION_CAPABILITY_IDS.synthesisSkill, 'style-synthesis-instructions')
    const tool = buildStyleExtractionManifest({ inputSchema: input.ref, outputSchema: output.ref })
    const manifests = [tool, router.manifest, axes.manifest, synthesis.manifest]
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: [tool.capabilityId],
        capabilities: manifests.map(manifest => ({
            capabilityId: manifest.capabilityId,
            kind: manifest.kind,
            manifestBlobHash: `${manifest.capabilityId}-hash`,
            manifest,
        })),
        resolvedManifests: manifests.map(manifest => ({
            capabilityId: manifest.capabilityId,
            manifestBlobHash: `${manifest.capabilityId}-hash`,
        })),
    }
    return new SealedResolvedCapabilityPlan(serializable, [
        input.loaded,
        output.loaded,
        router.resource,
        axes.resource,
        synthesis.resource,
    ])
}

function persistence(): CapabilityRunPersistence & { events: CapabilityRunEvent[]; runs: CapabilityRun[] } {
    const events: CapabilityRunEvent[] = []
    const runs: CapabilityRun[] = []
    return {
        events,
        runs,
        createRun: async run => {
            runs.push(structuredClone(run))
        },
        updateRun: async run => {
            runs.push(structuredClone(run))
        },
        appendEvent: async event => {
            events.push(structuredClone(event))
        },
    }
}

const logger = {
    styleExtractionRunId: 'extraction-1',
    emit: vi.fn(),
    chunk: vi.fn(),
    span: async <T>(_stage: string, _model: string | undefined, body: () => Promise<T>): Promise<T> => await body(),
}

const initializedInput = {
    styleExtractionRunId: 'extraction-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    organizationId: 'organization-1',
    intent: 'extract this',
    messages: [{
        role: 'user',
        content: [
            { type: 'input_text', text: 'extract this' },
            { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
        ],
    }],
    sourceAssetIds: ['asset-1'],
    analysisProvider: 'OpenAI' as const,
    analysisModel: { provider: 'OpenAI', model: 'gpt-5', modelVersion: 'gpt-5' },
}

const registerApiStyleExtractionActions = (
    registry: CapabilityActionRegistry,
    dependencies: StyleExtractionRuntimeDependencies,
): void => {
    registerStyleExtractionActions(registry, {
        runtime: createStyleExtractionRuntimePort(dependencies),
    })
}

describe('Style Extraction actions', () => {
    it('applies a generated visual-style Tool through the generic action contract', async () => {
        const registry = new CapabilityActionRegistry()
        registerApiStyleExtractionActions(registry, { runImageRouter: vi.fn() })
        const action = registry.get('visual-style.apply')
        const rootCapabilityId = 'visual-style.test'
        const context = {
            userId: 'user-1',
            workspaceId: 'workspace-1',
            organizationId: 'organization-1',
            rootCapabilityId,
            runId: 'run-1',
            origin: 'panel' as const,
            stepId: 'apply',
            attempt: 1,
            signal: new AbortController().signal,
            plan: {
                getManifest: () => ({
                    manifestBlobHash: 'manifest-hash',
                    manifest: { tool: { toolType: 'visual-style' } },
                }),
            } as any,
            getResource: vi.fn(),
            getRunEvents: () => [],
        }
        const resource = (resourceId: string, mediaType: string, value: string) => ({
            bytes: new TextEncoder().encode(value),
            ref: { resourceId, mediaType },
        })
        const input = {
            instructions: resource('instructions', 'text/markdown', 'Use fibrous paper.'),
            configuration: resource('configuration', 'application/json', '{"grain":"rough"}'),
            sample0: resource('sample-0', 'image/png', 'image-bytes'),
        }

        expect(await action.authorize(context, input)).toBe(true)
        expect(await action.execute(input, context)).toEqual({
            mediaGenerationMode: 'visual-style',
            preserveUserPrompt: false,
            visualInstructions: 'Use fibrous paper.\n\nStructured visual configuration:\n\n{"grain":"rough"}',
            referenceImages: [`data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`],
            referenceImageTraceUrls: [
                '/api/capabilities/visual-style.test/resources/sample-0?manifestBlobHash=manifest-hash',
            ],
        })
        expect(await action.authorize({ ...context, rootCapabilityId: 'global.style-extraction' }, input)).toBe(false)
    })

    it('preserves the fixed orchestrator behavior through the generic DAG', async () => {
        const registry = new CapabilityActionRegistry()
        let active = 0
        let maximumActive = 0
        const stageOrder: string[] = []
        registerApiStyleExtractionActions(registry, {
            runImageRouter: vi.fn(),
            createLogger: () => logger,
            initializeInput: async () => initializedInput,
            runRouter: async state => {
                stageOrder.push('router')
                return {
                    sceneAssessment: {
                        references: [{
                            imageRef: 'input-0',
                            subjects: [{ label: 'subject', bbox: [0, 0, 1, 1], salience: 1, description: 'subject' }],
                            regions: [],
                        }],
                        medium: 'digital-illustration',
                        axisDominance: Object.fromEntries(STYLE_EXTRACTION_AXES.map(axis => [axis, 1])),
                        intentResolution: { proposedCategory: 'illustration-style' },
                        notes: 'Do not invent traditional media.',
                    },
                }
            },
            runExtractorAxis: async (_state, axis) => {
                active += 1
                maximumActive = Math.max(maximumActive, active)
                await new Promise(resolve => setTimeout(resolve, 1))
                active -= 1
                stageOrder.push(`axis:${axis}`)
                return {
                    axisExtractions: {
                        [axis]: { axis, dominance: 1, fields: { value: axis }, rationale: axis },
                    },
                    failedAxes: [],
                }
            },
            materializeSourceCrops: async () => {
                active += 1
                maximumActive = Math.max(maximumActive, active)
                await new Promise(resolve => setTimeout(resolve, 1))
                active -= 1
                stageOrder.push('crops')
                return {
                    sourceCrops: [{
                        idx: 0,
                        subject: 'detail',
                        ext: 'png',
                        blobHash: 'crop-hash',
                        kind: 'source-crop',
                    }],
                }
            },
            synthesizeStyle: async state => {
                stageOrder.push('synthesis')
                expect(Object.keys(state.axisExtractions)).toHaveLength(STYLE_EXTRACTION_AXES.length)
                expect(state.sourceCrops).toHaveLength(1)
                return {
                    draft: {
                        category: 'illustration-style',
                        name: 'test-style',
                        summary: 'Test style',
                        tags: ['test'],
                        instructions: '## DO NOT\nInvent media.',
                        parameters: {},
                        recommendedSampleSubjects: [],
                    },
                }
            },
            generateSamples: async () => {
                stageOrder.push('samples')
                return { samples: [] }
            },
            persistStyle: async () => {
                stageOrder.push('persist')
                return {
                    capabilityId: 'visual-style.1',
                    capability: {
                        capabilityId: 'visual-style.1',
                        name: 'test-style',
                        category: 'illustration-style',
                        summary: 'Test style',
                        tags: ['test'],
                        sampleCount: 0,
                    },
                }
            },
        })
        const runPersistence = persistence()
        const result = await new CapabilityWorkflowRunner({
            registry,
            persistence: runPersistence,
            createRunId: () => 'capability-run-1',
        }).run({
            plan: makePlan(),
            rootCapabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
            input: {
                prompt: 'extract this',
                sourceAssetIds: ['asset-1'],
                analysisModelId: 'OpenAI:gpt-5',
            },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'panel',
        })

        expect(maximumActive).toBe(5)
        expect(stageOrder[0]).toBe('router')
        expect(stageOrder.slice(-3)).toEqual(['synthesis', 'samples', 'persist'])
        expect(result.output).toEqual(expect.objectContaining({
            success: true,
            capabilityId: 'visual-style.1',
            state: expect.objectContaining({
                capabilityId: 'visual-style.1',
                references: [expect.objectContaining({ assetId: 'asset-1' })],
                failedAxes: [],
            }),
        }))
        expect(runPersistence.events.filter(event => event.eventType === 'STEP_STARTED')).toHaveLength(17)
        expect(runPersistence.events.at(-1)?.eventType).toBe('RUN_COMPLETED')
    })

    it('keeps one axis failure isolated and visible to synthesis', async () => {
        const registry = new CapabilityActionRegistry()
        const synthesis = vi.fn(async state => {
            expect(state.failedAxes).toEqual([{ axis: 'mood', error: 'axis failed' }])
            return {
                draft: {
                    category: 'style',
                    name: 'style',
                    summary: 'style',
                    tags: [],
                    instructions: '## DO NOT',
                    parameters: {},
                    recommendedSampleSubjects: [],
                },
            }
        })
        registerApiStyleExtractionActions(registry, {
            runImageRouter: vi.fn(),
            createLogger: () => logger,
            initializeInput: async () => initializedInput,
            runRouter: async () => ({
                sceneAssessment: {
                    references: [],
                    medium: 'digital',
                    axisDominance: Object.fromEntries(STYLE_EXTRACTION_AXES.map(axis => [axis, 1])),
                    intentResolution: { proposedCategory: 'style' },
                    notes: '',
                },
            }),
            runExtractorAxis: async (_state, axis) =>
                axis === 'mood'
                    ? { axisExtractions: {}, failedAxes: [{ axis, error: 'axis failed' }] }
                    : { axisExtractions: {}, failedAxes: [] },
            materializeSourceCrops: async () => ({ sourceCrops: [] }),
            synthesizeStyle: synthesis,
            generateSamples: async () => ({ samples: [] }),
            persistStyle: async () => ({ capabilityId: 'visual-style.1' }),
        })

        const runPersistence = persistence()
        await new CapabilityWorkflowRunner({ registry, persistence: runPersistence }).run({
            plan: makePlan(),
            rootCapabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
            input: {
                prompt: 'extract',
                sourceAssetIds: ['asset-1'],
                analysisModelId: 'OpenAI:gpt-5',
            },
            userId: 'user-1',
            workspaceId: 'workspace-1',
            origin: 'panel',
        })

        expect(synthesis).toHaveBeenCalledOnce()
        expect(runPersistence.events).toContainEqual(expect.objectContaining({
            eventType: 'STEP_SKIPPED',
            stepId: 'extract-character-design',
        }))
    })
})
