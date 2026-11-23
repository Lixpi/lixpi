import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'
import {
    type CanvasComposerSession,
} from './canvas-composer-ports.ts'
import { createCanvasComposerAgentTools } from './canvas-composer-tools.ts'

const context = {
    userId: 'actor',
    workspaceId: 'workspace',
    organizationId: 'organization',
    conversationAssetId: 'current',
    rootCapabilityId: 'global.workspace-canvas',
    origin: 'model',
    runId: 'run',
    variant: {
        axis: 'request',
        variantKey: 'request',
    },
} satisfies CapabilityActionAuthorizationContext

const fixture = () => {
    const dispatchMessage = vi.fn(async () => ({
        acknowledgement: {
            status: 'accepted' as const,
            clientMessageId: 'message-id',
            turnId: 'target-turn',
            commandSeq: 1,
            eventSeq: 1,
            documentRevision: 0,
            projectionPending: true,
        },
        operationId: 'delegation:existing',
    }))
    const session = {
        conversationAssetId: 'current',
        dispatchAncestry: vi.fn(async () => ['current', 'parent']),
        dispatchMessage,
        signal: new AbortController().signal,
    } as unknown as CanvasComposerSession

    const tools = createCanvasComposerAgentTools(async () => session)
    const entry = tools.find(tool => tool.name === 'send_canvas_conversation_message')

    if (
        !entry
        || !('execute' in entry)
    )
        throw new Error('Composer send missing')

    return {
        dispatchMessage,
        entry,
    }
}

describe('Workspace composer send Tool', () => {
    it.each(['current', 'parent'])('rejects sending to %s without invoking the host', async conversationAssetId => {
        const {
            dispatchMessage,
            entry,
        } = fixture()

        expect(await entry.execute({ conversationAssetId }, context)).toMatchObject({
            status: 'error',
            error: { code: 'CANVAS_COMPOSER_RECURSIVE_DISPATCH' },
        })
        expect(dispatchMessage).not.toHaveBeenCalled()
    })

    it('queues the typed target command and returns the existing runtime’s pending operation', async () => {
        const {
            dispatchMessage,
            entry,
        } = fixture()
        const input = {
            conversationAssetId: 'other',
            settingsRevision: 2,
            fragment: {
                type: 'aiUserMessage',
                content: [],
            },
            references: [{
                assetId: 'asset',
                role: 'media',
            }],
        }

        expect(await entry.execute(input, context)).toMatchObject({
            status: 'pending',
            operationId: 'delegation:existing',
            acknowledgement: { status: 'accepted' },
        })
        expect(dispatchMessage).toHaveBeenCalledWith(input)
        expect(entry.schema).toMatchObject({ additionalProperties: false })
    })
})
