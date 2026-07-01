import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CanvasNode } from '@lixpi/constants'
import { createContextPreviewTile, getContextPreviewAccessibleLabel, type ContextPreviewEnvironment } from '$src/components/contextPreview/contextPreview.ts'

function createMockEnvironment(overrides: {
    documents?: { documentId: string; title?: string; content?: string | object }[]
    threads?: { threadId: string; title?: string; content?: string | object }[]
    authToken?: string
    apiBaseUrl?: string
} = {}): ContextPreviewEnvironment {
    const {
        documents = [],
        threads = [],
        authToken = 'token-123',
        apiBaseUrl = 'https://api.example.com',
    } = overrides

    return {
        getDocuments: () => documents,
        getThreads: () => threads,
        getApiBaseUrl: () => apiBaseUrl,
        getAuthToken: vi.fn(async () => authToken),
    }
}

function createDocumentNode(overrides: any = {}) {
    return {
        type: 'document',
        nodeId: 'document-node',
        referenceId: 'document-node',
        dimensions: { width: 300, height: 200 },
        descriptor: { status: 'ready', summary: 'Document summary' },
        ...overrides,
    }
}

function createThreadNode(overrides: any = {}) {
    return {
        type: 'aiChatThread',
        nodeId: 'thread-node',
        referenceId: 'thread-node',
        dimensions: { width: 320, height: 180 },
        descriptor: { status: 'ready', summary: 'Thread summary' },
        ...overrides,
    }
}

function createImageNode(overrides: any = {}) {
    return {
        type: 'image',
        nodeId: 'image-node',
        referenceId: 'image-node',
        src: '/api/images/raw.png',
        posterSrc: '/api/images/poster.png',
        dimensions: { width: 420, height: 560 },
        aspectRatio: 0.75,
        ...overrides,
    }
}

function createVideoNode(overrides: any = {}) {
    return {
        type: 'video',
        nodeId: 'video-node',
        referenceId: 'video-node',
        src: 'https://cdn.example.com/api/videos/video.mp4',
        posterSrc: 'https://cdn.example.com/api/images/poster.png',
        dimensions: { width: 480, height: 270 },
        aspectRatio: 1.777,
        ...overrides,
    }
}

function createTextDoc(text: string): string {
    return JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
}

function waitForMicrotasks(): Promise<void> {
    return Promise.resolve()
}

function waitForNextTick(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0)
    })
}

beforeEach(() => {
    document.body.innerHTML = ''
})

describe('context preview labels', () => {
    it('uses title when available and falls back to node type label otherwise', () => {
        const env = createMockEnvironment({
            documents: [{ documentId: 'document-node', title: 'Project Notes' }],
            threads: [{ threadId: 'thread-node', title: 'Design Chat' }],
        })

        expect(getContextPreviewAccessibleLabel(createDocumentNode(), env)).toBe('Project Notes')
        expect(getContextPreviewAccessibleLabel(createImageNode(), env)).toBe('Image')
        expect(getContextPreviewAccessibleLabel(createVideoNode(), env)).toBe('Video')
    })

    it('falls back to the node type label when title and metadata are missing', () => {
        const env = createMockEnvironment()

        expect(
            getContextPreviewAccessibleLabel(
                {
                    type: 'unknown',
                    nodeId: 'unknown-node',
                    referenceId: 'unknown-node',
                    dimensions: { width: 100, height: 100 },
                } as unknown as CanvasNode,
                env,
            ),
        ).toBe('unknown')
    })
})

