import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    MAX_UPLOAD_FILE_SIZE,
    type CanvasState,
    type MediaKind,
} from '@lixpi/constants'
import {
    WorkspaceCanvasActions,
    type CanvasIngestReply,
    type WorkspaceCanvasActionScope,
    type WorkspaceCanvasActionsPorts,
} from './workspace-canvas-actions.ts'

const state: CanvasState = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
const file = (size = 100): File => ({ name: 'clip.mov', size } as File)
function setup(overrides: Partial<WorkspaceCanvasActionsPorts> = {}) {
    let scope: WorkspaceCanvasActionScope | null = { workspaceId: 'workspace', organizationId: 'org', revision: 1 }
    let id = 0
    const ports: WorkspaceCanvasActionsPorts = {
        readScope: () => scope,
        createId: () => String(++id),
        now: () => 123,
        insertionWidth: 500,
        createDocument: vi.fn(async () => ({ assetId: 'document' })),
        uploadFile: vi.fn(async request => request.onStart() ? { assetId: 'asset', kind: 'video' } : null),
        importUrl: vi.fn(async request => request.onStart() ? { assetId: 'asset', kind: 'image' } : null),
        refreshAsset: vi.fn(async () => ({})),
        attach: vi.fn(async (_workspaceId, request) => request.prepare()),
        insertPlaceholder: vi.fn(),
        failPlaceholder: vi.fn(),
        prepareInsertion: vi.fn(() => state),
        commitDocument: vi.fn(),
        commitMedia: vi.fn(),
        closeUploadMenu: vi.fn(),
        reportError: vi.fn(),
        ...overrides,
    }
    const owner = new WorkspaceCanvasActions(ports)
    return {
        owner,
        ports,
        setScope: (value: typeof scope) => {
            scope = value
        },
    }
}

