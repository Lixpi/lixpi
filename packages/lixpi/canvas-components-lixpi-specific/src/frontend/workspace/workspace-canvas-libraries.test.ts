// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    WorkspaceCanvasLibraries,
    type WorkspaceCanvasLibrariesPorts,
} from './workspace-canvas-libraries.ts'

const library = vi.hoisted(() => ({
    element: null as HTMLElement | null,
    load: vi.fn(async () => {}),
    destroy: vi.fn(),
}))
const mediaLibrary = vi.hoisted(() => ({
    showAsset: vi.fn(),
}))

vi.mock('@lixpi/canvas-components-lixpi-specific/frontend/library', async importOriginal => ({
    ...await importOriginal<typeof import('@lixpi/canvas-components-lixpi-specific/frontend/library')>(),
    createCapabilityLibraryPanel: () => ({
        element: library.element ?? document.createElement('div'),
        load: library.load,
        destroy: library.destroy,
    }),
    createMediaLibraryPanel: () => mediaLibrary,
}))

describe('WorkspaceCanvasLibraries', () => {
    it('mounts and releases a capability library through its scoped owner', () => {
        library.element = document.createElement('div')
        const host = document.createElement('div')
        const owner = new WorkspaceCanvasLibraries({
            host: {
                settings: { helpTooltip: { interactiveHideDelayMs: 0 } },
                workspace: { organizationId: () => 'org-1' },
                capabilities: { catalog: vi.fn(() => ({})) },
            },
            document,
            getWorkspaceId: () => 'workspace-1',
            getCanvasState: () => null,
            getComposer: () => null,
            captureAdmission: () => () => true,
            createLibraryPorts: vi.fn(),
            createAssetViewPorts: vi.fn(),
            insertNode: vi.fn(),
            commit: vi.fn(),
            applyGeometry: vi.fn(),
        } as WorkspaceCanvasLibrariesPorts)

        const unmount = owner.mount(host, 'capabilities')

        expect(host.firstElementChild).toBe(library.element)
        expect(library.load).toHaveBeenCalledOnce()
        unmount?.()
        expect(library.destroy).toHaveBeenCalledOnce()
    })

    it('does not claim generated-output detail mode', () => {
        const owner = new WorkspaceCanvasLibraries({} as WorkspaceCanvasLibrariesPorts)

        expect(owner.mount(document.createElement('div'), 'aiThreads')).toBeNull()
    })

    it('opens an Asset through the owned media library instance', () => {
        const owner = new WorkspaceCanvasLibraries({
            host: {
                settings: { helpTooltip: { interactiveHideDelayMs: 0 } },
                media: { prepareRenditionUrls: vi.fn() },
            },
            captureAdmission: () => () => true,
            createLibraryPorts: () => ({}),
            createAssetViewPorts: () => ({ mountEditor: vi.fn() }),
        } as WorkspaceCanvasLibrariesPorts)

        owner.showMediaAsset('asset-1')

        expect(mediaLibrary.showAsset).toHaveBeenCalledWith('asset-1')
    })
})
