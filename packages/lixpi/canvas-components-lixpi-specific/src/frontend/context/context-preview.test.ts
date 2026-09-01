// @vitest-environment happy-dom
import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
} from 'vitest'
import type {
    Asset,
    CanvasNode,
} from '@lixpi/constants'
import {
    createContextPreviewTile as mountContextPreviewTile,
    getContextPreviewAccessibleLabel,
    type ContextPreviewEnvironment,
} from './context-preview.ts'

const owners: ReturnType<typeof mountContextPreviewTile>[] = []
function createContextPreviewTile(options: Parameters<typeof mountContextPreviewTile>[0]) {
    const tile = mountContextPreviewTile(options)
    owners.push(tile)
    return tile
}
afterEach(() => {
    for (const tile of owners.splice(0)) tile.destroy()
    vi.restoreAllMocks()
})

function makeAsset(overrides: Partial<Asset> & { assetId: string }): Asset {
    return {
        organizationId: 'org-1',
        title: '',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        documents: {},
        states: {},
        referenceCount: 0,
        revision: 1,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as Asset
}

function createMockEnvironment(overrides: {
    documents?: { documentId: string; title?: string; content?: string | object }[]
    threads?: { threadId: string; title?: string; content?: string | object }[]
    assets?: Asset[]
    authToken?: string
    apiBaseUrl?: string
} = {}): ContextPreviewEnvironment & {
    getDocuments: ReturnType<typeof vi.fn>
    getThreads: ReturnType<typeof vi.fn>
    getAsset: ReturnType<typeof vi.fn>
    getAuthToken: ReturnType<typeof vi.fn>
} {
    const {
        documents = [],
        threads = [],
        assets = [],
        authToken = 'token-123',
        apiBaseUrl = 'https://api.example.com',
    } = overrides
    const getDocuments = vi.fn(() => documents)
    const getThreads = vi.fn(() => threads)
    const getAsset = vi.fn((assetId: string) => assets.find((asset) => asset.assetId === assetId))
    const getAuthToken = vi.fn(async () => authToken)

    const environment = {
        document,
        tooltipHideDelayMs: 0,
        getDocuments,
        getThreads,
        getAsset,
        getAuthToken,
        getArtifactIcon: () => '<svg></svg>',
        extractDocumentText: (content: string | object) => {
            if (!content) return ''
            const source = typeof content === 'string' ? JSON.parse(content) : content
            return source.content?.map((block: { content?: Array<{ text?: string }> }) => block.content?.map(node => node.text ?? '').join('') ?? '').join('\n') ?? ''
        },
        initialRenditionUrl: (assetId: string, rendition: string) => `/api/assets/${assetId}/renditions/${rendition}`,
        resolveRenditionUrl: async (assetId: string, rendition: string): Promise<string> => {
            const token = await environment.getAuthToken()
            return `${apiBaseUrl}/api/assets/${assetId}/renditions/${rendition}?token=${encodeURIComponent(token)}`
        },
        onError: (error: unknown) => console.warn('Failed to resolve context preview media URL:', error),
    }
    return environment
}

function createDocumentNode(overrides: any = {}) {
    return {
        type: 'document',
        nodeId: 'document-node',
        assetId: 'document-node',
        position: { x: 0, y: 0 },
        dimensions: { width: 300, height: 200 },
        ...overrides,
    }
}

function createThreadNode(overrides: any = {}) {
    return {
        type: 'aiChatThread',
        nodeId: 'thread-node',
        assetId: 'thread-node',
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 180 },
        ...overrides,
    }
}

function createImageNode(overrides: any = {}) {
    return {
        type: 'image',
        nodeId: 'image-node',
        assetId: 'image-node',
        position: { x: 0, y: 0 },
        dimensions: { width: 420, height: 560 },
        ...overrides,
    }
}

function createVideoNode(overrides: any = {}) {
    return {
        type: 'video',
        nodeId: 'video-node',
        assetId: 'video-node',
        position: { x: 0, y: 0 },
        dimensions: { width: 480, height: 270 },
        ...overrides,
    }
}

function createAudioNode(overrides: any = {}) {
    return {
        type: 'audio',
        nodeId: 'audio-node',
        assetId: 'audio-node',
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 80 },
        ...overrides,
    }
}

