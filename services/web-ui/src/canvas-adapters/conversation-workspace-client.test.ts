import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getNatsUserSubjectToken, NATS_SUBJECTS, type ConversationEvent } from '@lixpi/constants'
import  { type AuthClientInstance } from '@lixpi/auth-client'
import  { type AssetService } from '$src/services/asset-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { ConversationWorkspaceClient } from './conversation-workspace-client.ts'

vi.mock('$src/stores/servicesStore.ts', () => ({ servicesStore: { getData: vi.fn() } }))
vi.mock('$src/stores/workspaceStore.ts', () => ({ workspaceStore: { getData: vi.fn() } }))

const auth = {
    getTokenSilently: vi.fn(async () => 'token'),
    userStore: { getData: () => 'user' },
    rejectAccess: vi.fn(),
    logout: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

describe('ConversationWorkspaceClient', () => {
    it('rebinds the private status subject after reconnect and releases both listeners on disposal', () => {
        let reconnect = () => {}
        const unsubscribers: Array<ReturnType<typeof vi.fn>> = []
        const callbacks: Array<(event: ConversationEvent) => void> = []
        const removeReconnect = vi.fn()
        const nats = {
            subscribe: vi.fn((_subject: string, callback: (event: ConversationEvent) => void) => {
                callbacks.push(callback)
                const unsubscribe = vi.fn()
                unsubscribers.push(unsubscribe)

                return { unsubscribe }
            }),
            onReconnect: vi.fn((listener: () => void) => { reconnect = listener

            return removeReconnect }),
        }
        vi.mocked(servicesStore.getData).mockReturnValue(nats as never)
        const client = new ConversationWorkspaceClient(auth as unknown as AuthClientInstance, {} as AssetService)
        const receive = vi.fn()
        const dispose = client.ports.subscribe('workspace', 'conversation', receive)
        expect(nats.subscribe).toHaveBeenCalledWith(`${NATS_SUBJECTS.CONVERSATION_SUBJECTS.STATUS}.${getNatsUserSubjectToken('user')}.workspace.conversation`, expect.any(Function))
        reconnect()
        expect(unsubscribers[0]).toHaveBeenCalledOnce()
        expect(nats.subscribe).toHaveBeenCalledTimes(2)
        callbacks[1]({} as ConversationEvent)
        expect(receive).toHaveBeenCalledOnce()
        dispose()
        expect(unsubscribers[1]).toHaveBeenCalledOnce()
        expect(removeReconnect).toHaveBeenCalledOnce()
        callbacks[1]({} as ConversationEvent)
        reconnect()
        expect(receive).toHaveBeenCalledOnce()
        expect(nats.subscribe).toHaveBeenCalledTimes(2)
    })

    it('propagates an unavailable responder without clearing authentication and accepts a later successful request', async () => {
        const request = vi.fn().mockRejectedValueOnce(new Error('no responders')).mockResolvedValueOnce({ conversationAssetId: 'conversation' })
        vi.mocked(servicesStore.getData).mockReturnValue({ request } as never)
        const client = new ConversationWorkspaceClient(auth as unknown as AuthClientInstance, {} as AssetService)
        const input = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
        }
        await expect(client.ports.get(input)).rejects.toThrow('no responders')
        expect(auth.rejectAccess).not.toHaveBeenCalled()
        expect(auth.logout).not.toHaveBeenCalled()
        await expect(client.ports.get(input)).resolves.toEqual({ conversationAssetId: 'conversation' })
        expect(request).toHaveBeenLastCalledWith(NATS_SUBJECTS.CONVERSATION_SUBJECTS.GET, {
            token: 'token',
            ...input,
        })
        expect(auth.getTokenSilently).toHaveBeenCalledTimes(2)
        expect(auth.getTokenSilently).toHaveBeenLastCalledWith()
    })
})
