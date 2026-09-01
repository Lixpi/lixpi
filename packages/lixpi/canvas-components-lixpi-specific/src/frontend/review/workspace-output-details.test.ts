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
    type Asset,
    type CanvasState,
    type ImageCanvasNode,
    type CapabilityArtifactCanvasNode,
    type MediaGenerationProgressState,
} from '@lixpi/constants'
import {
    type BranchMarkerNode,
} from '../../shared/index.ts'
import {
    type MediaGenerationProgressInstance,
} from '../progress/index.ts'
import {
    WorkspaceOutputDetails,
    type WorkspaceOutputDetailsPorts,
} from './workspace-output-details.ts'

const mocks = vi.hoisted(() => ({ progress: [] as MediaGenerationProgressInstance[], details: [] as { destroy: ReturnType<typeof vi.fn> }[] }))
vi.mock('../progress/index.ts', () => ({
    createMediaGenerationProgress: () => {
        const progress = { element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() }
        mocks.progress.push(progress)
        return progress
    },
}))
vi.mock('./workspace-asset-details.ts', () => ({
    WorkspaceAssetDetails: class {
        readonly element = document.createElement('section')
        readonly destroy = vi.fn()
        constructor() {
            mocks.details.push(this)
        }
    },
}))

const owners: WorkspaceOutputDetails[] = []
const media = (generated = true): ImageCanvasNode => ({
    nodeId: 'image',
    type: 'image',
    assetId: 'asset',
    position: { x: 0, y: 0 },
    dimensions: { width: 400, height: 240 },
    ...(generated ? { generatedBy: { conversationAssetId: 'conversation' } } : {}),
} as ImageCanvasNode)
const marker = { nodeId: 'marker', type: 'branchFork', position: { x: 0, y: 0 }, dimensions: { width: 400, height: 56 } } as BranchMarkerNode

function fixture() {
    const body = document.createElement('div')
    document.body.appendChild(body)
    const editor = { destroy: vi.fn() }
    const history = { destroy: vi.fn() }
    const info = { destroy: vi.fn() }
    const asset = { assetId: 'asset', title: 'Title', revision: 1 } as Asset
    const ports: WorkspaceOutputDetailsPorts = {
        assets: {
            document,
            workspaceId: 'workspace',
            userId: 'user',
            tooltipHideDelayMs: 0,
            getAsset: () => asset,
            mountEditor: vi.fn(() => editor),
            updateMetadata: vi.fn(async () => asset),
            onChanged: vi.fn(),
            onError: vi.fn(),
            getContentDocument: () => undefined,
            changeScope: vi.fn(async () => asset),
            attestSubjectIdentity: vi.fn(async () => asset),
        },
        getDescriptor: () => undefined,
        getArtifactDocument: () => ({ type: 'doc' }),
        getArtifactDefinition: () => ({ createGeneratedOutputInfoView: vi.fn(() => info) }),
        getBranchMediaTarget: () => null,
        getMediaBranchTarget: () => null,
        mountMediaHistory: vi.fn(() => history),
        mountBranchHistory: vi.fn(() => history),
        mountArtifactHistory: vi.fn(() => history),
        getProgress: () => null,
        progressDetails: {},
        now: () => 1234,
    }
    const mount = (node: ImageCanvasNode | CapabilityArtifactCanvasNode | BranchMarkerNode = media()) => {
        const owner = new WorkspaceOutputDetails(body, node, ports)
        owners.push(owner)
        return owner
    }
    return { body, ports, editor, history, info, mount }
}

