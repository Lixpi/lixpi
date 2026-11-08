// @vitest-environment happy-dom
import { CanvasThemeStore, createCanvasTheme } from '@lixpi/canvas-components/theme'
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type LixpiCanvasSettings,
} from '../settings/types.ts'
import {
    createWorkspaceDiagramCanvas,
    type WorkspaceDiagramCanvasOptions,
} from './workspace-diagram-canvas.ts'

const mocks = vi.hoisted(() => ({
    createDiagramCanvas: vi.fn(),
    createDefaultSettings: vi.fn(),
    applyWorkspaceCanvasTheme: vi.fn(),
}))

vi.mock('@lixpi/canvas-components/diagram', () => ({
    createDiagramCanvas: mocks.createDiagramCanvas,
}))
vi.mock('../settings/canvas-settings.ts', () => ({
    createLixpiCanvasSettings: mocks.createDefaultSettings,
}))
vi.mock('../settings/canvas-theme.ts', () => ({
    applyWorkspaceCanvasTheme: mocks.applyWorkspaceCanvasTheme,
}))

const makeCanvas = () => ({
    el: document.createElement('div'),
    mount: vi.fn(),
    setScene: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    refit: vi.fn(),
    refresh: vi.fn(),
    destroy: vi.fn(),
})

describe('workspace diagram canvas options', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.createDefaultSettings.mockReturnValue({ connector: { marker: 'default' } })
        mocks.createDiagramCanvas.mockImplementation(makeCanvas)
    })

    it('forwards supplied settings patches and appearance to the shared diagram canvas', () => {
        const settings = { connector: { marker: 'custom' } } as unknown as LixpiCanvasSettings
        const appearance: NonNullable<WorkspaceDiagramCanvasOptions['appearance']> = {
            background: '#101820',
            accentColor: '#ff8800',
        }

        createWorkspaceDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            settings,
            appearance,
            onError: vi.fn(),
        })

        expect(mocks.createDiagramCanvas).toHaveBeenCalledWith(expect.objectContaining({
            settings,
            appearance,
            connectionSettings: settings.connector,
        }))
        expect(mocks.applyWorkspaceCanvasTheme.mock.calls[0][1]).toMatchObject({
            connector: settings.connector,
        })
        expect(mocks.createDefaultSettings).toHaveBeenCalledOnce()
    })

    it('updates retained explicit settings when the shared theme changes', async () => {
        const actualSettings = await vi.importActual<typeof import('../settings/canvas-settings.ts')>('../settings/canvas-settings.ts')
        const defaults = actualSettings.createLixpiCanvasSettings()
        const explicitInfoButtonColor = '#123456'
        mocks.createDefaultSettings.mockReturnValue(defaults)
        const theme = new CanvasThemeStore(createCanvasTheme())
        const diagram = createWorkspaceDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            settings: {
                mediaNode: {
                    generatedMediaChrome: {
                        styles: {
                            infoButtonColor: explicitInfoButtonColor,
                        },
                    },
                },
            },
            theme,
            onError: vi.fn(),
        })
        const canvasOptions = mocks.createDiagramCanvas.mock.calls[0][0]
        const connectionSettings = canvasOptions.connectionSettings
        const retainedSettings = mocks.applyWorkspaceCanvasTheme.mock.calls[0][1]

        expect(connectionSettings).toBe(retainedSettings.connector)
        theme.update({
            connectors: {
                proximityConnectThreshold: 91,
            },
        })

        expect(connectionSettings.proximityConnectThreshold).toBe(91)
        expect(mocks.applyWorkspaceCanvasTheme.mock.calls.at(-1)?.[1]).toBe(retainedSettings)
        expect(retainedSettings.mediaNode.generatedMediaChrome.styles.infoButtonColor).toBe(explicitInfoButtonColor)
        diagram.destroy()
    })

    it('uses the default canvas settings when none are supplied', () => {
        const defaultSettings = { connector: { marker: 'default' } } as unknown as LixpiCanvasSettings
        mocks.createDefaultSettings.mockReturnValue(defaultSettings)

        createWorkspaceDiagramCanvas({
            ariaLabel: 'Research diagram',
            sceneKey: 'research-flow',
            onError: vi.fn(),
        })

        expect(mocks.createDefaultSettings).toHaveBeenCalledOnce()
        expect(mocks.createDiagramCanvas).toHaveBeenCalledWith(expect.objectContaining({
            connectionSettings: defaultSettings.connector,
        }))
        expect(mocks.createDiagramCanvas.mock.calls[0][0]).not.toHaveProperty('appearance')
        expect(mocks.applyWorkspaceCanvasTheme.mock.calls[0][1]).toMatchObject({
            connector: defaultSettings.connector,
        })
    })
})
