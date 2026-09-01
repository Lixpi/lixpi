// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    LoadingStatus,
    type CanvasState,
} from '@lixpi/constants'
import type {
    EngineMedia,
    ImageLease,
} from '@lixpi/canvas-engine/frontend/media'
import type {
    CanvasRendererOptions,
    ResourceHandle,
    ResourceKind,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    LixpiWorkspaceCanvas,
    type WorkspaceCanvasOptions,
} from './workspace-canvas.ts'
import type { WorkspaceCanvasHost } from './workspace-canvas-host.ts'
import { createLixpiCanvasSettings } from '../settings/index.ts'

const renderers = vi.hoisted(() => [] as any[])
vi.mock('@lixpi/canvas-engine/frontend/rendering', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-engine/frontend/rendering')>()
    class Renderer {
        readonly owner = Symbol()
        private id = 0
        scopes: AbortController[] = []
        ready = Promise.resolve(true)
        imageRequests: Array<{ request: Parameters<EngineMedia['acquireImage']>[0]; resolve: (lease: ImageLease) => void }> = []
        handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ kind, id: String(++this.id), owner: this.owner })
        resources = {
            createGroup: vi.fn(() => this.handle('group')),
            createTexture: vi.fn(() => this.handle('texture')),
            createPath: vi.fn(() => this.handle('path')),
            createMesh: vi.fn(() => this.handle('mesh')),
            updateGroup: vi.fn(),
            updateTexture: vi.fn(),
            updatePath: vi.fn(),
            updateMesh: vi.fn(),
            setPaint: vi.fn(),
            setMask: vi.fn(),
            setVisible: vi.fn(),
            release: vi.fn(),
        }
        layers = { media: this.handle('layer'), connectors: this.handle('layer'), foreground: this.handle('layer') }
        constructor(private options: CanvasRendererOptions) {
            renderers.push(this)
        }
        createScope() {
            const controller = new AbortController()
            this.scopes.push(controller)
            return {
                signal: controller.signal,
                resources: this.resources,
                layers: this.layers,
                media: {
                    acquireImage: vi.fn((request: Parameters<EngineMedia['acquireImage']>[0]) => new Promise<ImageLease>(resolve => this.imageRequests.push({ request, resolve }))),
                    acquirePlayback: async (request: Parameters<EngineMedia['acquirePlayback']>[0]) => this.options.mediaResolver!.resolve(request.media, request.renditionId, request.signal),
                },
                invalidate: vi.fn(),
                requestFrame: vi.fn(() => vi.fn()),
                destroy: () => controller.abort(),
            }
        }
        setViewport = vi.fn()
        resize = vi.fn()
        invalidate = vi.fn()
        renderNow = vi.fn()
        destroy() {
            for (const scope of this.scopes) scope.abort()
        }
    }
    return { ...actual, CanvasRenderer: Renderer }
})

vi.mock('@lixpi/canvas-components/effects/glass', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-components/effects/glass')>()
    class Material {
        bake() {
            return { kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array(4) }
        }
    }
    return { ...actual, TravelingSnakeGlassMaterial: Material, ClosedGlassStripMaterial: Material }
})

vi.mock('@lixpi/canvas-components-lixpi-specific/frontend/loading', async importOriginal => ({
    ...await importOriginal<typeof import('@lixpi/canvas-components-lixpi-specific/frontend/loading')>(),
    createWorkspaceLoadingOutline: () => ({ setVisible: vi.fn(), setErrorMessage: vi.fn(), destroy: vi.fn() }),
}))

const libraryMounts = vi.hoisted(() => [] as { options: any; instance: any }[])
vi.mock('@lixpi/canvas-components-lixpi-specific/frontend/library', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-components-lixpi-specific/frontend/library')>()
    const create = (options: any) => {
        const rootEl = document.createElement('div')
        const instance = { rootEl, element: rootEl, load: vi.fn(async () => {}), mountInto: (host: HTMLElement) => host.append(rootEl), unmount: () => rootEl.remove(), destroy: vi.fn(() => rootEl.remove()) }
        libraryMounts.push({ options, instance })
        return instance
    }
    return { ...actual, createMediaLibraryPanel: create, createArtifactLibraryPanel: create, createCapabilityLibraryPanel: create }
})

const owners: LixpiWorkspaceCanvas[] = []
function state(): CanvasState {
    return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}
