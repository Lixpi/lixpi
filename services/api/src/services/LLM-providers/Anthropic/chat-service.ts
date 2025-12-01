'use strict'

import process from 'process'
import fs from 'fs/promises'
import path from 'path'
import chalk from 'chalk'

import SQSService from '@lixpi/sqs-service'
import { MarkdownStreamParser } from '@lixpi/markdown-stream-parser'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

// import {
// } from '@lixpi/constants'

import type {
    AiModel,
    EventMeta
} from '@lixpi/constants'

import { resolveFilePath, readFileSynchronously } from '../../../helpers/file-loader.ts'
import { reportAiTokensUsage } from '../../../helpers/ai-tokens-usage-reporter.ts'
import AnthropicBaseClass from './base-class.ts'
import type { CircuitBreakerTrigger } from '../llm-provider-base-class.ts'

// Circuit breaker error message template
const TIMEOUT_ERROR = (elapsed: number) => `## 🚨  Error: Circuit Breaker triggered !
**Reason:** Processing timeout exceeded (${Math.floor(elapsed / 1000)}s)
**Info:** The AI response took too long to process and was automatically stopped to prevent system timeout. Please try simplifying your request or asking for a shorter response.
`

// Circuit breaker timeout trigger
const TIMEOUT_TRIGGER: CircuitBreakerTrigger = {
    name: 'timeout',
    shouldTrigger: (context) => context.elapsed > (20 * 60 * 1000), // 5 minutes
    getErrorMessage: (context) => TIMEOUT_ERROR(context.elapsed)
}

const env = process.env
const sqsService = new SQSService({
    region: process.env.AWS_REGION,
    ssoProfile: process.env.AWS_PROFILE,
})

// Load prompts
const SYSTEM_PROMPT = readFileSynchronously('src/services/LLM-providers/prompts/system.prompt', 'utf8')
const ANTHROPIC_CODE_BLOCK_HACK_PROMPT = readFileSynchronously('src/services/LLM-providers/prompts/Anthropic/code-block-hack.prompt', 'utf8')

// Saving the responses to a file for debugging purposes
const debugLLMResponses = async (responseChunks) => {
    // Load the temp directory for saving responses
    const tempAiResponsesDirPath = await resolveFilePath('temp-ai-responses')
    await fs.mkdir(tempAiResponsesDirPath, { recursive: true }).catch(console.error)

    const currentTime = new Date()
    const timestamp = currentTime.toISOString()

    await fs.writeFile(path.join(tempAiResponsesDirPath, `${timestamp}.json`), JSON.stringify(responseChunks, null, 4))
    await fs.writeFile(path.join(tempAiResponsesDirPath, `${timestamp}.txt`), responseChunks.join(''))
}

const appendToLastUserMessage = (arr, text) => {
    if (arr.length && typeof arr[arr.length - 1].content === 'string') {
        arr[arr.length - 1].content += text;
    }
    return arr;
};

class AnthropicChatService extends AnthropicBaseClass {
    static instances = new Map()

    static getInstance(instanceId) {
        if (!AnthropicChatService.instances.has(instanceId)) {
            const newInstance = new AnthropicChatService(instanceId)  // Use class name to refer to itself
            AnthropicChatService.instances.set(instanceId, newInstance)
        }

        infoStr([
            chalk.yellow('AiChatService -> '),
            'class.AnthropicChatService::::',
            chalk.green('getInstance'),
            '::instanceId:'
        ], {instanceId, instances: [...AnthropicChatService.instances]})
        return AnthropicChatService.instances.get(instanceId)
    }

    static removeInstance(instanceId) {
        if (AnthropicChatService.instances.has(instanceId)) {
            const instance = AnthropicChatService.instances.get(instanceId)
            instance.cleanup()
            AnthropicChatService.instances.delete(instanceId)

            infoStr([
                chalk.yellow('AiChatService -> '),
                'class.AnthropicChatService::',
                chalk.red('removeInstance'),
                '::instanceId:'
            ], {instanceId, instances: [...AnthropicChatService.instances]})
        }
    }

    constructor(instanceId) {
        if (!instanceId) {
            throw new Error('AI Chat Instance ID is required to create an instance of AnthropicChatService')
        }
        super(instanceId)

        this.markdownStreamParser = MarkdownStreamParser.getInstance(instanceId)

        // TODO this is probably deprecated, the code doesn't seem to be doing anything
        err('// TODO this is probably deprecated, the code doesnt seem to be doing anything')
        this.markdownStreamParserUnsubscribe = this.markdownStreamParser.subscribeToTokenParse((parsedSegment, unsubscribe) => {
            // Emit content to subscribed listeners
            this.notifyTokenReceive({
                ...parsedSegment,
                aiProvider: 'Anthropic'
            })

            if (parsedSegment.status === 'END_STREAM') {
                unsubscribe()
                MarkdownStreamParser.removeInstance(instanceId)
            }
        })
    }

