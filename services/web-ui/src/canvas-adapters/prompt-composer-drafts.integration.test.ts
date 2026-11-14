import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { WorkspacePromptComposer } from '@lixpi/canvas-components/workspace/composer'
import {
    WorkspaceConversationController,
    WorkspaceConversationPanel,
    type WorkspaceConversationPorts,
} from '@lixpi/canvas-components/workspace'
import {
    createConversationSettings,
    type ConversationSnapshot,
} from '@lixpi/constants'
import { createPromptComposerEditorPort } from './prompt-composer-editor.ts'
import { createWebUiEditorEnvironment } from '$src/editor/web-ui-editor.ts'

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
                environment: createWebUiEditorEnvironment({} as never, {
                    getTokenSilently: async () => 'token-1',
                    userStore: { getData: () => 'user' },
                } as never),
            }),
            onSubmit: data => controller.submit({
                type: 'aiUserMessage',
                content: data.contentJSON,
            }, [], models),
        })
        composers.push(composer)
        document.body.append(composer.element)
        const editorDom = composer.input.editorContainer.querySelector<HTMLElement>('.ProseMirror')!
        const readText = (): string => {
            const visit = (value: unknown): string => {
                if (
                    !value
                    || typeof value !== 'object'
                )
                    return ''

                const node = value as {
                    text?: string
                    content?: unknown[]
                }

                return node.text ?? (node.content ?? []).map(visit).join('')
            }

            return visit(composer.input.readContent())
        }
        const setParagraph = (text: string, strong = false): void => {
            const content = structuredClone(composer.input.readContent()) as {
                type: string
                content?: Array<{
                    type: string
                    content?: unknown[]
                }>
            }
            const visit = (node: {
                type: string
                content?: unknown[]
            }): boolean => {
                if (node.type === 'paragraph') {
                    node.content = strong
                        ? [
                            {
                                type: 'text',
                                text: text.slice(0, 6),
                                marks: [{ type: 'strong' }],
                            },
                            {
                                type: 'text',
                                text: text.slice(6),
                            },
                        ]
                        : [{
                            type: 'text',
                            text,
                        }]

                    return true
                }

                return (node.content ?? []).some(child => visit(child as {
                    type: string
                    content?: unknown[]
                }))
            }
            visit(content)
            composer.input.restoreContent(content)
        }
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
            expect(readText()).toBe('')
            const picker = panel.element.querySelector<HTMLSelectElement>('[aria-label="Conversation history"]')!
            const create = [...panel.element.querySelectorAll('button')].find(button => button.textContent === 'New conversation')!
            create.click()
            await vi.waitFor(() => expect(selected).toHaveBeenLastCalledWith('blue-hold'))
            await new Promise(resolve => setTimeout(resolve, 10))
            const expanded = document.createElement('section')
            document.body.append(expanded)
            expanded.append(composer.element)
            setParagraph('Make a blue hold')
            editorDom.dispatchEvent(new KeyboardEvent('keydown', {
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
            await vi.waitFor(() => expect(readText()).toBe('Unsent pipeline draft'))
            setParagraph('Unsent pipeline draft', true)
            const blueDraft = composer.input.readContent()
            expect(expanded.querySelector('.ai-prompt-input-content')?.textContent).toBe('Unsent pipeline draft')
            picker.value = 'hi'
            picker.dispatchEvent(new Event('change'))
            await vi.waitFor(() => expect(selected).toHaveBeenLastCalledWith('hi'))
            await new Promise(resolve => setTimeout(resolve, 10))
            expect(composer.input.editorContainer.querySelector('.ProseMirror')).toBe(editorDom)
            expect(readText()).toBe('')
            expect(expanded.querySelector('.ai-prompt-input-content')?.textContent).toBe('')
            await new Promise(resolve => setTimeout(resolve, 10))
            composer.selectConversation('blue-hold')
            expect(composer.input.readContent()).toEqual(blueDraft)
            expect(expanded.querySelector('.ai-prompt-input-content strong')?.textContent).toBe('Unsent')
        } finally {
            panel.destroy()
        }
    })
})
