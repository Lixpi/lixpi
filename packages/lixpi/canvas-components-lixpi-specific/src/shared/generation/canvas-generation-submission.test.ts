import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Asset,
} from '@lixpi/constants'
import {
    type AiPromptComposerSubmitData,
} from '../composer/canvas-conversation-content.ts'
import {
    CanvasGenerationSubmission,
    type CanvasGenerationSubmissionPorts,
    type CanvasGenerationSubmissionScope,
} from './canvas-generation-submission.ts'

function data(): AiPromptComposerSubmitData {
    return {
        contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quiet street' }] }],
        mediaGenerationMode: 'image',
        aiReasoningModels: ['reasoning'],
        useMultipleReasoningModels: false,
        useMultipleImageModels: false,
        useMultipleVideoModels: false,
        capabilityInputs: {},
    }
}

function asset(assetId: string): Asset {
    return {
        assetId,
        organizationId: 'organization',
        revision: 3,
        title: 'A quiet street',
        createdAt: 10,
        updatedAt: 11,
        documents: { conversation: { version: 2 } },
        states: { conversation: 'idle' },
    } as Asset
}

function setup() {
    let scope: CanvasGenerationSubmissionScope | null = { workspaceId: 'one', organizationId: 'organization', sceneKey: 'scene', contextNodeIds: ['selected'] }
    let sequence = 0
    const ports: CanvasGenerationSubmissionPorts = {
        readScope: () => scope,
        createId: () => `id-${++sequence}`,
        now: () => 42,
        createConversation: vi.fn(async request => asset(request.assetId)),
        activate: vi.fn(),
        cancel: vi.fn(),
        install: vi.fn(),
        reportError: vi.fn(),
    }
    return {
        submission: new CanvasGenerationSubmission(ports),
        ports,
        setScope: (value: CanvasGenerationSubmissionScope | null) => {
            scope = value
        },
    }
}

describe('CanvasGenerationSubmission', () => {
    it('persists the submitted message before installing the conversation', async () => {
        const { submission, ports } = setup()
        await submission.submit(data())
        expect(ports.createConversation).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'one',
            organizationId: 'organization',
            assetId: 'id-1',
            title: 'A quiet street',
            initialDoc: expect.objectContaining({
                content: [expect.objectContaining({
                    content: [expect.objectContaining({ attrs: { id: 'msg-id-2', createdAt: 42, referenceNodeIds: ['selected'] } })],
                })],
            }),
        }))
        expect(ports.install).toHaveBeenCalledWith(expect.objectContaining({ thread: expect.objectContaining({ threadId: 'id-1', workspaceId: 'one', revision: 3, proseMirrorVersion: 2 }) }))
        expect(ports.cancel).not.toHaveBeenCalled()
    })

    it('rejects empty requests and requests without reasoning selection before creating an Asset', async () => {
        const { submission, ports } = setup()
        await submission.submit({ ...data(), contentJSON: [] })
        await submission.submit({ ...data(), aiReasoningModels: [] })
        expect(ports.createConversation).not.toHaveBeenCalled()
        expect(ports.activate).not.toHaveBeenCalled()
        expect(ports.reportError).toHaveBeenCalledTimes(1)
    })

    it('deduplicates node references while respecting an explicit empty context selection', async () => {
        const { submission, ports } = setup()
        const reference = { type: 'prompt_reference', attrs: { referenceType: 'media', assetId: 'asset', nodeId: 'node', mediaKind: 'image', displayName: 'Frame' } }
        await submission.submit({ ...data(), contentJSON: [reference, reference] }, { explicitContextNodeIds: [] })
        expect(ports.install).toHaveBeenCalledWith(expect.objectContaining({ explicitContextNodeIds: ['node'] }))
    })

    it('keeps the admitted request immutable while conversation creation awaits transport', async () => {
        const { submission, ports } = setup()
        const created = Promise.withResolvers<Asset>()
        vi.mocked(ports.createConversation).mockReturnValueOnce(created.promise)
        const request = data()
        const options = { explicitContextNodeIds: ['selected'], excludedCanvasNodeIds: ['excluded'] }
        const pending = submission.submit(request, options)
        request.aiReasoningModels[0] = 'changed'
        options.excludedCanvasNodeIds.push('later')
        created.resolve(asset('id-1'))
        await pending
        expect(ports.install).toHaveBeenCalledWith(expect.objectContaining({ submittedData: expect.objectContaining({ aiReasoningModels: ['reasoning'] }), excludedCanvasNodeIds: ['excluded'] }))
    })

    it.each(['workspace', 'scene'])('does not install an editor after the %s changes', async changed => {
        const { submission, ports, setScope } = setup()
        const created = Promise.withResolvers<Asset>()
        vi.mocked(ports.createConversation).mockReturnValueOnce(created.promise)
        const pending = submission.submit(data())
        setScope({ workspaceId: changed === 'workspace' ? 'two' : 'one', organizationId: 'organization', sceneKey: changed === 'scene' ? 'replacement' : 'scene', contextNodeIds: [] })
        created.resolve(asset('id-1'))
        await pending
        expect(ports.install).not.toHaveBeenCalled()
        expect(ports.cancel).toHaveBeenCalledExactlyOnceWith('id-1')
        expect(ports.createConversation).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'one' }))
    })

    it('releases pending activation once on disposal without cancelling accepted Asset creation', async () => {
        const { submission, ports } = setup()
        const created = Promise.withResolvers<Asset>()
        vi.mocked(ports.createConversation).mockReturnValueOnce(created.promise)
        const pending = submission.submit(data())
        submission.destroy()
        submission.destroy()
        created.resolve(asset('id-1'))
        await pending
        await submission.submit(data())
        expect(ports.cancel).toHaveBeenCalledTimes(1)
        expect(ports.createConversation).toHaveBeenCalledTimes(1)
        expect(ports.install).not.toHaveBeenCalled()
    })

    it('cleans up a failed editor installation', async () => {
        const { submission, ports } = setup()
        vi.mocked(ports.install).mockImplementationOnce(() => {
            throw new Error('editor failed')
        })
        await submission.submit(data())
        expect(ports.cancel).toHaveBeenCalledExactlyOnceWith('id-1')
        expect(ports.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'editor failed' }))
    })

    it('stops before transport if activation closes the scene', async () => {
        const { submission, ports } = setup()
        vi.mocked(ports.activate).mockImplementationOnce(() => submission.clear())
        await submission.submit(data())
        expect(ports.createConversation).not.toHaveBeenCalled()
        expect(ports.cancel).toHaveBeenCalledTimes(1)
    })
})
