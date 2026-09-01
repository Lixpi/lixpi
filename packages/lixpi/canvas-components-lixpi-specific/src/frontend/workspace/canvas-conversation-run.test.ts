// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasState,
    CanvasNode,
} from '@lixpi/constants'
import { WorkspaceGenerationContext } from '../../shared/generation/workspace-generation-context.ts'
import { CanvasConversationEditors } from './canvas-conversation-editors.ts'
import {
    CanvasConversationRun,
    type CanvasConversationEditorMount,
    type CanvasConversationRunOptions,
    type CanvasConversationRunPorts,
    type CanvasConversationSubmit,
    type CanvasGenerationRequest,
} from './canvas-conversation-run.ts'

const media = (nodeId: string, type: 'image' | 'video' = 'image'): CanvasNode => ({
    nodeId,
    type,
    assetId: `asset-${nodeId}`,
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
})
const submitData = (): CanvasConversationSubmit => ({
    messages: [{ role: 'user', content: 'serialized prompt' }],
    mediaGenerationMode: 'video',
    aiReasoningModels: ['reasoning-a', 'reasoning-b'],
    useMultipleReasoningModels: true,
    useMultipleImageModels: false,
    useMultipleVideoModels: true,
    imageOptions: { aiImageModels: ['image-a'], imageGenerationSize: '1024x1024' },
    videoOptions: { aiVideoModels: ['video-a'], sourceVideoNodeId: 'video', videoAspectRatio: '16:9', videoResolution: '720p', videoDuration: '5' },
    referenceNodeIds: ['image', 'excluded'],
})

function setup(overrides: Partial<CanvasConversationRunPorts> = {}, options: Partial<CanvasConversationRunOptions> = {}) {
    const editors = new CanvasConversationEditors<CanvasConversationRun>({
        pane: document.createElement('div'),
        setTimer: () => 1,
        clearTimer: () => {},
    })
    let callbacks!: CanvasConversationEditorMount
    let transportError!: (error: unknown) => void
    const editor = { readContent: vi.fn(() => ({ type: 'doc', content: [] })), submitPersisted: vi.fn(), destroy: vi.fn(), activate: vi.fn() }
    const transport = { send: vi.fn(async (_request: CanvasGenerationRequest) => {}), stop: vi.fn(async () => {}), disconnect: vi.fn() }
    const state: CanvasState = {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [media('image'), media('video', 'video'), media('excluded')],
        edges: [{ edgeId: 'edge', sourceNodeId: 'excluded', targetNodeId: 'image', sourceHandle: 'right', targetHandle: 'left' }],
    }
    const ports: CanvasConversationRunPorts = {
        mountEditor: request => {
            callbacks = request
            return editor
        },
        connect: request => {
            transportError = request.onError
            return transport
        },
        context: new WorkspaceGenerationContext({ readAsset: () => undefined, renditionPath: (id, rendition) => `${id}/${rendition}` }),
        readCanvasState: () => state,
        getContextTitles: () => ({}),
        getVisibleArea: () => ({ width: 800, height: 600 }),
        createRequestId: () => 'request-1',
        now: () => 123,
        publishContent: vi.fn(),
        rememberContent: vi.fn(),
        refreshProjection: vi.fn(),
        setReceiving: vi.fn(),
        hasPendingPlacement: () => false,
        deferTeardown: vi.fn(),
        preflight: vi.fn(),
        clearContext: vi.fn(),
        fail: vi.fn(),
        teardown: vi.fn(),
        reportError: vi.fn(),
        onSegment: vi.fn(),
        ...overrides,
    }
    const config: CanvasConversationRunOptions = {
        workspaceId: 'workspace-1',
        thread: { threadId: 'thread-1', organizationId: 'org-1', content: { type: 'doc' }, proseMirrorVersion: 7 },
        submittedData: {
            contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'exact composer prompt' }] }],
            mediaGenerationMode: 'video',
            aiReasoningModels: ['reasoning-a'],
            useMultipleReasoningModels: false,
            useMultipleImageModels: false,
            useMultipleVideoModels: false,
            capabilityInputs: {},
            reasoningOptions: { configGroups: [{ groupId: 'reasoning-config', modelIds: ['reasoning-a'], values: {} }] },
        },
        explicitContextNodeIds: ['video', 'image'],
        excludedCanvasNodeIds: ['excluded'],
        ...options,
    }
    const mount = () => editors.mount(config.thread.threadId, scope => new CanvasConversationRun(scope, config, ports))
    const run = mount()
    return {
        editors,
        editor,
        transport,
        state,
        ports,
        config,
        run,
        mount,
        get callbacks() {
            return callbacks
        },
        fail: (error: unknown) => transportError(error),
    }
}

