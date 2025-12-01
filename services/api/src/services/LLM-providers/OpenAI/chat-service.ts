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

import OpenAiBaseClass from './base-class.ts'
import type { CircuitBreakerTrigger } from '../llm-provider-base-class.ts'
import { numTokensFromMessages } from './tiktoken-tokens-counter.ts'
import { reportAiTokensUsage } from '../../../helpers/ai-tokens-usage-reporter.ts'

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

class OpenAiChatService extends OpenAiBaseClass {
    static instances = new Map()

    static getInstance(instanceId) {
        if (!OpenAiChatService.instances.has(instanceId)) {
            const newInstance = new OpenAiChatService(instanceId)  // Use class name to refer to itself
            OpenAiChatService.instances.set(instanceId, newInstance)
        }

        infoStr([
            chalk.yellow('AiChatService -> '),
            'class.OpenAiChatService::::',
            chalk.green('getInstance'),
            '::instanceId:'
        ], {instanceId, instances: [...OpenAiChatService.instances]})
        return OpenAiChatService.instances.get(instanceId)
    }

    static removeInstance(instanceId) {
        if (OpenAiChatService.instances.has(instanceId)) {
            const instance = OpenAiChatService.instances.get(instanceId)
            instance.cleanup()
            OpenAiChatService.instances.delete(instanceId)

            infoStr([
                chalk.yellow('AiChatService -> '),
                'class.OpenAiChatService::',
                chalk.red('removeInstance'),
                '::instanceId:'
            ], {instanceId, instances: [...OpenAiChatService.instances]})
        }
    }

    constructor(instanceId) {
        if (!instanceId) {
            throw new Error('AI Chat Instance ID is required to create an instance of OpenAiChatService')
        }
        super(instanceId)

        // this.markdownStreamParser = MarkdownStreamParser
        this.markdownStreamParser = MarkdownStreamParser.getInstance(instanceId)

        // TODO this is probably deprecated, the code doesn't seem to be doing anything
        err('// TODO this is probably deprecated, the code doesnt seem to be doing anything')
        this.markdownStreamParserUnsubscribe = this.markdownStreamParser.subscribeToTokenParse((parsedSegment, unsubscribe) => {
            // Emit content to subscribed listeners
            this.notifyTokenReceive({
                ...parsedSegment,
                aiProvider: 'OpenAI'
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
            defaultTemperature,
            supportsSystemPrompt,
        } = aiModelMetaInfo
        const aiRequestReceivedAt = new Date().getTime()

        this.interruptStream = false // Resetting the interrupt flag.

        const messagesWithSystem = [
            ...(supportsSystemPrompt ? [{role: 'system', content: SYSTEM_PROMPT}] : []),
            ...messages
        ]

        const responseChunks = []    // Store the response chunks for edge case when the stream is interrupted and tokens stats need to be calculated by tiktoken. And also for debugging purposes.

        //TODO: check if prompt tokens amount does not exceed the model limit
        // Count prompt tokens
        // tokensUsage.usage.prompt_tokens = numTokensFromMessages(messages, modelVersion)
        if (false) { //PLACEHOLDER
            console.error(`${chalk.yellow('AiChatService ->')}  :: ${chalk.red('error')} :: ${chalk.red('tokensUsage.usage.prompt_tokens > this.maxTokens')}`, {tokensUsage, maxTokens: this.maxTokens})
            return
        }

        infoStr([
            chalk.yellow('AiChatService -> '),
            ' :: ',
            chalk.green('call'),
            ' :: this.openai.chat.completions.create():'
        ], {modelVersion, maxCompletionSize, messages: messagesWithSystem.map(el => ({role: el.role, contentLength: el.content.length})), markdownStreamParser: this.markdownStreamParser})

        // Add timeout protection
        const STREAM_TIMEOUT = 5 * 60 * 1000; // 5 minutes timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('OpenAI stream timeout')), STREAM_TIMEOUT);
        });

        try {
            const response = await Promise.race([
                this.openai.chat.completions.create({
                    model: modelVersion,
                    messages: messagesWithSystem,
                    temperature: defaultTemperature,
                    max_completion_tokens: maxCompletionSize,
                    stream: true,
                    store: false,
                    stream_options: {
                        include_usage: true
                    }
                }),
                timeoutPromise
            ]) as any;

            infoStr([
                chalk.yellow('AiChatService -> '),
                ' :: ',
                chalk.green('call'),
                ' :: this.markdownStreamParser.',
                chalk.green('startParsing()')
            ])

            this.markdownStreamParser.startParsing()

            // Initialize circuit breaker
            const circuitBreaker = this.createCircuitBreaker({ triggers: [TIMEOUT_TRIGGER] })

            for await (const data of response) {
                // Check circuit breaker limits
                const limitCheck = circuitBreaker.checkLimits()
                if (limitCheck.shouldBreak) {
                    err(`LLM_CIRCUIT_BREAK: Circuit breaker triggered - reason: ${limitCheck.reason}`);
                    break;
                }

                const {
                    id: aiVendorRequestId,
                    choices,    // Response chunks
                    usage    // Tokens usage stats
                } = data

                // info('OpenAiChatService::generate', {data})

                // Update tokens usage stats when available in the last chunk
                if (usage !== null) {
                    info('usage', {data})

                    reportAiTokensUsage({
                        eventMeta,
                        aiModelMetaInfo,

                        aiVendorRequestId,
                        aiVendorModelName: usage.model,
                        usage: {
                            promptTokens: usage.prompt_tokens,
                            promptAudioTokens: usage.prompt_tokens_details.audio_tokens,
                            promptCachedTokens: usage.prompt_tokens_details.cached_tokens,

                            completionTokens: usage.completion_tokens,
                            completionAudioTokens: usage.completion_tokens_details.audio_tokens,
                            completionReasoningTokens: usage.completion_tokens_details.reasoning_tokens,

                            totalTokens: usage.total_tokens
                        },
                        aiRequestReceivedAt,
                        aiRequestFinishedAt: new Date().getTime()
                    })
                }

                // When include_usage is true we need to handle empty choices in the last chunk
                if (choices.length > 0) {
                    const { finish_reason: finishReason, delta } = choices[0]
                    const { content } = delta

                    //TODO: use `finishReason` variable destructured from `choices[0]` to handle the end of the stream, refer to the API documentation for more details

                    if (content) {
                        if (this.interruptStream) {
                            infoStr([
                                chalk.yellow('AiChatService -> '),
                                ' :: ',
                                chalk.red('call'),
                                ' :: this.interruptStream'
                            ], {content})
                            this.markdownStreamParser.stopParsing()
                            break
                        }

                        this.markdownStreamParser.parseToken(content)

                        // Store the response chunks
                        responseChunks.push(content)
                    }
                }
            }
            // const receivedSystemMessage = [{content: responseChunks.join('')}]

            // TODO: make sure that the stream is interrupted and tokens properly counted even if session, e.g. if user closes the browser or network connection is lost
            // if (this.interruptStream) {
            //     tokensUsage.usage.completion_tokens = numTokensFromMessages(receivedSystemMessage, model)
            // }

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

        } catch (error) {
            // throw error
            this.markdownStreamParser.stopParsing()

            throw new Error(error instanceof Error ? error.message : String(error)) //TODO: just a temp solution, we need a better way to propagate AI errors to the user
        }
    }
}

export default OpenAiChatService
