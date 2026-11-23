import { webcrypto } from 'node:crypto'
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import {
    type CanvasCollaborationRequest,
    type CanvasCollaborationComposerEvent,
    type CanvasCollaborationEvent,
} from '@lixpi/constants'
import { WorkspaceCanvasCollaborationClient } from './workspace-canvas-collaboration-client.ts'

const {
    request,
    subscribe,
    onReconnect,
} = vi.hoisted(() => ({
    request: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: () => {} })),
    onReconnect: vi.fn(() => () => {}),
}))

vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: {
        getData: () => ({
            request,
            subscribe,
            onReconnect,
        }),
    },
}))

const HEARTBEAT_TEST_INTERVAL_MS = 5000

const encryptComposer = async (
    recipient: string,
    event: CanvasCollaborationComposerEvent,
) => {
    const publicKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(Buffer.from(recipient, 'base64url')),
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        false,
        [],
    )
    const ephemeral = await crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        true,
        ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
        {
            name: 'ECDH',
            public: publicKey,
        },
        ephemeral.privateKey,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['encrypt'],
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
        },
        key,
        new TextEncoder().encode(JSON.stringify(event)),
    )

    return {
        publicKey: Buffer.from(await crypto.subtle.exportKey('raw', ephemeral.publicKey)).toString('base64url'),
        iv: Buffer.from(iv).toString('base64url'),
        ciphertext: Buffer.from(ciphertext).toString('base64url'),
    }
}

