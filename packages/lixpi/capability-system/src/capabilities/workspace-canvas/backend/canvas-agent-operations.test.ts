import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasCollaborationPresence,
    type CanvasCollaborationSnapshot,
    type CanvasState,
} from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    createCoreDocumentKindRegistry,
} from '@lixpi/prosemirror'
import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'
import { CanvasAgentOperations } from './canvas-agent-operations.ts'
import { createCanvasAgentTools } from './canvas-agent-tools.ts'
import {
    createCanvasDocumentContent,
    prepareCanvasDocumentStep,
} from './canvas-agent-documents.ts'
import {
    type CanvasAgentSession,
} from './canvas-agent-ports.ts'

const fixture = () => {
    const signal = new AbortController().signal
    const state: CanvasState = {
        viewport: {
            x: 200,
            y: 100,
            zoom: 2,
        },
        nodes: [{
            type: 'document',
            nodeId: 'a',
            assetId: 'asset-a',
            position: {
                x: 100,
                y: 200,
            },
            dimensions: {
                width: 400,
                height: 350,
            },
        }, {
            type: 'document',
            nodeId: 'b',
            assetId: 'asset-b',
            parentId: 'a',
            position: {
                x: 40,
                y: 10,
            },
            dimensions: {
                width: 20,
                height: 60,
            },
        }],
        edges: [{
            edgeId: 'edge-a',
            sourceNodeId: 'a',
            targetNodeId: 'b',
        }],
    }
    const snapshot: CanvasCollaborationSnapshot = {
        workspaceId: 'workspace',
        actorId: 'agent',
        canvasRevision: 12,
        revision: 18,
        canvasState: state,
        actors: [{
            actorId: 'agent',
            kind: 'agent',
            name: 'Agent',
            camera: {
                x: 5,
                y: 10,
                zoom: 0.5,
            },
        }],
        ownership: [],
        queue: [],
    }
    const session: CanvasAgentSession = {
        requestId: 'tool-call',
        importPublicMedia: vi.fn(),
        signal,
        inspect: vi.fn(async () => snapshot),
        updatePresence: vi.fn(async (presence: CanvasCollaborationPresence) => ({
            ...snapshot,
            actors: snapshot.actors.map(actor => ({
                ...actor,
                ...presence,
            })),
        })),
        follow: vi.fn(async followingActorId => ({
            ...snapshot,
            actors: snapshot.actors.map(actor => ({
                ...actor,
                followingActorId,
            })),
        })),
        acquire: vi.fn(async target => ({
            target,
            actorId: 'agent',
            leaseId: `lease-${target}`,
        })),
        release: vi.fn(async () => {}),
        commit: vi.fn(async () => ({
            ...snapshot,
            canvasRevision: 13,
        })),
        createDocument: vi.fn(async () => {}),
        resolvePlacement: vi.fn((_, node) => node.position),
        prepareManagedRemoval: vi.fn(async () => undefined),
        attachAsset: vi.fn(async () => {}),
        detachAsset: vi.fn(async () => {}),
        replaceAsset: vi.fn(async () => {}),
        readAsset: vi.fn(async assetId => ({
            assetId,
            title: assetId,
            revision: 1,
            documents: {},
        })),
        renameAsset: vi.fn(),
        readDocument: vi.fn(),
        editDocument: vi.fn(),
    }

    return {
        operations: new CanvasAgentOperations(session),
        session,
        snapshot,
    }
}

