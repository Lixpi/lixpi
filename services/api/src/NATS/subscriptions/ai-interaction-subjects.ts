'use strict'

import chalk from 'chalk'

import NATS_Service from '@lixpi/nats-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'
import { NATS_SUBJECTS, type AiModelId, type AiInteractionChatSendMessagePayload, type AiInteractionChatStopMessagePayload } from '@lixpi/constants'

import AiModel from '../../models/ai-model.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS

export const aiInteractionSubjects = [
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: {
                allow: [
                    AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE
                ]
            },
            sub: {
                allow: [
                    `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.>`
                ]
            }
        },
        handler: async (data, msg) => {
            const {
                user: {
                    userId,
                    stripeCustomerId
                },
                messages,
                aiModel,
                workspaceId,
                aiChatThreadId,
                organizationId
            } = data as {
                user: { userId: string; stripeCustomerId: string }
                workspaceId: string
                aiChatThreadId: string
                organizationId: string
            } & AiInteractionChatSendMessagePayload

            const [provider, model] = (aiModel as string).split(':')
            const natsService = await NATS_Service.getInstance();

            try {
                // Fetch AI model meta info with pricing (for llm-api service)
                const aiModelMetaInfo = await AiModel.getAiModel({ provider, model, omitPricing: false })

                if (!aiModelMetaInfo || !aiModelMetaInfo.modelVersion) {
                    err('AI model meta info not found in the database', { aiModel })

                    // Publish error directly to client
                    natsService.publish(`${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`, {
                        error: `AI model not found: ${aiModel}`
                    })
                    return
                }

                // One stream per thread - use workspaceId:aiChatThreadId as unique key
                const instanceKey = `${workspaceId}:${aiChatThreadId}`

                infoStr([
                    chalk.cyan('🚀 [AI_INTERACTION] GATEWAY'),
                    ' :: Forwarding to llm-api',
                    ' :: instanceKey:',
                    chalk.yellow(instanceKey),
                    ' :: provider:',
                    chalk.green(provider)
                ])

                // Forward request to llm-api service via internal NATS subject
                natsService.publish(AI_INTERACTION_SUBJECTS.CHAT_PROCESS, {
                    messages,
                    aiModelMetaInfo,
                    workspaceId,
                    aiChatThreadId,
                    eventMeta: {
                        userId,
                        stripeCustomerId,
                        organizationId,
                        workspaceId,
                        aiChatThreadId
                    }
                })

                infoStr([
                    chalk.green('✅ [AI_INTERACTION] GATEWAY'),
                    ' :: Request forwarded to llm-api',
                    ' :: instanceKey:',
                    chalk.yellow(instanceKey)
                ])

            } catch (error) {
                err('❌ [AI_INTERACTION] GATEWAY ERROR:', error)

                // Publish error to client
                natsService.publish(`${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }
    },

    // Stop AI message streaming
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: {
                allow: [
                    AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE
                ]
            }
        },
        handler: async (data, msg) => {
            const {
                user: {
                    userId
                },
                workspaceId,
                aiChatThreadId
            } = data as {
                user: { userId: string }
                workspaceId: string
                aiChatThreadId: string
            }

            const natsService = await NATS_Service.getInstance()
            const instanceKey = `${workspaceId}:${aiChatThreadId}`

            infoStr([
                chalk.yellow('🛑 [AI_INTERACTION] GATEWAY'),
                ' :: Relaying STOP to llm-api',
                ' :: instanceKey:',
                chalk.red(instanceKey)
            ])

            // Relay stop request to llm-api service
            natsService.publish(`${AI_INTERACTION_SUBJECTS.CHAT_STOP}.${instanceKey}`, {
                workspaceId,
                aiChatThreadId,
                userId
            })

            infoStr([
                chalk.green('✅ [AI_INTERACTION] GATEWAY'),
                ' :: STOP request relayed to llm-api',
                ' :: instanceKey:',
                chalk.yellow(instanceKey)
            ])
        }
    },

    // Handle errors from llm-api service
    {
        subject: `${AI_INTERACTION_SUBJECTS.CHAT_ERROR}.>`,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            sub: {
                allow: [
                    `${AI_INTERACTION_SUBJECTS.CHAT_ERROR}.>`
                ]
            }
        },
        handler: async (data, msg) => {
            const { error, instanceKey } = data as { error: string; instanceKey: string }

            const natsService = await NATS_Service.getInstance()

            // Extract workspaceId and aiChatThreadId from instanceKey (format: workspaceId:aiChatThreadId)
            const [workspaceId, aiChatThreadId] = instanceKey.split(':')

            err('❌ [AI_INTERACTION] ERROR from llm-api:', { instanceKey, error })

            // Forward error to client
            natsService.publish(`${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`, {
                error
            })
        }
    },
]
