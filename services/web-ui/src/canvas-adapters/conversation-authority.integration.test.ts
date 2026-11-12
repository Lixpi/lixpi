import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { createCoreDocumentKindRegistry, getAssetDocumentEventSubject, type LoggedAssetStepStreamEvent } from '@lixpi/prosemirror'
import { DocumentAuthority } from '@lixpi/prosemirror/frontend/document-authority'
import { createAiChatThreadPlugin } from '@lixpi/prosemirror/frontend/editor'
import { createDocumentAuthorityTransport } from '$src/editor/document-authority-transport.ts'
import { createWebUiEditorServices } from '$src/editor/editor-services.ts'

const stores = vi.hoisted(() => ({ getData: vi.fn() }))
vi.mock('$src/stores/servicesStore.ts', () => ({ servicesStore: { getData: stores.getData } }))

afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

describe('native chat document authority', () => {
    it.each([false, true])('applies replay and live steps through real chat NodeViews while preserving rich content and selection (backward: %s)', async backward => {
        const schema = createCoreDocumentKindRegistry().schema('assetConversation')
        const coordinate = {
            organizationId: 'org',
            assetId: 'conversation',
            role: 'conversation' as const,
        }
        const initial = schema.nodeFromJSON({
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'conversation' },
                content: [{
                    type: 'aiUserMessage',
                    attrs: { id: 'user' },
                    content: [{
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: 'Rich request',
                            marks: [{ type: 'strong' }],
                        }],
                    }],
                }, {
                    type: 'aiResponseMessage',
                    attrs: {
                        id: 'response',
                        isReceivingAnimation: true,
                    },
                    content: [{
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: 'Hello',
                        }],
                    }],
                }],
            }],
        })
        const mount = document.createElement('div')
        document.body.append(mount)
        const view = new EditorView(mount, {
            state: EditorState.create({
                doc: initial,
                plugins: [createAiChatThreadPlugin({
                    services: createWebUiEditorServices({ getTokenSilently: async () => 'test-token' }),
                    sendAiRequestHandler: vi.fn(),
                    stopAiRequestHandler: vi.fn(),
                    renderContext: { readOnly: true },
                })],
            }),
            editable: () => false,
        })
        const responsePosition = initial.child(0).child(0).nodeSize + 1
        const textStart = responsePosition + 2
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, backward ? textStart + 5 : textStart, backward ? textStart : textStart + 5)))
        let server = EditorState.create({ doc: initial })
        const append = (text: string, version: number): LoggedAssetStepStreamEvent => {
            const tr = server.tr.insertText(text, server.doc.content.size - 3)
            server = server.apply(tr)

            return {
                ...coordinate,
                kind: 'STEP',
                version,
                subjectSeq: version,
                streamSequence: version,
                origin: 'ai-stream',
                msgId: `step-${version}`,
                clientId: 'server',
                step: tr.steps[0].toJSON(),
            }
        }
        const first = append(' world', 1)
        const second = append('!', 2)
        const third = append(' Again.', 3)
        let receive!: (event: LoggedAssetStepStreamEvent) => void
        const unsubscribe = vi.fn()
        const liveSubject = getAssetDocumentEventSubject('user', coordinate)
        const request = vi.fn()
            .mockResolvedValueOnce({
                snapshot: null,
                events: [first],
                currentVersion: 1,
                currentStreamSeq: 1,
                hasMore: false,
                liveSubject,
            })
            .mockResolvedValueOnce({
                snapshot: null,
                events: [second, third],
                currentVersion: 3,
                currentStreamSeq: 3,
                hasMore: false,
                liveSubject,
            })
        stores.getData.mockReturnValue({
            subscribe: (_subject: string, callback: typeof receive) => { receive = callback

            return { unsubscribe } },
            request,
        })
        const assetService = {
            acquireLease: vi.fn(),
            fetchDocumentSnapshot: vi.fn(),
        }
        const authority = new DocumentAuthority({
            ...coordinate,
            workspaceId: 'workspace',
            receiveOnly: true,
            baseVersion: 0,
            getView: () => view,
            transport: createDocumentAuthorityTransport(assetService as never, {
                getTokenSilently: async () => 'test-token',
                userStore: { getData: () => 'user' },
            } as never),
        })

        try {
            await vi.waitFor(() => expect(view.state.doc.textContent).toBe('Rich requestHello world'))
            expect(mount.querySelector('.ai-user-message strong')?.textContent).toBe('Rich request')
            expect(mount.querySelector('.ai-response-message-content')?.textContent).toBe('Hello world')
            expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('Hello')
            const response = mount.querySelector('.ai-response-message-wrapper')
            receive(first)
            expect(view.state.doc.textContent).toBe('Rich requestHello world')
            receive(third)
            await vi.waitFor(() => expect(view.state.doc.textContent).toBe('Rich requestHello world! Again.'))
            expect(mount.querySelector('.ai-response-message-wrapper')).toBe(response)
            expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('Hello')
            view.dispatch(view.state.tr.insertText('Unauthorized local edit', textStart))
            expect(view.state.doc.textContent).toBe('Rich requestHello world! Again.')
            expect(assetService.acquireLease).not.toHaveBeenCalled()
            expect(request).toHaveBeenCalledTimes(2)
        } finally {
            authority.disconnect()
            view.destroy()
        }

        expect(unsubscribe).toHaveBeenCalledOnce()
    })
})
