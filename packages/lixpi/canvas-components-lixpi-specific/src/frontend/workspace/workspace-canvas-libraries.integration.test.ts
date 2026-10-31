// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AssetMeta, type CanvasState } from '@lixpi/constants'
import { WorkspaceCanvasLibraries, type WorkspaceCanvasLibrariesPorts } from './workspace-canvas-libraries.ts'

const owners: WorkspaceCanvasLibraries[] = []
const fixture = () => {
    let scene = 1
    let workspaceId = 'workspace'
    const meta = {
        assetId: 'audio-export',
        title: 'Sequence export.wav',
        primaryCategory: 'audio',
        scope: 'workspace',
        scopeOwnerId: workspaceId,
        scopeAndOwner: `workspace#${workspaceId}`,
        byteSize: 768000,
        durationSeconds: 4,
    } as AssetMeta
    const state: CanvasState = {
        nodes: [],
        edges: [],
        viewport: {
            x: 0,
            y: 0,
            zoom: 1,
        },
    }
    const attachAsset = vi.fn(async (request: { canvasState: CanvasState }) => request.canvasState)
    const commit = vi.fn()
    const ports = {
        document,
        host: {
            settings: {
                helpTooltip: { interactiveHideDelayMs: 0 },
                mediaNode: { image: { defaultInsertionWidth: 240 } },
            },
            media: { prepareRenditionUrls: async () => () => '/authorized-audio' },
            assets: {},
            createId: () => 'audio-node',
        },
        getWorkspaceId: () => workspaceId,
        getCanvasState: () => state,
        captureAdmission: () => { const admittedScene = scene

            return () => admittedScene === scene },
        createLibraryPorts: () => ({
            document,
            workspaceId,
            userId: 'user',
            assets: { list: async () => ({ items: [meta] }) },
            onError: vi.fn(),
        }),
        createAssetViewPorts: () => ({ mountEditor: vi.fn() }),
        insertNode: node => ({
            ...state,
            nodes: [{
                ...node,
                position: {
                    x: 0,
                    y: 0,
                },
            }],
        }),
        attachAsset,
        commit,
    } as unknown as WorkspaceCanvasLibrariesPorts
    const owner = new WorkspaceCanvasLibraries(ports)
    owners.push(owner)
    const host = document.createElement('div')
    document.body.append(host)
    const unmount = owner.mount(host, 'media')!
    const button = async () => {
        await vi.waitFor(() => expect(host.querySelector('[data-action="insert"]')).not.toBeNull())

        return host.querySelector<HTMLButtonElement>('[data-action="insert"]')!
    }

    return {
        owner,
        host,
        button,
        unmount,
        attachAsset,
        commit,
        refreshScene: () => void (scene++),
        depart: () => { workspaceId = 'another-workspace'; scene++ },
    }
}

afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()

    document.body.replaceChildren()
})

describe('workspace library action admission', () => {
    it('places an exported audio Asset through the existing panel after the scene refreshes', async () => {
        const f = fixture()
        await f.button()
        f.unmount()
        f.refreshScene()
        f.owner.mount(f.host, 'media')
        ;(await f.button()).click()
        await vi.waitFor(() => expect(f.commit).toHaveBeenCalledOnce())
        expect(f.attachAsset).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'audio-export',
            nodeId: 'node-audio-node',
        }))
        expect(f.commit.mock.calls[0][0].nodes[0]).toMatchObject({
            type: 'audio',
            assetId: 'audio-export',
            dimensions: {
                width: 360,
                height: 96,
            },
        })
    })

    it('does not apply an attachment reply to a departed workspace', async () => {
        const f = fixture()
        const pending = Promise.withResolvers<CanvasState>()
        f.attachAsset.mockImplementationOnce(() => pending.promise)
        ;(await f.button()).click()
        await vi.waitFor(() => expect(f.attachAsset).toHaveBeenCalledOnce())
        f.depart()
        pending.resolve(f.attachAsset.mock.calls[0][0].canvasState)
        await vi.waitFor(() => expect(f.host.textContent).toContain('Could not add'))
        expect(f.commit).not.toHaveBeenCalled()
    })

    it('does not apply an attachment reply after its library is released', async () => {
        const f = fixture()
        const pending = Promise.withResolvers<CanvasState>()
        f.attachAsset.mockImplementationOnce(() => pending.promise)
        ;(await f.button()).click()
        await vi.waitFor(() => expect(f.attachAsset).toHaveBeenCalledOnce())
        f.owner.release()
        pending.resolve(f.attachAsset.mock.calls[0][0].canvasState)
        await pending.promise
        await Promise.resolve()
        expect(f.commit).not.toHaveBeenCalled()
    })
})
