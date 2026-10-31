import {
    type CapabilityManifest,
    type CapabilityResourceRef,
} from '@lixpi/constants'

import {
    type CapabilityActionAuthorizationContext,
    type CapabilityActionRegistry,
} from '../../../backend/capability-action-registry.ts'
import {
    type CapabilityArtifactBackendDefinition,
} from '../../../backend/capability-artifact-registry.ts'
import {
    type CapabilityModuleDefinition,
    type CapabilityPackageSeedContext,
} from '../../../backend/capability-module.ts'
import {
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'
import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'
import {
    MEDIA_PIPELINE_ARTIFACT_TYPE_ID,
    MEDIA_PIPELINE_MODULE_ID,
    MEDIA_PIPELINE_SKILL_ID,
    mediaPipelineSharedDefinition,
} from '../shared/media-pipeline.ts'
import { createMediaPipelinePlanningSkillPackage } from '../skills/planning/index.ts'
import { mediaPipelineSettings } from '../settings.ts'
import {
    mediaPipelineMatrixInputSchema,
    mediaPipelinePreparedMatrixInputSchema,
    type MediaPipelineMatrixInput,
    type MediaPipelinePreparedMatrixInput,
} from './media-pipeline-matrix.ts'
import {
    type MediaPipelineContext,
    type MediaPipelinePorts,
} from './media-pipeline-ports.ts'
import {
    MediaPipelineService,
    mediaPipelineSaveInputSchema,
    mediaPipelineSubmitInputSchema,
    mediaPipelineRetryInputSchema,
    type MediaPipelineSaveInput,
    type MediaPipelineSubmitInput,
    type MediaPipelineRetryInput,
} from './media-pipeline-service.ts'

export type MediaPipelineModuleDependencies = {
    ports: MediaPipelinePorts
    capabilityStorage: InstructionSkillStorage
    resolveContext: (context: CapabilityActionAuthorizationContext) => Promise<MediaPipelineContext | undefined>
}

export type MediaPipelineModuleExtension = {
    service: MediaPipelineService
    tools: typeof MEDIA_PIPELINE_TOOLS
}

export const mediaPipelineBackendDefinition: CapabilityArtifactBackendDefinition = {
    artifactTypeId: MEDIA_PIPELINE_ARTIFACT_TYPE_ID,
    shared: mediaPipelineSharedDefinition,
    initialCanvasDimensions: mediaPipelineSettings.canvas,
}

export const MEDIA_PIPELINE_TOOLS = [
    {
        name: 'get_pipeline',
        capabilityId: 'global.get-pipeline',
        action: 'media-pipeline.get',
        title: 'Get Pipeline',
        description: 'Read a saved pipeline and its frozen source references. This does not execute operations.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['pipelineId'],
            properties: { pipelineId: {
                type: 'string',
                minLength: 1,
                maxLength: 160,
            } },
        },
    },
    {
        name: 'save_pipeline',
        capabilityId: 'global.save-pipeline',
        action: 'media-pipeline.save',
        title: 'Save Pipeline',
        description: 'Save a pipeline draft without executing operations. To create: omit pipelineId, set baseRevision 0, use a stable clientMutationId, and supply patch.name plus the complete plan (requestedOutcome, constraints, sources, nodes, edges, executionPolicy, outputBindings). To revise: supply the exact saved pipelineId and current baseRevision; patch only changed fields. A display name is never a pipelineId.',
        schema: mediaPipelineSaveInputSchema,
    },
    {
        name: 'save_pipeline_matrix',
        capabilityId: 'global.save-pipeline-matrix',
        action: 'media-pipeline.save-matrix',
        title: 'Save Pipeline Matrix',
        description: 'Save a bounded prompt-variant by selected image-model matrix as a reviewable pipeline draft. Supply complete prepared prompts; this tool does not invoke reasoning models or generate media. Existing source references and constraints remain unless explicitly replaced.',
        schema: mediaPipelineMatrixInputSchema,
    },
    {
        name: 'prepare_pipeline_matrix',
        capabilityId: 'global.prepare-pipeline-matrix',
        action: 'media-pipeline.prepare-matrix',
        title: 'Prepare Pipeline Matrix',
        description: 'Use the explicitly selected reasoning models to prepare one prompt each and save their combinations with selected image models as a pipeline draft. Reasoning calls consume the accepted turn budget; this does not generate images.',
        schema: mediaPipelinePreparedMatrixInputSchema,
    },
    {
        name: 'submit_pipeline',
        capabilityId: 'global.submit-pipeline',
        action: 'media-pipeline.submit',
        title: 'Submit Pipeline',
        description: 'Validate and enqueue an explicitly authorized pipeline revision. Returns a durable operation handle while media work runs.',
        schema: mediaPipelineSubmitInputSchema,
    },
    {
        name: 'retry_pipeline',
        capabilityId: 'global.retry-pipeline',
        action: 'media-pipeline.retry',
        title: 'Retry Pipeline Branch',
        description: 'Retry explicitly selected failed or blocked nodes and their downstream branch from a settled prior execution. Retains successful dependencies and independent outputs. Requires a new attempt ID; uncertain provider outcomes cannot be retried.',
        schema: mediaPipelineRetryInputSchema,
    },
] as const

