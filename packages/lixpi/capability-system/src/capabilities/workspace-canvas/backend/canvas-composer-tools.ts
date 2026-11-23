import {
    type ConversationMessageNode,
    type ConversationReference,
    type ConversationSettings,
} from '@lixpi/constants'
import {
    type CapabilityAgentRegistration,
} from '../../../backend/capability-agent-registry.ts'
import { WORKSPACE_CANVAS_OPERATION } from './canvas-agent-tools.ts'
import {
    type CanvasComposerAccess,
    type CanvasComposerSession,
} from './canvas-composer-ports.ts'

type Schema = Record<string, unknown>

const object = (
    properties: Record<string, Schema> = {},
    required: string[] = [],
): Schema => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
})

const identifier = {
    type: 'string',
    pattern: '^[A-Za-z0-9_-]{1,128}$',
}
const revision = {
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
}
const cursor = {
    type: 'string',
    minLength: 1,
    maxLength: 2_048,
}
const modelIds = {
    type: 'array',
    maxItems: 16,
    uniqueItems: true,
    items: {
        type: 'string',
        minLength: 1,
        maxLength: 512,
    },
}
const settings = object({
    contextMode: {
        type: 'string',
        enum: ['explicit', 'discovery', 'mixed'],
    },
    midRunPolicy: {
        type: 'string',
        enum: ['steer', 'stop-first', 'queue'],
    },
    models: object(
        {
            reasoningModelIds: modelIds,
            imageModelIds: modelIds,
            videoModelIds: modelIds,
            reasoningOptions: { type: 'object' },
            imageOptions: { type: 'object' },
            videoOptions: { type: 'object' },
        },
        ['reasoningModelIds', 'imageModelIds', 'videoModelIds'],
    ),
})
const references = {
    type: 'array',
    maxItems: 24,
    items: object(
        {
            assetId: identifier,
            role: {
                type: 'string',
                enum: ['content', 'conversation', 'provenance', 'media', 'artifact'],
            },
            revision,
            renditionId: cursor,
        },
        ['assetId', 'role'],
    ),
}

type ComposerTool = {
    description: string
    intent: 'inspect' | 'execute'
    schema: Schema
    run: (
        composer: CanvasComposerSession,
        input: Readonly<Record<string, unknown>>,
    ) => Promise<object>
}

