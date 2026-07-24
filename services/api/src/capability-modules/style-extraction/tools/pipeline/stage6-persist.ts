'use strict'

import { v4 as uuid } from 'uuid'
import { info } from '@lixpi/debug-tools'

import {
    type CapabilityManifest,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
} from '@lixpi/constants'

import {
    saveCapability,
    storeCapabilityResource,
} from '../../../../models/capability.ts'
import type {
    StyleExtractionDependencies,
    StyleExtractionState,
    StyleSampleRef,
    StageLogger,
} from './types.ts'

const textEncoder = new TextEncoder()

export async function persistStyle(
    state: StyleExtractionState,
    logger: StageLogger,
    deps: StyleExtractionDependencies,
): Promise<Partial<StyleExtractionState>> {
    return await logger.span('persist', undefined, async () => {
        const draft = state.draft
        if (!draft) throw new Error('Cannot persist: synthesis stage produced no draft')
        const organizationId = state.input.organizationId
        if (!organizationId) throw new Error('Cannot persist visual-style Tool: organization context is required')
        if (state.references.some(reference => !reference.assetId)) {
            throw new Error('Cannot persist visual-style Tool: every source image must resolve to an Asset')
        }

        const capabilityId = `visual-style.${uuid()}`
        const orderedSamples = [
            ...state.sourceCrops.map((sample, index) => ({ ...sample, idx: index })),
            ...state.samples.map((sample, index) => ({ ...sample, idx: state.sourceCrops.length + index })),
        ]
        const resources = await buildVisualStyleResources({
            capabilityId,
            organizationId,
            state,
            samples: orderedSamples,
        })
        const manifest = buildVisualStyleManifest({
            capabilityId,
            name: draft.name,
            description: draft.summary,
            resources,
        })
        const record = await saveCapability({
            manifest,
            scope: 'organization',
            scopeOwnerId: organizationId,
            storageOwnerId: organizationId,
            summary: draft.summary,
            tags: [...draft.tags, 'visual-style'],
            requester: {
                userId: state.input.userId,
                organizationIds: [organizationId],
            },
            allowedActions: requireAllowedActions(deps),
        })
        const capability = {
            capabilityId: record.capabilityId,
            name: draft.name,
            category: draft.category,
            summary: draft.summary,
            tags: draft.tags,
            sampleCount: orderedSamples.length,
        }

        info(`Style extraction complete: ${capabilityId} (${draft.name}) — ${orderedSamples.length} Capability resources`)
        return { capabilityId, capability }
    }, {
        inputSummary: `draft=${state.draft?.name ?? 'none'} samples=${state.samples.length} sourceCrops=${state.sourceCrops.length}`,
        outputSummarizer: result => `capabilityId=${result.capabilityId} capability=${result.capability?.name}`,
    })
}

function requireAllowedActions(deps: StyleExtractionDependencies): ReadonlySet<string> {
    if (!deps.getAllowedActions) throw new Error('Style Extraction capability module is not registered')
    return deps.getAllowedActions()
}

type VisualStyleResources = {
    instructions: CapabilityResourceRef
    configuration: CapabilityResourceRef
    inputSchema: CapabilityResourceRef
    outputSchema: CapabilityResourceRef
    samples: CapabilityResourceRef[]
}

