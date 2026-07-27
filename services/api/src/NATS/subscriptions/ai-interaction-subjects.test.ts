'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    getAiInteractionResponseSubject,
    NATS_SUBJECTS,
} from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    nats: {
        getInstance: vi.fn(),
        publish: vi.fn(),
    },
    aiModel: {
        getAiModel: vi.fn(),
    },
    workspace: {
        getWorkspace: vi.fn(),
    },
    asset: {
        get: vi.fn(),
        acquireLease: vi.fn(),
        releaseLease: vi.fn(),
        renewLease: vi.fn(),
        claimConversationReceivingSystem: vi.fn(),
        updateConversationStateSystem: vi.fn(),
    },
    assetDocumentService: {
        loadCurrentSnapshot: vi.fn(),
    },
    requesterContext: {
        get: vi.fn(),
    },
    eventRelay: {
        ensure: vi.fn(),
    },
    pipelineEventLog: {
        replayPipelineEvents: vi.fn(),
    },
    capabilities: {
        resolve: vi.fn(),
    },
    llmModule: {
        process: vi.fn(),
        processMediaGenerationMatrix: vi.fn(),
        stop: vi.fn(),
        stopMediaGenerationMatrix: vi.fn(),
    },
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({
    log: mocks.log,
    info: mocks.info,
    infoStr: mocks.infoStr,
    warn: mocks.warn,
    err: mocks.err,
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => {
            mocks.nats.getInstance()
            return { publish: mocks.nats.publish }
        },
    },
}))

vi.mock('../../models/ai-model.ts', () => ({ default: mocks.aiModel }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/asset.ts', () => ({ default: mocks.asset }))
vi.mock('../../models/blob.ts', () => ({ default: {} }))
vi.mock('../../services/asset-requester-context.ts', () => ({ getAssetRequesterContext: mocks.requesterContext.get }))
vi.mock('../../services/asset-document-service.ts', () => ({ default: mocks.assetDocumentService }))
vi.mock('../../services/ai-interaction-event-relay.ts', () => ({ ensureAiInteractionEventRelay: mocks.eventRelay.ensure }))
vi.mock('../../llm/graph/pipeline-event-log.ts', () => ({
    PipelineEventLog: {
        fromSingleton: () => mocks.pipelineEventLog,
    },
}))
vi.mock('@lixpi/capability-system/backend', async (importOriginal) => ({
    ...await importOriginal<typeof import('@lixpi/capability-system/backend')>(),
    resolveCapabilities: mocks.capabilities.resolve,
}))

import { aiInteractionSubjects, setLlmModule } from './ai-interaction-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS
const getHandler = (subject: string) =>
    aiInteractionSubjects.find((subscription) => subscription.subject === subject)!.handler

const flushPromises = (): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, 0)
})

const requester = {
    userId: 'user-1',
    workspaceIds: ['workspace-1'],
    editableWorkspaceIds: ['workspace-1'],
    organizationIds: ['org-1'],
}

const conversationDoc = {
    type: 'doc',
    content: [
        {
            type: 'aiChatThread',
            attrs: { threadId: 'conv-1' },
            content: [
                {
                    type: 'aiUserMessage',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
                },
            ],
        },
    ],
}

const conversationAsset = {
    assetId: 'conv-1',
    organizationId: 'org-1',
    documents: { conversation: { docId: 'doc-1' } },
}

const workspace = {
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
    canvasState: { nodes: [] },
}

const baseMessageData = {
    user: { userId: 'user-1', stripeCustomerId: 'stripe-1' },
    messages: [{ role: 'user', content: 'Hello' }],
    aiReasoningModels: ['openai:gpt-4'],
    aiImageModels: ['google:imagen3'],
    aiVideoModels: ['openai:gpt-4o-video'],
    workspaceId: 'workspace-1',
    conversationAssetId: 'conv-1',
    enableImageGeneration: true,
    imageSize: '1:1',
    videoAspectRatio: '16:9',
    videoResolution: '1080p',
    videoDuration: '30',
}

const actionTimelineInputSchema = new TextEncoder().encode(JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['prompt', 'referenceAssetIds', 'durationMs', 'precisionMs'],
    properties: {
        prompt: { type: 'string', minLength: 1 },
        referenceAssetIds: { type: 'array', items: { type: 'string' } },
        durationMs: { type: 'integer', minimum: 1 },
        precisionMs: { type: 'integer', minimum: 1 },
    },
}))

