import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { CanvasState } from '@lixpi/constants'
import {
    CanvasPersistenceController,
    type WorkspaceCanvasSnapshot,
} from './canvas-persistence-controller.ts'
import {
    WorkspaceCanvasMembership,
    type CanvasMembershipTransportRequest,
} from './workspace-canvas-membership.ts'

function state(): CanvasState {
    return { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }
}

function setup() {
    let snapshot: WorkspaceCanvasSnapshot = { canvasState: state(), version: { canvasStateUpdatedAt: 5 } }
    const publish = vi.fn(publication => {
        snapshot = { canvasState: publication.canvasState ?? snapshot.canvasState, version: publication.version ?? snapshot.version }
    })
    const persistence = new CanvasPersistenceController('one', {
        read: () => snapshot,
        save: async () => ({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 20 } }),
        fetch: async () => snapshot,
        publish,
        reportError: vi.fn(),
    })
    const attach = vi.fn(async (request: CanvasMembershipTransportRequest): Promise<unknown> => ({ assetId: request.assetId, nodeIds: [request.nodeId] }))
    const detach = vi.fn(async (): Promise<unknown> => ({ success: true }))
    const membership = new WorkspaceCanvasMembership(persistence, { attach, detach, now: () => 10 })
    return { persistence, membership, attach, detach, publish }
}

describe('WorkspaceCanvasMembership', () => {
    it('prepares each mutation under the shared lock using the preceding acknowledged revision', async () => {
        const { membership, attach } = setup()
        const first = Promise.withResolvers<unknown>()
        attach.mockReturnValueOnce(first.promise)
        const one = membership.attach({ assetId: 'a', nodeId: 'n1', prepare: snapshot => snapshot.canvasState })
        const prepare = vi.fn(snapshot => snapshot.canvasState)
        const two = membership.attach({ assetId: 'b', nodeId: 'n2', prepare })
        await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
        expect(prepare).not.toHaveBeenCalled()
        first.resolve({ assetId: 'a', nodeIds: ['n1'] })
        await one
        await two
        expect(attach.mock.calls[1][0].workspaceMutation).toMatchObject({ expectedCanvasStateUpdatedAt: 10, canvasStateUpdatedAt: 11 })
    })

    it.each([
        null,
        { error: 'DENIED' },
        { assetId: 'wrong', nodeIds: ['n'] },
        { assetId: 'a', nodeIds: [] },
    ])('rejects an unacknowledged attachment without adopting its canvas', async response => {
        const { membership, attach, persistence, publish } = setup()
        attach.mockResolvedValueOnce(response)
        await expect(membership.attach({ assetId: 'a', nodeId: 'n', prepare: () => state() })).rejects.toThrow()
        expect(persistence.read()?.version.canvasStateUpdatedAt).toBe(5)
        expect(publish.mock.calls.some(([publication]) => publication.origin === 'authoritative')).toBe(false)
    })

    it('validates detach acknowledgment and publishes authoritative state without a local dirty patch', async () => {
        const { membership, detach, publish } = setup()
        await membership.detach({ assetId: 'a', nodeId: 'n', prepare: () => state() })
        expect(detach).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'one', assetId: 'a', nodeId: 'n' }))
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({ origin: 'authoritative', requiresSave: false }))
        detach.mockResolvedValueOnce({ success: false })
        await expect(membership.detach({ assetId: 'a', nodeId: 'n', prepare: () => state() })).rejects.toThrow('INVALID_ASSET_DETACH_RESPONSE')
    })

    it('does not dispatch when the view rejects preparation before transport', async () => {
        const { membership, attach } = setup()
        await expect(membership.attach({
            assetId: 'a',
            nodeId: 'n',
            prepare: () => {
                throw new Error('view disposed')
            },
        })).rejects.toThrow('view disposed')
        expect(attach).not.toHaveBeenCalled()
    })

    it('preserves the admitted request while transport is pending', async () => {
        const { membership, attach, persistence } = setup()
        const result = Promise.withResolvers<unknown>()
        attach.mockReturnValueOnce(result.promise)
        const draft = state()
        const operation = membership.attach({ assetId: 'a', nodeId: 'n', prepare: () => draft })
        await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
        draft.viewport.x = 200
        result.resolve({ assetId: 'a', nodeIds: ['n'] })
        await operation
        expect(persistence.read()?.canvasState.viewport.x).toBe(0)
    })

    it('returns a newer authoritative scene when it overtakes a membership reply', async () => {
        const { membership, attach, persistence } = setup()
        const response = Promise.withResolvers<unknown>()
        attach.mockReturnValueOnce(response.promise)
        const operation = membership.attach({ assetId: 'a', nodeId: 'n', prepare: () => state() })
        await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
        const authoritative = { ...state(), viewport: { x: 300, y: 0, zoom: 1 } }
        persistence.adoptAuthoritative({ canvasState: authoritative, version: { canvasStateUpdatedAt: 30 } })
        response.resolve({ assetId: 'a', nodeIds: ['n'] })
        expect(await operation).toEqual(authoritative)
        expect(persistence.read()?.version.canvasStateUpdatedAt).toBe(30)
    })
})
