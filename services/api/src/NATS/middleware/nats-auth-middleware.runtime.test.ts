import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import jsonWebToken from 'jsonwebtoken'
import {
    createHash,
    randomUUID,
} from 'node:crypto'
import { connect } from '@nats-io/transport-node'
import NatsService from '@lixpi/nats-service'
import {
    getCanvasCollaborationEventSubject,
    getNatsUserInboxPrefix,
    NATS_SUBJECTS,
    type CanvasCollaborationComposerEvent,
    type CanvasCollaborationPresenceEvent,
    type CanvasCollaborationSnapshot,
    type EncryptedCanvasCollaborationComposerEvent,
} from '@lixpi/constants'

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

const composerKeys = async () => {
    const pair = await crypto.subtle.generateKey({
        name: 'ECDH',
        namedCurve: 'P-256',
    }, false, ['deriveKey'])
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')

    return {
        reader: {
            inboxId: randomUUID(),
            publicKey,
        },
        privateKey: pair.privateKey,
    }
}

const decodeComposer = async (
    packet: EncryptedCanvasCollaborationComposerEvent,
    privateKey: CryptoKey,
): Promise<CanvasCollaborationComposerEvent> => {
    const publicKey = await crypto.subtle.importKey(
        'raw',
        Buffer.from(packet.publicKey, 'base64url'),
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        false,
        [],
    )
    const key = await crypto.subtle.deriveKey(
        {
            name: 'ECDH',
            public: publicKey,
        },
        privateKey,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['decrypt'],
    )
    const data = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: Buffer.from(packet.iv, 'base64url'),
        },
        key,
        Buffer.from(packet.ciphertext, 'base64url'),
    )

    return JSON.parse(new TextDecoder().decode(data)) as CanvasCollaborationComposerEvent
}

// =============================================================================
// Opt-in verification against the local API, NATS cluster, and LocalAuth0
// =============================================================================