async function buildVisualStyleResources({
    capabilityId,
    organizationId,
    state,
    samples,
}: {
    capabilityId: string
    organizationId: string
    state: StyleExtractionState
    samples: StyleSampleRef[]
}): Promise<VisualStyleResources> {
    const draft = state.draft!
    const instructions = await storeCapabilityResource({
        storageOwnerId: organizationId,
        resourceId: 'visual-style-instructions',
        bytes: textEncoder.encode(draft.instructions),
        mediaType: 'text/markdown',
        role: 'instructions',
        name: `${draft.name} instructions`,
    })
    const configuration = await storeCapabilityResource({
        storageOwnerId: organizationId,
        resourceId: 'visual-style-configuration',
        bytes: textEncoder.encode(JSON.stringify({
            category: draft.category,
            summary: draft.summary,
            parameters: draft.parameters,
            sourceContext: {
                sourceWorkspaceId: state.input.workspaceId,
                sourceCapabilityRunId: state.input.styleExtractionRunId,
                sourceImages: state.references.map((reference, index) => ({
                    index,
                    assetId: reference.assetId,
                    role: 'source-reference',
                })),
            },
            samples: samples.map(sample => ({
                index: sample.idx,
                resourceId: `visual-style-sample-${sample.idx}`,
                subject: sample.subject,
                rationale: sample.rationale,
                kind: sample.kind,
                cropRegion: sample.cropRegion,
            })),
        })),
        mediaType: 'application/json',
        role: 'reference',
        name: `${draft.name} configuration`,
    })
    const inputSchema = await storeCapabilityResource({
        storageOwnerId: organizationId,
        resourceId: 'visual-style-input-schema',
        bytes: textEncoder.encode(JSON.stringify({
            type: 'object',
            properties: { prompt: { type: 'string' } },
            additionalProperties: false,
        })),
        mediaType: 'application/schema+json',
        role: 'schema',
        name: 'Visual style input schema',
    })
    const outputSchema = await storeCapabilityResource({
        storageOwnerId: organizationId,
        resourceId: 'visual-style-output-schema',
        bytes: textEncoder.encode(JSON.stringify({
            type: 'object',
            required: ['mediaGenerationMode', 'preserveUserPrompt', 'visualInstructions', 'referenceImages', 'referenceImageTraceUrls'],
            properties: {
                mediaGenerationMode: { const: 'visual-style' },
                preserveUserPrompt: { const: false },
                visualInstructions: { type: 'string' },
                referenceImages: { type: 'array', items: { type: 'string' } },
                referenceImageTraceUrls: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
        })),
        mediaType: 'application/schema+json',
        role: 'schema',
        name: 'Visual style output schema',
    })
    const sampleResources = samples.map((sample): CapabilityResourceRef => ({
        resourceId: `visual-style-sample-${sample.idx}`,
        blobHash: sample.blobHash,
        mediaType: sampleMediaType(sample),
        role: 'example',
        name: sample.subject,
    }))
    if (sampleResources.length > 124) {
        throw new Error(`Visual-style Tool ${capabilityId} exceeds the resource limit`)
    }
    return { instructions, configuration, inputSchema, outputSchema, samples: sampleResources }
}

function buildVisualStyleManifest({
    capabilityId,
    name,
    description,
    resources,
}: {
    capabilityId: string
    name: string
    description: string
    resources: VisualStyleResources
}): CapabilityManifest {
    const sampleInputs = Object.fromEntries(resources.samples.map((sample, index) => [
        `sample${index}`,
        { source: 'resource' as const, capabilityId, resourceId: sample.resourceId },
    ]))
    return {
        schemaVersion: 1,
        capabilityId,
        kind: 'tool',
        name,
        description,
        references: [],
        resources: [
            resources.instructions,
            resources.configuration,
            resources.inputSchema,
            resources.outputSchema,
            ...resources.samples,
        ],
        tool: {
            toolType: 'visual-style',
            inputSchema: resources.inputSchema,
            outputSchema: resources.outputSchema,
            executionPolicy: 'required',
            workflow: {
                steps: [{
                    stepId: 'apply',
                    title: 'Apply visual style',
                    action: 'visual-style.apply',
                    dependsOn: [],
                    input: {
                        instructions: {
                            source: 'resource',
                            capabilityId,
                            resourceId: resources.instructions.resourceId,
                        },
                        configuration: {
                            source: 'resource',
                            capabilityId,
                            resourceId: resources.configuration.resourceId,
                        },
                        ...sampleInputs,
                    },
                    progress: {},
                }],
                outputs: {
                    mediaGenerationMode: { source: 'step', stepId: 'apply', path: ['mediaGenerationMode'] },
                    preserveUserPrompt: { source: 'step', stepId: 'apply', path: ['preserveUserPrompt'] },
                    visualInstructions: { source: 'step', stepId: 'apply', path: ['visualInstructions'] },
                    referenceImages: { source: 'step', stepId: 'apply', path: ['referenceImages'] },
                    referenceImageTraceUrls: { source: 'step', stepId: 'apply', path: ['referenceImageTraceUrls'] },
                },
            },
        },
    }
}

function sampleMediaType(sample: StyleSampleRef): CapabilityResourceMediaType {
    return sample.ext === 'jpg' || sample.ext === 'jpeg' ? 'image/jpeg' : 'image/png'
}
