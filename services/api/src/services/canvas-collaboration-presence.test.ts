import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    getCanvasCollaborationEventSubject,
    getNatsUserInboxPrefix,
    NATS_SUBJECTS,
    type CanvasCollaborationComposerEvent,
    type EncryptedCanvasCollaborationComposerEvent,
} from '@lixpi/constants'
import { CanvasCollaborationPresenceRelay } from './canvas-collaboration-presence.ts'
import { emptyCanvasRoom } from './canvas-collaboration-state.ts'

const mocks = vi.hoisted(() => ({
    publish: vi.fn(),
    resolve: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: () => ({ getConnection: () => ({ publish: mocks.publish }) }) },
}))
vi.mock('./workspace-tree.ts', () => ({
    workspaceAccessResolver: () => ({ resolve: mocks.resolve }),
}))

const reader = async (inboxId: string) => {
    const keys = await crypto.subtle.generateKey({
        name: 'ECDH',
        namedCurve: 'P-256',
    }, false, ['deriveKey'])
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url')

    return {
        keys,
        registration: {
            inboxId,
            publicKey,
        },
    }
}

const decrypt = async (
    message: EncryptedCanvasCollaborationComposerEvent,
    privateKey: CryptoKey,
): Promise<CanvasCollaborationComposerEvent> => {
    const publicKey = await crypto.subtle.importKey(
        'raw',
        Buffer.from(message.publicKey, 'base64url'),
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
    const decoded = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: Buffer.from(message.iv, 'base64url'),
        },
        key,
        Buffer.from(message.ciphertext, 'base64url'),
    )

    return JSON.parse(new TextDecoder().decode(decoded)) as CanvasCollaborationComposerEvent
}

describe('Private canvas composer presence', () => {
    it('encrypts drafts for eligible follower sessions, including tabs on the same account', async () => {
        const relay = new CanvasCollaborationPresenceRelay()
        const state = emptyCanvasRoom()
        const workspaceId = 'workspace'
        const [observer, follower, transitive, revoked] = await Promise.all(
            ['observer', 'follower', 'transitive', 'revoked'].map(async tab => await reader(`${tab}-composers-private`)),
        )

        for (const [actorId, userId, followingActorId, key] of [
            ['speaker', 'speaker', undefined, undefined],
            ['observer', 'same-account', undefined, observer],
            ['follower', 'same-account', 'speaker', follower],
            ['transitive', 'another-account', 'follower', transitive],
            ['revoked', 'revoked', 'speaker', revoked],
            ['agent-follower', 'same-account', 'speaker', undefined],
        ] as const)
            state.participants[actorId] = {
                actor: {
                    actorId,
                    kind: actorId === 'agent-follower' ? 'agent' : 'human',
                    name: actorId,
                    ...(followingActorId ? { followingActorId } : {}),
                },
                userId,
                expiresAt: Date.now() + 60_000,
                followSequence: 1,
                ...(key ? { composerReader: key.registration } : {}),
            }

        mocks.resolve.mockResolvedValue({ status: 'granted' })
        await relay.authorize(workspaceId, 'revoked', true)
        mocks.resolve.mockImplementation(async ({ userId }) => ({
            status: userId === 'revoked' ? 'denied' : 'granted',
        }))

        const draft = {
            conversationAssetId: 'conversation',
            content: {
                type: 'doc',
                content: [{
                    type: 'text',
                    text: 'Unsent draft',
                }],
            },
        }

        relay.update(workspaceId, state, 'speaker', 5, {
            composer: draft,
            composerSelection: {
                anchor: 2,
                head: 3,
            },
        })

        await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(3))

        const events = new Map(mocks.publish.mock.calls.map(([subject, payload]) => [
            subject,
            JSON.parse(new TextDecoder().decode(payload)),
        ]))
        const followerInbox = `${getNatsUserInboxPrefix('same-account')}.canvas-composer.${follower!.registration.inboxId}`
        const observerInbox = `${getNatsUserInboxPrefix('same-account')}.canvas-composer.${observer!.registration.inboxId}`

        expect(events.has(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CANVAS_INTERNAL_PRESENCE)).toBe(true)
        expect(events.has(getCanvasCollaborationEventSubject('same-account'))).toBe(false)
        expect(events.has(observerInbox)).toBe(false)
        expect(events.has(followerInbox)).toBe(true)

        const encrypted = events.get(followerInbox) as EncryptedCanvasCollaborationComposerEvent

        expect(encrypted).not.toHaveProperty('composerPresence')
        expect(JSON.stringify(encrypted)).not.toContain('Unsent draft')
        expect(await decrypt(encrypted, follower!.keys.privateKey)).toMatchObject({
            recipientActorId: 'follower',
            composerPresence: {
                actorId: 'speaker',
                sequence: 5,
                composer: draft,
            },
        })
        await expect(decrypt(encrypted, observer!.keys.privateKey)).rejects.toThrow()
        expect(mocks.resolve).toHaveBeenCalledWith({
            workspaceId,
            userId: 'revoked',
        })

        const actor = state.participants.speaker!.actor

        expect(relay.merge(workspaceId, state, actor)).not.toHaveProperty('composer')
        expect(relay.composerSnapshot(workspaceId, state, 'observer', actor)).not.toHaveProperty('composer')
        expect(relay.composerSnapshot(workspaceId, state, 'agent-follower', actor)).toMatchObject({
            composer: draft,
            composerSequence: 5,
        })

        relay.update(workspaceId, state, 'speaker', 7, {
            composerSelection: {
                anchor: 9,
                head: 9,
            },
        })
        relay.update(workspaceId, state, 'speaker', 6, {
            composer: { content: {
                type: 'doc',
                text: 'Late draft',
            } },
            composerSelection: {
                anchor: 1,
                head: 1,
            },
        })
        expect(relay.composerSnapshot(workspaceId, state, 'agent-follower', actor)).toMatchObject({
            composer: { content: {
                type: 'doc',
                text: 'Late draft',
            } },
            composerSelection: {
                anchor: 9,
                head: 9,
            },
            composerSequence: 7,
        })
    })
})
