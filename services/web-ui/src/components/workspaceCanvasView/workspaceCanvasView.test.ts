// @vitest-environment happy-dom

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const lifecycleMocks = vi.hoisted(() => ({
    surfaceConstructed: vi.fn(),
    surfaceDestroyed: vi.fn(),
}))

vi.mock(
    '@lixpi/canvas-components/workspace',
    () => ({
        WorkspaceCanvasSurface: class {
            readonly el = document.createElement('div')

            constructor() {
                lifecycleMocks.surfaceConstructed()
            }

            destroy = (): void => void lifecycleMocks.surfaceDestroyed()
        },
        createWorkspaceCanvas: vi.fn(),
    }),
)

const loadCanvasViewModules = async () => {
    vi.resetModules()

    const theme = await import('@lixpi/canvas-components/theme')
    const adapter = await import('$src/canvas-adapters/canvas-theme.ts')
    const workspaceCanvasView = await import('./workspaceCanvasView.ts')

    return {
        theme,
        adapter,
        workspaceCanvasView,
    }
}

const createViewConfig = (theme?: unknown) => ({
    assetService: {} as never,
    auth: {} as never,
    router: {} as never,
    ...(theme ? { theme: theme as never } : {}),
})

const setThemeTokens = (
    root: HTMLElement,
    background: string,
): void => {
    const tokens = {
        background,
        surface: '#202020',
        'surface-secondary': '#303030',
        'surface-hover': '#404040',
        text: '#f0f0f0',
        'text-muted': '#c0c0c0',
        border: '#505050',
        accent: '#606060',
        success: '#707070',
        warning: '#808080',
        danger: '#909090',
    }

    for (const [role, value] of Object.entries(tokens))
        root.style.setProperty(`--theme-${role}`, value)
}

const flushMutationObserver = async (): Promise<void> => new Promise(resolve => setTimeout(
    resolve,
    0,
))

const connectView = async (root: HTMLElement): Promise<void> => {
    document.body.append(root)
    await flushMutationObserver()
}