beforeEach(() => {
    mocks.progress.length = 0
    mocks.details.length = 0
})
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('WorkspaceOutputDetails', () => {
    it('owns metadata and the selected media history without creating a duplicate progress timeline', () => {
        const f = fixture()
        const progress = { element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() }
        f.ports.mountMediaHistory = vi.fn(request => {
            request.onProgress(progress)
            return f.history
        })
        const owner = f.mount()
        const request = vi.mocked(f.ports.mountMediaHistory).mock.calls[0][0]
        expect(request.target.lineageProjectionScope).toBe('media-run')
        expect(request.target.limitProjectionToSelectedMedia).toBe(true)
        expect(f.body.querySelectorAll('.workspace-generated-output-details-history')).toHaveLength(1)
        expect(mocks.progress).toHaveLength(0)
        f.ports.getProgress = () => ({ status: 'completed' } as MediaGenerationProgressState)
        owner.sync({ nodes: [media()] } as CanvasState)
        expect(progress.update).toHaveBeenCalledWith({ status: 'completed' })
        owner.destroy()
        expect(request.signal.aborted).toBe(true)
        expect(f.history.destroy).toHaveBeenCalledOnce()
        expect(f.editor.destroy).toHaveBeenCalledOnce()
        expect(mocks.details[0].destroy).toHaveBeenCalledOnce()
        request.onProgress(progress)
        owner.sync({ nodes: [media()] } as CanvasState)
        expect(progress.update).toHaveBeenCalledOnce()
        expect(progress.destroy).not.toHaveBeenCalled()
        expect(f.body.childElementCount).toBe(0)
    })

    it('falls back from a branch media projection to its canonical marker history', () => {
        const f = fixture()
        f.ports.getBranchMediaTarget = () => ({ node: media(), lineageProjectionScope: 'branch-fork', limitProjectionToSelectedMedia: false })
        f.ports.mountMediaHistory = vi.fn(() => null)
        f.mount(marker)
        expect(f.ports.mountBranchHistory).toHaveBeenCalledWith(expect.objectContaining({ target: { marker, lineageProjectionScope: 'branch-fork' } }))
        expect(f.ports.assets.mountEditor).not.toHaveBeenCalled()
    })

    it('keeps uploaded media metadata without an empty generation section', () => {
        const f = fixture()
        f.mount(media(false))
        expect(f.body.querySelector('.canvas-asset-metadata-editor')).not.toBeNull()
        expect(f.body.querySelector('.workspace-generated-output-details-history')).toBeNull()
        expect(f.ports.mountMediaHistory).not.toHaveBeenCalled()
    })

    it('projects a linked marker for media whose generatedBy record is absent', () => {
        const f = fixture()
        f.ports.getMediaBranchTarget = () => ({ marker, lineageProjectionScope: 'branch-fork' })
        f.mount(media(false))
        expect(f.ports.mountBranchHistory).toHaveBeenCalledWith(expect.objectContaining({ target: { marker, lineageProjectionScope: 'branch-fork' } }))
        expect(f.ports.mountMediaHistory).not.toHaveBeenCalled()
    })

    it('owns fallback progress and updates it from the matching canvas node', () => {
        const f = fixture()
        f.ports.mountMediaHistory = vi.fn(() => null)
        f.ports.getProgress = () => ({ status: 'running' } as MediaGenerationProgressState)
        const owner = f.mount()
        expect(mocks.progress).toHaveLength(1)
        owner.sync({ nodes: [{ ...media(), nodeId: 'different' }] } as CanvasState)
        expect(mocks.progress[0].update).not.toHaveBeenCalled()
        owner.sync({ nodes: [media()] } as CanvasState)
        expect(mocks.progress[0].update).toHaveBeenCalledOnce()
        owner.destroy()
        expect(mocks.progress[0].destroy).toHaveBeenCalledOnce()
    })

    it('disposes registered Artifact info views along with their history and editors', () => {
        const f = fixture()
        const owner = f.mount({ ...media(), type: 'capabilityArtifact', artifactTypeId: 'registered-type' } as CapabilityArtifactCanvasNode)
        expect(f.ports.mountArtifactHistory).toHaveBeenCalledOnce()
        expect(f.body.querySelector('.canvas-capability-artifact-details')).not.toBeNull()
        owner.destroy()
        expect(f.info.destroy).toHaveBeenCalledOnce()
        expect(f.history.destroy).toHaveBeenCalledOnce()
        expect(f.editor.destroy).toHaveBeenCalledOnce()
    })

    it('releases mounted editors and Artifact views when history mounting fails', () => {
        const f = fixture()
        f.ports.mountArtifactHistory = () => {
            throw new Error('history failed')
        }
        expect(() => f.mount({ ...media(), type: 'capabilityArtifact', artifactTypeId: 'registered-type' } as CapabilityArtifactCanvasNode)).toThrow('history failed')
        expect(f.info.destroy).toHaveBeenCalledOnce()
        expect(f.editor.destroy).toHaveBeenCalledOnce()
        expect(mocks.details[0].destroy).toHaveBeenCalledOnce()
        expect(f.body.childElementCount).toBe(0)
    })

    it('renders analysis states and tags while leaving the editable summary in metadata', () => {
        const f = fixture()
        f.ports.getDescriptor = () => ({ source: 'analysis', status: 'analyzing' } as ReturnType<WorkspaceOutputDetailsPorts['getDescriptor']>)
        const first = f.mount(media(false))
        expect(f.body.querySelector<HTMLElement>('.canvas-media-descriptor-spinner')?.style.animationDelay).toBe('-434ms')
        first.destroy()
        f.ports.getDescriptor = () => ({ source: 'analysis', status: 'ready', summary: 'Editable summary', entityTags: ['Person'], styleTags: ['Illustration'] } as ReturnType<WorkspaceOutputDetailsPorts['getDescriptor']>)
        f.mount(media(false))
        expect([...f.body.querySelectorAll('.canvas-media-descriptor-tag')].map(tag => tag.textContent)).toEqual(['Person', 'Illustration'])
        expect(f.body.querySelector('.canvas-media-descriptor-summary')).toBeNull()
    })

    it('leaves another canvas intact when one history disposer fails', () => {
        const first = fixture()
        const second = fixture()
        const owner = first.mount()
        second.mount()
        first.history.destroy.mockImplementationOnce(() => {
            throw new Error('release failed')
        })
        expect(() => owner.destroy()).toThrow()
        expect(first.editor.destroy).toHaveBeenCalledOnce()
        expect(first.body.childElementCount).toBe(0)
        expect(second.body.childElementCount).toBeGreaterThan(0)
        expect(second.history.destroy).not.toHaveBeenCalled()
    })
})
