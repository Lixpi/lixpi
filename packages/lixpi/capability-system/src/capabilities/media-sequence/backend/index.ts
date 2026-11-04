import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'
import {
    type CapabilityModuleDefinition,
} from '../../../backend/capability-module.ts'
import {
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'
import {
    MEDIA_SEQUENCE_MODULE_ID,
    MEDIA_SEQUENCE_TOOL_ID,
    type SequencePatchRequest,
    type SequencePatchResult,
    type SequenceSourceBinding,
} from '../shared/media-sequence.ts'
import {
    MediaSequenceService,
    type MediaSequenceAccess,
    type MediaSequencePorts,
} from './media-sequence-service.ts'
import { MediaSequenceRenderCompiler } from './render/sequence-render-compiler.ts'
import { createMediaSequenceAgentTools } from './media-sequence-agent-tools.ts'
import { createMediaSequenceEditingSkill } from '../skills/editing/index.ts'
import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'
import {
    MediaSequencePipelineOperations,
    type MediaSequencePipelinePorts,
} from './media-sequence-pipeline.ts'

export type MediaSequenceModuleDependencies = {
    ports: MediaSequencePorts
    capabilityStorage: InstructionSkillStorage
    resolveAccess: (
        context: CapabilityActionAuthorizationContext,
        clientMutationId: string,
    ) => Promise<MediaSequenceAccess>
    exportSequence: (
        access: MediaSequenceAccess,
        request: Record<string, unknown>,
    ) => Promise<unknown>
    pipeline?: MediaSequencePipelinePorts
    resolveSourceSelection?: (
        access: MediaSequenceAccess,
        input: Pick<SequenceSourceBinding, 'sourceId' | 'assetId' | 'renditionId'>,
    ) => Promise<SequenceSourceBinding>
    onEditCommitted?: (
        access: MediaSequenceAccess,
        result: Exclude<SequencePatchResult, { status: 'conflict' }>,
    ) => Promise<void>
}

export const createMediaSequenceModule = (dependencies?: MediaSequenceModuleDependencies): CapabilityModuleDefinition => {
    const service = dependencies ? new MediaSequenceService(dependencies.ports) : undefined
    const execute = async (
        input: Readonly<Record<string, unknown>>,
        context: CapabilityActionAuthorizationContext,
    ): Promise<unknown> => {
        if (
            !dependencies
            || !service
        )
            throw new Error('MEDIA_SEQUENCE_EDITING_UNAVAILABLE')

        const args = input.request as Record<string, unknown>
        const access = await dependencies.resolveAccess(
            context,
            String(args.clientMutationId ?? 'read'),
        )

        if (input.action === 'get_sequence')
            return await service.get(
                access,
                String(args.sequenceId),
                args.revision as number | undefined,
            )

        if (
            input.action === 'resolve_sequence_source'
            && dependencies.resolveSourceSelection
        )
            return await dependencies.resolveSourceSelection(
                access,
                {
                    sourceId: String(args.sourceId),
                    assetId: String(args.assetId),
                    renditionId: args.renditionId === undefined ? 'original' : String(args.renditionId),
                },
            )

        if (
            input.action === 'create_sequence'
            || input.action === 'patch_sequence'
        ) {
            const result = input.action === 'create_sequence' ? await service.create(
                access,
                args as {
                    sequenceId: string
                    name: string
                    clientMutationId: string
                },
            ) : await service.patch(access, args as SequencePatchRequest)

            if (result.status !== 'conflict')
                await dependencies.onEditCommitted?.(access, result)

            return result
        }

        if (input.action === 'export_sequence')
            return await dependencies.exportSequence(access, args)

        throw new Error('MEDIA_SEQUENCE_UNKNOWN_TOOL')
    }
    const inputSchema = {
        anyOf: createMediaSequenceAgentTools(async () => undefined, true).map(
            tool => ({
                type: 'object',
                additionalProperties: false,
                required: ['action', 'request'],
                properties: {
                    action: { const: tool.name },
                    request: tool.schema,
                },
            }),
        ),
    }

    return {
        moduleId: MEDIA_SEQUENCE_MODULE_ID,
        operationFamilies: [{
            family: 'sequence-edit',
            description: 'Create or edit a local sequence by arranging existing media, tracks, clips, timing and output dimensions. Includes executing a saved sequence.create or sequence.revise pipeline node. Does not generate content using an AI model.',
            operationKeys: ['sequence.create', 'sequence.revise'],
        }, {
            family: 'sequence-export',
            description: 'Render a local sequence to MP4, WAV or MP3 using its existing media. This is local assembly/export, not AI image, audio or video generation.',
            operationKeys: ['sequence.export'],
        }],
        name: 'Media Sequence',
        normalizedName: 'media sequence',
        summary: 'Edit and export a versioned multitrack video, audio, and text sequence.',
        tags: ['sequence', 'timeline', 'editing', 'video', 'audio', 'artifact'],
        descriptionSheet: {
            purpose: 'Assemble authorized source media with nondestructive, revision-checked edits and rendered exports.',
            expectedInputs: [{
                name: 'Sequence or source Assets',
                requirement: 'required',
                accepts: ['image', 'video', 'audio', 'artifact'],
                description: 'An explicit sequence target and authorized source selections.',
            }],
            bestResults: ['Inspect the latest revision before editing.', 'Keep source ticks and sequence ticks in their declared time bases.'],
            limitations: ['Text captions require supplied text; speech transcription is not provided.', 'Locked tracks reject edits until explicitly unlocked.'],
            executionCharacteristics: {
                cost: 'medium',
                latency: 'medium',
                summary: 'Edits commit immediately; export runs as a durable media render operation.',
            },
        },
        entry: {
            capabilityId: MEDIA_SEQUENCE_TOOL_ID,
            kind: 'tool',
        },
        extensions: {
            ...(service ? { service } : {}),
            ...(service
                && dependencies?.pipeline
                ? { pipelineOperations: new MediaSequencePipelineOperations(service, dependencies.pipeline).handlers() }
                : {}),
            renderCompiler: new MediaSequenceRenderCompiler(),
        },
        agentTools: dependencies ? createMediaSequenceAgentTools(
            (
                action,
                request,
                context,
            ) => execute(
                {
                    action,
                    request,
                },
                context,
            ),
            Boolean(dependencies.resolveSourceSelection),
        ) : [],
        tools: [{
            kind: 'tool',
            capabilityId: MEDIA_SEQUENCE_TOOL_ID,
            registerActions: registry => registry.register({
                key: 'media-sequence.execute',
                timeoutMs: 30000,
                validateInput: input => {
                    const result = validateJsonSchemaValue(inputSchema, input)

                    return result.valid ? { valid: true } : {
                        valid: false,
                        message: result.errors.join('; '),
                    }
                },
                validateOutput: () => ({ valid: true }),
                authorize: context => Boolean(context.userId && context.workspaceId),
                execute,
                classifyRetry: () => 'terminal',
            }),
            seed: async context => {
                if (!dependencies)
                    throw new Error('MEDIA_SEQUENCE_CATALOG_STORAGE_UNAVAILABLE')

                const input = await dependencies.capabilityStorage.storeResource({
                    storageOwnerId: 'system',
                    resourceId: 'media-sequence-input',
                    bytes: new TextEncoder().encode(
                        JSON.stringify(inputSchema),
                    ),
                    mediaType: 'application/schema+json',
                    role: 'schema',
                    name: 'Media Sequence Input',
                })
                const output = await dependencies.capabilityStorage.storeResource({
                    storageOwnerId: 'system',
                    resourceId: 'media-sequence-output',
                    bytes: new TextEncoder().encode(
                        JSON.stringify({ type: 'object' }),
                    ),
                    mediaType: 'application/schema+json',
                    role: 'schema',
                    name: 'Media Sequence Output',
                })
                await dependencies.capabilityStorage.seedBuiltInCapability({
                    storageOwnerId: 'system',
                    parentModuleId: context.parentModuleId,
                    catalogExposure: context.catalogExposure,
                    allowedActions: context.allowedActions,
                    summary: 'Inspect, patch, or export a versioned media sequence.',
                    tags: ['sequence', 'editing', 'audio', 'video'],
                    manifest: {
                        schemaVersion: 1,
                        capabilityId: MEDIA_SEQUENCE_TOOL_ID,
                        kind: 'tool',
                        name: 'Media Sequence',
                        description: 'Inspect and edit sequences through the shared revision-checked patch API, or submit a frozen export.',
                        references: [{
                            capabilityId: 'global.media-sequence-editing',
                            kind: 'skill',
                            import: ['sequence-editing'],
                        }],
                        resources: [input, output],
                        tool: {
                            toolType: MEDIA_SEQUENCE_MODULE_ID,
                            inputSchema: input,
                            outputSchema: output,
                            executionPolicy: 'required',
                            executionMultiplicity: 'once',
                            modelAxisPolicy: {
                                reasoning: 'ignore',
                                image: 'ignore',
                                video: 'ignore',
                                outputMode: 'capability-only',
                            },
                            workflow: {
                                steps: [{
                                    stepId: 'sequence',
                                    title: 'Apply sequence request',
                                    action: 'media-sequence.execute',
                                    dependsOn: [],
                                    input: {
                                        action: {
                                            source: 'input',
                                            path: ['action'],
                                        },
                                        request: {
                                            source: 'input',
                                            path: ['request'],
                                        },
                                    },
                                    progress: {},
                                }],
                                outputs: { result: {
                                    source: 'step',
                                    stepId: 'sequence',
                                    path: [],
                                } },
                            },
                        },
                    },
                })
            },
        }],
        skills: dependencies ? [createMediaSequenceEditingSkill(dependencies.capabilityStorage)] : [],
    }
}

export * from './media-sequence-service.ts'
export * from './media-sequence-pipeline.ts'
export * from './render/render-contract.ts'
export * from './render/sequence-render-compiler.ts'