function fixture(overrides: Partial<WorkspaceCanvasHost> = {}, optionOverrides: Partial<WorkspaceCanvasOptions> = {}, configure?: (host: WorkspaceCanvasHost) => void) {
    const paneEl = document.createElement('div')
    const viewportEl = document.createElement('div')
    paneEl.append(viewportEl)
    document.body.append(paneEl)
    const settings = {
        ...createLixpiCanvasSettings(),
        aiChatThread: {
            styles: { nodeBorder: '', nodeBoxShadow: '', panelSectionDividerBorder: '' },
            contextPreview: { styles: {} },
            panelSwitch: { height: 36, transitionDurationMs: 0, transitionMinDurationMs: 0, transitionDistanceSpeedupFactor: 1 },
        },
        rightSidePanel: {
            defaultDimensions: { width: 494 },
            dimensions: { minWidth: 320, maxPaneMargin: 64 },
            layout: { contentInset: 10 },
            resizeHandle: { offset: 0, grabWidth: 20 },
            toggle: { openAriaLabel: 'Close', closedAriaLabel: 'Open' },
            animation: { durationMs: 0 },
            overlay: { enabled: false },
            drag: { enabled: false },
        },
        videoControls: {},
        helpTooltip: { interactiveHideDelayMs: 0 },
        dropdown: { styles: { popoverBoxShadow: '' } },
        aiPromptInput: { useShiftingGradientBackground: false },
        gradient: { styles: { shiftingColors: [] } },
    } as WorkspaceCanvasHost['settings']
    settings.canvasChrome.glassBorder.enabled = false
    let command: ((workspaceId?: string) => void) | undefined
    const releaseCommand = vi.fn()
    const assetCallbacks: Function[] = []
    const modelCallbacks: Function[] = []
    const workspaceCallbacks: Function[] = []
    const releases = [vi.fn(), vi.fn(), vi.fn()]
    const editorDispose = vi.fn()
    const host = {
        createId: () => crypto.randomUUID(),
        settings,
        openExternalUrl: vi.fn(),
        onOpenCapabilityLibrary: callback => {
            command = callback
            return releaseCommand
        },
        editors: {
            createPrompt: () => () => ({ editorView: null, restoreContent: vi.fn(), destroy: editorDispose }),
            createConversation: vi.fn(),
            mountAsset: vi.fn(),
            mountDocument: vi.fn(),
            mountCapability: vi.fn(),
            mountHistory: vi.fn(),
        },
        assets: {
            read: () => undefined,
            upsert: vi.fn(),
            readDocument: () => undefined,
            subscribe: callback => {
                assetCallbacks.push(callback)
                callback({ items: new Map() })
                return releases[0]
            },
            get: vi.fn(),
            refresh: vi.fn(),
            loadWorkspaceAssets: vi.fn(async () => []),
            ensureAssetsLoaded: vi.fn(async () => []),
            create: vi.fn(),
            updateMetadata: vi.fn(),
            changeScope: vi.fn(),
            attestSubjectIdentity: vi.fn(),
            reviewGeneratedOutput: vi.fn(),
            list: vi.fn(async () => ({ items: [] })),
            resumeDocument: vi.fn(),
            detach: vi.fn(),
        },
        generation: {
            connect: vi.fn(),
            fetchConversation: vi.fn(),
            subscribe: vi.fn(() => () => {}),
            replay: vi.fn(),
            get: vi.fn(),
            cancel: vi.fn(),
            resolveReference: vi.fn(),
            startVerification: vi.fn(),
            stopConversation: vi.fn(),
            describeMedia: vi.fn(),
        },
        workspace: {
            organizationId: () => 'org',
            userId: () => 'user',
            loadingStatus: () => LoadingStatus.success,
            reload: vi.fn(),
            subscribe: callback => {
                workspaceCallbacks.push(callback)
                callback({ loadingStatus: LoadingStatus.success })
                return releases[2]
            },
        },
        models: {
            read: () => [],
            modelIcon: () => null,
            providerIcon: () => null,
            createBadge: () => null,
            styleBadge: vi.fn(),
            subscribe: callback => {
                modelCallbacks.push(callback)
                callback()
                return releases[1]
            },
        },
        capabilities: {
            frontend: { get: vi.fn(), require: vi.fn() },
            shared: { get: vi.fn(), require: vi.fn() },
            ensureStyles: vi.fn(),
            catalog: vi.fn(() => ({ list: async () => [], get: vi.fn(), invalidate: vi.fn() })),
            promptCatalog: vi.fn(() => ({ getModule: vi.fn(), search: vi.fn() })),
        },
        media: { sources: { getAsset: () => undefined, resolveAssetRendition: vi.fn(), resolveTransientSource: vi.fn() }, renditionPath: vi.fn(), prepareRenditionUrls: vi.fn(), download: vi.fn(), uploadReplacement: vi.fn() },
        contextEnvironment: sources => ({ ...sources, extractDocumentText: () => '', getAssetRenditionPath: () => '', prepareAuthorizedRenditionUrl: vi.fn() }),
        extractText: () => '',
        traceDetail: () => ({}),
        storage: { getItem: () => null, setItem: vi.fn() },
        debugEnabled: () => false,
        ...overrides,
    } as WorkspaceCanvasHost
    const options: WorkspaceCanvasOptions = { paneEl, viewportEl, mediaModeSwitchMountEl: document.createElement('div'), modelMenuControlMountEl: document.createElement('div'), workspaceId: 'first', canvasState: state(), documents: [], aiChatThreads: [], ...optionOverrides }
    configure?.(host)
    const owner = new LixpiWorkspaceCanvas(options, host)
    owners.push(owner)
    return { owner, host, options, paneEl, viewportEl, command: (workspaceId?: string) => command?.(workspaceId), releaseCommand, releases, assetCallbacks, modelCallbacks, workspaceCallbacks, editorDispose }
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    )
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.replaceChildren()
    renderers.length = 0
    libraryMounts.length = 0
})

