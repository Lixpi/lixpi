'use strict'

import { NATS_SUBJECTS, LoadingStatus, type AiChatThread, type AiChatThreadStatus } from '@lixpi/constants'

const { AI_CHAT_THREAD_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

import AuthService from '$src/services/auth-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { aiChatThreadStore } from '$src/stores/aiChatThreadStore.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'

class AiChatThreadService {
    constructor() {}

    public async getAiChatThread({ workspaceId, threadId }: { workspaceId: string; threadId: string }): Promise<AiChatThread | null> {
        aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const thread: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.GET_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            })

            if (thread.error) {
                aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.error })
                return null
            }

            aiChatThreadStore.setThread(thread)
            aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.success })

            return thread
        } catch (error) {
            console.error('Failed to load AI chat thread:', error)
            aiChatThreadStore.setMetaValues({ loadingStatus: LoadingStatus.error })
            return null
        }
    }

    public async getWorkspaceAiChatThreads({ workspaceId }: { workspaceId: string }): Promise<void> {
        try {
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

            const threads: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.GET_WORKSPACE_AI_CHAT_THREADS, {
                token: await AuthService.getTokenSilently(),
                workspaceId
            })

            aiChatThreadsStore.setThreads(Array.isArray(threads) ? threads : [])
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            console.error('Failed to load workspace AI chat threads:', error)
            aiChatThreadsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        }
    }

    public async createAiChatThread({ workspaceId, content, aiModel }: { workspaceId: string; content: any; aiModel: string }): Promise<AiChatThread | null> {
        try {
            const thread: any = await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                content,
                aiModel
            })

            if (thread.error) {
                console.error('AI chat thread creation error:', thread.error)
                return null
            }

            // Add thread to the threads store
            aiChatThreadsStore.addThread(thread)

            return thread
        } catch (error) {
            console.error('Failed to create AI chat thread:', error)
            return null
        }
    }

    public async updateAiChatThread({
        workspaceId,
        threadId,
        content,
        aiModel,
        status
    }: {
        workspaceId: string
        threadId: string
        content?: any
        aiModel?: string
        status?: AiChatThreadStatus
    }): Promise<void> {
        try {
            const updatePayload: any = {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            }

            if (content !== undefined) updatePayload.content = content
            if (aiModel !== undefined) updatePayload.aiModel = aiModel
            if (status !== undefined) updatePayload.status = status

            await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD, updatePayload)

            // Update in store
            aiChatThreadsStore.updateThread(threadId, { content, aiModel, status })
        } catch (error) {
            console.error('Failed to update AI chat thread:', error)
        }
    }

    public async deleteAiChatThread({ workspaceId, threadId }: { workspaceId: string; threadId: string }): Promise<void> {
        try {
            await servicesStore.getData('nats')!.request(AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                threadId
            })

            // Remove from store
            aiChatThreadsStore.removeThread(threadId)
        } catch (error) {
            console.error('Failed to delete AI chat thread:', error)
        }
    }
}

export default AiChatThreadService
