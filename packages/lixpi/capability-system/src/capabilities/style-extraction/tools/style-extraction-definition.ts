'use strict'

import { readFile } from 'node:fs/promises'

import {
    type CapabilityManifest,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
    type CapabilityValueBinding,
} from '@lixpi/constants'
import type { CapabilityPackageSeedContext } from '../../../backend/capability-module.ts'
import {
    STYLE_EXTRACTION_AXES_RESOURCE_ID,
    STYLE_EXTRACTION_AXES_SKILL_ID,
    STYLE_EXTRACTION_ROUTER_RESOURCE_ID,
    STYLE_EXTRACTION_ROUTER_SKILL_ID,
    STYLE_EXTRACTION_SYNTHESIS_RESOURCE_ID,
    STYLE_EXTRACTION_SYNTHESIS_SKILL_ID,
} from '../skills/index.ts'

export const STYLE_EXTRACTION_CAPABILITY_IDS = {
    tool: 'global.style-extraction',
    routerSkill: STYLE_EXTRACTION_ROUTER_SKILL_ID,
    axesSkill: STYLE_EXTRACTION_AXES_SKILL_ID,
    synthesisSkill: STYLE_EXTRACTION_SYNTHESIS_SKILL_ID,
} as const

export const STYLE_EXTRACTION_AXES = [
    'palette',
    'medium-signature',
    'character-design',
    'lighting',
    'composition',
    'mood',
    'background-treatment',
    'edge-treatment',
    'line-quality',
    'surface-texture',
] as const

export type StyleExtractionCapabilityStorage = {
    storeResource: (input: {
        storageOwnerId: string
        resourceId: string
        bytes: Uint8Array
        mediaType: CapabilityResourceMediaType
        role: CapabilityResourceRole
        name: string
    }) => Promise<CapabilityResourceRef>
    seedBuiltInCapability: (input: {
        allowedActions: ReadonlySet<string>
        manifest: CapabilityManifest
        summary: string
        tags: string[]
        parentModuleId: string
        catalogExposure: 'module-internal'
        storageOwnerId: string
    }) => Promise<unknown>
}

type ResourceSource = {
    resourceId: string
    fileName: string
    mediaType: CapabilityResourceMediaType
    role: CapabilityResourceRole
    name: string
}

const inputSchemaSource: ResourceSource = {
    resourceId: 'style-extraction-input-schema',
    fileName: 'style-extraction-input.schema.json',
    mediaType: 'application/schema+json',
    role: 'schema',
    name: 'Style Extraction Input Schema',
}

const outputSchemaSource: ResourceSource = {
    resourceId: 'style-extraction-output-schema',
    fileName: 'style-extraction-output.schema.json',
    mediaType: 'application/schema+json',
    role: 'schema',
    name: 'Style Extraction Output Schema',
}

export async function seedStyleExtractionTool(
    context: CapabilityPackageSeedContext,
    storage: StyleExtractionCapabilityStorage,
    storageOwnerId = 'system',
): Promise<void> {
    const inputSchema = await storeToolResource(storage, storageOwnerId, inputSchemaSource)
    const outputSchema = await storeToolResource(storage, storageOwnerId, outputSchemaSource)
    await storage.seedBuiltInCapability({
        allowedActions: context.allowedActions,
        manifest: buildStyleExtractionManifest({ inputSchema, outputSchema }),
        summary: 'Analyzes visual references through parallel specialist axes and saves a reusable visual style.',
        tags: ['style', 'visual-analysis', 'extraction', 'global'],
        parentModuleId: context.parentModuleId,
        catalogExposure: context.catalogExposure,
        storageOwnerId,
    })
}