describe('LixpiWorkspaceCanvas composition', () => {
    it('mounts and releases a blank workspace through its infrastructure ports', () => {
        const f = fixture()
        expect(f.owner.getCanvasState()).toMatchObject(state())
        f.owner.destroy()
        expect(f.owner.getCanvasState()).toBeNull()
        expect(f.releases.map(release => release.mock.calls.length)).toEqual([1, 1, 1])
        expect(f.releaseCommand).toHaveBeenCalledTimes(1)
    })
    it('isolates commands, subscriptions and renderer scopes across two canvases', () => {
        const first = fixture()
        const second = fixture({}, { workspaceId: 'second' })
        first.command('second')
        expect(libraryMounts).toHaveLength(0)
        second.command('second')
        expect(libraryMounts).toHaveLength(1)
        const secondLibrary = libraryMounts[0]
        first.owner.destroy()
        first.command('first')
        expect(libraryMounts).toHaveLength(1)
        expect(second.releases.every(release => release.mock.calls.length === 0)).toBe(true)
        expect(secondLibrary.instance.destroy).not.toHaveBeenCalled()
        expect(renderers[0].scopes.every((scope: AbortController) => scope.signal.aborted)).toBe(true)
        expect(renderers[1].scopes.some((scope: AbortController) => !scope.signal.aborted)).toBe(true)
    })

    it('suppresses queued store callbacks and imperative mutations after destruction', () => {
        const onCanvasStateChange = vi.fn()
        const f = fixture({}, { onCanvasStateChange })
        f.owner.destroy()
        onCanvasStateChange.mockClear()
        expect(() => {
            for (const changed of f.assetCallbacks) changed({ items: new Map() })
            for (const changed of f.modelCallbacks) changed()
            for (const changed of f.workspaceCallbacks) changed({ loadingStatus: LoadingStatus.error })
            f.owner.render(state(), [], [], 'second')
            f.owner.commitTransientCanvasState(state())
            f.owner.toggleMediaLibrary()
            f.owner.toggleAiChatPanel()
        }).not.toThrow()
        expect(onCanvasStateChange).not.toHaveBeenCalled()
        expect(f.owner.getCanvasState()).toBeNull()
    })

    it.each(['navigation', 'destruction'])('rejects a library insertion completing after %s', async action => {
        let finish!: (value: CanvasState) => void
        const attach = vi.fn(() =>
            new Promise<CanvasState>(resolve => {
                finish = resolve
            })
        )
        const f = fixture({}, { onAssetAttach: attach })
        f.owner.toggleMediaLibrary()
        const library = libraryMounts.at(-1)!
        const pending = library.options.onInsertAsset({ assetId: 'a', primaryCategory: 'image', aspectRatio: 1 })
        expect(attach).toHaveBeenCalledTimes(1)
        const accepted = attach.mock.calls[0] as unknown as [{ canvasState: CanvasState }]
        if (action === 'navigation') f.owner.render(state(), [], [], 'second')
        else f.owner.destroy()
        finish(accepted[0].canvasState)
        expect(await pending).toBe(false)
        expect(f.owner.getCanvasState()?.nodes ?? []).toEqual([])
        expect(library.instance.destroy).toHaveBeenCalledTimes(1)
    })

    it('accepts a library insertion in its original scene', async () => {
        const f = fixture({}, { onAssetAttach: async ({ canvasState }) => canvasState })
        f.owner.toggleMediaLibrary()
        expect(await libraryMounts.at(-1)!.options.onInsertAsset({ assetId: 'a', primaryCategory: 'image', aspectRatio: 1 })).toBe(true)
        expect(f.owner.getCanvasState()?.nodes).toMatchObject([{ type: 'image', assetId: 'a' }])
    })

    it('replaces workspace-bound libraries and prompt catalogs on navigation', () => {
        const f = fixture()
        f.owner.toggleMediaLibrary()
        const firstLibrary = libraryMounts.at(-1)!
        f.owner.render(state(), [], [], 'second')
        expect(firstLibrary.instance.destroy).toHaveBeenCalledTimes(1)
        f.owner.toggleMediaLibrary()
        expect(libraryMounts.at(-1)!.options.workspaceId).toBe('second')
        expect(f.host.capabilities.promptCatalog).toHaveBeenLastCalledWith('second', 'org')
    })

    it.each(['first', 'other'])('admits library review geometry only for its workspace (%s)', async workspaceId => {
        const canvasState: CanvasState = {
            ...state(),
            nodes: [{ type: 'capabilityArtifact', nodeId: 'artifact-node', assetId: 'artifact', artifactTypeId: 'test-artifact', position: { x: 0, y: 0 }, dimensions: { width: 120, height: 80 } }],
            aiChatPanel: { isOpen: true, topLevelMode: 'artifacts', contextChips: [] },
        }
        const f = fixture({}, { canvasState }, host => {
            vi.mocked(host.assets.refresh).mockImplementation(() => new Promise(() => {}))
            vi.mocked(host.assets.reviewGeneratedOutput).mockResolvedValue({
                success: true,
                workspaceId,
                affectedAssetIds: [],
                acceptedAssetIds: ['artifact'],
                rejectedAssetIds: [],
                supersededAssetIds: [],
                canvasGeometry: { layoutRevision: 1, nodes: [], removedNodeIds: ['artifact-node'] },
            })
        })
        const library = libraryMounts.find(mount => mount.options.onAcceptAsset)!
        expect(await library.options.onAcceptAsset({ assetId: 'artifact' })).toBe(workspaceId === 'first')
        expect(f.owner.getCanvasState()?.nodes.map(node => node.nodeId)).toEqual(workspaceId === 'first' ? [] : ['artifact-node'])
    })

    it('cleans earlier mounts when the final subscription fails', () => {
        const assetRelease = vi.fn(), modelRelease = vi.fn(), commandRelease = vi.fn()
        expect(() =>
            fixture({}, {}, host => {
                host.assets.subscribe = () => assetRelease
                host.models.subscribe = () => modelRelease
                host.onOpenCapabilityLibrary = () => commandRelease
                host.workspace.subscribe = () => {
                    throw new Error('subscription failed')
                }
            })
        ).toThrow('subscription failed')
        expect(assetRelease).toHaveBeenCalledTimes(1)
        expect(modelRelease).toHaveBeenCalledTimes(1)
        expect(commandRelease).toHaveBeenCalledTimes(1)
        expect(renderers[0].scopes.every((scope: AbortController) => scope.signal.aborted)).toBe(true)
        expect(document.querySelector('.canvas-global-composer')).toBeNull()
    })

    it('continues cleanup when a subscription disposer throws', () => {
        const f = fixture()
        f.releases[0].mockImplementation(() => {
            throw new Error('unsubscribe')
        })
        expect(() => f.owner.destroy()).toThrow(AggregateError)
        expect(f.releases.map(release => release.mock.calls.length)).toEqual([1, 1, 1])
        expect(f.releaseCommand).toHaveBeenCalledTimes(1)
        expect(f.editorDispose).toHaveBeenCalledTimes(1)
        expect(renderers[0].scopes.every((scope: AbortController) => scope.signal.aborted)).toBe(true)
        expect(() => f.owner.destroy()).not.toThrow()
    })
})