function createCapabilityArtifactNode(overrides: any = {}) {
    return {
        type: 'capabilityArtifact',
        nodeId: 'timeline-node',
        artifactTypeId: 'action-timeline',
        assetId: 'timeline-asset',
        position: { x: 0, y: 0 },
        dimensions: { width: 520, height: 360 },
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

// =============================================================================
// LABELS — title resolution prefers Asset.title, then falls back to the
// document store's title, then to the node-type label.
// =============================================================================

describe('context preview labels', () => {
    it('uses the Asset title when available and falls back to the node type label for media', () => {
        const env = createMockEnvironment({
            assets: [makeAsset({ assetId: 'document-node', title: 'Project Notes' })],
        })

        expect(getContextPreviewAccessibleLabel(createDocumentNode(), env)).toBe('Project Notes')
        expect(getContextPreviewAccessibleLabel(createImageNode(), env)).toBe('Image')
        expect(getContextPreviewAccessibleLabel(createVideoNode(), env)).toBe('Video')
        expect(getContextPreviewAccessibleLabel(createAudioNode(), env)).toBe('Audio')
    })

    it('falls back to the node type label when title and metadata are missing', () => {
        const env = createMockEnvironment()

        expect(
            getContextPreviewAccessibleLabel(
                {
                    type: 'unknown',
                    nodeId: 'unknown-node',
                    dimensions: { width: 100, height: 100 },
                } as unknown as CanvasNode,
                env,
            ),
        ).toBe('unknown')
    })

    it('falls back to the document store title when the Asset has no title', () => {
        const env = createMockEnvironment({
            assets: [makeAsset({ assetId: 'document-node', title: '' })],
            documents: [{ documentId: 'document-node', title: '  Project Notes  ' }],
        })

        expect(getContextPreviewAccessibleLabel(createDocumentNode(), env)).toBe('Project Notes')
    })

    it('renders a Capability Artifact with its registered existing SVG icon and canonical title', async () => {
        const env = createMockEnvironment({
            assets: [makeAsset({ assetId: 'timeline-asset', title: 'Train Timeline' })],
        })
        const { dom } = createContextPreviewTile({
            node: createCapabilityArtifactNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        expect(trigger.getAttribute('aria-label')).toBe('Train Timeline')
        expect(trigger.querySelector('.context-preview-artifact-icon svg')).not.toBeNull()
        expect(trigger.querySelector('.context-preview-artifact-title')).toBeNull()

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.querySelector('.context-preview-artifact-title')?.textContent)
            .toBe('Train Timeline')
    })

    it('falls back to extracted document content when the Asset descriptor summary is blank', async () => {
        const env = createMockEnvironment({
            assets: [makeAsset({
                assetId: 'document-node',
                title: 'Draft Note',
                descriptor: { status: 'ready', summary: '   ' } as Asset['descriptor'],
            })],
            documents: [
                {
                    documentId: 'document-node',
                    title: 'Draft Note',
                    content: createTextDoc('Draft content should win over blank summary'),
                },
            ],
        })
        const { dom } = createContextPreviewTile({
            node: createDocumentNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.querySelector('.context-preview-document-text')?.textContent)
            .toBe('Draft content should win over blank summary')
    })
})

describe('context preview resource ownership', () => {
    it('aborts pending hydration and ignores the result even if detached DOM is reattached', async () => {
        const environment = createMockEnvironment()
        const pending = Promise.withResolvers<string>()
        const signals: AbortSignal[] = []
        environment.resolveRenditionUrl = (_asset, _rendition, signal) => {
            signals.push(signal)
            return pending.promise
        }
        const tile = createContextPreviewTile({ node: createImageNode(), environment })
        document.body.appendChild(tile.dom)
        const image = tile.dom.querySelector('img')!
        const source = image.src
        tile.destroy()
        document.body.appendChild(image)
        expect(signals.every(signal => signal.aborted)).toBe(true)
        pending.resolve('https://media.test/late.png')
        await waitForNextTick()
        expect(image.src).toBe(source)
    })

    it('pauses and releases native videos without touching another preview instance', () => {
        const first = createContextPreviewTile({ node: createVideoNode(), environment: createMockEnvironment() })
        const second = createContextPreviewTile({ node: createVideoNode(), environment: createMockEnvironment() })
        document.body.append(first.dom, second.dom)
        const firstVideo = first.dom.querySelector('video')!
        const secondVideo = second.dom.querySelector('video')!
        const firstPause = vi.spyOn(firstVideo, 'pause')
        const secondPause = vi.spyOn(secondVideo, 'pause')
        first.destroy()
        expect(firstPause).toHaveBeenCalledOnce()
        expect(firstVideo.hasAttribute('src')).toBe(false)
        expect(firstVideo.hasAttribute('poster')).toBe(false)
        expect(secondPause).not.toHaveBeenCalled()
        expect(second.dom.isConnected).toBe(true)
    })

    it('disposes superseded popover media while keeping the trigger alive', async () => {
        const environment = createMockEnvironment()
        const signals: AbortSignal[] = []
        environment.resolveRenditionUrl = async (_asset, _rendition, signal) => {
            signals.push(signal)
            return 'https://media.test/image.png'
        }
        const tile = createContextPreviewTile({ node: createImageNode(), environment, inlinePopover: true })
        document.body.appendChild(tile.dom)
        const originalContentSignal = signals[0]!
        const triggerSignal = signals[1]!
        tile.dom.querySelector<HTMLElement>('.context-preview-inline-trigger')!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()
        expect(originalContentSignal.aborted).toBe(true)
        expect(triggerSignal.aborted).toBe(false)
        expect(signals.at(-1)!.aborted).toBe(false)
    })
})

// =============================================================================
// createContextPreviewTile — media URL resolution
//
// Image/video previews are always built from the Asset rendition path
// (/api/assets/<assetId>/renditions/<name>), never from a URL on the node.
// =============================================================================

describe('createContextPreviewTile — media resolution', () => {
    it('renders the initial preview src from the asset rendition path before hydration', () => {
        const env = createMockEnvironment()
        const { dom } = createContextPreviewTile({
            node: createImageNode({ assetId: 'image-1' }),
            environment: env,
        })

        const imageEl = dom.querySelector('.context-preview-image') as HTMLImageElement
        expect(imageEl.getAttribute('src')).toBe('/api/assets/image-1/renditions/preview')
    })

    it('hydrates the trigger preview with an authenticated, API-base-qualified URL', async () => {
        const env = createMockEnvironment({
            apiBaseUrl: 'https://api.example.com',
            authToken: 'auth-token',
        })

        const { dom } = createContextPreviewTile({
            node: createImageNode({ assetId: 'image-1' }),
            environment: env,
        })
        document.body.appendChild(dom)

        const imageEl = dom.querySelector('.context-preview-image') as HTMLImageElement
        await waitForNextTick()

        expect(imageEl.src).toBe('https://api.example.com/api/assets/image-1/renditions/preview?token=auth-token')
    })

    it('does not mutate the trigger media src when auth lookup fails', async () => {
        const env = createMockEnvironment({
            apiBaseUrl: 'https://api.example.com',
        })
        const tokenError = new Error('auth failed')
        env.getAuthToken = vi.fn(async () => {
            throw tokenError
        })
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const { dom } = createContextPreviewTile({
            node: createImageNode({ assetId: 'image-1' }),
            environment: env,
        })
        document.body.appendChild(dom)

        const imageEl = dom.querySelector('.context-preview-image') as HTMLImageElement
        const srcBeforeHydration = imageEl.getAttribute('src')
        await waitForNextTick()

        expect(imageEl.getAttribute('src')).toBe(srcBeforeHydration)
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to resolve context preview media URL:',
            tokenError,
        )

        warnSpy.mockRestore()
    })

    it('does not apply the authenticated media URL after the tile is detached before token resolution', async () => {
        const env = createMockEnvironment()
        let resolveAuth: ((value: string | undefined) => void) | null = null
        env.getAuthToken = vi.fn(() =>
            new Promise((resolve) => {
                resolveAuth = resolve
            })
        )

        const { dom } = createContextPreviewTile({
            node: createImageNode({ assetId: 'image-1' }),
            environment: env,
        })
        document.body.appendChild(dom)

        const imageEl = dom.querySelector('.context-preview-image') as HTMLImageElement
        const srcBeforeDetach = imageEl.getAttribute('src')

        dom.remove()
        resolveAuth?.('auth-token')
        await waitForNextTick()

        expect(imageEl.getAttribute('src')).toBe(srcBeforeDetach)
        expect(imageEl.src).not.toContain('token=auth-token')
    })

    it('hydrates video src and poster with authenticated asset rendition URLs', async () => {
        const env = createMockEnvironment({
            apiBaseUrl: 'https://api.example.com',
            authToken: 'auth-token',
        })

        const { dom } = createContextPreviewTile({
            node: createVideoNode({ assetId: 'video-1' }),
            environment: env,
        })
        document.body.appendChild(dom)

        const videoEl = dom.querySelector('video') as HTMLVideoElement
        await waitForNextTick()

        expect(videoEl.src).toBe('https://api.example.com/api/assets/video-1/renditions/original?token=auth-token')
        expect(videoEl.poster).toBe('https://api.example.com/api/assets/video-1/renditions/poster?token=auth-token')
        // The popover content (large video) is built eagerly alongside the trigger (mini video),
        // so both get src + poster hydration: 2 videos x 2 attrs = 4 token lookups.
        expect(env.getAuthToken).toHaveBeenCalledTimes(4)
    })
})

// =============================================================================
// createContextPreviewTile — document/title rendering
// =============================================================================

describe('createContextPreviewTile — document content', () => {
    it('renders the Asset title and descriptor summary into trigger and popover content', async () => {
        const env = createMockEnvironment({
            assets: [makeAsset({
                assetId: 'document-node',
                title: 'Project Notes',
                descriptor: { status: 'ready', summary: 'Descriptor override' } as Asset['descriptor'],
            })],
            documents: [
                {
                    documentId: 'document-node',
                    title: 'Project Notes',
                    content: createTextDoc('Persisted body content'),
                },
            ],
        })

        const { dom } = createContextPreviewTile({
            node: createDocumentNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        expect(trigger.getAttribute('aria-label')).toBe('Project Notes')

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent).not.toBeNull()
        expect(tooltipContent.querySelector('.context-preview-document-title')?.textContent).toBe('Project Notes')
        expect(tooltipContent.querySelector('.context-preview-document-text')?.textContent).toBe('Descriptor override')
    })

    it('renders extracted document content when the Asset has no ready descriptor', async () => {
        const env = createMockEnvironment({
            assets: [makeAsset({
                assetId: 'document-node',
                title: 'Draft Note',
                descriptor: { status: 'error', summary: 'Descriptor should be ignored while not ready' } as Asset['descriptor'],
            })],
            documents: [
                {
                    documentId: 'document-node',
                    title: 'Draft Note',
                    content: createTextDoc('Draft text that should backfill the panel'),
                },
            ],
        })
        const { dom } = createContextPreviewTile({
            node: createDocumentNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent).not.toBeNull()
        expect(tooltipContent.querySelector('.context-preview-document-title')?.textContent).toBe('Draft Note')
        expect(tooltipContent.querySelector('.context-preview-document-text')?.textContent)
            .toBe('Draft text that should backfill the panel')
    })
})

// =============================================================================
// createContextPreviewTile — popover orientation / layout classes
// =============================================================================

describe('createContextPreviewTile — popover layout', () => {
    it('uses a caller-provided inline label as the trigger for the same shared preview card', async () => {
        const env = createMockEnvironment()
        const triggerContent = document.createElement('span')
        triggerContent.className = 'test-inline-reference-label'
        triggerContent.textContent = 'Character Sheet'
        const { dom, destroy } = createContextPreviewTile({
            node: createImageNode({ assetId: 'image-1' }),
            environment: env,
            triggerContent,
            titleOverride: 'Character Sheet',
        })
        document.body.appendChild(dom)

        expect(dom.classList.contains('context-preview-tooltip-inline-label')).toBe(true)
        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        expect(trigger.classList.contains('context-preview-trigger-inline-label')).toBe(true)
        expect(trigger.querySelector('.test-inline-reference-label')).toBe(triggerContent)
        expect(trigger.querySelector('.context-preview-image-mini')).toBeNull()
        expect(trigger.getAttribute('aria-label')).toBe('Character Sheet')

        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.querySelector('.context-preview-image-large')).not.toBeNull()
        expect(tooltipContent.querySelector('.context-preview-popover-title')?.textContent)
            .toBe('Character Sheet')

        destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('uses the base popover class when image/video metadata is missing', async () => {
        const env = createMockEnvironment()
        const { dom, destroy } = createContextPreviewTile({
            node: createImageNode(),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.className).toContain('context-preview-popover')
        expect(tooltipContent.className).not.toContain('context-preview-popover-portrait')
        expect(tooltipContent.className).not.toContain('context-preview-popover-landscape')

        const popoverBody = tooltipContent.querySelector('.context-preview-popover-body') as HTMLElement
        expect(popoverBody.className).toContain('context-preview-popover-body-landscape')

        destroy()
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

    it('adds a portrait orientation class when the node is taller than it is wide, and landscape otherwise', async () => {
        const env = createMockEnvironment({
            assets: [makeAsset({ assetId: 'image-node', descriptor: { status: 'ready', summary: 'Has meta' } as Asset['descriptor'] })],
        })
        const { dom, destroy } = createContextPreviewTile({
            node: createImageNode({ dimensions: { width: 200, height: 500 } }),
            environment: env,
        })
        document.body.appendChild(dom)

        const trigger = dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const popoverBody = document.body.querySelector('.context-preview-popover-body') as HTMLElement
        expect(popoverBody.classList.contains('context-preview-popover-body-portrait')).toBe(true)
        destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()

        const { dom: landscapeDom, destroy: destroyLandscape } = createContextPreviewTile({
            node: createImageNode({ dimensions: { width: 500, height: 300 } }),
            environment: env,
        })
        document.body.appendChild(landscapeDom)

        const landscapeTrigger = landscapeDom.querySelector('.help-tooltip-trigger') as HTMLElement
        landscapeTrigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        const landscapePopoverBody = document.body.querySelector('.context-preview-popover-body') as HTMLElement
        expect(landscapePopoverBody.classList.contains('context-preview-popover-body-landscape')).toBe(true)
        destroyLandscape()
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
        const largeVideo = tooltipContent.querySelector('.context-preview-video-large video') as HTMLVideoElement
        expect(largeVideo).not.toBeNull()
        expect(largeVideo.hasAttribute('controls')).toBe(true)
    })
})

// =============================================================================
// createContextPreviewTile — live content updates via getNode
// =============================================================================

describe('createContextPreviewTile — live updates', () => {
    it('portals a canvas preview to the pane and preserves the viewport scale', async () => {
        const pane = document.createElement('div')
        pane.className = 'workspace-pane'
        const viewport = document.createElement('div')
        viewport.className = 'workspace-viewport'
        viewport.style.transform = 'matrix(1.5, 0, 0, 1.5, 0, 0)'
        const node = document.createElement('div')
        node.className = 'workspace-document-node'
        pane.appendChild(viewport)
        viewport.appendChild(node)
        document.body.appendChild(pane)

        const { dom, destroy } = createContextPreviewTile({
            node: createImageNode(),
            environment: createMockEnvironment(),
            inlinePopover: true,
        })
        node.appendChild(dom)

        const popover = dom.querySelector('.context-preview-inline-popover') as HTMLElement
        dom.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitForMicrotasks()

        expect(popover.parentElement).toBe(pane)
        expect(popover.classList.contains('context-preview-inline-popover-portaled')).toBe(true)
        expect(popover.style.transform).toContain('scale(1.5)')

        destroy()
        expect(popover.isConnected).toBe(false)
    })

    it('reruns preview rendering when getNode returns changed content', async () => {
        // Thread (and any other non-image/video/document) nodes fall through to the
        // generic preview branch, which renders only the title — never descriptor
        // text — so this exercises the title re-render on getNode change.
        let currentNode = createThreadNode()

        const env = createMockEnvironment({
            assets: [makeAsset({ assetId: 'thread-node', title: 'First title' })],
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
        expect(tooltipContent.textContent).toContain('First title')

        env.getAsset = vi.fn(() => makeAsset({ assetId: 'thread-node', title: 'Second title' }))
        currentNode = createThreadNode()

        trigger.dispatchEvent(new PointerEvent('focusin', { bubbles: true }))
        await waitForMicrotasks()

        tooltipContent = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(tooltipContent.textContent).toContain('Second title')
    })

    it('supports inline popovers that stay inside the tile and update on getNode', async () => {
        let currentNode = createDocumentNode()
        const env = createMockEnvironment({
            assets: [makeAsset({
                assetId: 'document-node',
                title: 'Thread title',
                descriptor: { status: 'ready', summary: 'First summary' } as Asset['descriptor'],
            })],
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
        expect(popover.querySelector('.context-preview-document-title')?.textContent).toBe('Thread title')
        expect(popover.querySelector('.context-preview-document-text')?.textContent).toContain('First summary')

        env.getAsset = vi.fn(() =>
            makeAsset({
                assetId: 'document-node',
                title: 'Thread title',
                descriptor: { status: 'ready', summary: 'Second summary' } as Asset['descriptor'],
            })
        )
        currentNode = createDocumentNode()

        trigger.dispatchEvent(new PointerEvent('focusin', { bubbles: true }))
        await waitForMicrotasks()

        expect(popover.querySelector('.context-preview-document-text')?.textContent).toContain('Second summary')

        dom.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 100))
        expect(popover.classList.contains('is-open')).toBe(false)
        destroy()
        expect(popover.isConnected).toBe(false)
    })
})

// =============================================================================
// createContextPreviewTile — lifecycle
// =============================================================================

describe('createContextPreviewTile — lifecycle', () => {
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
})