export const mediaPipelineToolResultSchema = {
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'data', 'sources'],
            properties: {
                status: { const: 'completed' },
                data: { type: 'object' },
                sources: {
                    type: 'array',
                    items: { type: 'object' },
                },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'operationId'],
            properties: {
                status: { const: 'pending' },
                operationId: {
                    type: 'string',
                    minLength: 1,
                },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'error'],
            properties: {
                status: { const: 'error' },
                details: {},
                error: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['code', 'message', 'recoverable'],
                    properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                        recoverable: { type: 'boolean' },
                        nodeId: { type: 'string' },
                        sourceId: { type: 'string' },
                    },
                },
            },
        },
    ],
}

export const createMediaPipelineModule = (dependencies: MediaPipelineModuleDependencies): CapabilityModuleDefinition => {
    const service = new MediaPipelineService(dependencies.ports)

    return {
        moduleId: MEDIA_PIPELINE_MODULE_ID,
        operationFamilies: [{
            family: 'image',
            description: 'Generate new image content using an AI inference model. Does not include placing existing images in a local sequence.',
            operationKeys: ['image.generate'],
        }],
        extensions: { 'media-pipeline': {
            service,
            tools: MEDIA_PIPELINE_TOOLS,
        } satisfies MediaPipelineModuleExtension },
        name: 'Media Pipeline',
        normalizedName: 'media pipeline',
        summary: 'Plans and executes revisioned media dependencies using authorized installed operations.',
        tags: ['media', 'pipeline', 'artifact'],
        descriptionSheet: {
            purpose: 'Builds reusable media plans with frozen sources, explicit dependencies, constraints, and output bindings.',
            expectedInputs: [
                {
                    name: 'Requested outcome',
                    requirement: 'required',
                    accepts: ['prompt'],
                    description: 'The result requested by the user, including constraints that must survive revisions.',
                },
                {
                    name: 'Source Assets',
                    requirement: 'optional',
                    accepts: ['image', 'video', 'audio', 'document', 'artifact'],
                    description: 'Authorized source Assets resolved to immutable revision and content snapshots.',
                },
                {
                    name: 'Execution grant',
                    requirement: 'conditional',
                    accepts: ['parameters'],
                    description: 'A trusted grant from an accepted user action is required to execute the plan.',
                },
            ],
            bestResults: ['Reuse shared dependencies when several outputs depend on the same result.', 'Keep source references and user constraints explicit.'],
            limitations: ['Unsupported operations remain gaps in a draft and prevent submission.', 'Inference requires an installed executor and a usable synchronized AWS Bedrock route.'],
            executionCharacteristics: {
                cost: 'high',
                latency: 'high',
                summary: 'Draft edits do not generate media. Submitted operations run asynchronously with durable receipts.',
            },
        },
        entry: {
            capabilityId: 'global.save-pipeline',
            kind: 'tool',
        },
        agentTools: [{
            name: 'list_pipeline_operations',
            description: 'List installed pipeline operation keys, input and output ports, parameter schemas, and usable Bedrock model routes before drafting a pipeline.',
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            intent: 'inspect',
            operationFamilies: [],
            execute: async (_input, actionContext) => {
                const context = await dependencies.resolveContext(actionContext)

                if (!context)
                    throw new Error('PIPELINE_TRUSTED_CONTEXT_REQUIRED')

                return await service.listOperations(context)
            },
        }, ...MEDIA_PIPELINE_TOOLS.map(
            tool => ({
                name: tool.name,
                description: tool.description,
                schema: tool.schema,
                intent: tool.name === 'get_pipeline'
                    ? 'inspect'
                    : tool.name !== 'submit_pipeline'
                        && tool.name !== 'retry_pipeline'
                        ? 'plan'
                        : 'execute',
                operationFamilies: [],
                execute: async (input, actionContext) => {
                    const validation = validateActionValue(tool.schema, input)

                    if (!validation.valid)
                        throw new Error(`PIPELINE_INPUT_INVALID:${validation.message}`)

                    const context = await resolveBoundContext(actionContext, dependencies)

                    if (!context)
                        throw new Error('PIPELINE_TRUSTED_CONTEXT_REQUIRED')

                    if (tool.name === 'get_pipeline')
                        return await service.get(context, input.pipelineId as string)

                    if (tool.name === 'save_pipeline')
                        return await service.save(context, input as MediaPipelineSaveInput)

                    if (tool.name === 'save_pipeline_matrix')
                        return await service.saveMatrix(context, input as MediaPipelineMatrixInput)

                    if (tool.name === 'prepare_pipeline_matrix')
                        return await service.prepareMatrix(context, input as MediaPipelinePreparedMatrixInput)

                    if (tool.name === 'retry_pipeline')
                        return await service.retry(context, input as MediaPipelineRetryInput)

                    return await service.submit(context, input as MediaPipelineSubmitInput)
                },
            }),
        )],
        tools: MEDIA_PIPELINE_TOOLS.map(
            tool => ({
                kind: 'tool',
                capabilityId: tool.capabilityId,
                registerActions: registry => registerAction(
                    registry,
                    tool,
                    service,
                    dependencies,
                ),
                seed: async context => await seedTool(
                    tool,
                    context,
                    dependencies.capabilityStorage,
                ),
            }),
        ),
        skills: [createMediaPipelinePlanningSkillPackage(dependencies.capabilityStorage)],
    }
}