describe.runIf(process.env.LIXPI_NATS_RUNTIME_TEST === 'true')('local NATS authentication', () => {
    it('serves versioned login assets with intact JavaScript and WebAssembly resources', async () => {
        const origin = 'http://lixpi-localauth0:3000'
        const authorization = new URL('/authorize', origin)
        authorization.search = new URLSearchParams({
            client_id: 'mock-client-id',
            audience: process.env.VITE_AUTH0_AUDIENCE!,
            redirect_uri: process.env.VITE_AUTH0_REDIRECT_URI!,
            scope: 'openid profile email',
            response_type: 'token',
            bypass: 'true',
        }).toString()
        const response = await fetch(authorization, { signal: AbortSignal.timeout(5000) })
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html.includes('<script type="module">')).toBe(true)
        const resources = [...html.matchAll(/<link\b[^>]*>/g)]
            .map(match => match[0])
            .filter(link => /rel="(?:modulepreload|preload)"/.test(link))

        expect(resources.some(link => link.includes('.wasm'))).toBe(true)
        expect(resources.some(link => link.includes('.js'))).toBe(true)
        expect(resources.some(link => link.includes('/snippets/'))).toBe(true)
        const assetPrefixes = new Set<string>()

        for (const link of resources) {
            const path = link.match(/href="([^"]+)"/)?.[1]
            const integrity = link.match(/integrity="([^"]+)"/)?.[1]
            expect(path).toMatch(/^\/frontend\/[a-f0-9]{64}\//)
            assetPrefixes.add(path!.match(/^\/frontend\/[a-f0-9]{64}\//)![0])
            const asset = await fetch(new URL(path!, origin), { signal: AbortSignal.timeout(5000) })
            expect(asset.status).toBe(200)
            const bytes = new Uint8Array(await asset.arrayBuffer())
            expect(`sha384-${createHash('sha384').update(bytes).digest('base64')}`).toBe(integrity)

            if (path!.endsWith('.wasm')) {
                expect(asset.headers.get('content-type')).toMatch(/application\/wasm/)
                expect(WebAssembly.validate(bytes)).toBe(true)
            } else
                expect(asset.headers.get('content-type')).toMatch(/javascript/)
        }

        expect(assetPrefixes.size).toBe(1)
    })

    it('rejects bad connection credentials, authenticates a user, and enforces request tokens', async () => {
        expect(process.env.VITE_MOCK_AUTH).toBe('true')
        const servers = ['nats://lixpi-nats-1:4222']

        await expect(NatsService.init({
            servers,
            token: 'invalid-runtime-test-token',
            initialConnectMaxAttempts: 1,
        })).rejects.toThrow()

        const tokenResponse = await fetch('http://lixpi-localauth0:3000/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: 'client_id',
                client_secret: 'client_secret',
                audience: process.env.VITE_AUTH0_AUDIENCE,
                grant_type: 'client_credentials',
            }),
            signal: AbortSignal.timeout(5000),
        })
        expect(tokenResponse.status).toBe(200)
        const { access_token: token } = await tokenResponse.json()
        expect(Boolean(token)).toBe(true)
        const claims = jsonWebToken.decode(token, { json: true })
        expect(claims?.sub).toBe('local|test-user-001')
        expect(claims?.email_verified).toBe(true)
        expect(claims?.['https://lixpi.ai/admission']).toEqual({
            v: 1,
            epoch: 1,
        })

        const service = await NatsService.init({
            servers,
            name: 'api-auth-runtime-test',
            token,
            inboxPrefix: getNatsUserInboxPrefix(claims!.sub!),
            initialConnectMaxAttempts: 1,
        })

        try {
            expect(service.isConnected()).toBe(true)

            const missingTokenReply = await service.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER, {})
            expect(missingTokenReply).toEqual({ error: 'Authentication required' })

            const invalidTokenReply = await service.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER, { token: 'invalid-runtime-test-token' })
            expect(invalidTokenReply).toEqual({ error: 'Authentication failed: Invalid or expired token' })

            const user = await service.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER, { token })
            expect(user.userId).toBe(claims!.sub)
            expect(Array.isArray(user.organizations)).toBe(true)
            expect(user.organizations.length).toBeGreaterThan(0)

            const trees = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE, { token })
            expect(Array.isArray(trees.organizations)).toBe(true)

            const name = `Local startup verification ${randomUUID()}`
            const { workspace } = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CREATE_WORKSPACE, {
                token,
                name,
            })
            expect(typeof workspace.workspaceId).toBe('string')

            try {
                const loaded = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                })
                expect(loaded.name).toBe(name)
                expect(loaded.organizationId).toBe(user.organizations[0])

                const subject = NATS_SUBJECTS.WORKSPACE_SUBJECTS.CANVAS_COLLABORATE
                const follower = await connect({
                    servers,
                    token,
                    inboxPrefix: getNatsUserInboxPrefix(user.userId),
                })
                const hostSession = randomUUID()
                const followerSession = randomUUID()
                const followerKeys = await composerKeys()
                const base = {
                    token,
                    workspaceId: workspace.workspaceId,
                }

                try {
                    const events = follower.subscribe(getCanvasCollaborationEventSubject(user.userId))
                    const host = await service.request(subject, {
                        ...base,
                        sessionId: hostSession,
                        action: 'join',
                    })
                    expect(host.actorId).toBeTruthy()
                    const followerAction = async (action: object) =>
                        (await follower.request(subject, JSON.stringify({
                            ...base,
                            sessionId: followerSession,
                            ...action,
                        }))).json()
                    const peer = await followerAction({
                        action: 'join',
                        composerReader: followerKeys.reader,
                    }) as CanvasCollaborationSnapshot
                    const viewerId = peer.actors.find(actor => actor.actorId === host.actorId)?.viewerId
                    expect(viewerId).toBeTruthy()
                    expect(peer.actors.find(actor => actor.actorId === peer.actorId)?.viewerId).toBe(viewerId)
                    expect(peer.actorId).toBeTruthy()
                    expect(peer.actorId).not.toBe(host.actorId)
                    await followerAction({
                        action: 'follow',
                        actorId: host.actorId,
                        sequence: 1,
                    })
                    const camera = {
                        x: -120,
                        y: 80,
                        zoom: 1.75,
                    }
                    await service.request(subject, {
                        ...base,
                        sessionId: hostSession,
                        action: 'presence',
                        sequence: 1,
                        camera,
                    })
                    const received: unknown[] = []
                    const timeout = setTimeout(() => events.unsubscribe(), 2500)

                    try {
                        for await (const message of events) {
                            const event = message.json<{
                                workspaceId: string
                                presence?: {
                                    actorId: string
                                    camera?: unknown
                                }
                            }>()

                            if (
                                event.workspaceId === workspace.workspaceId
                                && event.presence?.actorId === host.actorId
                            ) {
                                received.push(event.presence.camera)

                                break
                            }
                        }

                        expect(received).toEqual([camera])
                    } finally {
                        clearTimeout(timeout)
                        events.unsubscribe()
                    }

                    if (process.env.LIXPI_CANVAS_LATENCY_TEST === 'true') {
                        const timings: number[] = []
                        const bus = follower.subscribe(getCanvasCollaborationEventSubject(user.userId))
                        await follower.flush()
                        const stream = bus[Symbol.asyncIterator]()
                        const deadline = setTimeout(() => bus.unsubscribe(), 8000)

                        try {
                            for (let sequence = 2; sequence <= 41; sequence += 1) {
                                const started = performance.now()
                                const acknowledgement = service.request(subject, {
                                    ...base,
                                    sessionId: hostSession,
                                    action: 'presence',
                                    sequence,
                                    camera: {
                                        ...camera,
                                        x: camera.x + sequence,
                                    },
                                })
                                let delivered = false

                                while (!delivered) {
                                    const next = await stream.next()

                                    if (next.done)
                                        throw new Error('Camera latency sample timed out')

                                    const event = next.value.json<{
                                        workspaceId: string
                                        presence?: {
                                            actorId: string
                                            sequence: number
                                        }
                                    }>()
                                    delivered = event.workspaceId === workspace.workspaceId
                                        && event.presence?.actorId === host.actorId
                                        && event.presence.sequence === sequence
                                }

                                timings.push(performance.now() - started)
                                await acknowledgement
                                await new Promise(resolve => setTimeout(resolve, 50))
                            }

                            timings.sort((left, right) => left - right)
                            process.stdout.write(`Canvas local NATS delivery, 40 updates: median ${timings[19]!.toFixed(2)} ms, p95 ${timings[37]!.toFixed(2)} ms\n`)
                        } finally {
                            clearTimeout(deadline)
                            bus.unsubscribe()
                        }
                    }

                    const observerKeys = await composerKeys()
                    const observer = await connect({
                        servers,
                        token,
                        inboxPrefix: getNatsUserInboxPrefix(user.userId),
                    })
                    const ownInbox = getNatsUserInboxPrefix(user.userId)
                    const privateTopic = `${ownInbox}.canvas-composer.${followerKeys.reader.inboxId}`
                    const privateDelivery = follower.subscribe(privateTopic, { max: 1 })
                    const sameAccountInbox = observer.subscribe(`${ownInbox}.canvas-composer.*`, { max: 1 })
                    const ordinaryMessages: unknown[] = []
                    const publicObserver = observer.subscribe(getCanvasCollaborationEventSubject(user.userId), {
                        callback: (error, message) => {
                            if (!error)
                                ordinaryMessages.push(message.json())
                        },
                    })
                    const stopDraftWait = setTimeout(() => {
                        privateDelivery.unsubscribe()
                        sameAccountInbox.unsubscribe()
                    }, 3000)

                    try {
                        const observerSession = randomUUID()
                        const joinObserver = await observer.request(subject, JSON.stringify({
                            ...base,
                            sessionId: observerSession,
                            action: 'join',
                            composerReader: observerKeys.reader,
                        }))
                        const observerJoined = joinObserver.json<CanvasCollaborationSnapshot>()
                        expect(observerJoined.actorId).toBeTruthy()
                        expect(new Set(observerJoined.actors.map(actor => actor.actorId)).size).toBe(3)
                        expect(new Set(observerJoined.actors.map(actor => actor.viewerId))).toEqual(new Set([viewerId]))
                        await Promise.all([follower.flush(), observer.flush()])

                        const draftText = 'Synthetic private draft for runtime verification'
                        const draft = {
                            content: {
                                type: 'doc',
                                content: [{
                                    type: 'paragraph',
                                    content: [{
                                        type: 'text',
                                        text: draftText,
                                    }],
                                }],
                            },
                        }
                        const updates = await service.request(subject, {
                            ...base,
                            sessionId: hostSession,
                            action: 'presence',
                            sequence: 100,
                            composer: draft,
                        })
                        expect(updates.presenceSequence).toBe(100)

                        const [privatePacket, broadInboxPacket] = await Promise.all([
                            privateDelivery[Symbol.asyncIterator]().next(),
                            sameAccountInbox[Symbol.asyncIterator]().next(),
                        ])
                        expect(privatePacket.done).toBe(false)
                        expect(broadInboxPacket.done).toBe(false)

                        const encrypted = privatePacket.value!.json<EncryptedCanvasCollaborationComposerEvent>()
                        const visibleCiphertext = broadInboxPacket.value!.json<EncryptedCanvasCollaborationComposerEvent>()

                        expect(visibleCiphertext).toEqual(encrypted)
                        expect(JSON.stringify(visibleCiphertext)).not.toContain(draftText)
                        expect(await decodeComposer(encrypted, followerKeys.privateKey)).toMatchObject({
                            workspaceId: workspace.workspaceId,
                            recipientActorId: peer.actorId,
                            composerPresence: {
                                actorId: host.actorId,
                                composer: draft,
                            },
                        })
                        await expect(decodeComposer(visibleCiphertext, observerKeys.privateKey)).rejects.toThrow()

                        const probe = await observer.request(subject, JSON.stringify({
                            ...base,
                            sessionId: followerSession,
                            action: 'presence',
                            knownCanvasRevision: 0,
                            sequence: 101,
                        }))
                        expect(probe.string()).not.toContain(draftText)
                        expect(probe.string()).not.toContain(followerKeys.reader.inboxId)
                        const rebind = await observer.request(subject, JSON.stringify({
                            ...base,
                            sessionId: followerSession,
                            action: 'join',
                            composerReader: observerKeys.reader,
                        }))
                        expect(rebind.json()).toEqual({ error: 'CANVAS_COMPOSER_SESSION_BOUND' })
                        expect(JSON.stringify(ordinaryMessages)).not.toContain(draftText)
                        expect(ordinaryMessages.some(event => event && typeof event === 'object' && 'composerPresence' in event)).toBe(false)

                        const activityAt = Date.now()
                        await service.request(subject, {
                            ...base,
                            sessionId: hostSession,
                            action: 'presence',
                            sequence: 102,
                            activityAt: activityAt - 50,
                        })
                        const accountFollow = await followerAction({
                            action: 'follow',
                            actorId: null,
                            viewerId,
                            sequence: 2,
                        }) as CanvasCollaborationSnapshot
                        expect(accountFollow.actors.find(actor => actor.actorId === peer.actorId)).toMatchObject({
                            followingViewerId: viewerId,
                            followingActorId: host.actorId,
                        })
                        await observer.request(subject, JSON.stringify({
                            ...base,
                            sessionId: observerSession,
                            action: 'presence',
                            sequence: 1,
                            activityAt,
                        }))
                        const switched = await followerAction({
                            action: 'presence',
                            sequence: 103,
                            knownCanvasRevision: loaded.canvasStateUpdatedAt ?? loaded.updatedAt,
                        }) as CanvasCollaborationSnapshot
                        expect(switched.actors.find(actor => actor.actorId === peer.actorId)).toMatchObject({
                            followingViewerId: viewerId,
                            followingActorId: observerJoined.actorId,
                        })
                    } finally {
                        clearTimeout(stopDraftWait)
                        privateDelivery.unsubscribe()
                        sameAccountInbox.unsubscribe()
                        publicObserver.unsubscribe()
                        await observer.close()
                    }

                    await followerAction({
                        action: 'follow',
                        actorId: null,
                        sequence: 3,
                    })
                    const deliveries = follower.subscribe(getCanvasCollaborationEventSubject(user.userId))
                    await follower.flush()

                    try {
                        const asset = await service.request(NATS_SUBJECTS.ASSET_SUBJECTS.CREATE, {
                            token,
                            organizationId: loaded.organizationId,
                            originWorkspaceId: workspace.workspaceId,
                            scope: 'workspace',
                            scopeOwnerId: workspace.workspaceId,
                            title: 'Canvas sync fixture',
                            primaryCategory: 'document',
                        })
                        expect(asset.assetId).toBeTruthy()
                        const node = {
                            nodeId: randomUUID(),
                            type: 'document',
                            assetId: asset.assetId,
                            position: {
                                x: 20,
                                y: 30,
                            },
                            dimensions: {
                                width: 400,
                                height: 350,
                            },
                        }
                        const attached = await service.request(NATS_SUBJECTS.ASSET_SUBJECTS.ATTACH, {
                            ...base,
                            assetId: asset.assetId,
                            nodeId: node.nodeId,
                            workspaceMutation: {
                                canvasState: {
                                    ...loaded.canvasState,
                                    nodes: [node],
                                },
                                expectedCanvasStateUpdatedAt: loaded.canvasStateUpdatedAt ?? loaded.updatedAt,
                                canvasStateUpdatedAt: Math.max(Date.now(), (loaded.canvasStateUpdatedAt ?? loaded.updatedAt) + 1),
                            },
                        })
                        expect(attached.error).toBeUndefined()
                        const afterFirstAttach = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, base)
                        const secondNode = {
                            ...node,
                            nodeId: randomUUID(),
                            position: {
                                x: 90,
                                y: 95,
                            },
                        }
                        const secondAttach = await service.request(NATS_SUBJECTS.ASSET_SUBJECTS.ATTACH, {
                            ...base,
                            assetId: asset.assetId,
                            nodeId: secondNode.nodeId,
                            workspaceMutation: {
                                canvasState: {
                                    ...afterFirstAttach.canvasState,
                                    nodes: [node, secondNode],
                                },
                                expectedCanvasStateUpdatedAt: afterFirstAttach.canvasStateUpdatedAt,
                                canvasStateUpdatedAt: Math.max(Date.now(), afterFirstAttach.canvasStateUpdatedAt + 1),
                            },
                        })
                        expect(secondAttach.error).toBeUndefined()
                        const latest = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, base)
                        const independentCamera = {
                            x: 285,
                            y: -340,
                            zoom: 0.65,
                        }
                        const firstGeometry = {
                            nodeId: node.nodeId,
                            x: 105,
                            y: 80,
                            width: node.dimensions.width,
                            height: node.dimensions.height,
                        }
                        const secondGeometry = {
                            ...firstGeometry,
                            nodeId: secondNode.nodeId,
                            x: -170,
                            y: 125,
                        }
                        const geometryObserver = await connect({
                            servers,
                            token,
                            inboxPrefix: getNatsUserInboxPrefix(user.userId),
                        })
                        const intermediates = geometryObserver.subscribe(getCanvasCollaborationEventSubject(user.userId))
                        const geometryDeadline = setTimeout(() => intermediates.unsubscribe(), 3000)

                        try {
                            const observed = await geometryObserver.request(subject, JSON.stringify({
                                ...base,
                                sessionId: randomUUID(),
                                action: 'join',
                            }))
                            const observing = observed.json<CanvasCollaborationSnapshot>()
                            expect(observing.actors.find(actor => actor.actorId === observing.actorId)?.followingActorId).toBeFalsy()
                            await geometryObserver.flush()
                            const [firstLease, secondLease] = await Promise.all([
                                service.request(subject, {
                                    ...base,
                                    sessionId: hostSession,
                                    action: 'acquire',
                                    target: `node:${node.nodeId}`,
                                    requestId: randomUUID(),
                                }),
                                followerAction({
                                    action: 'acquire',
                                    target: `node:${secondNode.nodeId}`,
                                    requestId: randomUUID(),
                                }),
                            ])
                            expect(firstLease).toHaveProperty('lease.target', `node:${node.nodeId}`)
                            expect(secondLease).toHaveProperty('lease.target', `node:${secondNode.nodeId}`)

                            await Promise.all([
                                service.request(subject, {
                                    ...base,
                                    sessionId: hostSession,
                                    action: 'presence',
                                    sequence: 109,
                                    camera,
                                    geometry: [firstGeometry],
                                }),
                                followerAction({
                                    action: 'presence',
                                    sequence: 104,
                                    camera: independentCamera,
                                    geometry: [secondGeometry],
                                }),
                            ])
                            const previews = new Map<string, unknown>()

                            for await (const delivery of intermediates) {
                                const event = delivery.json<CanvasCollaborationPresenceEvent>()

                                if (
                                    event.workspaceId === workspace.workspaceId
                                    && event.presence?.geometry?.length
                                )
                                    previews.set(event.presence.actorId, event.presence.geometry)

                                if (previews.size === 2)
                                    break
                            }

                            expect(previews.get(host.actorId)).toEqual([firstGeometry])
                            expect(previews.get(peer.actorId)).toEqual([secondGeometry])
                            const uncommitted = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, base)
                            expect(uncommitted.canvasState.nodes).toEqual(latest.canvasState.nodes)
                            const isolated = await followerAction({
                                action: 'presence',
                                sequence: 105,
                                knownCanvasRevision: latest.canvasStateUpdatedAt,
                            }) as CanvasCollaborationSnapshot
                            expect(isolated.actors.find(actor => actor.actorId === host.actorId)?.camera).toEqual(camera)
                            expect(isolated.actors.find(actor => actor.actorId === peer.actorId)?.camera).toEqual(independentCamera)
                        } finally {
                            clearTimeout(geometryDeadline)
                            intermediates.unsubscribe()
                            await geometryObserver.close()
                        }

                        const moved = {
                            ...node,
                            position: {
                                x: 321,
                                y: -456,
                            },
                        }
                        const committed = await service.request(subject, {
                            ...base,
                            sessionId: hostSession,
                            action: 'commit',
                            requestId: randomUUID(),
                            baseCanvasRevision: latest.canvasStateUpdatedAt,
                            changes: { nodes: [moved] },
                        })
                        expect(committed.error).toBeUndefined()
                        const secondMoved = {
                            ...secondNode,
                            position: {
                                x: -222,
                                y: 160,
                            },
                        }
                        const secondCommit = await followerAction({
                            action: 'commit',
                            requestId: randomUUID(),
                            baseCanvasRevision: committed.canvasRevision,
                            changes: { nodes: [secondMoved] },
                        })
                        expect(secondCommit).toHaveProperty('canvasRevision')
                        const persisted = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, base)
                        expect(persisted.canvasState.nodes).toEqual([moved, secondMoved])
                        const deadline = setTimeout(() => deliveries.unsubscribe(), 3000)

                        try {
                            let receivedPosition = false

                            for await (const delivery of deliveries) {
                                const event = delivery.json<{
                                    workspaceId: string
                                    canvasState?: {nodes: typeof node[]}
                                }>()
                                receivedPosition = event.workspaceId === workspace.workspaceId
                                    && event.canvasState?.nodes.some(item => item.nodeId === node.nodeId && item.position.x === 321 && item.position.y === -456) === true
                                    && event.canvasState.nodes.some(item => item.nodeId === secondNode.nodeId && item.position.x === -222 && item.position.y === 160)

                                if (receivedPosition)
                                    break
                            }

                            expect(receivedPosition).toBe(true)
                        } finally {
                            clearTimeout(deadline)
                        }
                    } finally {
                        deliveries.unsubscribe()
                    }

                    const sharedCameraEvents = follower.subscribe(getCanvasCollaborationEventSubject(user.userId))
                    await follower.flush()
                    const stopSharedCameraWait = setTimeout(() => sharedCameraEvents.unsubscribe(), 2500)

                    try {
                        await service.request(subject, {
                            ...base,
                            sessionId: hostSession,
                            action: 'presence',
                            sequence: 110,
                            camera,
                            mainCameraAt: Date.now(),
                        })
                        let matchedCamera: CanvasCollaborationPresenceEvent['mainCamera']

                        for await (const message of sharedCameraEvents) {
                            const event = message.json<CanvasCollaborationPresenceEvent>()

                            if (
                                event.workspaceId === workspace.workspaceId
                                && event.mainCamera
                            ) {
                                matchedCamera = event.mainCamera

                                break
                            }
                        }

                        expect(matchedCamera).toMatchObject({
                            viewerId,
                            actorId: host.actorId,
                            camera,
                        })
                        const caughtUp = await followerAction({
                            action: 'presence',
                            sequence: 106,
                            knownCanvasRevision: loaded.canvasStateUpdatedAt ?? loaded.updatedAt,
                        }) as CanvasCollaborationSnapshot
                        expect(caughtUp.mainCamera).toEqual(matchedCamera)
                        expect(caughtUp.actors.find(actor => actor.actorId === peer.actorId)?.camera).toEqual(camera)
                    } finally {
                        clearTimeout(stopSharedCameraWait)
                        sharedCameraEvents.unsubscribe()
                    }

                    await followerAction({ action: 'leave' })
                    await service.request(subject, {
                        ...base,
                        sessionId: hostSession,
                        action: 'leave',
                    })
                } finally {
                    await follower.close()
                }

                const updated = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                    name: `${name} updated`,
                })
                expect(updated.tree.organizationId).toBe(user.organizations[0])
                const reloaded = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                })
                expect(reloaded.name).toBe(`${name} updated`)
            } finally {
                const deleted = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                })
                expect(deleted.deletedWorkspaceIds).toEqual([workspace.workspaceId])
            }
        } finally {
            await service.disconnect()
        }
    }, 20000)
})