const tools: Record<string, ComposerTool> = {
    list_canvas_conversations: {
        description: 'List conversations in the current workspace. Returns conversation IDs, current settings, and running and queued turn state.',
        intent: 'inspect',
        schema: object({ cursor: identifier }),
        run: async (composer, input) => await composer.listConversations(input.cursor as string | undefined),
    },
    read_canvas_conversation: {
        description: 'Read a current-workspace conversation, including its recent transcript, current settings revision, run state, and queued messages.',
        intent: 'inspect',
        schema: object({ conversationAssetId: identifier }, ['conversationAssetId']),
        run: async (composer, input) => await composer.readConversation(input.conversationAssetId as string),
    },
    read_canvas_conversation_history: {
        description: 'Read a page of a current-workspace conversation transcript. Use its message cursor to read older messages.',
        intent: 'inspect',
        schema: object(
            {
                conversationAssetId: identifier,
                cursor,
            },
            ['conversationAssetId'],
        ),
        run: async (composer, input) => await composer.readMessages(input.conversationAssetId as string, input.cursor as string | undefined),
    },
    read_canvas_turn_author: {
        description: 'Read the sending conversation ID when a turn was authored by another conversation agent.',
        intent: 'inspect',
        schema: object(
            {
                conversationAssetId: identifier,
                turnId: identifier,
            },
            ['conversationAssetId', 'turnId'],
        ),
        run: async (composer, input) => ({
            origin: await composer.readTurnOrigin(input.conversationAssetId as string, input.turnId as string) ?? null,
        }),
    },
    list_canvas_composer_models: {
        description: 'Read the available reasoning, image and video models and their supported composer options.',
        intent: 'inspect',
        schema: object(),
        run: async composer => await composer.readModelCatalog(),
    },
    create_canvas_conversation: {
        description: 'Create a conversation in the current workspace and return its ID and initial settings. It appears in the shared conversation list after its first accepted message.',
        intent: 'execute',
        schema: object({ settings }),
        run: async (composer, input) => await composer.createConversation((input.settings ?? {}) as Partial<ConversationSettings>),
    },
    configure_canvas_conversation: {
        description: 'Update the current-workspace conversation settings. Use the current settings revision and keep all model ID lists when changing model options.',
        intent: 'execute',
        schema: object(
            {
                conversationAssetId: identifier,
                expectedRevision: revision,
                patch: settings,
            },
            ['conversationAssetId', 'expectedRevision', 'patch'],
        ),
        run: async (composer, input) => await composer.updateSettings(
            input.conversationAssetId as string,
            input.expectedRevision as number,
            input.patch as Partial<ConversationSettings>,
        ),
    },
    rename_canvas_conversation: {
        description: 'Rename a conversation in the current workspace using the shared Asset title.',
        intent: 'execute',
        schema: object(
            {
                conversationAssetId: identifier,
                title: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 512,
                },
            },
            ['conversationAssetId', 'title'],
        ),
        run: async (composer, input) => await composer.renameConversation(input.conversationAssetId as string, input.title as string),
    },
    send_canvas_conversation_message: {
        description: 'Queue an agent-authored message in another current-workspace conversation. Use its current settings revision and an aiUserMessage ProseMirror fragment. Attach canvas Assets or Assets admitted to this turn through references.',
        intent: 'execute',
        schema: object(
            {
                conversationAssetId: identifier,
                settingsRevision: revision,
                fragment: { type: 'object' },
                references,
            },
            ['conversationAssetId', 'settingsRevision', 'fragment'],
        ),
        run: async (composer, input) => {
            const conversationAssetId = input.conversationAssetId as string

            if (
                conversationAssetId === composer.conversationAssetId
                || (await composer.dispatchAncestry()).includes(conversationAssetId)
            )
                throw new Error('CANVAS_COMPOSER_RECURSIVE_DISPATCH')

            const result = await composer.dispatchMessage({
                conversationAssetId,
                settingsRevision: input.settingsRevision as number,
                fragment: input.fragment as ConversationMessageNode,
                references: (input.references ?? []) as ConversationReference[],
            })

            if (result.acknowledgement.status === 'rejected')
                return {
                    status: 'error',
                    error: result.acknowledgement.error,
                }

            if (result.operationId)
                return {
                    status: 'pending',
                    operationId: result.operationId,
                    conversationAssetId,
                    acknowledgement: result.acknowledgement,
                }

            return { acknowledgement: result.acknowledgement }
        },
    },
    stop_canvas_conversation: {
        description: 'Stop the specified run in a current-workspace conversation and pause its queue. Use the current run ID.',
        intent: 'execute',
        schema: object(
            {
                conversationAssetId: identifier,
                runId: identifier,
            },
            ['conversationAssetId', 'runId'],
        ),
        run: async (composer, input) => await composer.stopRun(input.conversationAssetId as string, input.runId as string),
    },
    cancel_canvas_queued_messages: {
        description: 'Remove the specified queued messages from a current-workspace conversation. Use its current queue revision.',
        intent: 'execute',
        schema: object(
            {
                conversationAssetId: identifier,
                expectedRevision: revision,
                turnIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    uniqueItems: true,
                    items: identifier,
                },
            },
            ['conversationAssetId', 'expectedRevision', 'turnIds'],
        ),
        run: async (composer, input) => await composer.cancelQueued(
            input.conversationAssetId as string,
            input.expectedRevision as number,
            input.turnIds as string[],
        ),
    },
    resume_canvas_conversation_queue: {
        description: 'Resume queued work in a current-workspace conversation using its current queue revision.',
        intent: 'execute',
        schema: object(
            {
                conversationAssetId: identifier,
                expectedRevision: revision,
            },
            ['conversationAssetId', 'expectedRevision'],
        ),
        run: async (composer, input) => await composer.resumeQueue(input.conversationAssetId as string, input.expectedRevision as number),
    },
}

const handledErrors = new Map([
    ['CANVAS_COMPOSER_RECURSIVE_DISPATCH', 'Send the message to another conversation outside this turn’s sending chain.'],
    ['CONVERSATION_NOT_FOUND', 'Use the ID of an available conversation in this workspace.'],
    ['STALE_CONVERSATION_SETTINGS', 'Read the current conversation settings before retrying.'],
    ['STALE_CONVERSATION_QUEUE', 'Read the current queue before retrying.'],
    ['STALE_CONVERSATION_RUN', 'Read the current run state before retrying.'],
    ['CONVERSATION_TURN_NOT_QUEUED', 'Read the current queue and select queued messages.'],
    ['CANVAS_COMPOSER_SOURCE_NOT_ADMITTED', 'Attach an Asset that is on the canvas or admitted to this turn.'],
    ['AGENT_BUDGET_EXHAUSTED:delegationCalls', 'This turn has no remaining agent dispatches.'],
    ['REVISION_CONFLICT', 'Read the current conversation title before retrying.'],
])

export const createCanvasComposerAgentTools = (access: CanvasComposerAccess): CapabilityAgentRegistration[] =>
    Object.entries(tools).map(
        ([name, tool]): CapabilityAgentRegistration => ({
            kind: 'tool',
            name,
            description: tool.description,
            schema: tool.schema,
            intent: tool.intent,
            operationFamilies: [WORKSPACE_CANVAS_OPERATION],
            execute: async (input, context) => {
                const composer = await access(context)
                composer.signal.throwIfAborted()

                try {
                    const result = await tool.run(composer, input)

                    if ('status' in result)
                        return result

                    return {
                        status: 'succeeded',
                        data: result,
                    }
                } catch (error) {
                    const code = error instanceof Error ? error.message : ''
                    const message = handledErrors.get(code)

                    if (!message)
                        throw error

                    return {
                        status: 'error',
                        error: {
                            code,
                            message,
                            recoverable: true,
                        },
                    }
                }
            },
        }),
    )