    async generate({
            messages = [],
            aiModelMetaInfo,
            eventMeta,
        }: {
            messages: any[],
            aiModelMetaInfo: AiModel,
            eventMeta: EventMeta
        }) {
        const {
            provider,
            model,
            modelVersion,
            maxCompletionSize,
            defaultTemperature
        } = aiModelMetaInfo
        const aiRequestReceivedAt = new Date().getTime()

        this.interruptStream = false // Resetting the interrupt flag.

        // Store the response chunks for debugging
        const responseChunks = []

        const messagesWithPrompt = appendToLastUserMessage(messages, ANTHROPIC_CODE_BLOCK_HACK_PROMPT)

        const tokensUsage = {
            model: modelVersion,
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0
            }
        }

        infoStr([
            chalk.yellow('AiChatService -> '),
            ' :: ',
            chalk.green('call'),
            ' :: this.anthropic.chat.completions.create():'
        ], {modelVersion, maxCompletionSize, messages: messagesWithPrompt.map((el: any) => ({role: el.role, contentLength: el.content.length})), markdownStreamParser: this.markdownStreamParser})

        try {
            // Use local aliases to avoid TS complaints about properties declared in the base class
            const anthropicClient = (this as any).anthropic

            const stream = await anthropicClient.messages.create({
                model: modelVersion,
                messages: messagesWithPrompt,
                max_tokens: maxCompletionSize,
                system: SYSTEM_PROMPT,
                stream: true,
            })

            // Start parsing as soon as stream is established
            infoStr([
                chalk.yellow('AiChatService -> '),
                ' :: ',
                chalk.green('call'),
                ' :: this.markdownStreamParser.',
                chalk.green('startParsing()')
            ])
            this.markdownStreamParser.startParsing()

            let finalMessage = null

            // Initialize circuit breaker
            const circuitBreaker = this.createCircuitBreaker({ triggers: [TIMEOUT_TRIGGER] })

            // Iterate async stream events
            for await (const event of stream as any) {
                // Check circuit breaker limits
                const limitCheck = circuitBreaker.checkLimits()
                if (limitCheck.shouldBreak) {
                    err(`LLM_CIRCUIT_BREAK: Circuit breaker triggered - reason: ${limitCheck.reason}`);
                    break;
                }

                // Handle external interrupt
                if ((this as any).interruptStream) {
                    infoStr([
                        chalk.yellow('AiChatService -> '),
                        ' :: ',
                        chalk.red('call'),
                        ' :: this.interruptStream'
                    ])
                    this.markdownStreamParser.stopParsing()
                    break
                }

                // Text deltas
                if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta' && event?.delta?.text) {
                    const content = event.delta.text

                    this.markdownStreamParser.parseToken(content)

                    if (env.SAVE_LLM_RESPONSES_TO_DEBUG_DIR) {
                        responseChunks.push(content)
                    }
                }

                // Final message with usage arrives near the end
                if (event?.type === 'message') {
                    finalMessage = event.message
                }
            }

            // Stop parsing when stream ends
            infoStr([
                chalk.yellow('AiChatService -> '),
                ' :: ',
                chalk.green('call'),
                ' :: this.markdownStreamParser.',
                chalk.red('stopParsing()')
            ])
            this.markdownStreamParser.stopParsing()

            if (env.SAVE_LLM_RESPONSES_TO_DEBUG_DIR) {
                await debugLLMResponses(responseChunks)
            }

            // Report tokens usage if available
            if (finalMessage && finalMessage.usage) {
                const { id: aiVendorRequestId, usage } = finalMessage
                info('AnthropicService::finalMessage', { message: finalMessage })

                tokensUsage.usage.prompt_tokens = usage.input_tokens
                tokensUsage.usage.completion_tokens = usage.output_tokens

                reportAiTokensUsage({
                    eventMeta,
                    aiModelMetaInfo,

                    aiVendorRequestId,
                    aiVendorModelName: usage.model,
                    usage: {
                        promptTokens: usage.input_tokens,
                        promptAudioTokens: 0,    // Doesn't seem to be supported by Anthropic yet
                        promptCachedTokens: 0,    // Not using at the moment for Anthropic

                        completionTokens: usage.output_tokens,
                        completionAudioTokens: 0,    // Doesn't seem to be supported by Anthropic yet
                        completionReasoningTokens: 0,    // Doesn't seem to be supported by Anthropic yet

                        totalTokens: usage.input_tokens + usage.output_tokens
                    },
                    aiRequestReceivedAt,
                    aiRequestFinishedAt: new Date().getTime()
                })
            }

        } catch (error) {

            this.markdownStreamParser.stopParsing()

            throw new Error(error instanceof Error ? error.message : String(error)) //TODO: just a temp solution, we need a better way to propagate AI errors to the user
        }
    }
}

export default AnthropicChatService