describe('workspace canvas actions', () => {
    it('creates a document before preparing and attaching its canvas node', async () => {
        const { owner, ports } = setup()
        await owner.createDocument()
        expect(ports.createDocument).toHaveBeenCalledWith({ organizationId: 'org', workspaceId: 'workspace', title: 'New Document' })
        expect(ports.prepareInsertion).toHaveBeenCalledWith({ nodeId: 'node-1', type: 'document', assetId: 'document', dimensions: { width: 400, height: 350 } })
        expect(ports.commitDocument).toHaveBeenCalledWith(state)
    })

    it('places an upload operation before transport starts and replaces it after membership accepts', async () => {
        const { owner, ports } = setup()
        await owner.uploadFile(file())
        expect(ports.insertPlaceholder).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'upload-1', operation: 'upload', title: 'clip.mov', status: 'in-progress' }))
        expect(ports.refreshAsset).toHaveBeenCalledWith('asset', 'workspace')
        expect(ports.prepareInsertion).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'node-2', type: 'video', assetId: 'asset' }), 'upload-1')
        expect(ports.commitMedia).toHaveBeenCalledWith(state, 'node-2', 'upload-1')
    })

    it.each(['image', 'video', 'audio', 'document'] as MediaKind[])('preserves %s insertion geometry', async kind => {
        const { owner, ports } = setup({
            uploadFile: async request => {
                request.onStart()
                return { assetId: 'asset', kind }
            },
        })
        await owner.uploadFile(file())
        const dimensions = kind === 'audio' ? { width: 360, height: 96 } : { width: 500, height: 500 / (kind === 'document' ? 0.7727 : 1) }
        expect(ports.prepareInsertion).toHaveBeenCalledWith(expect.objectContaining({ type: kind === 'document' ? 'mediaDocument' : kind, dimensions }), 'upload-1')
    })

    it('surfaces oversized files in an operation node without uploading bytes', async () => {
        const { owner, ports } = setup()
        await owner.uploadFile(file(MAX_UPLOAD_FILE_SIZE + 1))
        expect(ports.uploadFile).not.toHaveBeenCalled()
        expect(ports.failPlaceholder).toHaveBeenCalledWith('upload-1', 'File is too large.')
    })

    it('keeps the server rejection on its upload placeholder', async () => {
        const { owner, ports } = setup({
            uploadFile: async request => {
                request.onStart()
                return { error: 'Unsupported file' }
            },
        })
        await owner.uploadFile(file())
        expect(ports.failPlaceholder).toHaveBeenCalledWith('upload-1', 'Unsupported file')
        expect(ports.attach).not.toHaveBeenCalled()
    })

    it('imports trimmed URLs, names their placeholder and closes the menu on success', async () => {
        const { owner, ports } = setup()
        await owner.importUrl(' https://example.test/path/image.png ')
        expect(ports.importUrl).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', url: 'https://example.test/path/image.png' }))
        expect(ports.insertPlaceholder).toHaveBeenCalledWith(expect.objectContaining({ title: 'image.png' }))
        expect(ports.closeUploadMenu).toHaveBeenCalledOnce()
        expect(ports.commitMedia).toHaveBeenCalledOnce()
    })

    it('does not begin an upload if the canvas changes while authorization is pending', async () => {
        let start!: () => boolean
        let finish!: (result: CanvasIngestReply) => void
        const fixture = setup({
            uploadFile: request => {
                start = request.onStart
                return new Promise(resolve => {
                    finish = resolve
                })
            },
        })
        const pending = fixture.owner.uploadFile(file())
        fixture.setScope({ workspaceId: 'other', organizationId: 'org', revision: 2 })
        expect(start()).toBe(false)
        finish(null)
        await pending
        expect(fixture.ports.insertPlaceholder).not.toHaveBeenCalled()
        expect(fixture.ports.commitMedia).not.toHaveBeenCalled()
    })

    it('allows accepted uploads to finish without touching a replacement canvas', async () => {
        let finish!: (result: CanvasIngestReply) => void
        const fixture = setup({
            uploadFile: request => {
                request.onStart()
                return new Promise(resolve => {
                    finish = resolve
                })
            },
        })
        const pending = fixture.owner.uploadFile(file())
        fixture.owner.clear()
        finish({ assetId: 'asset', kind: 'video' })
        await pending
        expect(fixture.ports.refreshAsset).not.toHaveBeenCalled()
        expect(fixture.ports.attach).not.toHaveBeenCalled()
    })

    it('refuses to prepare a membership write after a same-workspace view replacement', async () => {
        const fixture = setup()
        fixture.ports.attach = vi.fn(async (_workspaceId, request) => {
            fixture.setScope({ workspaceId: 'workspace', organizationId: 'org', revision: 2 })
            return request.prepare()
        })
        await fixture.owner.createDocument()
        expect(fixture.ports.prepareInsertion).not.toHaveBeenCalled()
        expect(fixture.ports.commitDocument).not.toHaveBeenCalled()
        expect(fixture.ports.reportError).toHaveBeenCalledWith('Error creating document:', expect.objectContaining({ message: 'WORKSPACE_CHANGED_DURING_CANVAS_MUTATION' }))
    })

    it('does not commit accepted membership into a disposed canvas or admit another action', async () => {
        const fixture = setup()
        fixture.ports.attach = vi.fn(async (_workspaceId, request) => {
            const next = request.prepare()
            fixture.owner.destroy()
            return next
        })
        await fixture.owner.createDocument()
        await fixture.owner.createDocument()
        expect(fixture.ports.commitDocument).not.toHaveBeenCalled()
        expect(fixture.ports.createDocument).toHaveBeenCalledOnce()
    })

    it('reports transport and metadata failures without committing membership', async () => {
        const { owner, ports } = setup({ refreshAsset: async () => ({ error: 'Asset unavailable' }) })
        await owner.uploadFile(file())
        expect(ports.failPlaceholder).toHaveBeenCalledWith('upload-1', 'Upload failed')
        expect(ports.reportError).toHaveBeenCalledOnce()
        expect(ports.attach).not.toHaveBeenCalled()
    })
})