const registerAction = (
    registry: CapabilityActionRegistry,
    tool: typeof MEDIA_PIPELINE_TOOLS[number],
    service: MediaPipelineService,
    dependencies: MediaPipelineModuleDependencies,
): void => {
    registry.register({
        key: tool.action,
        timeoutMs: mediaPipelineSettings.actionTimeoutMs,
        validateInput: input => validateActionValue(
            {
                type: 'object',
                additionalProperties: false,
                required: ['request'],
                properties: { request: tool.schema },
            },
            input,
        ),
        validateOutput: output => validateActionValue(mediaPipelineToolResultSchema, output),
        authorize: async context => Boolean(await resolveBoundContext(context, dependencies)),
        execute: async (input, actionContext) => {
            const context = await resolveBoundContext(actionContext, dependencies)

            if (!context)
                throw new Error('PIPELINE_TRUSTED_CONTEXT_REQUIRED')

            const request = input.request as Record<string, unknown>

            if (tool.name === 'get_pipeline')
                return await service.get(context, request.pipelineId as string)

            if (tool.name === 'save_pipeline')
                return await service.save(context, request as MediaPipelineSaveInput)

            if (tool.name === 'save_pipeline_matrix')
                return await service.saveMatrix(context, request as MediaPipelineMatrixInput)

            if (tool.name === 'prepare_pipeline_matrix')
                return await service.prepareMatrix(context, request as MediaPipelinePreparedMatrixInput)

            if (tool.name === 'retry_pipeline')
                return await service.retry(context, request as MediaPipelineRetryInput)

            return await service.submit(context, request as MediaPipelineSubmitInput)
        },
        classifyRetry: () => 'terminal',
        collectOutputAssetIds: output => {
            const result = output as {
                status?: string
                data?: {
                    assetId?: string
                    artifact?: { assetId?: string }
                }
            }
            const assetId = result.data?.artifact?.assetId ?? result.data?.assetId

            return result.status === 'completed'
                && assetId
                ? [assetId]
                : []
        },
    })
}