describe('canvas conversation run', () => {
    it('forwards media events only for the live workspace and conversation', () => {
        const fixture = setup()
        fixture.callbacks.onSegment({ type: 'image_partial', workspaceId: 'other', conversationAssetId: 'thread-1' })
        fixture.callbacks.onSegment({ type: 'image_partial', workspaceId: 'workspace-1', conversationAssetId: 'other' })
        expect(fixture.ports.onSegment).not.toHaveBeenCalled()
        const event = { type: 'image_partial', workspaceId: 'workspace-1', conversationAssetId: 'thread-1' }
        fixture.callbacks.onSegment(event, { responseMessageId: 'response' })
        expect(fixture.ports.onSegment).toHaveBeenCalledWith(event, { responseMessageId: 'response' })
        fixture.editors.clear()
        fixture.callbacks.onSegment(event)
        expect(fixture.ports.onSegment).toHaveBeenCalledTimes(1)
        fixture.editors.destroy()
    })
    it('prepares explicit context and preflight before sending unchanged generation selections', async () => {
        const fixture = setup()
        fixture.ports.clearContext = vi.fn(() => expect(fixture.ports.preflight).toHaveBeenCalledTimes(1))
        fixture.transport.send.mockImplementation(async request => {
            expect(fixture.ports.clearContext).toHaveBeenCalledTimes(1)
            expect(request).toMatchObject({
                generationRequestId: 'request-1',
                aiReasoningModels: ['reasoning-a', 'reasoning-b'],
                mediaGenerationMode: 'video',
                useMultipleReasoningModels: true,
                useMultipleImageModels: false,
                useMultipleVideoModels: true,
                aiImageModels: ['image-a'],
                imageSize: '1024x1024',
                aiVideoModels: ['video-a'],
                videoAspectRatio: '16:9',
                videoResolution: '720p',
                videoDuration: '5',
                videoSourceForExtension: 'asset-video',
                canvasVisibleArea: { width: 800, height: 600 },
                reasoningConfigGroups: fixture.config.submittedData!.reasoningOptions!.configGroups,
                workspaceContextSnapshot: { workspaceId: 'workspace-1', promptText: 'exact composer prompt' },
            })
            expect(request.workspaceContextSnapshot!.nodes.map(node => node.nodeId)).toEqual(['image', 'video'])
            expect(request.mediaBranchCandidateSnapshot!.candidates.map(node => node.nodeId)).toEqual(['image', 'video'])
        })
        await fixture.callbacks.onSubmit(submitData())
        expect(fixture.ports.preflight).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceNodeIds: ['video', 'image'],
                promptText: 'exact composer prompt',
                promptParts: [{ type: 'text', text: 'exact composer prompt' }],
                createdAt: 123,
            }),
            fixture.config.submittedData,
            undefined,
        )
        fixture.editors.destroy()
    })

    it('retains submitted options despite later composer mutation and passes regeneration through', async () => {
        const regeneration = { mode: 'existing-prompt', lineageParentNodeId: 'branch', branchId: 'branch', lineageParentType: 'branchOrigin', replayPrompts: [] } satisfies NonNullable<CanvasConversationRunOptions['regeneration']>
        const fixture = setup({}, { regeneration })
        fixture.config.submittedData!.contentJSON[0].content[0].text = 'changed'
        fixture.config.explicitContextNodeIds!.length = 0
        await fixture.callbacks.onSubmit(submitData())
        expect(fixture.transport.send).toHaveBeenCalledWith(expect.objectContaining({
            regeneration,
            workspaceContextSnapshot: expect.objectContaining({ promptText: 'exact composer prompt' }),
        }))
        fixture.editors.destroy()
    })

    it('sends reasoning without adding media preflight or a request identifier', async () => {
        const fixture = setup()
        await fixture.callbacks.onSubmit({ ...submitData(), imageOptions: undefined, videoOptions: undefined })
        expect(fixture.ports.preflight).not.toHaveBeenCalled()
        expect(fixture.transport.send.mock.calls[0][0]).not.toHaveProperty('generationRequestId')
        fixture.editors.destroy()
    })

    it('receives persisted runs without resubmitting them', async () => {
        const fixture = setup({}, { submittedData: undefined })
        await fixture.callbacks.onSubmit(submitData())
        fixture.callbacks.onStreaming({ type: 'doc', content: [{ type: 'text', text: 'stream' }] })
        expect(fixture.transport.send).not.toHaveBeenCalled()
        expect(fixture.ports.rememberContent).toHaveBeenCalledWith('thread-1', expect.any(Object), true)
        expect(fixture.ports.publishContent).not.toHaveBeenCalled()
        fixture.callbacks.onChange({ type: 'doc' })
        expect(fixture.ports.rememberContent).toHaveBeenLastCalledWith('thread-1', { type: 'doc' }, false)
        expect(fixture.ports.publishContent).toHaveBeenCalledWith({ type: 'doc' })
        fixture.editors.destroy()
    })

    it('defers settled editors only when their own placement is no longer pending', () => {
        let pending = true
        const fixture = setup({ hasPendingPlacement: () => pending })
        fixture.callbacks.onReceiving('other-thread', false)
        expect(fixture.ports.setReceiving).not.toHaveBeenCalled()
        fixture.callbacks.onReceiving('thread-1', false)
        expect(fixture.ports.deferTeardown).not.toHaveBeenCalled()
        pending = false
        fixture.callbacks.onReceiving('thread-1', false)
        expect(fixture.ports.deferTeardown).toHaveBeenCalledWith('thread-1')
        fixture.editors.destroy()
    })

    it('ignores callbacks and submit dispatch from a removed editor', async () => {
        const fixture = setup()
        fixture.editors.clear()
        fixture.callbacks.onStreaming({ type: 'doc' })
        fixture.callbacks.onChange({ type: 'doc' })
        fixture.callbacks.onReceiving('thread-1', true)
        fixture.fail(new Error('late stream'))
        fixture.callbacks.onStop()
        fixture.run.submitPersisted()
        await fixture.callbacks.onSubmit(submitData())
        expect(fixture.ports.refreshProjection).not.toHaveBeenCalled()
        expect(fixture.ports.fail).not.toHaveBeenCalled()
        expect(fixture.transport.send).not.toHaveBeenCalled()
        expect(fixture.transport.stop).not.toHaveBeenCalled()
        expect(fixture.editor.submitPersisted).not.toHaveBeenCalled()
        expect(fixture.editor.destroy).toHaveBeenCalledTimes(1)
        expect(fixture.transport.disconnect).toHaveBeenCalledTimes(1)
        fixture.editors.destroy()
    })

    it('does not send if clearing submitted chips replaces the scene', async () => {
        const fixture = setup()
        fixture.ports.clearContext = () => fixture.editors.clear()
        await fixture.callbacks.onSubmit(submitData())
        expect(fixture.transport.send).not.toHaveBeenCalled()
    })

    it('lets accepted transport settle without tearing down a replacement editor', async () => {
        const pending = Promise.withResolvers<void>()
        const fixture = setup()
        fixture.transport.send.mockReturnValue(pending.promise)
        const oldCallbacks = fixture.callbacks
        const submitted = oldCallbacks.onSubmit(submitData())
        fixture.mount()
        pending.reject(new Error('old request failed'))
        await expect(submitted).rejects.toThrow('old request failed')
        expect(fixture.ports.teardown).not.toHaveBeenCalled()
        expect(fixture.editors.has('thread-1')).toBe(true)
        fixture.editors.destroy()
    })

    it('owns editor cleanup when transport connection or editor activation fails', () => {
        const fixture = setup()
        fixture.ports.connect = () => {
            throw new Error('connect failed')
        }
        expect(() => fixture.mount()).toThrow('connect failed')
        expect(fixture.editor.destroy).toHaveBeenCalledTimes(2)
        expect(fixture.editors.has('thread-1')).toBe(false)
        fixture.editors.destroy()
        const activated = setup()
        activated.editor.activate.mockImplementation(() => {
            throw new Error('activate failed')
        })
        expect(() => activated.mount()).toThrow('activate failed')
        expect(activated.transport.disconnect).toHaveBeenCalledTimes(2)
        activated.editors.destroy()
    })

    it('connects transport before activating queued editor submissions', () => {
        const fixture = setup()
        fixture.editor.activate.mockImplementation(() => fixture.fail(new Error('queued failure')))
        fixture.mount()
        expect(fixture.ports.fail).toHaveBeenCalledTimes(1)
        fixture.editors.destroy()
    })

    it('keeps independent canvases with the same conversation alive separately', () => {
        const first = setup()
        const second = setup()
        first.editors.destroy()
        second.run.submitPersisted()
        second.callbacks.onStreaming({ type: 'doc' })
        expect(second.editor.submitPersisted).toHaveBeenCalledTimes(1)
        expect(second.ports.refreshProjection).toHaveBeenCalledTimes(1)
        second.editors.destroy()
    })
})
