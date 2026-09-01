// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    LoadingStatus,
    type Asset,
    type CanvasState,
} from '@lixpi/constants'
import { WorkspaceCanvasSession } from '../../shared/persistence/workspace-canvas-session.ts'
import {
    WorkspaceCanvasSurface,
    type WorkspaceCanvasRenderer,
    type WorkspaceCanvasRendererOptions,
    type WorkspaceCanvasSurfacePorts,
    type WorkspaceCanvasSurfaceSnapshot,
} from './workspace-canvas-surface.ts'
import type { WorkspaceCanvasChromeSettings } from './workspace-canvas-chrome.ts'

const settings: WorkspaceCanvasChromeSettings & { insertionWidth: number } = {
    panel: {
        defaultDimensions: { width: 500 },
        dimensions: { maxPaneMargin: 30 },
        layout: { contentInset: 12 },
        typography: { contentFontSize: 14, tagPillFontSize: 12, tagPillFontWeight: 500 },
        styles: { backdropFill: '#fff', backdropFillOpaque: '#fff', toggleColor: '#111', toggleHoverColor: '#222' },
    },
    modelMenuHoverBackground: '#abc',
    palette: { steelBlue: '#5d656d', nightBlue: '#42494f', offWhite: '#f5f3f3' },
    insertionWidth: 320,
}