const makeModule = () => ({
    process: mocks.llmModule.process,
    processMediaGenerationMatrix: mocks.llmModule.processMediaGenerationMatrix,
    stop: mocks.llmModule.stop,
    stopMediaGenerationMatrix: mocks.llmModule.stopMediaGenerationMatrix,
    capabilityModuleCatalog: {
        routePrompt: (prompt: string) => prompt.includes('shot plan')
            ? {
                capabilityId: 'global.action-timeline',
                kind: 'tool',
                input: {},
                missingInputFields: ['durationMs', 'precisionMs'],
            }
            : undefined,
    },
})

describe('AI interaction message routing', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.nats.getInstance.mockReturnValue(undefined)
        mocks.nats.publish.mockClear()
        mocks.requesterContext.get.mockResolvedValue(requester)
        mocks.asset.get.mockResolvedValue(conversationAsset)
        mocks.asset.acquireLease.mockResolvedValue({ leaseId: 'lease-1' })
        mocks.asset.releaseLease.mockResolvedValue(undefined)
        mocks.asset.renewLease.mockResolvedValue(undefined)
        mocks.asset.claimConversationReceivingSystem.mockResolvedValue({ assetId: 'conv-1' })
        mocks.asset.updateConversationStateSystem.mockResolvedValue(undefined)
        mocks.assetDocumentService.loadCurrentSnapshot.mockResolvedValue({ doc: conversationDoc, version: 5 })
        mocks.eventRelay.ensure.mockReturnValue('live-subject')
        mocks.aiModel.getAiModel.mockResolvedValue({ modelVersion: '1' })
        mocks.workspace.getWorkspace.mockResolvedValue(workspace)
        mocks.pipelineEventLog.replayPipelineEvents.mockResolvedValue({
            streamName: 'PIPELINE_EVENTS_workspace-1',
            subject: `${SUBJECTS.CHAT_PIPELINE_EVENTS}.workspace-1.conv-1`,
            events: [],
        })
        mocks.capabilities.resolve.mockResolvedValue({
            getManifest: () => ({
                manifest: {
                    tool: {
                        inputSchema: { resourceId: 'action-timeline-input-schema' },
                    },
                },
            }),
            getResource: () => ({ bytes: actionTimelineInputSchema }),
        })
        mocks.llmModule.process.mockResolvedValue(undefined)
        mocks.llmModule.processMediaGenerationMatrix.mockResolvedValue(undefined)
        mocks.llmModule.stop.mockResolvedValue(undefined)
        mocks.llmModule.stopMediaGenerationMatrix.mockResolvedValue(undefined)
        setLlmModule(makeModule() as never)
    })

    it('invokes the media generation matrix path when generation request metadata exists', async () => {
        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: {
                generationRequestId: 'request-1',
                reasoningModelIds: ['openai:gpt-4'],
                imageModelIds: [],
                videoModelIds: [],
            },
        })
        await flushPromises()

        expect(mocks.llmModule.processMediaGenerationMatrix).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org-1',
            aiChatThreadId: 'conv-1',
            workspaceId: 'workspace-1',
            eventMeta: {
                userId: 'user-1',
                stripeCustomerId: 'stripe-1',
                organizationId: 'org-1',
                workspaceId: 'workspace-1',
                aiChatThreadId: 'conv-1',
            },
        }))
        expect(mocks.llmModule.process).not.toHaveBeenCalled()
        expect(mocks.nats.publish).not.toHaveBeenCalled()
    })

    it('skips ai model lookup entirely when media generation request path is taken', async () => {
        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: {
                generationRequestId: 'request-5',
                reasoningModelIds: ['openai:gpt-4'],
                imageModelIds: [],
                videoModelIds: [],
            },
        })
        await flushPromises()

        expect(mocks.aiModel.getAiModel).not.toHaveBeenCalled()
        expect(mocks.llmModule.process).not.toHaveBeenCalled()
        expect(mocks.llmModule.processMediaGenerationMatrix).toHaveBeenCalledTimes(1)
    })

    it('rejects the send with AI_MODEL_REQUIRED when no reasoning model and no media generation request are given', async () => {
        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            aiReasoningModels: [],
            mediaGenerationRequest: undefined,
        })
        await flushPromises()

        expect(mocks.nats.publish).toHaveBeenCalledWith(
            expect.stringContaining(`${SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.`),
            { error: 'AI_MODEL_REQUIRED' },
        )
        expect(mocks.llmModule.process).not.toHaveBeenCalled()
    })

    it('requests missing free-form timeline timing despite populated image and video selections', async () => {
        mocks.assetDocumentService.loadCurrentSnapshot.mockResolvedValue({
            doc: {
                ...conversationDoc,
                content: [{
                    ...conversationDoc.content[0],
                    content: [{
                        type: 'aiUserMessage',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Make a shot plan for this' }] }],
                    }],
                }],
            },
            version: 5,
        })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            messages: [{ role: 'user', content: 'Make a shot plan for this' }],
            aiImageModels: ['google:imagen3'],
            aiVideoModels: ['openai:gpt-4o-video'],
        })
        await flushPromises()

        expect(mocks.nats.publish).toHaveBeenCalledWith(
            expect.stringContaining(`${SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.`),
            { error: 'ACTION_TIMELINE_DURATION_AND_PRECISION_REQUIRED' },
        )
        expect(mocks.llmModule.process).not.toHaveBeenCalled()
        expect(mocks.llmModule.processMediaGenerationMatrix).not.toHaveBeenCalled()
    })

    it('removes scalar image and video axes when Action Timeline owns the turn', async () => {
        const prompt = 'Create a 17s shot plan with 2ms details for an imaginary film'
        mocks.assetDocumentService.loadCurrentSnapshot.mockResolvedValue({
            doc: {
                ...conversationDoc,
                content: [{
                    ...conversationDoc.content[0],
                    content: [{
                        type: 'aiUserMessage',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: prompt }] }],
                    }],
                }],
            },
            version: 6,
        })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            messages: [{ role: 'user', content: prompt }],
            aiImageModels: ['google:imagen3'],
            aiVideoModels: ['openai:gpt-4o-video'],
            mediaGenerationRequest: undefined,
        })
        await flushPromises()

        expect(mocks.aiModel.getAiModel).toHaveBeenCalledTimes(1)
        expect(mocks.llmModule.process).toHaveBeenCalledWith(
            'workspace-1:conv-1',
            'openai',
            expect.objectContaining({
                imageModelMetaInfo: null,
                videoModelMetaInfo: null,
                enableImageGeneration: false,
                videoAspectRatio: undefined,
                videoResolution: undefined,
                videoDurationSeconds: undefined,
                videoSourceForExtension: undefined,
                capabilityInputs: {
                    'global.action-timeline': {
                        prompt,
                        referenceAssetIds: [],
                        durationMs: 17_000,
                        precisionMs: 2,
                    },
                },
            }),
        )
        expect(mocks.llmModule.processMediaGenerationMatrix).not.toHaveBeenCalled()
    })

    it('publishes an error to the canonical subject when media generation matrix fails', async () => {
        mocks.llmModule.processMediaGenerationMatrix.mockRejectedValueOnce(new Error('matrix failed'))

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: {
                generationRequestId: 'request-4',
                reasoningModelIds: ['openai:gpt-4'],
                imageModelIds: [],
                videoModelIds: [],
            },
        })
        await flushPromises()

        expect(mocks.nats.publish).toHaveBeenCalledWith(
            `${SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.org-1.conv-1`,
            { error: 'matrix failed' },
        )
    })

    it('rejects unknown reasoning models with a direct publish error', async () => {
        mocks.aiModel.getAiModel.mockResolvedValueOnce(null)

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
            aiReasoningModels: ['openai:missing'],
        })
        await flushPromises()

        expect(mocks.aiModel.getAiModel).toHaveBeenCalledWith({
            provider: 'openai',
            model: 'missing',
            omitPricing: false,
        })
        expect(mocks.nats.publish).toHaveBeenCalledWith(
            `${SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.org-1.conv-1`,
            { error: 'AI model not found: openai:missing' },
        )
        expect(mocks.llmModule.process).not.toHaveBeenCalled()
    })

    it('publishes model-not-found for incomplete model metadata', async () => {
        mocks.aiModel.getAiModel.mockResolvedValueOnce({ model: 'gpt-4' })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
            aiReasoningModels: ['openai:gpt-4'],
        })
        await flushPromises()

        expect(mocks.nats.publish).toHaveBeenCalledWith(
            `${SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.org-1.conv-1`,
            { error: 'AI model not found: openai:gpt-4' },
        )
    })

    it('forwards the complete authoritative prompt into messages and context snapshots', async () => {
        const authoritativePrompt = `start-${'x'.repeat(25_000)}-end`
        mocks.assetDocumentService.loadCurrentSnapshot.mockResolvedValueOnce({
            doc: {
                type: 'doc',
                content: [{
                    type: 'aiChatThread',
                    attrs: { threadId: 'conv-1' },
                    content: [{
                        type: 'aiUserMessage',
                        content: [{
                            type: 'paragraph',
                            content: [{ type: 'text', text: authoritativePrompt }],
                        }],
                    }],
                }],
            },
            version: 6,
        })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            messages: [{ role: 'user', content: 'untrusted browser prompt' }],
            aiImageModels: [],
            aiVideoModels: [],
            mediaGenerationRequest: undefined,
            mediaBranchCandidateSnapshot: {
                resolverVersion: 'image-branch-vlm-v1',
                conversationAssetId: 'conv-1',
                regionNodeId: 'standalone:conv-1',
                promptText: 'untrusted candidate prompt',
                promptFingerprint: 'untrusted',
                candidates: [],
                transcriptContext: '',
            },
            workspaceContextSnapshot: {
                resolverVersion: 'workspace-context-v1',
                workspaceId: 'workspace-1',
                conversationAssetId: 'conv-1',
                promptText: 'untrusted workspace prompt',
                nodes: [],
            },
        })
        await flushPromises()

        const [, , payload] = mocks.llmModule.process.mock.calls[0] as [
            string,
            string,
            {
                messages: Array<{ role: string; content: string }>
                mediaBranchCandidateSnapshot: { promptText: string }
                workspaceContextSnapshot: { promptText: string }
            },
        ]
        expect(payload.messages.at(-1)?.content).toBe(authoritativePrompt)
        expect(payload.mediaBranchCandidateSnapshot.promptText).toBe(authoritativePrompt)
        expect(payload.workspaceContextSnapshot.promptText).toBe(authoritativePrompt)
    })

    it('normalizes video options for valid and invalid candidate values', async () => {
        mocks.aiModel.getAiModel
            .mockResolvedValueOnce({ modelVersion: '1' })
            .mockResolvedValueOnce({ model: 'imagen', modelVersion: '1' })
            .mockResolvedValueOnce({
                model: 'gpt-4o-video',
                modelVersion: '1',
                videoAspectRatios: [{ value: '16:9' }, { value: '4:3' }],
                videoResolutions: [{ value: '2160p' }, { value: '1080p' }],
                videoDurations: [{ value: '120' }, { value: '60' }],
            })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
            videoAspectRatio: '3:2',
            videoResolution: '2k',
            videoDuration: '60',
        })
        await flushPromises()

        const [, , payload] = mocks.llmModule.process.mock.calls[0] as [
            string,
            string,
            {
                videoAspectRatio?: string
                videoResolution?: string
                videoDurationSeconds?: number
            },
        ]

        expect(payload.videoAspectRatio).toBe('16:9')
        expect(payload.videoResolution).toBe('2160p')
        expect(payload.videoDurationSeconds).toBe(60)
        expect(payload.eventMeta).toMatchObject({ organizationId: 'org-1' })
    })

    it('casts number-based duration to numeric seconds when normalizing video duration', async () => {
        mocks.aiModel.getAiModel
            .mockResolvedValueOnce({ modelVersion: '1' })
            .mockResolvedValueOnce({ model: 'imagen', modelVersion: '1' })
            .mockResolvedValueOnce({
                model: 'gpt-4o-video',
                modelVersion: '1',
                videoDurations: [{ value: '30' }, { value: '60' }],
            })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
            videoDuration: 30 as unknown as string,
            videoAspectRatio: undefined,
            videoResolution: undefined,
        })
        await flushPromises()

        const [, , payload] = mocks.llmModule.process.mock.calls[0] as [
            string,
            string,
            { videoDurationSeconds?: number },
        ]
        expect(payload.videoDurationSeconds).toBe(30)
        expect(payload.videoAspectRatio).toBeUndefined()
        expect(payload.videoResolution).toBeUndefined()
    })

    it('continues with null image/video metadata when those models are not found', async () => {
        mocks.aiModel.getAiModel
            .mockResolvedValueOnce({ modelVersion: '1' })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
            aiImageModels: ['google:missing-image'],
            aiVideoModels: ['openai:missing-video'],
        })
        await flushPromises()

        expect(mocks.llmModule.process).toHaveBeenCalledWith('workspace-1:conv-1', expect.anything(), expect.objectContaining({
            imageModelMetaInfo: null,
            videoModelMetaInfo: null,
        }))
        expect(mocks.warn).toHaveBeenCalledWith('Image model not found: google:missing-image, proceeding without image routing')
        expect(mocks.warn).toHaveBeenCalledWith('Video model not found: openai:missing-video, proceeding without video routing')
    })

    it('publishes an error when LLM processing throws', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue({ modelVersion: '1' })
        mocks.llmModule.process.mockRejectedValueOnce(new Error('process failed'))

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
        })
        await flushPromises()

        expect(mocks.nats.publish).toHaveBeenCalledWith(
            `${SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.org-1.conv-1`,
            { error: 'process failed' },
        )
    })

    it('returns a module-init error back to the client if process is triggered before module registration', async () => {
        setLlmModule(undefined as never)
        mocks.aiModel.getAiModel.mockResolvedValue({ modelVersion: '1' })

        await getHandler(SUBJECTS.CHAT_SEND_MESSAGE)({
            ...baseMessageData,
            mediaGenerationRequest: undefined,
            aiReasoningModels: ['openai:gpt-4'],
        })
        await flushPromises()

        expect(mocks.nats.publish).toHaveBeenCalledWith(
            getAiInteractionResponseSubject('user-1', 'workspace-1', 'conv-1'),
            { error: 'LLM module not initialized' },
        )
    })

    it('forwards stop for both LLM chat and media-generation workflows', async () => {
        const result = await getHandler(SUBJECTS.CHAT_STOP_MESSAGE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            conversationAssetId: 'conv-1',
            generationRequestId: 'request-stop',
        })

        expect(mocks.llmModule.stop).toHaveBeenCalledWith('workspace-1:conv-1')
        expect(mocks.llmModule.stopMediaGenerationMatrix).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'conv-1',
            generationRequestId: 'request-stop',
        })
        expect(result).toEqual({ status: 'stopped', generationRequestId: 'request-stop' })
    })

    it('replays persisted pipeline events from the next stream sequence', async () => {
        mocks.pipelineEventLog.replayPipelineEvents.mockResolvedValueOnce({
            streamName: 'PIPELINE_EVENTS_workspace-1',
            subject: `${SUBJECTS.CHAT_PIPELINE_EVENTS}.workspace-1.pipeline-1`,
            events: [
                { eventId: 'old', streamSequence: 4, payload: { content: { status: 'old' } } },
                { eventId: 'next', streamSequence: 6, payload: { content: { status: 'new' } } },
            ],
        })

        const result = await getHandler(SUBJECTS.CHAT_PIPELINE_RESUME)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            pipelineId: 'pipeline-1',
            localStreamSeq: 4,
            maxMessages: 25,
        })

        expect(mocks.workspace.getWorkspace).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'workspace-1',
        })
        expect(mocks.pipelineEventLog.replayPipelineEvents).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            pipelineId: 'pipeline-1',
            startStreamSeq: 5,
            maxMessages: 25,
        })
        expect(result).toEqual({
            streamName: 'PIPELINE_EVENTS_workspace-1',
            subject: `${SUBJECTS.CHAT_PIPELINE_EVENTS}.workspace-1.pipeline-1`,
            liveSubject: 'live-subject',
            events: [
                { eventId: 'next', streamSequence: 6, payload: { content: { status: 'new' } } },
            ],
        })
    })

    it('requires a pipeline id for pipeline replay', async () => {
        const result = await getHandler(SUBJECTS.CHAT_PIPELINE_RESUME)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            localStreamSeq: 0,
        })

        expect(result).toEqual({ error: 'PIPELINE_ID_REQUIRED' })
        expect(mocks.workspace.getWorkspace).not.toHaveBeenCalled()
        expect(mocks.pipelineEventLog.replayPipelineEvents).not.toHaveBeenCalled()
    })

    it('denies pipeline replay before touching JetStream when workspace access fails', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'WORKSPACE_NOT_FOUND' })

        const result = await getHandler(SUBJECTS.CHAT_PIPELINE_RESUME)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            pipelineId: 'pipeline-1',
            localStreamSeq: 0,
        })

        expect(result).toEqual({ error: 'WORKSPACE_NOT_FOUND' })
        expect(mocks.pipelineEventLog.replayPipelineEvents).not.toHaveBeenCalled()
    })
})
