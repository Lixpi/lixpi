import {
    getNatsUserSubjectToken,
    NATS_SUBJECTS,
    type ConversationEvent,
} from '@lixpi/constants'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import type NatsService from '@lixpi/nats-service'
import {
    type WorkspaceConversationPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'

import { servicesStore } from '$src/stores/servicesStore.ts'
import {
    type AssetService,
} from '$src/services/asset-service.ts'

export class ConversationWorkspaceClient {
    readonly ports: WorkspaceConversationPorts

    constructor(
        private readonly auth: AuthClientInstance,
        assets: AssetService,
    ) {
        const subjects = NATS_SUBJECTS.CONVERSATION_SUBJECTS
        this.ports = {
            rename: async (
                workspaceId,
                conversationAssetId,
                title,
            ) => {
                const asset = await assets.get(conversationAssetId, workspaceId)

                if ('error' in asset)
                    throw new Error(asset.error)

                const result = await assets.updateMetadata(
                    conversationAssetId,
                    asset.revision,
                    { title },
                )

                if ('error' in result)
                    throw new Error(result.error)
            },
            create: request => this.request(subjects.CREATE, request),
            list: request => this.request(subjects.LIST, request),
            get: request => this.request(subjects.GET, request),
            messages: request => this.request(subjects.MESSAGES, request),
            submit: request => this.request(subjects.SUBMIT, request),
            settings: request => this.request(subjects.SETTINGS_UPDATE, request),
            stop: request => this.request(subjects.STOP, request),
            queue: request => this.request(subjects.QUEUE_UPDATE, request),
            replay: request => this.request(subjects.REPLAY, request),
            subscribe: (
                workspaceId,
                conversationAssetId,
                receive,
            ) => {
                const user = getNatsUserSubjectToken(
                    auth.userStore.getData('userId'),
                )
                const nats = servicesStore.getData('nats') as NatsService | null

                if (!nats)
                    throw new Error('The conversation connection is unavailable.')

                let subscription: ReturnType<NatsService['subscribe']> = null
                let closed = false
                const bind = () => {
                    if (closed)
                        return

                    subscription?.unsubscribe()
                    subscription = nats.subscribe(`${subjects.STATUS}.${user}.${workspaceId}.${conversationAssetId}`, (event: ConversationEvent) => {
                        if (!closed)
                            receive(event)
                    })

                    if (!subscription)
                        throw new Error('The conversation connection is unavailable.')
                }
                bind()
                const removeReconnect = nats.onReconnect(bind)

                return () => {
                    closed = true
                    removeReconnect()
                    subscription?.unsubscribe()
                }
            },
        }
    }

    private async request<T>(
        subject: string,
        payload: object,
    ): Promise<T> {
        const nats = servicesStore.getData('nats')

        if (!nats)
            throw new Error('The conversation connection is unavailable.')

        const result = (await nats.request(
            subject,
            {
                token: await this.auth.getTokenSilently(),
                ...payload,
            },
        )) as T | { error: unknown }

        if (!result)
            throw new Error('The conversation connection is unavailable.')

        if (
            result
            && typeof result === 'object'
            && 'error' in result
        )
            throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error))

        return result as T
    }
}
