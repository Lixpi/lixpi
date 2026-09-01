// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CapabilityArtifactCanvasNode,
    type ImageCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceCanvasAssets,
    type WorkspaceCanvasAssetsPorts,
} from './workspace-canvas-assets.ts'

const image: ImageCanvasNode = {
    nodeId: 'image-1',
    type: 'image',
    assetId: 'asset-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
}

describe('WorkspaceCanvasAssets', () => {
    it('reads descriptors and parses artifact provenance', () => {
        const host = {
            assets: {
                read: () => ({ descriptor: { content: 'image' } }),
                readDocument: () => ({ doc: { text: 'provenance' }, version: 1 }),
            },
            extractText: () => '{"input":{"prompt":"draw"}}',
        }
        const owner = new WorkspaceCanvasAssets({ host } as WorkspaceCanvasAssetsPorts)
        const artifact = {
            nodeId: 'artifact-1',
            type: 'capabilityArtifact',
            assetId: 'asset-artifact',
            artifactTypeId: 'chart',
            position: { x: 0, y: 0 },
            dimensions: { width: 100, height: 100 },
        } as CapabilityArtifactCanvasNode

        expect(owner.getDescriptor(image)).toEqual({ content: 'image' })
        expect(owner.getArtifactProvenance(artifact)).toEqual({ input: { prompt: 'draw' } })
    })

    it('upserts successful metadata updates and refreshes chrome', async () => {
        const upsert = vi.fn()
        const refreshChrome = vi.fn()
        const updated = { assetId: 'asset-1', revision: 2 }
        const host = {
            settings: { helpTooltip: { interactiveHideDelayMs: 10 } },
            workspace: { userId: () => 'user-1' },
            assets: {
                read: vi.fn(),
                readDocument: vi.fn(),
                updateMetadata: vi.fn(async () => updated),
                changeScope: vi.fn(),
                attestSubjectIdentity: vi.fn(),
                upsert,
            },
        }
        const owner = new WorkspaceCanvasAssets({
            host,
            document,
            editors: { mountAsset: vi.fn() },
            getWorkspaceId: () => 'workspace-1',
            refreshChrome,
            reportError: vi.fn(),
        } as WorkspaceCanvasAssetsPorts)
        const ports = owner.createViewPorts()

        await ports.updateMetadata('asset-1', 1, { title: 'Updated' })
        ports.onChanged()

        expect(upsert).toHaveBeenCalledWith(updated)
        expect(refreshChrome).toHaveBeenCalledOnce()
    })
})