describe('canvas agent operations', () => {
    it('reports one viewer per person with their active device while retaining independent actors', async () => {
        const {
            operations,
            snapshot,
        } = fixture()
        snapshot.actors.push(
            {
                actorId: 'tab-earlier',
                kind: 'human',
                name: 'Person',
                viewerId: 'viewer-person',
                lastActiveAt: 4,
            },
            {
                actorId: 'tab-active',
                kind: 'human',
                name: 'Person',
                viewerId: 'viewer-person',
                lastActiveAt: 7,
            },
            {
                actorId: 'tab-other',
                kind: 'human',
                name: 'Other',
                viewerId: 'viewer-other',
            },
        )

        await expect(operations.inspect()).resolves.toMatchObject({
            viewers: [
                {
                    viewerId: 'viewer-person',
                    actorId: 'tab-active',
                    name: 'Person',
                },
                {
                    viewerId: 'viewer-other',
                    actorId: 'tab-other',
                    name: 'Other',
                },
            ],
            actors: snapshot.actors,
        })
    })

    it('moves the independent actor camera to the world position of a nested node', async () => {
        const {
            operations,
            session,
        } = fixture()

        await operations.navigate({
            focusNodeId: 'b',
            zoom: 4,
        })

        expect(session.updatePresence).toHaveBeenCalledExactlyOnceWith({
            camera: {
                x: 150,
                y: 240,
                zoom: 4,
            },
        })
        expect(session.commit).not.toHaveBeenCalled()
    })

    it('places imported media through the same membership transaction as existing Assets', async () => {
        const {
            operations,
            session,
        } = fixture()
        vi.mocked(session.importPublicMedia).mockResolvedValue({ assetId: 'imported' })
        vi.mocked(session.readAsset).mockResolvedValue({
            assetId: 'imported',
            title: 'Clip',
            revision: 1,
            documents: {},
            media: {
                kind: 'video',
                aspectRatio: 2,
            } as never,
        })
        const position = {
            x: 30,
            y: 70,
        }
        await operations.importMedia('https://media.example/clip.mp4', { position })

        expect(session.attachAsset).toHaveBeenCalledWith(expect.objectContaining({
            node: expect.objectContaining({
                type: 'video',
                assetId: 'imported',
                position,
            }),
        }))
        expect(session.createDocument).not.toHaveBeenCalled()
    })

    it('opens an edge menu using a connection identity', async () => {
        const {
            operations,
            session,
        } = fixture()
        const menu = {
            kind: 'edge',
            edgeId: 'edge-a',
        }

        await operations.presence({ menu })

        expect(session.updatePresence).toHaveBeenCalledExactlyOnceWith({ menu })
    })

    it('preserves a reparented node’s world position while committing with its lease', async () => {
        const {
            operations,
            session,
        } = fixture()

        await operations.editGeometry([{
            nodeId: 'b',
            parentId: null,
        }])

        expect(session.commit).toHaveBeenCalledExactlyOnceWith(
            12,
            { nodes: [expect.objectContaining({
                nodeId: 'b',
                position: {
                    x: 140,
                    y: 210,
                },
            })] },
            [{
                target: 'node:b',
                actorId: 'agent',
                leaseId: 'lease-node:b',
            }],
        )
        expect(session.release).toHaveBeenCalledOnce()
        expect(session.updatePresence).toHaveBeenLastCalledWith({ geometry: [] })
    })

    it('releases acquired targets when human ownership invalidates the commit', async () => {
        const {
            operations,
            session,
        } = fixture()
        vi.mocked(session.commit).mockRejectedValueOnce(new Error('CANVAS_LEASE_LOST'))

        await expect(operations.editGeometry([
            {
                nodeId: 'b',
                offset: {
                    x: 15,
                    y: 5,
                },
            },
            {
                nodeId: 'a',
                dimensions: {
                    width: 450,
                    height: 350,
                },
            },
        ])).rejects.toThrow('CANVAS_LEASE_LOST')

        expect(vi.mocked(session.acquire).mock.calls).toEqual([['node:a'], ['node:b']])
        expect(session.release).toHaveBeenCalledTimes(2)
    })

    it('plans generated-output deletion before the asset removal path', async () => {
        const {
            operations,
            session,
        } = fixture()
        const execute = vi.fn(async () => true)
        vi.mocked(session.prepareManagedRemoval).mockResolvedValue({
            targets: ['node:generated'],
            execute,
        })

        await operations.remove('a')

        expect(session.acquire).toHaveBeenCalledWith('node:generated')
        expect(execute).toHaveBeenCalledOnce()
        expect(session.detachAsset).not.toHaveBeenCalled()
    })

    it('uses tool schemas that reject mismatched placement and document branches', () => {
        const { session } = fixture()
        const tools = createCanvasAgentTools(async () => session)
        const place = tools.find(tool => tool.name === 'create_canvas_node')
        const edit = tools.find(tool => tool.name === 'edit_canvas_document')

        expect(validateJsonSchemaValue(place?.schema, {
            kind: 'document',
            title: 'Story',
        }).valid).toBe(true)
        expect(validateJsonSchemaValue(place?.schema, {
            kind: 'asset',
            assetId: 'asset-a',
            title: 'Story',
        }).valid).toBe(false)
        expect(validateJsonSchemaValue(edit?.schema, {
            nodeId: 'a',
            role: 'content',
            expectedVersion: 2,
            edit: {
                from: 1,
                to: 1,
                text: 'Start',
            },
        }).valid).toBe(true)
    })
})

describe('canvas agent rich-text edits', () => {
    const document = () => new HeadlessProseMirrorEngine({
        registry: createCoreDocumentKindRegistry(),
        kindId: DOCUMENT_TYPE.ASSET_CONTENT,
        doc: createCanvasDocumentContent('alpha'),
        version: 2,
    })

    it('produces one ProseMirror step with the same resulting document', () => {
        const engine = document()
        const prepared = prepareCanvasDocumentStep(engine, {
            from: 1,
            to: 6,
            text: 'beta',
        })

        expect(prepared?.after).toEqual(createCanvasDocumentContent('beta'))
        expect(engine.applyStepJson(prepared!.step).version).toBe(3)
        expect(engine.snapshot()).toEqual(prepared?.after)
    })

    it('rejects an invalid document range before producing a step', () => {
        expect(() => prepareCanvasDocumentStep(document(), {
            from: 10,
            to: 20,
            text: 'beta',
        }))
            .toThrow('CANVAS_DOCUMENT_STEP_INVALID')
    })
})
