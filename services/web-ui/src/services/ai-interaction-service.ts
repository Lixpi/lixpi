'use strict'

import { NATS_SUBJECTS, AI_INTERACTION_CONSTANTS } from '@lixpi/constants'
import type { AiModelId, AiInteractionChatSendMessagePayload, AiInteractionChatStopMessagePayload } from '@lixpi/constants'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS
const { STREAM_STATUS } = AI_INTERACTION_CONSTANTS

import AuthService from './auth-service.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.js'
import { MarkdownStreamParser } from '@lixpi/markdown-stream-parser'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { organizationStore } from '$src/stores/organizationStore.ts'

export default class AiInteractionService {
    workspaceId: string
    aiChatThreadId: string
    segmentsReceiver: any
    markdownStreamParser: any
    markdownStreamParserUnsubscribe: any
    currentAiProvider: string | null

    constructor({ workspaceId, aiChatThreadId }: { workspaceId: string; aiChatThreadId: string }) {
        this.workspaceId = workspaceId
        this.aiChatThreadId = aiChatThreadId
        this.segmentsReceiver = SegmentsReceiver
        this.currentAiProvider = null

        this.initNatsSubscriptions()
    }

    initMarkdownParser() {
        // Clean up existing parser if any
        if (this.markdownStreamParser) {
            if (this.markdownStreamParserUnsubscribe) {
                this.markdownStreamParserUnsubscribe()
            }
            MarkdownStreamParser.removeInstance(this.aiChatThreadId)
        }

        // Initialize markdown stream parser (exact replication of backend pattern)
        this.markdownStreamParser = MarkdownStreamParser.getInstance(this.aiChatThreadId)

        // Subscribe to parsed segments from the markdown stream parser
        this.markdownStreamParserUnsubscribe = this.markdownStreamParser.subscribeToTokenParse((parsedSegment, unsubscribe) => {
            // Emit parsed content to segmentsReceiver with aiProvider and aiChatThreadId
            this.segmentsReceiver.receiveSegment({
                ...parsedSegment,
                aiProvider: this.currentAiProvider,
                aiChatThreadId: this.aiChatThreadId
            })

            // Cleanup on stream end
            if (parsedSegment.status === 'END_STREAM') {
                unsubscribe()
                MarkdownStreamParser.removeInstance(this.aiChatThreadId)
                this.currentAiProvider = null
            }
        })
    }

    async initNatsSubscriptions() {
        try {
            // Unsubscribe from all previous subscriptions to avoid duplicate receives
            servicesStore.getData('nats')!.getSubscriptions(['ai.interaction.chat.receiveMessage.*.*']).forEach(sub => sub.unsubscribe())

            if (!this.workspaceId || !this.aiChatThreadId)
                throw new Error('AiInteractionService requires workspaceId and aiChatThreadId')

            this.subscribeToChatMessages()
        } catch (error) {
            console.error('Failed to initialize NATS service:', error)
        }
    }

    async subscribeToChatMessages() {
        // Subscribe to responses for this specific workspace and thread
        servicesStore.getData('nats')!.subscribe(
            `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${this.workspaceId}.${this.aiChatThreadId}`,
            (data, msg) => {
                this.onChatMessageResponse(data)
            }
        )
    }


    onChatMessageResponse(data: any) {
        if(data?.error) {
            alert(`Failed to receive chat message: \n${JSON.stringify(data.error)}`)
            return
        }

        const { content } = data

        if (!content) {
            console.error('No content in AI chat message:', data)
            return
        }

        // Track current aiProvider for parser callback
        if (content.aiProvider) {
            this.currentAiProvider = content.aiProvider
        }

        // Route raw tokens through markdown parser (exact replication of backend pattern)
        if (content.status === STREAM_STATUS.START_STREAM) {
            // Initialize fresh parser instance for this stream
            this.initMarkdownParser()
            // startParsing() will emit START_STREAM event internally via subscribeToTokenParse callback
            this.markdownStreamParser.startParsing()
        } else if (content.status === STREAM_STATUS.STREAMING && content.text) {
            // Feed raw token to parser - it will emit parsed segments via subscribeToTokenParse callback
            this.markdownStreamParser.parseToken(content.text)
        } else if (content.status === STREAM_STATUS.END_STREAM) {
            // stopParsing() will emit END_STREAM event internally via subscribeToTokenParse callback
            this.markdownStreamParser.stopParsing()
        }
    }

    async sendChatMessage({ messages, aiModel }: Omit<AiInteractionChatSendMessagePayload, 'threadId'>) {
        const organizationId = organizationStore.getData('organizationId')
        const user = userStore.getData()

        const payload = {
            token: await AuthService.getTokenSilently(),
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            messages,
            aiModel,
            organizationId
        }
        servicesStore.getData('nats')!.publish(AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE, payload)
    }

    async stopChatMessage() {
        const payload = {
            token: await AuthService.getTokenSilently(),
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId
        }

        servicesStore.getData('nats')!.publish(AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE, payload)
    }

    disconnect() {}
}