export function buildStyleExtractionManifest(resources: {
    inputSchema: CapabilityResourceRef
    outputSchema: CapabilityResourceRef
}): CapabilityManifest {
    const routeStepId = 'route'
    const axisSteps = STYLE_EXTRACTION_AXES.map((axis, index) => ({
        stepId: `extract-${axis}`,
        title: `Extract ${axis.replace(/-/g, ' ')}`,
        action: 'style.extract-axis',
        dependsOn: [routeStepId],
        input: {
            state: { source: 'step', stepId: routeStepId, path: ['state'] } as CapabilityValueBinding,
            axis: { source: 'literal', value: axis } as CapabilityValueBinding,
            instructions: {
                source: 'resource',
                capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.axesSkill,
                resourceId: STYLE_EXTRACTION_AXES_RESOURCE_ID,
            } as CapabilityValueBinding,
        },
        condition: {
            type: 'compare' as const,
            operator: 'equals' as const,
            left: {
                source: 'step' as const,
                stepId: routeStepId,
                path: ['applicableAxes', axis],
            },
            right: { source: 'literal' as const, value: true },
        },
        progress: { group: 'axis-extraction' },
    }))
    const mergeInputs: Record<string, CapabilityValueBinding> = {
        state: { source: 'step', stepId: routeStepId, path: ['state'] },
        crops: { source: 'step', stepId: 'materialize-crops', path: [] },
    }
    axisSteps.forEach((step, index) => {
        mergeInputs[`axis${index}`] = { source: 'step', stepId: step.stepId, path: [] }
    })

    return {
        schemaVersion: 1,
        capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
        kind: 'tool',
        name: 'Style Extraction',
        description: 'Extracts reusable visual traits through routing, parallel specialist analysis, crop evidence, synthesis, samples, and persistence.',
        references: [
            { capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.routerSkill, kind: 'skill', import: ['router'] },
            { capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.axesSkill, kind: 'skill', import: ['axes'] },
            { capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.synthesisSkill, kind: 'skill', import: ['synthesis'] },
        ],
        resources: [resources.inputSchema, resources.outputSchema],
        tool: {
            toolType: 'style-extraction',
            inputSchema: resources.inputSchema,
            outputSchema: resources.outputSchema,
            executionPolicy: 'required',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'first-selected',
                image: 'all-selected',
                video: 'ignore',
                outputMode: 'continue-media-generation',
            },
            workflow: {
                steps: [
                    {
                        stepId: 'initialize',
                        title: 'Prepare references',
                        action: 'style.initialize',
                        dependsOn: [],
                        input: {
                            prompt: { source: 'input', path: ['prompt'] },
                            intent: { source: 'input', path: ['intent'] },
                            sourceAssetIds: { source: 'input', path: ['sourceAssetIds'] },
                            analysisModelId: { source: 'input', path: ['analysisModelId'] },
                            imageModelId: { source: 'input', path: ['imageModelId'] },
                        },
                        progress: {},
                    },
                    {
                        stepId: routeStepId,
                        title: 'Analyze scene',
                        action: 'style.route',
                        dependsOn: ['initialize'],
                        input: {
                            state: { source: 'step', stepId: 'initialize', path: ['state'] },
                            instructions: {
                                source: 'resource',
                                capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.routerSkill,
                                resourceId: STYLE_EXTRACTION_ROUTER_RESOURCE_ID,
                            },
                        },
                        retry: { maxAttempts: 2, backoffMs: 1_000 },
                        progress: { exposeReasoning: true },
                    },
                    ...axisSteps,
                    {
                        stepId: 'materialize-crops',
                        title: 'Materialize source crops',
                        action: 'style.materialize-crops',
                        dependsOn: [routeStepId],
                        input: {
                            state: { source: 'step', stepId: routeStepId, path: ['state'] },
                        },
                        progress: { group: 'axis-extraction' },
                    },
                    {
                        stepId: 'merge-analysis',
                        title: 'Combine analysis',
                        action: 'style.merge-analysis',
                        dependsOn: [...axisSteps.map(step => step.stepId), 'materialize-crops'],
                        input: mergeInputs,
                        progress: {},
                    },
                    {
                        stepId: 'synthesize',
                        title: 'Synthesize style',
                        action: 'style.synthesize',
                        dependsOn: ['merge-analysis'],
                        input: {
                            state: { source: 'step', stepId: 'merge-analysis', path: ['state'] },
                            instructions: {
                                source: 'resource',
                                capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.synthesisSkill,
                                resourceId: STYLE_EXTRACTION_SYNTHESIS_RESOURCE_ID,
                            },
                        },
                        retry: { maxAttempts: 2, backoffMs: 1_000 },
                        progress: { exposeReasoning: true },
                    },
                    {
                        stepId: 'generate-samples',
                        title: 'Generate samples',
                        action: 'style.generate-samples',
                        dependsOn: ['synthesize'],
                        input: {
                            state: { source: 'step', stepId: 'synthesize', path: ['state'] },
                        },
                        progress: { group: 'samples' },
                    },
                    {
                        stepId: 'persist',
                        title: 'Save style',
                        action: 'style.persist',
                        dependsOn: ['generate-samples'],
                        input: {
                            state: { source: 'step', stepId: 'generate-samples', path: ['state'] },
                        },
                        retry: { maxAttempts: 2, backoffMs: 500 },
                        progress: {},
                    },
                ],
                outputs: {
                    state: { source: 'step', stepId: 'persist', path: ['state'] },
                    success: { source: 'step', stepId: 'persist', path: ['success'] },
                    capabilityId: { source: 'step', stepId: 'persist', path: ['capabilityId'] },
                },
            },
        },
    }
}

async function storeToolResource(
    storage: StyleExtractionCapabilityStorage,
    storageOwnerId: string,
    source: ResourceSource,
): Promise<CapabilityResourceRef> {
    return await storage.storeResource({
        storageOwnerId,
        resourceId: source.resourceId,
        bytes: await readFile(new URL(`./resources/${source.fileName}`, import.meta.url)),
        mediaType: source.mediaType,
        role: source.role,
        name: source.name,
    })
}
