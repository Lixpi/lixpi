'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import AiChatThread from '../../models/ai-chat-thread.ts'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { AI_CHAT_THREAD_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

export const aiChatThreadSubjects = [
    {
        subject: AI_CHAT_THREAD_SUBJECTS.GET_AI_CHAT_THREAD,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_CHAT_THREAD_SUBJECTS.GET_AI_CHAT_THREAD] },
            sub: { allow: [AI_CHAT_THREAD_SUBJECTS.GET_AI_CHAT_THREAD] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId, threadId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            return await AiChatThread.getAiChatThread({
                workspaceId,
                threadId
            })
        }
    },

    {
        subject: AI_CHAT_THREAD_SUBJECTS.GET_WORKSPACE_AI_CHAT_THREADS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_CHAT_THREAD_SUBJECTS.GET_WORKSPACE_AI_CHAT_THREADS] },
            sub: { allow: [AI_CHAT_THREAD_SUBJECTS.GET_WORKSPACE_AI_CHAT_THREADS] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            return await AiChatThread.getWorkspaceAiChatThreads({ workspaceId })
        }
    },

    {
        subject: AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD] },
            sub: { allow: [AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD] }
        },
        handler: async (data: any, msg: any) => {
            const {
                user: { userId },
                workspaceId,
                content,
                aiModel
            } = data

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            const thread = await AiChatThread.createAiChatThread({
                workspaceId,
                content,
                aiModel
            })

            return thread
        }
    },

    {
        subject: AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD] },
            sub: { allow: [AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId, threadId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            await AiChatThread.update({
                workspaceId,
                threadId,
                content: data.content,
                aiModel: data.aiModel,
                status: data.status
            })

            return {
                success: true,
                threadId
            }
        }
    },

    {
        subject: AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD] },
            sub: { allow: [AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId, threadId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            await AiChatThread.delete({
                workspaceId,
                threadId
            })

            return {
                success: true,
                threadId
            }
        }
    }
]