describe('createContextPreviewTile', () => {
    it('does not mutate API media token flow when auth lookup fails', async () => {
        const env = createMockEnvironment({
            apiBaseUrl: 'https://api.example.com/',
            authToken: 'auth-token',
        })
        const tokenError = new Error('auth failed')
        env.getAuthToken = vi.fn(async () => {
            throw tokenError
        })
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const { dom } = createContextPreviewTile({
            node: createImageNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForNextTick()

        const imageEl = document.body.querySelector('.help-tooltip-content .workspace-ai-chat-panel-context-preview-image') as HTMLImageElement
        expect(imageEl.src).toContain('/api/images/raw.png')
        expect(imageEl.src).not.toContain('token=auth-token')
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to resolve context preview media URL:',
            expect.any(Error),
        )

        warnSpy.mockRestore()
    })

    it('leaves media URLs unchanged for data URIs', async () => {
        const env = createMockEnvironment()
        const { dom } = createContextPreviewTile({
            node: createImageNode({
                src: 'data:image/png;base64,QUJD',
                posterSrc: 'data:image/png;base64,U0F2',
            }),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const imageEl = document.body.querySelector('.help-tooltip-content .workspace-ai-chat-panel-context-preview-image') as HTMLImageElement
        expect(imageEl.src).toBe('data:image/png;base64,QUJD')
        expect(env.getAuthToken).not.toHaveBeenCalled()
    })

    it('applies preferred inline popover placement to generated class names', () => {
        const env = createMockEnvironment()
        const { dom } = createContextPreviewTile({
            node: createImageNode(),
            environment: env,
            inlinePopover: true,
            preferredPlacement: 'bottom',
        })
        document.body.appendChild(dom)

        const popover = dom.querySelector('.context-preview-inline-popover') as HTMLElement
        expect(popover.className).toContain('context-preview-inline-popover-bottom')
    })

    it('renders document title and summary into trigger and popover content', async () => {
        const env = createMockEnvironment({
            documents: [
                {
                    documentId: 'document-node',
                    title: 'Project Notes',
                    content: createTextDoc('Persisted body content'),
                },
            ],
        })

        const { dom } = createContextPreviewTile({
            node: createDocumentNode({ descriptor: { status: 'ready', summary: 'Descriptor override' } }),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        expect(trigger.getAttribute('aria-label')).toBe('Project Notes')

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent).not.toBeNull()
        expect(tooltipContent.querySelector('.workspace-ai-chat-panel-context-preview-document-title')?.textContent).toBe('Project Notes')
        expect(tooltipContent.querySelector('.workspace-ai-chat-panel-context-preview-document-text')?.textContent).toBe('Descriptor override')
    })

    it('hydrates media URLs with auth token only for API-backed paths', async () => {
        const authToken = 'auth-token'
        const env = createMockEnvironment({
            apiBaseUrl: 'https://api.example.com/',
            authToken,
        })
        env.getAuthToken = vi.fn(async () => {
            await waitForNextTick()
            return authToken
        })

        const { dom } = createContextPreviewTile({
            node: createImageNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const imageEl = document.body.querySelector('.help-tooltip-content .workspace-ai-chat-panel-context-preview-image') as HTMLImageElement
        await waitForNextTick()
        expect(imageEl.src).toContain('/api/images/raw.png')
        expect(imageEl.src).toContain('token=auth-token')

        const { dom: localDom } = createContextPreviewTile({
            node: createImageNode({ src: '/media/local/file.png' }),
            environment: env,
        })
        document.body.appendChild(localDom)

        const localImage = localDom.querySelector('.workspace-ai-chat-panel-context-preview-image') as HTMLImageElement
        await waitForMicrotasks()
        expect(localImage.src).toContain('/media/local/file.png')
        expect(localImage.src).not.toContain('token=auth-token')

        const { dom: fileVideoDom } = createContextPreviewTile({
            node: createVideoNode({
                src: 'https://cdn.example.com/api/files/videos/video.mp4',
                posterSrc: 'https://cdn.example.com/api/files/images/poster.png',
            }),
            environment: env,
        })
        document.body.appendChild(fileVideoDom)

        const videoEl = fileVideoDom.querySelector('video') as HTMLVideoElement
        await waitForNextTick()

        expect(videoEl.src).toContain('https://cdn.example.com/api/files/videos/video.mp4?token=auth-token')
        expect(videoEl.poster).toContain('https://cdn.example.com/api/files/images/poster.png?token=auth-token')

        expect(env.getAuthToken).toHaveBeenCalledTimes(6)
    })

    it('does not append auth token for absolute URLs outside /api/files', async () => {
        const env = createMockEnvironment({
            authToken: 'auth-token',
        })

        const { dom } = createContextPreviewTile({
            node: createVideoNode({
                src: 'https://cdn.example.com/external/video.mp4',
                posterSrc: 'https://cdn.example.com/external/poster.png',
            }),
            environment: env,
        })
        document.body.appendChild(dom)

        const videoEl = dom.querySelector('video') as HTMLVideoElement
        await waitForNextTick()

        expect(videoEl.src).toContain('https://cdn.example.com/external/video.mp4')
        expect(videoEl.poster).toContain('https://cdn.example.com/external/poster.png')
        expect(videoEl.src).not.toContain('token=')
        expect(videoEl.poster).not.toContain('token=')
        expect(env.getAuthToken).toHaveBeenCalledTimes(0)
    })

    it('preserves existing query params when appending auth token to absolute API URLs', async () => {
        const env = createMockEnvironment({
            authToken: 'auth-token',
        })

        const { dom } = createContextPreviewTile({
            node: createImageNode({ src: 'https://cdn.example.com/api/files/images/raw.png?existing=1' }),
            environment: env,
        })
        document.body.appendChild(dom)

        const imageEl = document.body.querySelector('.help-tooltip-content .workspace-ai-chat-panel-context-preview-image') as HTMLImageElement
        await waitForNextTick()

        expect(imageEl.src).toContain('https://cdn.example.com/api/files/images/raw.png?existing=1&token=auth-token')
    })

    it('falls back to base64 wrappers for relative paths that are not API or remote URLs', async () => {
        const env = createMockEnvironment()
        const { dom } = createContextPreviewTile({
            node: createImageNode({ src: 'local-file.png' }),
            environment: env,
        })
        document.body.appendChild(dom)

        const imageEl = document.body.querySelector('.help-tooltip-content .workspace-ai-chat-panel-context-preview-image') as HTMLImageElement
        await waitForMicrotasks()

        expect(imageEl.src).toContain('data:image/png;base64,local-file.png')
        expect(imageEl.src).not.toContain('token=')
    })

    it('keeps controls only on large video previews while mini thumbnails stay compact', async () => {
        const env = createMockEnvironment()
        const { dom } = createContextPreviewTile({
            node: createVideoNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const miniVideo = dom.querySelector('video') as HTMLVideoElement
        expect(miniVideo).not.toBeNull()
        expect(miniVideo.hasAttribute('controls')).toBe(false)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        const largeVideo = tooltipContent.querySelector('.workspace-ai-chat-panel-context-preview-video-large video') as HTMLVideoElement
        expect(largeVideo).not.toBeNull()
        expect(largeVideo.hasAttribute('controls')).toBe(true)
    })

    it('reruns preview rendering when getNode returns changed content', async () => {
        let currentNode = createThreadNode({
            descriptor: { status: 'ready', summary: 'First summary' },
            content: createTextDoc('First body content'),
        })

        const env = createMockEnvironment({
            threads: [
                {
                    threadId: 'thread-node',
                    title: 'Thread',
                    content: createTextDoc('Latest content'),
                },
            ],
        })

        const { dom } = createContextPreviewTile({
            node: currentNode,
            getNode: () => currentNode,
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        let tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.textContent).toContain('First summary')

        currentNode = createThreadNode({
            descriptor: { status: 'ready', summary: 'Second summary' },
        })

        trigger.dispatchEvent(new PointerEvent('focusin', { bubbles: true }))
        await waitForMicrotasks()

        tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.textContent).toContain('Second summary')
    })

    it('supports inline popovers that stay inside the tile and update on getNode', async () => {
        let currentNode = createDocumentNode({
            title: 'Thread title',
            descriptor: { status: 'ready', summary: 'First summary' },
            content: createTextDoc('First body content'),
        })
        const env = createMockEnvironment({
            documents: [{ documentId: 'document-node', title: 'Thread title' }],
        })
        const { dom, destroy } = createContextPreviewTile({
            node: currentNode,
            getNode: () => currentNode,
            environment: env,
            inlinePopover: true,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.context-preview-inline-trigger') as HTMLElement
        const popover = dom.querySelector('.context-preview-inline-popover') as HTMLElement
        expect(popover).not.toBeNull()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        expect(popover.classList.contains('is-open')).toBe(false)

        dom.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        expect(dom.classList.contains('is-open')).toBe(true)
        expect(popover.classList.contains('is-open')).toBe(true)
        expect(popover.querySelector('.workspace-ai-chat-panel-context-preview-document-title')?.textContent).toBe('Thread title')
        expect(popover.querySelector('.workspace-ai-chat-panel-context-preview-document-text')?.textContent).toContain('First summary')

        currentNode = createDocumentNode({
            title: 'Thread title',
            descriptor: { status: 'ready', summary: 'Second summary' },
            content: createTextDoc('Second body content'),
        })

        trigger.dispatchEvent(new PointerEvent('focusin', { bubbles: true }))
        await waitForMicrotasks()

        expect(popover.querySelector('.workspace-ai-chat-panel-context-preview-document-text')?.textContent).toContain('Second summary')

        dom.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
        await waitForMicrotasks()
        expect(popover.classList.contains('is-open')).toBe(false)
        destroy()
        expect(popover.isConnected).toBe(false)
    })

    it('adds popover orientation classes for image previews with metadata', async () => {
        const env = createMockEnvironment()
        const { dom, destroy } = createContextPreviewTile({
            node: createImageNode({
                descriptor: { status: 'ready', summary: 'Has meta' },
                aspectRatio: 0.4,
                dimensions: { width: 200, height: 500 },
            }),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const popoverBody = document.body.querySelector('.workspace-ai-chat-panel-context-preview-popover-body') as HTMLElement
        expect(popoverBody.classList.contains('workspace-ai-chat-panel-context-preview-popover-body-portrait')).toBe(true)
        destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

        const { dom: landscapeDom, destroy: destroyLandscape } = createContextPreviewTile({
            node: createImageNode({
                descriptor: { status: 'ready', summary: 'Has meta' },
                aspectRatio: 1.6,
                dimensions: { width: 500, height: 300 },
            }),
            environment: env,
        })
        document.body.appendChild(landscapeDom)

        const landscapeTrigger = landscapeDom.querySelector('.help-tooltip-trigger') as HTMLElement
        landscapeTrigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const landscapePopoverBody = document.body.querySelector('.workspace-ai-chat-panel-context-preview-popover-body') as HTMLElement
        expect(landscapePopoverBody.classList.contains('workspace-ai-chat-panel-context-preview-popover-body-landscape')).toBe(true)
        destroyLandscape()
    })

    it('destroys tooltip DOM cleanly', async () => {
        const env = createMockEnvironment()
        const { dom, destroy } = createContextPreviewTile({
            node: createDocumentNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()
        expect(document.body.querySelector('.help-tooltip')).not.toBeNull()

        destroy()

        expect(dom.querySelector('.help-tooltip')).toBeNull()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        expect(document.body.querySelector('.help-tooltip')).toBeNull()
    })

    it('renders extracted document content when the descriptor is not ready', async () => {
        const env = createMockEnvironment({
            documents: [
                {
                    documentId: 'document-node',
                    title: 'Draft Note',
                    content: createTextDoc('Draft text that should backfill the panel'),
                },
            ],
        })
        const { dom } = createContextPreviewTile({
            node: createDocumentNode({
                descriptor: { status: 'error', summary: 'Descriptor should be ignored while not ready' },
            } as unknown as CanvasNode),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent).not.toBeNull()
        expect(tooltipContent.querySelector('.workspace-ai-chat-panel-context-preview-document-title')?.textContent).toBe('Draft Note')
        expect(tooltipContent.querySelector('.workspace-ai-chat-panel-context-preview-document-text')?.textContent)
            .toBe('Draft text that should backfill the panel')
    })
})
