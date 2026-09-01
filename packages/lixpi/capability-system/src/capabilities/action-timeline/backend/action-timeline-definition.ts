import { readFile } from 'node:fs/promises'

import {
    type CapabilityManifest,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
} from '@lixpi/constants'

import {
    type CapabilityPackageSeedContext,
} from '../../../backend/capability-module.ts'
import {
    ACTION_TIMELINE_MODULE_ID,
    ACTION_TIMELINE_TOOL_ID,
} from '../shared/action-timeline.ts'

export type ActionTimelineCapabilityStorage = {
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
    resourceId: 'action-timeline-input-schema',
    fileName: 'action-timeline-input.schema.json',
    mediaType: 'application/schema+json',
    role: 'schema',
    name: 'Action Timeline Input Schema',
}

const outputSchemaSource: ResourceSource = {
    resourceId: 'action-timeline-output-schema',
    fileName: 'action-timeline-output.schema.json',
    mediaType: 'application/schema+json',
    role: 'schema',
    name: 'Action Timeline Output Schema',
}

export async function seedActionTimelineTool(
    context: CapabilityPackageSeedContext,
    storage: ActionTimelineCapabilityStorage,
    storageOwnerId = 'system',
): Promise<void> {
    const inputSchema = await storeResource(storage, storageOwnerId, inputSchemaSource)
    const outputSchema = await storeResource(storage, storageOwnerId, outputSchemaSource)
    await storage.seedBuiltInCapability({
        allowedActions: context.allowedActions,
        manifest: buildActionTimelineManifest({ inputSchema, outputSchema }),
        summary: 'Creates an editable, reusable time-segmented action plan from a prompt and cited Assets.',
        tags: ['timeline', 'shot-plan', 'storyboard', 'artifact', 'global'],
        parentModuleId: context.parentModuleId,
        catalogExposure: context.catalogExposure,
        storageOwnerId,
    })
}

export function buildActionTimelineManifest(resources: {
    inputSchema: CapabilityResourceRef
    outputSchema: CapabilityResourceRef
}): CapabilityManifest {
    return {
        schemaVersion: 1,
        capabilityId: ACTION_TIMELINE_TOOL_ID,
        kind: 'tool',
        name: 'Action Timeline',
        description: 'Create a reusable timed action or shot plan. Requires durationMs and precisionMs; produces one Artifact per selected reasoning model and no image or video output.',
        references: [
            { capabilityId: 'global.action-timeline-timing-grid', kind: 'skill', import: ['timing-grid'] },
            { capabilityId: 'global.action-timeline-segment-writing', kind: 'skill', import: ['segment-writing'] },
            { capabilityId: 'global.action-timeline-reference-fidelity', kind: 'skill', import: ['reference-fidelity'] },
        ],
        resources: [resources.inputSchema, resources.outputSchema],
        tool: {
            toolType: ACTION_TIMELINE_MODULE_ID,
            inputSchema: resources.inputSchema,
            outputSchema: resources.outputSchema,
            executionPolicy: 'model-required',
            executionMultiplicity: 'per-reasoning-model',
            modelAxisPolicy: {
                reasoning: 'all-selected',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: {
                steps: [
                    {
                        stepId: 'validate-request',
                        title: 'Validate timeline request',
                        action: 'action-timeline.validate-request',
                        dependsOn: [],
                        input: {
                            prompt: { source: 'input', path: ['prompt'] },
                            referenceAssetIds: { source: 'input', path: ['referenceAssetIds'] },
                            durationMs: { source: 'input', path: ['durationMs'] },
                            precisionMs: { source: 'input', path: ['precisionMs'] },
                        },
                        progress: {},
                    },
                    {
                        stepId: 'write-segments',
                        title: 'Write timeline segments',
                        action: 'action-timeline.write-segments',
                        dependsOn: ['validate-request'],
                        input: {
                            prepared: { source: 'step', stepId: 'validate-request', path: [] },
                        },
                        progress: { exposeReasoning: true },
                    },
                    {
                        stepId: 'persist-timeline',
                        title: 'Persist Action Timeline',
                        action: 'action-timeline.persist-timeline',
                        dependsOn: ['write-segments'],
                        input: {
                            prepared: { source: 'step', stepId: 'validate-request', path: [] },
                            written: { source: 'step', stepId: 'write-segments', path: [] },
                        },
                        retry: { maxAttempts: 2, backoffMs: 250 },
                        progress: {},
                    },
                ],
                outputs: {
                    outputKind: { source: 'step', stepId: 'persist-timeline', path: ['outputKind'] },
                    assetId: { source: 'step', stepId: 'persist-timeline', path: ['assetId'] },
                },
            },
        },
    }
}

async function storeResource(
    storage: ActionTimelineCapabilityStorage,
    storageOwnerId: string,
    source: ResourceSource,
): Promise<CapabilityResourceRef> {
    const bytes = await readFile(new URL(`./resources/${source.fileName}`, import.meta.url))
    return await storage.storeResource({
        storageOwnerId,
        resourceId: source.resourceId,
        bytes,
        mediaType: source.mediaType,
        role: source.role,
        name: source.name,
    })
}
