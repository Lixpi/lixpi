import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { WorkspacePromptComposer } from '@lixpi/canvas-components-lixpi-specific/frontend/composer'
import {
    WorkspaceConversationController,
    WorkspaceConversationPanel,
    type WorkspaceConversationPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    createConversationSettings,
    type ConversationSnapshot,
} from '@lixpi/constants'
import { createPromptComposerEditorPort } from './prompt-composer-editor.ts'

const composers: WorkspacePromptComposer[] = []

afterEach(() => {
    for (const composer of composers.splice(0)) composer.destroy()

    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('conversation drafts through the native prompt editor', () => {
    it('restores independent drafts after a rejected submission in the same expanded native editor', async () => {
        const stored = new Map<string, string>()
        let controller!: WorkspaceConversationController
        const models = {
            reasoningModelIds: ['test:reasoning' as const],
            imageModelIds: [],
            videoModelIds: [],
        }
        const composer = new WorkspacePromptComposer({
            document,
            workspaceId: 'workspace',
            userId: 'user',
            storage: {
                getItem: key => stored.get(key) ?? null,
                setItem: (key, value) => void stored.set(key, value),
            },
            appearance: {
                popoverBoxShadow: '',
                useShiftingGradientBackground: false,
                gradientColors: [],
            },
            mountContextTray: () => ({
                element: document.createElement('div'),
                destroy: () => {},
            }),
            mountEditor: createPromptComposerEditorPort({
                assetService: {} as never,
                auth: { userStore: { getData: () => 'user' } } as never,
            }),
            onSubmit: data => controller.submit({
                type: 'aiUserMessage',
                content: data.contentJSON,
            }, [], models),
        })
        composers.push(composer)
        document.body.append(composer.element)
        const view = composer.input.editorView!
        const snapshot = (id: string): ConversationSnapshot => ({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: id,
            title: id,
            settings: {
                ...createConversationSettings(),
                models,
            },
            settingsRevision: 0,
            queueRevision: 0,
            queuePaused: false,
            queuedTurns: [],
            messages: [],
            documentRevision: 0,
            eventSeq: 0,
            createdAt: 1,
            updatedAt: 1,
        })
        const conversations = ['hi'].map(snapshot)
        const submit = vi.fn(async () => { throw new Error('Request was not authorized.') })
        controller = new WorkspaceConversationController('workspace', 'user', {
            list: async () => ({ conversations }),
            get: async request => snapshot(request.conversationAssetId),
            create: async () => snapshot('blue-hold'),
            submit,
            subscribe: () => () => {},
            replay: async () => ({
                events: [],
                hasMore: false,
                eventSeq: 0,
                snapshotRequired: false,
            }),
        } as unknown as WorkspaceConversationPorts, {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => void stored.set(key, value),
        }, () => 'id')
        const selected = vi.fn((id: string) => {
            window.setTimeout(() => {
                if (controller.current?.conversationAssetId === id)
                    composer.selectConversation(id, controller.current.settings.models)
            }, 0)
        })
        const panel = new WorkspaceConversationPanel(controller, document, selected, undefined, {
            load: async () => null,
            mount: vi.fn(),
        })
        composer.element.prepend(panel.element)

        try {
            await controller.initialize('hi')
            await vi.waitFor(() => expect(selected).toHaveBeenLastCalledWith('hi'))
            await new Promise(resolve => setTimeout(resolve, 10))
            expect(view.state.doc.textContent).toBe('')
            const picker = panel.element.querySelector<HTMLSelectElement>('[aria-label="Conversation"]')!
            const create = [...panel.element.querySelectorAll('button')].find(button => button.textContent === 'New conversation')!
            create.click()
            await vi.waitFor(() => expect(selected).toHaveBeenLastCalledWith('blue-hold'))
            await new Promise(resolve => setTimeout(resolve, 10))
            const expanded = document.createElement('section')
            document.body.append(expanded)
            expanded.append(composer.element)
            view.dispatch(view.state.tr.insertText('Make a blue hold', 2))
            view.dom.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            }))
            await vi.waitFor(() => expect(controller.error).toBe('Request was not authorized.'))
            expect(submit).toHaveBeenCalledOnce()
            const paragraph = expanded.querySelector<HTMLElement>('.ai-prompt-input-content p')!
            paragraph.textContent = 'Unsent pipeline draft'
            paragraph.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: 'Unsent pipeline draft',
            }))
            await vi.waitFor(() => expect(view.state.doc.textContent).toBe('Unsent pipeline draft'))
            view.dispatch(view.state.tr.addMark(2, 8, view.state.schema.marks.strong.create()))
            const blueDraft = view.state.doc.toJSON()
            expect(expanded.querySelector('.ai-prompt-input-content')?.textContent).toBe('Unsent pipeline draft')
            picker.value = 'hi'
            picker.dispatchEvent(new Event('change'))
            await vi.waitFor(() => expect(selected).toHaveBeenLastCalledWith('hi'))
            await new Promise(resolve => setTimeout(resolve, 10))
            expect(composer.input.editorView).toBe(view)
            expect(view.state.doc.textContent).toBe('')
            expect(expanded.querySelector('.ai-prompt-input-content')?.textContent).toBe('')
            await new Promise(resolve => setTimeout(resolve, 10))
            composer.selectConversation('blue-hold')
            expect(view.state.doc.toJSON()).toEqual(blueDraft)
            expect(expanded.querySelector('.ai-prompt-input-content strong')?.textContent).toBe('Unsent')
        } finally {
            panel.destroy()
        }
    })
})