describe('workspace canvas mounted theme lifecycle', () => {
    beforeEach(() => {
        lifecycleMocks.surfaceConstructed.mockReset()
        lifecycleMocks.surfaceDestroyed.mockReset()
        document.body.replaceChildren()
    })

    afterEach(() => {
        document.body.replaceChildren()
        vi.restoreAllMocks()
    })

    it('waits for connection before reading CSS or constructing the surface', async () => {
        const { workspaceCanvasView } = await loadCanvasViewModules()
        const getComputedStyle = vi.spyOn(
            window,
            'getComputedStyle',
        )
        const view = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig())
        setThemeTokens(
            view.el,
            '#101010',
        )

        await flushMutationObserver()

        expect(lifecycleMocks.surfaceConstructed).not.toHaveBeenCalled()
        expect(getComputedStyle.mock.calls.some(([element]) => element === view.el)).toBe(false)
    })

    it('initializes from the connected root before constructing one surface', async () => {
        const {
            adapter,
            workspaceCanvasView,
        } = await loadCanvasViewModules()
        const events: string[] = []
        const backgroundsAtConstruction: string[] = []
        const getComputedStyle = vi.spyOn(
            window,
            'getComputedStyle',
        )
        adapter.canvasThemeStore.subscribe(() => events.push('theme initialized'))
        lifecycleMocks.surfaceConstructed.mockImplementation(() => {
            events.push('surface constructed')
            backgroundsAtConstruction.push(adapter.canvasThemeStore.value.colors.background)
        })

        const view = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig())
        setThemeTokens(
            view.el,
            '#121212',
        )
        view.el.dataset.colorTheme = "Host configured theme"

        expect(lifecycleMocks.surfaceConstructed).not.toHaveBeenCalled()
        await connectView(view.el)

        const secondParent = document.createElement('section')
        document.body.append(secondParent)
        secondParent.append(view.el)
        await flushMutationObserver()

        expect(lifecycleMocks.surfaceConstructed).toHaveBeenCalledOnce()
        expect(backgroundsAtConstruction).toEqual(['#121212'])
        expect(events).toEqual(['theme initialized', 'surface constructed'])
        expect(adapter.canvasThemeStore.value.name).toBe('Host configured theme')
        expect(getComputedStyle.mock.calls.filter(([element]) => element === view.el)).toHaveLength(1)
    })

    it('stops observing when destroyed before connection', async () => {
        const { workspaceCanvasView } = await loadCanvasViewModules()
        const getComputedStyle = vi.spyOn(
            window,
            'getComputedStyle',
        )
        const view = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig())
        setThemeTokens(
            view.el,
            '#131313',
        )

        view.destroy()
        document.body.append(view.el)
        await flushMutationObserver()

        expect(view.el.isConnected).toBe(true)
        expect(lifecycleMocks.surfaceConstructed).not.toHaveBeenCalled()
        expect(getComputedStyle.mock.calls.some(([element]) => element === view.el)).toBe(false)
    })

    it('disposes the binding and surface when destroyed after connection', async () => {
        const {
            adapter,
            workspaceCanvasView,
        } = await loadCanvasViewModules()
        const view = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig())
        setThemeTokens(
            view.el,
            '#141414',
        )
        view.el.dataset.colorTheme = "Host configured theme"
        await connectView(view.el)

        expect(view.el.dataset.canvasTheme).toBe('Host configured theme')
        expect(view.el.style.getPropertyValue('--canvas-background')).toBe('#141414')

        view.destroy()
        adapter.canvasThemeStore.update({
            name: 'Updated after destroy',
            colors: { background: '#151515' },
        })

        expect(lifecycleMocks.surfaceDestroyed).toHaveBeenCalledOnce()
        expect(view.el.isConnected).toBe(false)
        expect(view.el.getAttribute('data-canvas-theme')).toBeNull()
        expect(view.el.style.getPropertyValue('--canvas-background')).toBe('')
    })

    it('binds an explicit theme instead of reading the default CSS theme', async () => {
        const {
            theme,
            adapter,
            workspaceCanvasView,
        } = await loadCanvasViewModules()
        const explicitTheme = new theme.CanvasThemeStore(theme.createCanvasTheme({
            name: 'Explicit workspace theme',
            colors: { background: '#abcdef' },
        }))
        const initialSharedTheme = adapter.canvasThemeStore.value
        const getComputedStyle = vi.spyOn(
            window,
            'getComputedStyle',
        )
        const view = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig(explicitTheme))
        setThemeTokens(
            view.el,
            '#161616',
        )
        await connectView(view.el)

        expect(view.el.dataset.canvasTheme).toBe('Explicit workspace theme')
        expect(view.el.style.getPropertyValue('--canvas-background')).toBe('#abcdef')
        expect(adapter.canvasThemeStore.value).toBe(initialSharedTheme)
        expect(getComputedStyle.mock.calls.some(([element]) => element === view.el)).toBe(false)

        explicitTheme.update({ name: 'Updated explicit theme' })

        expect(view.el.dataset.canvasTheme).toBe('Updated explicit theme')
    })

    it('preserves shared updates before the first mount across later workspace mounts', async () => {
        const {
            theme,
            adapter,
            workspaceCanvasView,
        } = await loadCanvasViewModules()
        const sharedTheme = theme.createCanvasTheme({
            name: 'Application selected theme',
            colors: { background: '#ababab' },
        })
        adapter.canvasThemeStore.set(sharedTheme)
        const getComputedStyle = vi.spyOn(
            window,
            'getComputedStyle',
        )
        const firstView = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig())
        const laterView = workspaceCanvasView.createWorkspaceCanvasView(createViewConfig())
        setThemeTokens(
            firstView.el,
            '#171717',
        )
        setThemeTokens(
            laterView.el,
            '#181818',
        )

        await connectView(firstView.el)
        await connectView(laterView.el)

        expect(lifecycleMocks.surfaceConstructed).toHaveBeenCalledTimes(2)
        expect(adapter.canvasThemeStore.value).toEqual(sharedTheme)
        expect(firstView.el.dataset.canvasTheme).toBe('Application selected theme')
        expect(laterView.el.dataset.canvasTheme).toBe('Application selected theme')
        expect(firstView.el.style.getPropertyValue('--canvas-background')).toBe('#ababab')
        expect(laterView.el.style.getPropertyValue('--canvas-background')).toBe('#ababab')
        expect(getComputedStyle.mock.calls.some(([element]) => element === firstView.el)).toBe(false)
        expect(getComputedStyle.mock.calls.some(([element]) => element === laterView.el)).toBe(false)
    })
})