function canvas(): CanvasState {
    return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function deferred<Value>() {
    let resolve!: (value: Value) => void
    const promise = new Promise<Value>(accept => {
        resolve = accept
    })
    return { promise, resolve }
}

const owners: WorkspaceCanvasSurface[] = []
function setup(options: { snapshot?: Partial<WorkspaceCanvasSurfaceSnapshot>; configure?: (ports: WorkspaceCanvasSurfacePorts, renderer: WorkspaceCanvasRenderer) => void } = {}) {
    vi.useFakeTimers()
    let snapshot: WorkspaceCanvasSurfaceSnapshot = {
        workspaceId: 'a',
        loadedWorkspaceId: 'a',
        organizationId: 'org',
        loadingStatus: LoadingStatus.success,
        canvasState: canvas(),
        assets: [],
        ...options.snapshot,
    }
    let currentState = snapshot.canvasState
    let rendererOptions!: WorkspaceCanvasRendererOptions
    const listeners = new Set<() => void>()
    let savedListener!: () => void
    let pageHide!: () => void
    const unsubscribe = vi.fn()
    const removePageHide = vi.fn()
    const stopSynchronization = vi.fn()
    const sessions = new Map<string, WorkspaceCanvasSession>()
    const publish = vi.fn()
    const save = vi.fn(async (request: { workspaceId: string }) => ({ status: 'saved' as const, workspaceId: request.workspaceId, version: { updatedAt: 20, canvasStateUpdatedAt: 20 } }))
    const renderer: WorkspaceCanvasRenderer = {
        getCanvasState: vi.fn(() => currentState),
        getViewport: vi.fn(() => currentState?.viewport ?? { x: 0, y: 0, zoom: 1 }),
        setViewport: vi.fn(viewport => {
            if (currentState) currentState = { ...currentState, viewport }
        }),
        insertNodeAtViewportCenter: vi.fn(node => {
            currentState = { ...(currentState ?? canvas()), nodes: [...(currentState?.nodes ?? []), { ...node, position: { x: 0, y: 0 } }] }
            rendererOptions.onCanvasStateChange(currentState)
            return currentState
        }),
        replaceUploadPlaceholder: vi.fn(() => currentState),
        commitTransientCanvasState: vi.fn(),
        commitTransientCanvasNodeInsertion: vi.fn(),
        markUploadPlaceholderFailed: vi.fn(),
        render: vi.fn(state => {
            currentState = state
        }),
        toggleMediaLibrary: vi.fn(),
        destroy: vi.fn(),
    }
    const ports: WorkspaceCanvasSurfacePorts = {
        document,
        readSnapshot: () => snapshot,
        readDocument: vi.fn(),
        subscriptions: [changed => {
            listeners.add(changed)
            savedListener = changed
            changed()
            return () => {
                listeners.delete(changed)
                unsubscribe()
            }
        }],
        session: id => {
            let session = sessions.get(id)
            if (!session) {
                session = new WorkspaceCanvasSession(id, {
                    read: () => ({ canvasState: canvas(), version: { updatedAt: 1, canvasStateUpdatedAt: 1 } }),
                    save,
                    fetch: vi.fn(async () => ({ canvasState: canvas(), version: { updatedAt: 1, canvasStateUpdatedAt: 1 } })),
                    publish,
                    reportError: vi.fn(),
                })
                sessions.set(id, session)
            }
            return session
        },
        membership: { attach: vi.fn(async request => ({ assetId: request.assetId, nodeIds: [request.nodeId] })), detach: vi.fn(async () => ({ success: true })), now: () => 10 },
        ingest: { createDocument: vi.fn(async () => ({ assetId: 'created' })), uploadFile: vi.fn(async () => null), importUrl: vi.fn(async () => null), refreshAsset: vi.fn(async () => ({})) },
        createId: () => 'id',
        now: () => 10,
        publishTransient: vi.fn(),
        synchronizeAssets: vi.fn(() => stopSynchronization),
        storage: { get: vi.fn(() => null), set: vi.fn(), remove: vi.fn() },
        setTimer: (callback, delay) => {
            const timer = setTimeout(callback, delay)
            return () => clearTimeout(timer)
        },
        onPageHide: callback => {
            pageHide = callback
            return removePageHide
        },
        createRenderer: config => {
            rendererOptions = config
            return renderer
        },
        reportError: vi.fn(),
    }
    options.configure?.(ports, renderer)
    const mount = () => {
        const owner = new WorkspaceCanvasSurface(settings, ports)
        owners.push(owner)
        return owner
    }
    const change = (patch: Partial<WorkspaceCanvasSurfaceSnapshot>) => {
        snapshot = { ...snapshot, ...patch }
        for (const listener of listeners) listener()
    }
    return {
        mount,
        change,
        ports,
        renderer,
        save,
        publish,
        sessions,
        unsubscribe,
        removePageHide,
        stopSynchronization,
        callbacks: () => rendererOptions,
        lateStoreChange: () => savedListener(),
        pageHide: () => pageHide(),
        setRendererState: (state: CanvasState) => {
            currentState = state
        },
    }
}

afterEach(() => {
    for (const owner of owners.splice(0)) {
        try {
            owner.destroy()
        } catch {}
    }
    vi.useRealTimers()
})

describe('workspace canvas surface', () => {
    it('renders only the loaded route workspace and releases its viewport lease on navigation', () => {
        const view = setup()
        view.mount()
        expect(view.sessions.get('a')?.viewCount).toBe(1)
        view.change({ workspaceId: 'b' })
        expect(view.renderer.render).toHaveBeenLastCalledWith(null, [], [], 'b')
        expect(view.sessions.get('a')?.viewCount).toBe(0)
        expect(view.stopSynchronization).toHaveBeenCalledOnce()
        view.change({ loadedWorkspaceId: 'b', canvasState: canvas() })
        expect(view.sessions.get('b')?.viewCount).toBe(1)
        expect(view.ports.synchronizeAssets).toHaveBeenLastCalledWith('b')
    })

    it('hydrates document and conversation placements through document ports', () => {
        const asset = { assetId: 'asset', title: 'Title', organizationId: 'org', revision: 4, createdAt: 1, updatedAt: 2, documents: { content: { version: 5 }, conversation: { version: 7 } }, states: { conversation: 'none' } } as Asset
        const content = { type: 'doc', content: [] }
        const view = setup({
            snapshot: { assets: [asset] },
            configure: ports => {
                ports.readDocument = vi.fn(() => content)
            },
        })
        view.mount()
        const args = vi.mocked(view.renderer.render).mock.calls.at(-1)!
        expect(args[1]).toEqual([expect.objectContaining({ documentId: 'asset', content, proseMirrorVersion: 5, revision: 4 })])
        expect(args[2]).toEqual([expect.objectContaining({ threadId: 'asset', content, proseMirrorVersion: 7, status: 'idle' })])
        expect(view.ports.readDocument).toHaveBeenCalledWith('asset', 'conversation')
    })

    it('serializes reentrant store notifications from renderer updates', () => {
        const view = setup()
        view.mount()
        let depth = 0
        let maximumDepth = 0
        let changed = false
        vi.mocked(view.renderer.render).mockImplementation(() => {
            maximumDepth = Math.max(maximumDepth, ++depth)
            if (!changed) {
                changed = true
                view.change({ canvasState: { ...canvas(), lastActiveConversationAssetId: 'conversation' } })
            }
            depth -= 1
        })
        view.change({ canvasState: canvas() })
        expect(maximumDepth).toBe(1)
        expect(view.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({ lastActiveConversationAssetId: 'conversation' }), [], [], 'a')
    })

    it('keeps two views of one session independently disposable', () => {
        const first = setup()
        const one = first.mount()
        const second = setup({
            configure: ports => {
                ports.session = first.ports.session
            },
        })
        second.mount()
        expect(first.sessions.get('a')?.viewCount).toBe(2)
        one.destroy()
        expect(first.sessions.get('a')?.viewCount).toBe(1)
        expect(second.renderer.destroy).not.toHaveBeenCalled()
        second.change({ canvasState: { ...canvas(), viewport: { x: 20, y: 30, zoom: 2 } } })
        expect(second.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { x: 20, y: 30, zoom: 2 } }), [], [], 'a')
    })

    it('discards document creation after the same workspace unloads and reloads', async () => {
        const creation = deferred<{ assetId: string }>()
        const view = setup({
            configure: ports => {
                ports.ingest.createDocument = () => creation.promise
            },
        })
        const owner = view.mount()
        owner.el.querySelector<HTMLButtonElement>('[aria-label="New Document"]')!.click()
        view.change({ loadingStatus: LoadingStatus.loading })
        view.change({ loadingStatus: LoadingStatus.success, canvasState: canvas() })
        creation.resolve({ assetId: 'late' })
        await vi.advanceTimersByTimeAsync(0)
        expect(view.ports.membership.attach).not.toHaveBeenCalled()
        expect(view.renderer.commitTransientCanvasState).not.toHaveBeenCalled()
    })

    it('rejects queued membership preparation after route replacement', async () => {
        const view = setup()
        view.mount()
        const release = deferred<void>()
        const lock = view.ports.session('a').persistence.runMembershipMutation(() => release.promise)
        const attach = view.callbacks().onAssetAttach({ assetId: 'asset', nodeId: 'node', canvasState: canvas() })
        const rejection = expect(attach).rejects.toThrow('WORKSPACE_CHANGED_DURING_CANVAS_MUTATION')
        view.change({ workspaceId: 'b', loadedWorkspaceId: 'b' })
        release.resolve()
        await lock
        await rejection
        expect(view.ports.membership.attach).not.toHaveBeenCalled()
    })

    it('adopts accepted membership in its originating session after the view closes', async () => {
        const result = deferred<unknown>()
        const view = setup({
            configure: ports => {
                ports.membership.attach = vi.fn(() => result.promise)
            },
        })
        const owner = view.mount()
        const attach = view.callbacks().onAssetAttach({ assetId: 'asset', nodeId: 'node', canvasState: canvas() })
        expect(view.ports.membership.attach).toHaveBeenCalledOnce()
        owner.destroy()
        result.resolve({ assetId: 'asset', nodeIds: ['node'] })
        await attach
        expect(view.publish).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'a', origin: 'authoritative' }))
        expect(view.renderer.commitTransientCanvasState).not.toHaveBeenCalled()
    })

    it('keeps upload placeholders transient without scheduling persistent geometry writes', async () => {
        const pending = deferred<null>()
        const view = setup({
            configure: ports => {
                ports.ingest.uploadFile = async request => {
                    request.onStart()
                    return await pending.promise
                }
            },
        })
        const owner = view.mount()
        const input = owner.el.querySelector<HTMLInputElement>('input[type="file"]')!
        Object.defineProperty(input, 'files', { value: [new File(['x'], 'image.png', { type: 'image/png' })] })
        input.dispatchEvent(new Event('change'))
        expect(view.ports.publishTransient).toHaveBeenCalledWith('a', expect.objectContaining({ nodes: [expect.objectContaining({ type: 'operationStatus' })] }))
        expect(view.save).not.toHaveBeenCalled()
        owner.destroy()
        pending.resolve(null)
        await vi.advanceTimersByTimeAsync(0)
    })

    it('flushes the trailing viewport with final renderer geometry during disposal', async () => {
        const view = setup()
        const owner = view.mount()
        view.callbacks().onViewportChange({ x: 10, y: 0, zoom: 1 })
        await view.ports.session('a').drain()
        view.callbacks().onViewportChange({ x: 20, y: 0, zoom: 1 })
        view.setRendererState({ ...canvas(), nodes: [{ nodeId: 'doc', type: 'document', assetId: 'asset', position: { x: 90, y: 30 }, dimensions: { width: 400, height: 350 } }] })
        owner.destroy()
        await view.ports.session('a').drain()
        expect(view.save).toHaveBeenLastCalledWith(expect.objectContaining({ canvasState: expect.objectContaining({ viewport: { x: 20, y: 0, zoom: 1 }, nodes: [expect.objectContaining({ position: { x: 90, y: 30 } })] }), persistViewport: true }))
        expect(vi.getTimerCount()).toBe(0)
    })

    it('owns pagehide stashing without accepting callbacks after disposal', () => {
        const view = setup()
        const owner = view.mount()
        view.callbacks().onViewportChange({ x: 10, y: 20, zoom: 2 })
        view.pageHide()
        expect(view.ports.storage.set).toHaveBeenCalledOnce()
        owner.destroy()
        vi.mocked(view.renderer.render).mockClear()
        const saveCount = view.save.mock.calls.length
        view.lateStoreChange()
        view.callbacks().onCanvasStateChange(canvas())
        view.callbacks().onAuthoritativeCanvasStateChange({ canvasState: canvas(), layoutRevision: 100 })
        view.callbacks().onViewportChange({ x: 0, y: 0, zoom: 1 })
        expect(view.renderer.render).not.toHaveBeenCalled()
        expect(view.save.mock.calls).toHaveLength(saveCount)
        expect(view.unsubscribe).toHaveBeenCalledOnce()
        expect(view.removePageHide).toHaveBeenCalledOnce()
    })

    it('releases sibling resources when renderer reads and disposal both fail', () => {
        const view = setup()
        const owner = view.mount()
        vi.mocked(view.renderer.getCanvasState).mockImplementation(() => {
            throw new Error('read')
        })
        vi.mocked(view.renderer.destroy).mockImplementation(() => {
            throw new Error('destroy')
        })
        expect(() => owner.destroy()).toThrow(AggregateError)
        expect(view.unsubscribe).toHaveBeenCalledOnce()
        expect(view.stopSynchronization).toHaveBeenCalledOnce()
        expect(view.removePageHide).toHaveBeenCalledOnce()
        expect(view.sessions.get('a')?.viewCount).toBe(0)
        expect(() => owner.destroy()).not.toThrow()
    })

    it('releases an already mounted renderer and earlier subscriptions when a subscription fails', () => {
        const release = vi.fn()
        const view = setup({
            configure: ports => {
                ports.subscriptions = [() => release, () => {
                    throw new Error('subscription')
                }]
            },
        })
        expect(() => view.mount()).toThrow('subscription')
        expect(release).toHaveBeenCalledOnce()
        expect(view.renderer.destroy).toHaveBeenCalledOnce()
        expect(view.stopSynchronization).toHaveBeenCalledOnce()
        expect(view.sessions.get('a')?.viewCount).toBe(0)
    })

    it('releases the initial viewport lease if renderer construction fails', () => {
        const view = setup({
            configure: ports => {
                ports.createRenderer = () => {
                    throw new Error('renderer')
                }
            },
        })
        expect(() => view.mount()).toThrow('renderer')
        expect(view.sessions.get('a')?.viewCount).toBe(0)
    })
})