const resolveBoundContext = async (
    context: CapabilityActionAuthorizationContext,
    dependencies: MediaPipelineModuleDependencies,
): Promise<MediaPipelineContext | undefined> => {
    const resolved = await dependencies.resolveContext(context)

    if (
        !resolved
        || resolved.userId !== context.userId
        || resolved.workspaceId !== context.workspaceId
        || resolved.conversationAssetId !== context.conversationAssetId
        || resolved.organizationId !== context.organizationId
    )
        return undefined

    return resolved
}

const validateActionValue = (
    schema: unknown,
    value: unknown,
): { valid: true } | {
    valid: false
    message: string
} => {
    const result = validateJsonSchemaValue(schema, value)

    return result.valid ? result : {
        valid: false,
        message: result.errors.join('; '),
    }
}

const seedTool = async (
    tool: typeof MEDIA_PIPELINE_TOOLS[number],
    context: CapabilityPackageSeedContext,
    storage: InstructionSkillStorage,
): Promise<void> => {
    const storeSchema = async (
        suffix: string,
        schema: unknown,
    ): Promise<CapabilityResourceRef> =>
        await storage.storeResource({
            storageOwnerId: 'system',
            resourceId: `${tool.name}-${suffix}`,
            bytes: new TextEncoder().encode(
                JSON.stringify(schema),
            ),
            mediaType: 'application/schema+json',
            role: 'schema',
            name: `${tool.title} ${suffix}`,
        })
    const inputSchema = await storeSchema('input', tool.schema)
    const outputSchema = await storeSchema(
        'output',
        {
            type: 'object',
            additionalProperties: false,
            required: ['result'],
            properties: { result: mediaPipelineToolResultSchema },
        },
    )
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: tool.capabilityId,
        kind: 'tool',
        name: tool.title,
        description: tool.description,
        references: [{
            capabilityId: MEDIA_PIPELINE_SKILL_ID,
            kind: 'skill',
            import: ['pipeline-planning'],
        }],
        resources: [inputSchema, outputSchema],
        tool: {
            toolType: MEDIA_PIPELINE_MODULE_ID,
            inputSchema,
            outputSchema,
            executionPolicy: 'model-choice',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'ignore',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: {
                steps: [{
                    stepId: 'perform-action',
                    title: tool.title,
                    action: tool.action,
                    dependsOn: [],
                    progress: {},
                    input: { request: {
                        source: 'input',
                        path: [],
                    } },
                }],
                outputs: { result: {
                    source: 'step',
                    stepId: 'perform-action',
                    path: [],
                } },
            },
        },
    }
    await storage.seedBuiltInCapability({
        manifest,
        summary: tool.description,
        tags: ['media', 'pipeline'],
        storageOwnerId: 'system',
        allowedActions: context.allowedActions,
        parentModuleId: context.parentModuleId,
        catalogExposure: context.catalogExposure,
    })
}