describe('WorkspaceCanvasCollaborationClient', () => {
    it('decrypts session-scoped composer updates only while following their author', async () => {
        vi.stubGlobal('crypto', webcrypto)
        const auth = {
            getTokenSilently: async () => 'token',
            userStore: { getData: () => 'user' },
        } as unknown as AuthClientInstance
        const workspaceId = 'workspace'
        const self = {
            actorId: 'actor',
            name: 'Local',
            kind: 'human' as const,
            followingActorId: 'peer',
        }
        const peer = {
            actorId: 'peer',
            name: 'Peer',
            kind: 'human' as const,
        }
        const snapshot = {
            workspaceId,
            actorId: self.actorId,
            revision: 1,
            canvasRevision: 1,
            actors: [self, peer],
            ownership: [],
            queue: [],
        }
        const changed = vi.fn<(event: CanvasCollaborationEvent, actorId: string) => void>()
        const client = new WorkspaceCanvasCollaborationClient(auth, workspaceId, changed)
        request.mockResolvedValue(snapshot)

        try {
            client.start()
            await vi.waitFor(() => expect(client.actorId).toBe(self.actorId))
            const subscriptions = subscribe.mock.calls as unknown as [string, (message: unknown) => void][]
            const room = subscriptions.find(([subject]) => subject.startsWith('workspace.canvas.events.'))![1]
            const scoped = subscriptions.find(([subject]) => subject.includes('.canvas-composer.'))![1]
            const join = request.mock.calls.map(call => call[1] as CanvasCollaborationRequest).find(action => action.action === 'join')
            const reader = join?.composerReader
            const draft = {
                actorId: 'peer',
                sequence: 1,
                composer: { content: { type: 'doc' } },
            }

            expect(reader?.inboxId).toBeTruthy()
            room({
                workspaceId,
                presence: {
                    actorId: 'peer',
                    sequence: 2,
                    cursor: {
                        x: 1,
                        y: 2,
                    },
                },
            })
            room({
                workspaceId,
                presence: {
                    actorId: 'peer',
                    sequence: 1,
                    camera: {
                        x: 42,
                        y: 20,
                        zoom: 1,
                    },
                },
            })
            expect(changed.mock.lastCall?.[0].actors[1]).toMatchObject({
                camera: {
                    x: 42,
                    y: 20,
                    zoom: 1,
                },
                cursor: {
                    x: 1,
                    y: 2,
                },
            })
            const message = {
                workspaceId,
                recipientActorId: self.actorId,
                composerPresence: draft,
            }
            room(message)
            expect(changed.mock.lastCall?.[0].actors[1].composer).toBeUndefined()

            const other = await encryptComposer(reader!.publicKey, {
                ...message,
                recipientActorId: 'other',
            })
            const authorized = await encryptComposer(reader!.publicKey, message)
            const selection = {
                anchor: 1,
                head: 2,
            }
            const caret = await encryptComposer(reader!.publicKey, {
                ...message,
                composerPresence: {
                    actorId: 'peer',
                    sequence: 2,
                    composerSelection: selection,
                },
            })
            scoped(other)
            scoped(caret)
            await vi.waitFor(() => expect(changed.mock.lastCall?.[0].actors[1].composerSelection).toEqual(selection))
            scoped(authorized)
            await vi.waitFor(() => expect(changed.mock.lastCall?.[0].actors[1].composer).toEqual(draft.composer))
            expect(changed.mock.lastCall?.[0].actors[1].composerSelection).toEqual(selection)

            room({
                ...snapshot,
                revision: 2,
                actors: [{
                    ...self,
                    followingActorId: null,
                }, peer],
            })
            const delayed = await encryptComposer(reader!.publicKey, {
                ...message,
                composerPresence: {
                    ...draft,
                    sequence: 2,
                },
            })
            scoped(delayed)
            expect(changed.mock.lastCall?.[0].actors[1].composer).toBeUndefined()
        } finally {
            client.destroy()
            vi.unstubAllGlobals()
        }
    })

    it('renders graph, drag, and Main camera updates received before the workspace join reply', async () => {
        vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID() })
        const workspaceId = 'workspace'
        const self = {
            actorId: 'local',
            name: 'Local',
            kind: 'human' as const,
        }
        const peer = {
            actorId: 'peer',
            name: 'Peer',
            kind: 'human' as const,
        }
        const auth = {
            getTokenSilently: async () => 'token',
            userStore: { getData: () => 'user' },
        } as unknown as AuthClientInstance
        const snapshot: CanvasCollaborationEvent = {
            workspaceId,
            actors: [self, peer],
            revision: 1,
            canvasRevision: 10,
            ownership: [],
            queue: [],
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        }
        const graph: NonNullable<CanvasCollaborationEvent['canvasState']> = {
            ...snapshot.canvasState!,
            nodes: [{
                type: 'document',
                nodeId: 'node',
                assetId: 'asset',
                position: {
                    x: 30,
                    y: 50,
                },
                dimensions: {
                    width: 200,
                    height: 300,
                },
            }],
        }
        const preview = {
            nodeId: 'node',
            x: 70,
            y: 90,
            width: 200,
            height: 300,
        }
        const mainCamera = {
            viewerId: 'peer-account',
            actorId: peer.actorId,
            sequence: 4,
            updatedAt: 500,
            camera: {
                x: 120,
                y: 75,
                zoom: 3,
            },
        }
        const join = Promise.withResolvers<unknown>()
        request.mockImplementation(async (_, action: CanvasCollaborationRequest) =>
            action.action === 'join' ? await join.promise : {
                workspaceId,
                actorId: self.actorId,
            },
        )
        const changed = vi.fn<(event: CanvasCollaborationEvent, actorId: string) => void>()
        const joined = vi.fn()
        const client = new WorkspaceCanvasCollaborationClient(auth, workspaceId, changed, joined)

        try {
            client.start()
            const room = (subscribe.mock.lastCall as unknown as [string, (message: unknown) => void])[1]
            room({
                ...snapshot,
                revision: 2,
                canvasRevision: 11,
                canvasState: graph,
            })
            room({
                ...snapshot,
                revision: 3,
                canvasRevision: 11,
                canvasState: undefined,
            })
            room({
                workspaceId,
                mainCamera,
                presence: {
                    actorId: peer.actorId,
                    sequence: 4,
                    geometry: [preview],
                },
            })
            room({
                workspaceId,
                mainCamera: {
                    ...mainCamera,
                    sequence: 3,
                    updatedAt: 499,
                },
                presence: {
                    actorId: peer.actorId,
                    sequence: 3,
                },
            })
            expect(changed).not.toHaveBeenCalled()

            join.resolve({
                ...snapshot,
                actorId: self.actorId,
            })

            await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
            expect(changed.mock.calls[0]?.[0]).toMatchObject({
                revision: 3,
                canvasRevision: 11,
                canvasState: graph,
                actors: [self, {
                    ...peer,
                    geometry: [preview],
                }],
            })
            expect(changed.mock.lastCall?.[0].mainCamera).toEqual(mainCamera)
            expect(joined).toHaveBeenCalledOnce()
            expect(changed.mock.invocationCallOrder[1]).toBeLessThan(joined.mock.invocationCallOrder[0])
            expect(request.mock.calls.map(call => call[1] as CanvasCollaborationRequest)).toContainEqual(
                expect.objectContaining({
                    action: 'presence',
                    knownCanvasRevision: 11,
                }),
            )
        } finally {
            client.destroy()
            vi.unstubAllGlobals()
        }
    })

    it('starts a new workspace join when NATS reconnects before the last join has replied', async () => {
        vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID() })
        const workspaceId = 'workspace'
        const self = {
            actorId: 'local',
            name: 'Local',
            kind: 'human' as const,
        }
        const auth = {
            getTokenSilently: async () => 'token',
            userStore: { getData: () => 'user' },
        } as unknown as AuthClientInstance
        const previous = Promise.withResolvers<unknown>()
        const snapshot = {
            workspaceId,
            actorId: self.actorId,
            actors: [self],
            revision: 2,
            canvasRevision: 10,
            ownership: [],
            queue: [],
        }
        let joins = 0
        request.mockImplementation(async (_, action: CanvasCollaborationRequest) => {
            if (action.action !== 'join')
                return {
                    workspaceId,
                    actorId: self.actorId,
                }

            joins += 1

            return joins === 1 ? await previous.promise : snapshot
        })
        const changed = vi.fn<(event: CanvasCollaborationEvent, actorId: string) => void>()
        const client = new WorkspaceCanvasCollaborationClient(auth, workspaceId, changed)

        try {
            client.start()
            await vi.waitFor(() => expect(joins).toBe(1))
            const [reconnect] = onReconnect.mock.lastCall as unknown as [() => void]
            reconnect()
            await vi.waitFor(() => expect(client.actorId).toBe(self.actorId))
            expect(joins).toBe(2)
            expect(changed.mock.lastCall?.[0].revision).toBe(2)

            previous.resolve({
                ...snapshot,
                revision: 1,
            })
            await previous.promise
            expect(changed).toHaveBeenCalledTimes(1)
        } finally {
            client.destroy()
            vi.unstubAllGlobals()
        }
    })

    it('bounds motion traffic and immediately sends the last pending delta after an in-flight request', async () => {
        vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID() })
        const actorId = 'actor'
        const workspaceId = 'workspace'
        const auth = {
            getTokenSilently: async () => 'token',
            userStore: { getData: () => 'user' },
        } as unknown as AuthClientInstance
        const snapshot = {
            workspaceId,
            actorId,
            revision: 1,
            canvasRevision: 1,
            actors: [],
            ownership: [],
            queue: [],
            canvasState: {
                nodes: [],
                edges: [],
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
            },
        }
        const pending = Promise.withResolvers<unknown>()
        const deltas: CanvasCollaborationRequest[] = []
        request.mockImplementation(async (_subject, action: CanvasCollaborationRequest) => {
            if (
                action.action !== 'presence'
                || action.knownCanvasRevision !== undefined
            )
                return snapshot

            deltas.push(action)

            return deltas.length === 1
                ? await pending.promise
                : {
                    workspaceId,
                    actorId,
                    presenceSequence: action.sequence,
                }
        })
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
        const client = new WorkspaceCanvasCollaborationClient(auth, workspaceId, vi.fn())

        try {
            client.start()
            await vi.advanceTimersByTimeAsync(60)
            client.update({ cursor: {
                x: 1,
                y: 1,
            } })
            await vi.advanceTimersByTimeAsync(0)

            for (let x = 2; x < 99; x++)
                client.update({ cursor: {
                    x,
                    y: x,
                } })

            client.activity(142)
            client.update({ selection: {
                nodeIds: ['selected'],
                edgeIds: [],
            } })
            client.update({ cursor: {
                x: 99,
                y: 99,
            } }, true)
            const mainCamera = {
                x: 80,
                y: 120,
                zoom: 2,
            }
            client.update({ camera: {
                x: 78,
                y: 119,
                zoom: 2,
            } }, false, 140)
            client.update({ camera: mainCamera }, true, 141)
            await vi.advanceTimersByTimeAsync(0)
            expect(deltas).toHaveLength(1)

            await vi.advanceTimersByTimeAsync(HEARTBEAT_TEST_INTERVAL_MS)

            pending.resolve({
                workspaceId,
                actorId,
                presenceSequence: 1,
            })
            await vi.advanceTimersByTimeAsync(0)

            expect(deltas).toHaveLength(2)
            const heartbeats = request.mock.calls.map(call => call[1] as CanvasCollaborationRequest)
                .filter(action => action.action === 'presence' && action.knownCanvasRevision !== undefined)
            expect(heartbeats.at(-1)).toMatchObject({
                cursor: {
                    x: 99,
                    y: 99,
                },
                selection: {
                    nodeIds: ['selected'],
                    edgeIds: [],
                },
            })
            expect(deltas[1]).toHaveProperty('camera', mainCamera)
            expect(deltas[1]).toHaveProperty('mainCameraAt', 141)
            expect(deltas[1]).toHaveProperty('activityAt', 142)
            expect(deltas[1]).not.toHaveProperty('cursor')
            expect(deltas[1]).not.toHaveProperty('selection')
            expect(heartbeats.at(-1)).not.toHaveProperty('activityAt')
            expect(heartbeats.at(-1)).not.toHaveProperty('mainCameraAt')
        } finally {
            client.destroy()
            vi.useRealTimers()
            vi.unstubAllGlobals()
        }
    })
})
