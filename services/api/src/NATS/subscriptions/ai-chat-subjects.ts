'use strict'

import chalk from 'chalk'

import NATS_Service from '@lixpi/nats-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'
import { AI_CHAT_SUBJECTS, type AiModelId, type AiChatSendMessagePayload, type AiChatStopMessagePayload } from '@lixpi/constants'

import AiModel from '../../models/ai-model.ts'

import OpenAiChatService from '../../services/LLM-providers/OpenAI/chat-service.ts'
import AnthropicChatService from '../../services/LLM-providers/Anthropic/chat-service.ts'

export const aiChatSubjects = [
    {
        subject: AI_CHAT_SUBJECTS.SEND_MESSAGE,
        type: 'subscribe',
        queue: 'aiChat',
        payloadType: 'json',
        permissions: {
            pub: {
                allow: [
                    AI_CHAT_SUBJECTS.SEND_MESSAGE
                ]
            },
            sub: {
                allow: [
                    `${AI_CHAT_SUBJECTS.SEND_MESSAGE_RESPONSE}.>`
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
                threadId,
                documentId,
                organizationId
            } = data as {
                user: { userId: string; stripeCustomerId: string }
                documentId: string
                organizationId: string
            } & AiChatSendMessagePayload

            const [provider, model] = (aiModel as string).split(':')
            const natsService = await NATS_Service.getInstance();

            // Fetch AI model meta info
            const aiModelMetaInfo = await AiModel.getAiModel({ provider, model, omitPricing: false })

            if (!aiModelMetaInfo || !aiModelMetaInfo.modelVersion) {
                console.error('AI model meta info not found in the database', {aiModel})
                return
            }

            // One stream per thread - use documentId:threadId as unique key
            const instanceKey = `${documentId}:${threadId}`

            infoStr([
                chalk.cyan('🚀 [AI_CHAT] NEW REQUEST'),
                ' :: instanceKey:',
                chalk.yellow(instanceKey),
                ' :: provider:',
                chalk.green(provider)
            ])

            // Anthropic ---------------------------------------------------------------------------------------
            if (provider === 'Anthropic') {
                const anthropicChatService = AnthropicChatService.getInstance(instanceKey)

                try {
                    // Subscribe to chat content
                    anthropicChatService.subscribeToTokenReceive((content: any, unsubscribe: any) => {
                        natsService.publish(`${AI_CHAT_SUBJECTS.SEND_MESSAGE_RESPONSE}.${documentId}`, { content, threadId })

                        if (content.status === 'END_STREAM') {
                            infoStr([
                                chalk.green('✅ [AI_CHAT] STREAM COMPLETE'),
                                ' :: instanceKey:',
                                chalk.yellow(instanceKey),
                                ' :: Cleaning up'
                            ])
                            unsubscribe();
                            AnthropicChatService.removeInstance(instanceKey);
                        }
                    });

                    // Don't await - let it run concurrently so we can process next message immediately
                    anthropicChatService.generate({
                        messages,
                        aiModelMetaInfo,
                        eventMeta: {
                            userId,
                            stripeCustomerId,
                            organizationId,
                            documentId
                        }
                    })
                } catch (error) {
                    console.error('❌ [AI_CHAT] Anthropic error for instanceKey:', instanceKey, error)
                    natsService.publish(`${AI_CHAT_SUBJECTS.SEND_MESSAGE_RESPONSE}.${documentId}`, { error: error instanceof Error ? error.message : String(error) })
                }

            }
            // End AI Chat ---------------------------------------------------------------------------------------------------


            // OpenAI ---------------------------------------------------------------------------------------
            if (provider === 'OpenAI') {
                const openAiChatService = OpenAiChatService.getInstance(instanceKey)

                try {
                    // Subscribe to chat content
                    openAiChatService.subscribeToTokenReceive((content: any, unsubscribe: any) => {
                        natsService.publish(`${AI_CHAT_SUBJECTS.SEND_MESSAGE_RESPONSE}.${documentId}`, { content, threadId })

                        if (content.status === 'END_STREAM') {
                            infoStr([
                                chalk.green('✅ [AI_CHAT] STREAM COMPLETE'),
                                ' :: instanceKey:',
                                chalk.yellow(instanceKey),
                                ' :: Cleaning up'
                            ])
                            unsubscribe();
                            OpenAiChatService.removeInstance(instanceKey);
                        }
                    });

                    // Don't await - let it run concurrently so we can process next message immediately
                    openAiChatService.generate({
                        messages,
                        aiModelMetaInfo,
                        eventMeta: {
                            userId,
                            stripeCustomerId,
                            organizationId,
                            documentId
                        }
                    })

                } catch (error) {
                    console.error('❌ [AI_CHAT] OpenAI error for instanceKey:', instanceKey, error)
                    natsService.publish(`${AI_CHAT_SUBJECTS.SEND_MESSAGE_RESPONSE}.${documentId}`, { error: error instanceof Error ? error.message : String(error) })
                }
            }
        }
    },

    // Stop AI message streaming
    {
        subject: AI_CHAT_SUBJECTS.STOP_MESSAGE,
        type: 'subscribe',
        queue: 'aiChat',
        payloadType: 'json',
        permissions: {
            pub: {
                allow: [
                    AI_CHAT_SUBJECTS.STOP_MESSAGE
                ]
            }
        },
        handler: async (data, msg) => {
            const {
                user: {
                    userId
                },
                documentId,
                threadId
            } = data as {
                user: { userId: string }
                documentId: string
            } & AiChatStopMessagePayload

            infoStr([
                chalk.yellow('AiChatService -> '),
                'STOP_MESSAGE received :: ',
                chalk.red('Stopping stream'),
                ' :: documentId:',
                documentId,
                ' threadId:',
                threadId
            ])

            // Try to find and stop the active service instance for this thread
            // Check both Anthropic and OpenAI services since we don't know which one is active
            const instanceKey = `${documentId}:${threadId}`
            let serviceStopped = false

            if (AnthropicChatService.instances.has(instanceKey)) {
                const service = AnthropicChatService.getInstance(instanceKey)
                service.stopStream()
                serviceStopped = true
                infoStr([
                    chalk.green('✓ Stopped Anthropic service for instanceKey:'),
                    instanceKey
                ])
            }

            if (OpenAiChatService.instances.has(instanceKey)) {
                const service = OpenAiChatService.getInstance(instanceKey)
                service.stopStream()
                serviceStopped = true
                infoStr([
                    chalk.green('✓ Stopped OpenAI service for instanceKey:'),
                    instanceKey
                ])
            }

            if (!serviceStopped) {
                warn(`No active AI service found for instanceKey: ${instanceKey} (documentId: ${documentId}, threadId: ${threadId})`)
            }
        }
    },
]
