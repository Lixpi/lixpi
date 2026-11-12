// @vitest-environment happy-dom
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    mountEditorDocument: vi.fn(),
    destroy: vi.fn(),
}))

vi.mock('./editor-views.ts', async importOriginal => ({
    ...await importOriginal<typeof import('./editor-views.ts')>(),
    mountEditorDocument: mocks.mountEditorDocument,
}))

import { editorDocumentViews } from './editor-views.ts'
import { mountReadOnlyAiChatThreadProjection } from './read-only-ai-chat-thread.ts'

const registry = { schema: vi.fn() } as never
const services = { media: {} } as never

const makeContent = () => ({
    type: 'doc',
    content: [],
}) as const

const makeMount = (): HTMLElement => {
    const mount = document.createElement('div')
    mount.className = 'read-only-test-mount'

    return mount
}

describe('mountReadOnlyAiChatThreadProjection', () => {
    beforeEach(() => {
        mocks.mountEditorDocument.mockReset().mockReturnValue({ destroy: mocks.destroy })
        mocks.destroy.mockReset()
    })

    it('mounts a read-only provenance view in a host carrying the projection classes', () => {
        const mount = makeMount()
        const content = makeContent()
        const promptReferencePreviewRenderer = { getNode: vi.fn() } as never

        const projection = mountReadOnlyAiChatThreadProjection({
            registry,
            services,
            mount,
            content,
            threadId: 'thread-1',
            className: 'custom-thread-projection',
            traceDetailsOptions: { className: 'trace-projection' },
            promptReferencePreviewRenderer,
        })

        const host = mount.querySelector('.read-only-ai-chat-thread-projection') as HTMLElement | null
        expect(host).not.toBeNull()
        expect(host!.classList.contains('ai-chat-thread-node-editor')).toBe(true)
        expect(host!.classList.contains('custom-thread-projection')).toBe(true)

        const [options] = mocks.mountEditorDocument.mock.calls[0]!
        expect(options).toMatchObject({
            registry,
            container: host,
            document: content,
            readOnly: true,
            definition: editorDocumentViews.assetProvenance,
            context: {
                services,
                promptReferences: { previewRenderer: promptReferencePreviewRenderer },
                chat: {
                    threadId: 'thread-1',
                    renderContext: {
                        readOnly: true,
                        traceDetailsOptions: { className: 'trace-projection' },
                    },
                },
            },
        })

        projection.destroy()
        expect(mocks.destroy).toHaveBeenCalledTimes(1)
        expect(mount.children).toHaveLength(0)
    })

    it('uses the conversation view when asked and adds no custom class by default', () => {
        const mount = makeMount()

        mountReadOnlyAiChatThreadProjection({
            registry,
            services,
            mount,
            content: makeContent(),
            threadId: 'thread-2',
            documentType: 'assetConversation',
        })

        const host = mount.querySelector('.read-only-ai-chat-thread-projection') as HTMLElement | null
        expect(host!.className).toBe('ai-chat-thread-node-editor read-only-ai-chat-thread-projection')
        expect(mocks.mountEditorDocument.mock.calls[0]![0].definition).toBe(editorDocumentViews.assetConversation)
    })
})
